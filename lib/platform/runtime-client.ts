import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import {
  bedrockRuntimeModel,
  runtimeContextSchema,
  runtimeReplyWithUsageSchema,
  type RuntimeModel,
} from "./runtime-model";
import { StudioError } from "../studio/store";
import { agentFailureCode, safeAwsName, safeAwsStatus } from "./runtime-failure";
import { streamEvents } from "./event-stream";
export function episodeRuntimeScope(session: { projectId: string; releaseId: string; ownerHash: string; id: string }) {
  return createHash("sha256").update(JSON.stringify(["botfactory-runtime/1", session.projectId, session.releaseId, session.ownerHash, session.id])).digest("hex");
}
export function episodeIdFromStart(scope: { projectId: string; releaseId: string; ownerHash: string }, requestId: string) {
  const buf = createHash("sha256").update(JSON.stringify(["botfactory-episode/1", scope.projectId, scope.releaseId, scope.ownerHash, requestId])).digest().subarray(0, 16);
  buf[6] = (buf[6] & 15) | 128; // RFC 9562 UUIDv8, application-defined bytes.
  buf[8] = (buf[8] & 63) | 128;
  return buf.toString("hex").replace(/^(........)(....)(....)(....)/, "$1-$2-$3-$4-");
}
const cloudConfig = () => ({
  arn: process.env.STUDIO_AGENTCORE_RUNTIME_ARN ?? "",
  region: process.env.STUDIO_AGENTCORE_REGION ?? "ap-northeast-2",
  profile: process.env.STUDIO_AGENTCORE_PROFILE,
});
export async function warmCloudPlayerEpisode(s: Parameters<typeof episodeRuntimeScope>[0], signal?: AbortSignal) {
  const { arn, region, profile } = cloudConfig();
  const client = new BedrockAgentCoreClient({ region, maxAttempts: 1, ...(profile ? { credentials: fromIni({ profile }) } : {}) });
  try {
    const result = await client.send(new InvokeAgentRuntimeCommand({ agentRuntimeArn: arn, runtimeSessionId: episodeRuntimeScope(s),
      contentType: "application/json", accept: "application/json", payload: Buffer.from('{"schemaVersion":"runtime-warmup/1"}'),
    }), { abortSignal: AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]) });
    const body = JSON.parse(await result.response!.transformToString());
    return result.statusCode === 200 && body.schemaVersion === "runtime-warmup/1" && body.ready === true;
  } catch { return false; }
  finally { client.destroy(); }
}
/** Only a provider-declared provisioning conflict is safe to retry before inference. */
export async function invokeAfterProvisioning<T>(invoke: () => Promise<T>, signal: AbortSignal, retry: boolean, sleep = pause) {
  let remaining = 33000;
  for (let backoff = 500; ; backoff = Math.min(backoff * 2, 3000)) {
    try { signal.throwIfAborted(); return await invoke(); }
    catch (error) {
      if (!retry || (error as { name?: string }).name !== "RetryableConflictException" || remaining < backoff) throw error;
      remaining -= backoff;
      await sleep(backoff, undefined, { signal });
    }
  }
}
export async function invokeCloudRuntime(
  context: Parameters<RuntimeModel>[0],
  config: { arn: string; region: string; profile?: string },
  signal?: AbortSignal,
  execution?: { episodeScope?: string; onTextDelta?: (text: string) => void | Promise<void> },
) {
  if (
    !/^arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[a-zA-Z0-9_-]+$/.test(
      config.arn,
    )
  )
    throw new StudioError(503, "AgentCore Runtime ARN 설정을 확인하세요.");
  const client = new BedrockAgentCoreClient({
    region: config.region,
    maxAttempts: 1,
    ...(config.profile
      ? { credentials: fromIni({ profile: config.profile }) }
      : {}),
  });
  // Hosted player turns reuse only their authenticated episode's isolated
  // compute. Canon, transcripts and memories still belong to DynamoDB.
  const scope = execution?.episodeScope;
  const runtimeSessionId = scope && /^[a-f0-9]{64}$/.test(scope) ? scope : randomUUID();
  const schemaVersion = context.entities ? "character-turn/2" : "character-turn/1";
  const since = (mark: number) => Math.max(0, Math.round(performance.now() - mark));
  let agentCoreHeadersMs = 0, agentCoreBodyMs = 0, agentCoreStopMs = 0;
  let phase = "invoke";
  let reply: Awaited<ReturnType<RuntimeModel>>;
  try {
    const payload = Buffer.from(JSON.stringify({ schemaVersion, context: runtimeContextSchema.parse(context) }));
    const started = performance.now();
    const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: config.arn,
        runtimeSessionId,
        contentType: "application/json",
        accept: execution?.onTextDelta ? "text/event-stream" : "application/json",
        payload,
      });
    const deadline = AbortSignal.any([
          AbortSignal.timeout(150000),
          ...(signal ? [signal] : []),
        ]);
    const result = await invokeAfterProvisioning(() => client.send(command, { abortSignal: deadline }), deadline, runtimeSessionId === scope);
    agentCoreHeadersMs = since(started);
    phase = "body";
    const reading = performance.now();
    let raw;
    if (execution?.onTextDelta) {
      let streamed = "";
      for await (const { event, data } of streamEvents(result.response! as AsyncIterable<Uint8Array>)) {
        if (event === "dialogue.delta") {
          const value = z.string().max(6000).parse(data.text);
          streamed += value;
          if (streamed.length > 6000) throw Error("Dialogue exceeds stream limit");
          await execution.onTextDelta(value);
        }
        if (event === "runtime.error") throw new StudioError(502, "모델 스트림이 완료되지 않았습니다. 저장하지 않았습니다.");
        if (event === "runtime.complete") raw = data;
      }
      if (!raw || raw.reply?.text !== streamed.trim()) throw Error("Incomplete dialogue stream");
    } else raw = JSON.parse(await result.response!.transformToString());
    agentCoreBodyMs = since(reading);
    phase = "reply";
    const failure = agentFailureCode.safeParse(raw?.errorCode);
    if (result.statusCode === 200 && raw?.schemaVersion === schemaVersion && failure.success) {
      console.info(JSON.stringify({ event: "agentcore_player_failure", phase, code: failure.data, agentCoreHeadersMs }));
      throw new StudioError(failure.data === "model_format" || failure.data === "model_limit" ? 422 : failure.data === "model_provider" ? 503 : 502,
        "문장 형식이나 모델 응답을 확인하지 못했습니다. 저장하지 않았습니다. 잠시 후 다시 보내 주세요.");
    }
    if (result.statusCode !== 200 || raw.error || raw.schemaVersion !== schemaVersion)
      throw new StudioError(
        502,
        "AgentCore의 모델 실행이 실패했습니다. 기존 회차는 유지됩니다.",
      );
    reply = runtimeReplyWithUsageSchema.parse(raw.reply);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    console.info(JSON.stringify({ event: "agentcore_player_failure", phase, awsError: safeAwsName(error), awsHttpStatus: safeAwsStatus(error), agentCoreHeadersMs }));
    throw new StudioError(
      502,
      "AgentCore 호출에 실패했습니다. 프로필·권한·리전·런타임 상태를 확인하세요.",
    );
  } finally {
    // Disposable callers still receive the original explicit cleanup.
    // Episode compute expires using the configured idle timer.
    if (runtimeSessionId !== scope) {
      const stopping = performance.now();
      await client.send(new StopRuntimeSessionCommand({ agentRuntimeArn: config.arn, runtimeSessionId }),
        { abortSignal: AbortSignal.timeout(5000) }).catch(() => {});
      agentCoreStopMs = since(stopping);
    }
    client.destroy();
  }
  return { ...reply, ...(reply.usage ? { usage: { ...reply.usage, agentCoreHeadersMs, agentCoreBodyMs, agentCoreStopMs } } : {}) };
}
export const configuredRuntimeModel: RuntimeModel = (context, signal, execution) =>
  process.env.STUDIO_RUNTIME_BACKEND === "agentcore"
    ? invokeCloudRuntime(
        context,
        cloudConfig(),
        signal, execution,
      )
    : bedrockRuntimeModel(context, signal);
