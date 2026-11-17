import { createHash } from "node:crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3VectorsClient, PutVectorsCommand, GetVectorsCommand, DeleteVectorsCommand, QueryVectorsCommand } from "@aws-sdk/client-s3vectors";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { z } from "zod";
import { StudioError } from "../studio/store";
import type { RuntimeSession, MemoryAssertion } from "./memory";
import { memoryEvidence } from "./memory-inspection";

export const embeddingModel = "amazon.titan-embed-text-v2:0";
export const embeddingDimensions = 512;
export type VectorRecord = { key: string; metadata: Record<string, string | number | string[]> };
export interface MemoryVectors {
  get(keys: string[]): Promise<VectorRecord[]>;
  put(key: string, metadata: VectorRecord["metadata"], text: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  query(session: RuntimeSession, characterId: string, text: string): Promise<VectorRecord[]>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const memoryScopeHash = (s: Pick<RuntimeSession, "projectId" | "ownerHash" | "releaseId" | "id">) => hash([s.projectId, s.ownerHash, s.releaseId, s.id]);
// Keep legacy hashes unchanged; annotations participate in new memory integrity.
export const memoryHash = (m: MemoryAssertion) => hash([m.id, m.kind, m.subjectId, m.predicate, m.sourceTurnId, m.sourceQuote, m.knownBy, m.status, ...(m.ontology ? [m.ontology] : [])]);
export const vectorKey = (s: RuntimeSession, m: MemoryAssertion) => `${memoryScopeHash(s)}/${m.id}`;
export function vectorMetadata(s: RuntimeSession, m: MemoryAssertion) {
  return { scope: memoryScopeHash(s), memoryId: m.id, contentHash: memoryHash(m), knownBy: m.knownBy, schema: "memory-vector/1" };
}
// Search service output is a candidate ID only, never model-ready context.
export function verifiedVectorMemories(s: RuntimeSession, characterId: string, candidates: VectorRecord[]) {
  if (s.status !== "active") return [];
  const result: MemoryAssertion[] = [];
  for (const candidate of candidates.slice(0, 30)) {
    const m = s.memories.find(m => m.id === candidate.metadata.memoryId);
    if (!m || m.status !== "reported" || !m.knownBy.includes(characterId) || result.some(r => r.id === m.id)) continue;
    if (!memoryEvidence(s, m, characterId)) continue;
    if (candidate.key !== vectorKey(s, m) || candidate.metadata.scope !== memoryScopeHash(s) || candidate.metadata.contentHash !== memoryHash(m) || candidate.metadata.schema !== "memory-vector/1") continue;
    result.push(m);
  }
  return result;
}

export class S3MemoryVectors implements MemoryVectors {
  constructor(readonly vectors: S3VectorsClient, readonly bedrock: BedrockRuntimeClient, readonly indexArn: string) {
    if (!/^arn:aws:s3vectors:[a-z0-9-]+:\d{12}:bucket\/[a-z0-9-]+\/index\/[a-z0-9-]+$/.test(indexArn)) throw new StudioError(503, "S3 Vectors 인덱스 설정을 확인하세요.");
  }
  private async embed(text: string) {
    const input = z.string().min(1).max(3000).parse(text);
    const response = await this.bedrock.send(new InvokeModelCommand({ modelId: embeddingModel, contentType: "application/json", accept: "application/json", body: Buffer.from(JSON.stringify({ inputText: input, dimensions: embeddingDimensions, normalize: true })) }), { abortSignal: AbortSignal.timeout(15000) });
    const result = JSON.parse(Buffer.from(response.body).toString("utf8"));
    return z.array(z.number().finite()).length(embeddingDimensions).parse(result.embedding);
  }
  async get(keys: string[]): Promise<VectorRecord[]> {
    const result: VectorRecord[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const r = await this.vectors.send(new GetVectorsCommand({ indexArn: this.indexArn, keys: keys.slice(i, i + 100), returnMetadata: true }), { abortSignal: AbortSignal.timeout(15000) });
      for (const v of r.vectors ?? []) if (v.key && v.metadata) result.push({ key: v.key, metadata: v.metadata as VectorRecord["metadata"] });
    }
    return result;
  }
  async put(key: string, metadata: VectorRecord["metadata"], text: string) {
    const vector = await this.embed(text);
    await this.vectors.send(new PutVectorsCommand({ indexArn: this.indexArn, vectors: [{ key, data: { float32: vector }, metadata }] }), { abortSignal: AbortSignal.timeout(15000) });
  }
  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 100) await this.vectors.send(new DeleteVectorsCommand({ indexArn: this.indexArn, keys: keys.slice(i, i + 100) }), { abortSignal: AbortSignal.timeout(15000) });
  }
  async query(session: RuntimeSession, characterId: string, text: string) {
    const vector = await this.embed(text);
    const response = await this.vectors.send(new QueryVectorsCommand({ indexArn: this.indexArn, queryVector: { float32: vector }, topK: 20, returnMetadata: true,
      filter: { $and: [{ scope: { $eq: memoryScopeHash(session) } }, { knownBy: { $eq: characterId } }, { schema: { $eq: "memory-vector/1" } }] },
    }), { abortSignal: AbortSignal.timeout(15000) });
    return (response.vectors ?? []).filter(v => v.key && v.metadata).map(v => ({ key: v.key!, metadata: v.metadata as VectorRecord["metadata"] }));
  }
}
let cached: { key: string; value: S3MemoryVectors } | undefined;
export function configuredVectors() {
  if (!process.env.STUDIO_VECTOR_INDEX_ARN) return undefined;
  const region = process.env.STUDIO_DDB_REGION ?? "ap-northeast-2";
  const profile = process.env.STUDIO_DDB_PROFILE;
  const index = process.env.STUDIO_VECTOR_INDEX_ARN;
  const key = JSON.stringify([region, profile, index]);
  if (cached?.key === key) return cached.value;
  const config = { region, maxAttempts: 1, ...(profile ? { credentials: fromIni({ profile }) } : {}) };
  const value = new S3MemoryVectors(new S3VectorsClient(config), new BedrockRuntimeClient(config), index);
  cached = { key, value };
  return value;
}
