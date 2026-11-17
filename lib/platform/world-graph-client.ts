import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { z } from "zod";
import { StudioError } from "../studio/store";
import { worldGraphDocument, type WorldGraphInput } from "./world-graph";
import type { RuntimeSession } from "./memory";
import { storySchema } from "../studio/schema";
import { memoryScopeHash } from "./vector-memory";

export class WorldGraphClient {
  constructor(readonly client: LambdaClient, readonly functionName: string) {}
  async invoke(input: unknown) {
    const response = await this.client.send(new InvokeCommand({ FunctionName: this.functionName, InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify(input)) }), { abortSignal: AbortSignal.timeout(110_000) });
    if (response.FunctionError || !response.Payload) throw new StudioError(503, "Neptune 세계관 그래프를 준비하지 못했습니다. 원본은 보존되어 있으며 다시 시도할 수 있습니다.");
    const result = z.object({ status: z.enum(["ready", "pending"]), scope: z.string(), hash: z.string(), nodes: z.array(z.record(z.string(), z.unknown())).optional(), edges: z.array(z.record(z.string(), z.unknown())).optional(), story: storySchema.optional() }).strict().parse(JSON.parse(Buffer.from(response.Payload).toString()));
    return result;
  }
  async ensure(input: WorldGraphInput) {
    const expected = worldGraphDocument(input);
    const result = await this.invoke({ action: "ensure", ...input });
    if (result.status !== "ready" || result.hash !== expected.hash || result.scope !== expected.scope) throw new StudioError(503, "세계관 그래프의 저장 버전을 확인하지 못했습니다.");
    return result;
  }
  async read(input: WorldGraphInput) { return this.invoke({ action: "read", ...input }); }
  async clone(input: WorldGraphInput, session: RuntimeSession) {
    const result = await this.invoke({ action: "clone", ...input, ownerHash: session.ownerHash, sessionId: session.id, releaseId: session.releaseId, sessionRevision: session.revision });
    if (result.status !== "ready" || result.scope !== `episode-world/${memoryScopeHash(session)}` || result.hash !== worldGraphDocument(input).hash || !result.story) throw new StudioError(503, "회차별 세계관 복제 중입니다. 준비 완료 후 다시 대화하세요.");
    return result;
  }
}
export function configuredWorldGraph() {
  const arn = process.env.STUDIO_WORLD_GRAPH_ARN;
  if (!arn) return undefined;
  const parsed = /^arn:aws:lambda:([a-z0-9-]+):\d{12}:function:[A-Za-z0-9_-]+$/.exec(arn);
  if (!parsed) throw new StudioError(503, "세계관 그래프 연결 설정을 확인하세요.");
  const profile = process.env.STUDIO_DDB_PROFILE;
  return new WorldGraphClient(new LambdaClient({ region: parsed[1], maxAttempts: 1, ...(profile ? { credentials: fromIni({ profile }) } : {}) }), arn);
}
/** The DynamoDB mode reads the immutable release already checked by the caller
 * and takes all world changes from the authenticated episode ledger. Graph
 * lookup and stream projection remain independent, scoped derivatives. */
export function requiresSynchronousWorldGraph() {
  return process.env.STUDIO_WORLD_GRAPH_PLAY_MODE !== "ddb";
}
