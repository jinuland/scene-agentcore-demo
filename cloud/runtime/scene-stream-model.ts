import { BedrockRuntimeClient, ConverseStreamCommand, type ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { Sha256 } from "../../lib/studio/bedrock-mantle";
import { SignatureV4 } from "@smithy/signature-v4";
import { dialogueModelSettings, gptMantleEffort } from "../../lib/platform/dialogue-modes";
import { responseLanguageInstruction, type RuntimeModel } from "../../lib/platform/runtime-model";
import { streamEvents } from "../../lib/platform/event-stream";
import { hasSceneDialogue } from "../../lib/platform/story-beats";
import { StudioError } from "../../lib/studio/store";

// Clients reuse connections across turns; session state never lives in these clients.
const clients = new Map<string, BedrockRuntimeClient>();
const clientFor = (region: string) => {
  if (!clients.has(region)) clients.set(region, new BedrockRuntimeClient({ region, maxAttempts: 1 }));
  return clients.get(region)!;
};

export function sceneStreamPrompt(context: Parameters<RuntimeModel>[0]) {
  const language = context.responseLanguage === "en" ? "English, roughly 160–300 words" : context.responseLanguage === "ja" ? "日本語400〜800字程度" : "한국어 400~800자";
  return [
    "당신은 캐릭터 챗의 한 인물이다. 현재 인물의 말투·관점·알고 있는 사실로 사용자의 마지막 말에 직접 반응한다.",
    `대사와 필요한 장면·행동만 ${language}로 쓴다. 짧게 답할 상황은 더 짧아도 된다. JSON, 도구 호출, INFO창, 이름표, 표정 태그, 메타 설명과 내부 추론은 출력하지 않는다.`,
    "필요할 때만 [행동]과 [대사] 태그로 구분한다. 설정 설명과 같은 질문을 반복하지 않고, 실제로 달라진 상황에 맞는 반응이나 작은 다음 행동을 제시한다.",
    "이번 발언이 허용된 행동의 실행을 명시하면 그 행동에 대한 인물의 반응과 관찰 가능한 작은 결과까지 이어간다. 새 선택이 필요하지 않은데 준비나 동의 질문만 반복하며 멈추지 않는다. 근거 없이 합격·능력·문제 해결을 확정하지 않는다.",
    "플레이어의 새 말·행동·감정·능력을 대신 확정하지 않는다. 사용자 주장과 희망을 확정된 세계 사실로 바꾸지 않는다. 현재 사건·장소·시간·인물의 소통 방식·일정·미공개 사실의 범위를 지킨다.",
    "기억은 발언한 사람의 주장이다. 근거가 없으면 모른다고 자연스럽게 말한다. 현재 상태의 확정 사건은 이미 반영됐으므로 다시 동의를 요구하거나 도입으로 되돌리지 않는다.",
    context.policy,
    JSON.stringify({ character: context.character, scene: context.scene, facts: context.visibleFacts,
      boundaries: context.boundaries, memories: context.memories, recent: context.recent }),
    responseLanguageInstruction(context.responseLanguage),
  ].join("\n");
}

/** Plain dialogue output for the demo. Structured state is computed independently. */
export const sceneStreamModel: RuntimeModel = async (context, signal, execution) => {
  const settings = dialogueModelSettings(context.dialogueMode);
  const modelId = settings.modelId;
  if (!modelId) throw new StudioError(422, "대화 모델을 선택해 주세요.");
  const start = performance.now();
  const system = sceneStreamPrompt(context);
  const deadline = AbortSignal.any([AbortSignal.timeout(65000), ...(signal ? [signal] : [])]);
  let text = "", firstContentMs: number | undefined, stop: string | undefined;
  let usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadInputTokens?: number } = {};
  const delta = async (value: string) => {
    if (!value) return;
    firstContentMs ??= Math.round(performance.now() - start);
    text += value;
    if (text.length > 6000) throw new StudioError(502, "응답이 너무 깁니다.");
    await execution?.onTextDelta?.(value);
  };
  if (!settings.mantleRegion) {
    const claude = modelId.includes("anthropic.");
    const nova = modelId.includes("amazon.nova");
    const extra = claude ? { thinking: { type: modelId.endsWith("5-5")
      ? modelId.includes("sonnet") ? "between_tools" : "adaptive" : "disabled" },
      ...(modelId.endsWith("5-5") && !modelId.includes("sonnet") ? { output_config: { effort: "low" } } : {}) }
      : modelId.includes("xai.") ? { reasoning: { effort: "low" } } : {};
    const result = await clientFor(process.env.STUDIO_BEDROCK_REGION ?? "ap-northeast-2").send(new ConverseStreamCommand({
      modelId, system: [{ text: system }], messages: [{ role: "user", content: [{ text: context.message }] }],
      inferenceConfig: { maxTokens: 2200, ...(nova ? { temperature: 0.45 } : {}) },
      ...(Object.keys(extra).length ? { additionalModelRequestFields: extra as ConverseStreamCommandInput["additionalModelRequestFields"] } : {}),
    }), { abortSignal: deadline });
    for await (const event of result.stream ?? []) {
      if (event.contentBlockDelta?.delta?.text) await delta(event.contentBlockDelta.delta.text);
      if (event.metadata?.usage) {
        const u = event.metadata.usage;
        usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadInputTokens: u.cacheReadInputTokens };
      }
      if (event.messageStop) stop = event.messageStop.stopReason;
      if ("modelStreamErrorException" in event || "internalServerException" in event || "throttlingException" in event || "serviceUnavailableException" in event || "validationException" in event)
        throw new StudioError(503, "모델 스트림이 중단됐습니다. 다시 시도해 주세요.");
    }
  } else {
    const region = settings.mantleRegion, hostname = `bedrock-mantle.${region}.api.aws`;
    const gpt = gptMantleEffort(modelId), path = gpt ? "/openai/v1/responses" : "/openai/v1/chat/completions";
    const body = JSON.stringify(gpt ? {
      model: modelId, store: false, stream: true, max_output_tokens: 2400, reasoning: { effort: ["openai.gpt-6-luna", "openai.gpt-6.1-terra"].includes(modelId) ? "none" : gpt },
      instructions: system, input: context.message,
    } : {
      model: modelId, stream: true, stream_options: { include_usage: true }, max_tokens: 2200, reasoning_effort: "none",
      messages: [{ role: "system", content: system }, { role: "user", content: context.message }],
    });
    const signed = await new SignatureV4({ credentials: clientFor(region).config.credentials, service: "bedrock-mantle", region, sha256: Sha256 })
      .sign({ protocol: "https:", hostname, path, method: "POST", headers: { host: hostname, "content-type": "application/json" }, body });
    const result = await fetch(`https://${hostname}${path}`, { method: "POST", headers: signed.headers, body, signal: deadline, redirect: "error" });
    if (!result.ok || !result.body) { await result.body?.cancel(); throw new StudioError(result.status === 429 ? 429 : 502, "Bedrock 모델 스트림을 시작하지 못했습니다."); }
    for await (const { data: e } of streamEvents(result.body as unknown as AsyncIterable<Uint8Array>)) {
      if (e.type === "response.output_text.delta") await delta(e.delta ?? "");
      if (e.type === "response.completed") {
        stop = e.response.status === "completed" ? "stop" : e.response.status;
        const u = e.response.usage;
        usage = { inputTokens: u?.input_tokens, outputTokens: u?.output_tokens, reasoningTokens: u?.output_tokens_details?.reasoning_tokens,
          cacheReadInputTokens: u?.input_tokens_details?.cached_tokens };
      }
      if (e.choices?.[0]?.delta?.content) await delta(e.choices[0].delta.content);
      if (e.choices?.[0]?.finish_reason) stop = e.choices[0].finish_reason;
      if (e.usage && !gpt) usage = { inputTokens: e.usage.prompt_tokens, outputTokens: e.usage.completion_tokens,
        reasoningTokens: e.usage.completion_tokens_details?.reasoning_tokens };
      if (e.error || e.type === "response.failed" || e.type === "response.incomplete") throw new StudioError(502, "모델이 대사를 완성하지 못했습니다.");
    }
  }
  if (!["end_turn", "stop", "stop_sequence"].includes(stop ?? "") || !hasSceneDialogue(text))
    throw new StudioError(422, "모델이 대사를 완성하지 못했습니다. 저장하지 않았습니다.");
  return { text: text.trim(), usedFactIds: [], memories: [],
    ...(context.reportUsage ? { usage: { ...usage, bedrockMs: Math.round(performance.now() - start), firstContentMs } } : {}) };
};
