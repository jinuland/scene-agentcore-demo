import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { GetCommand, TransactGetCommand, TransactWriteCommand, type DynamoDBDocumentClient, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { storySchema, type Project } from "../studio/schema";
import { StudioError } from "../studio/store";
import { defaultPlatform } from "./types";

// A storage version changes for EVERY mutation, independently of canon revision.
export const PROJECT_SNAPSHOT_LIMIT = 1_800_000;
const CHUNK_BYTES = 64 * 1024;
const idSchema = z.string().uuid();
const metaSchema = z.object({
  schema: z.literal(1), workspaceId: idSchema, projectId: idSchema,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  chunks: z.number().int().min(1).max(Math.ceil(PROJECT_SNAPSHOT_LIMIT / CHUNK_BYTES)),
  bytes: z.number().int().min(1).max(PROJECT_SNAPSHOT_LIMIT), digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const receiptSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), version: z.number().int().positive() });
const envelopeSchema = z.object({
  id: idSchema, title: z.string(), revision: z.number().int().positive(), story: storySchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  messages: z.array(z.unknown()), revisions: z.array(z.unknown()), assets: z.array(z.unknown()),
  receipts: z.array(z.unknown()), usage: z.object({ textCalls: z.number(), imageCalls: z.number(), inputTokens: z.number(), outputTokens: z.number() }),
}).passthrough();
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const unavailable = () => new StudioError(503, "AWS 작품 저장소를 확인하지 못했습니다. 저장 결과를 확인한 후 같은 요청으로 재시도하세요.");
const conflict = () => new StudioError(409, "다른 곳에서 작품이 변경되었습니다. 최신 작품을 확인하세요.");
function validateProject(project: unknown, id: string): asserts project is Project {
  const parsed = envelopeSchema.safeParse(project);
  if (!parsed.success || parsed.data.id !== id) throw new StudioError(400, "작품 스냅샷 또는 저장 범위가 올바르지 않습니다.");
}
export class DynamoProjects {
  constructor(private client: DynamoDBDocumentClient, private table: string, private workspaceId: string, private now = Date.now) {
    idSchema.parse(workspaceId);
    if (!/^(?:arn:aws:dynamodb:[a-z0-9-]+:\d{12}:table\/)?[a-zA-Z0-9_.-]{3,255}$/.test(table)) throw new StudioError(503, "작품 저장소 설정이 올바르지 않습니다.");
  }
  private key(id: string, sk: string) {
    idSchema.parse(id);
    return { pk: `WORKSPACE#${this.workspaceId}#PROJECT#${id}`, sk };
  }
  private async get(id: string, sk: string) {
    try {
      return (await this.client.send(new GetCommand({ TableName: this.table, Key: this.key(id, sk), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(30_000) })).Item;
    } catch { throw unavailable(); }
  }
  private meta(raw: unknown, id: string) {
    const parsed = metaSchema.safeParse(raw);
    if (!parsed.success || parsed.data.workspaceId !== this.workspaceId || parsed.data.projectId !== id || parsed.data.chunks !== Math.ceil(parsed.data.bytes / CHUNK_BYTES)) throw unavailable();
    return parsed.data;
  }
  async changeStamp(id: string) {
    const raw = await this.get(id, "META");
    if (!raw) throw new StudioError(404, "클라우드 작품을 찾지 못했습니다.");
    this.meta(raw, id);
    if (Number.isSafeInteger(raw.sequence) && raw.sequence >= 0 && Number.isSafeInteger(raw.revision) && raw.revision > 0) return { sequence: raw.sequence as number, revision: raw.revision as number };
    const snapshot = await this.load(id);
    if (!snapshot) throw unavailable();
    return { sequence: snapshot.project.platform?.sequence ?? 0, revision: snapshot.project.revision };
  }
  async load(id: string): Promise<{ project: Project; version: number } | null> {
    idSchema.parse(id);
    // Metadata can change between the sizing read and transaction. Retry a
    // bounded number of times; never return a mixture of snapshot versions.
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.get(id, "META");
      if (!raw) return null;
      const before = this.meta(raw, id);
      try {
        const result = await this.client.send(new TransactGetCommand({
          TransactItems: ["META", ...Array.from({ length: before.chunks }, (_, n) => `PART#${n}`)].map(sk => ({ Get: { TableName: this.table, Key: this.key(id, sk) } })),
        }), { abortSignal: AbortSignal.timeout(30_000) });
        const rows = result.Responses;
        if (!rows?.[0]?.Item) throw unavailable();
        const current = this.meta(rows[0].Item, id);
        if (current.version !== before.version) continue;
        if (rows.length !== current.chunks + 1) throw unavailable();
        const parts = rows.slice(1).map((row, i) => {
          const item = row.Item;
          const expectedBytes = Math.min(CHUNK_BYTES, current.bytes - i * CHUNK_BYTES);
          if (item?.version !== current.version || !(item.bytes instanceof Uint8Array) || item.bytes.byteLength !== expectedBytes) throw unavailable();
          return Buffer.from(item.bytes);
        });
        const bytes = Buffer.concat(parts);
        if (digest(bytes) !== current.digest) throw unavailable();
        const project: unknown = JSON.parse(bytes.toString("utf8"));
        validateProject(project, id);
        return { project, version: current.version };
      } catch { throw unavailable(); }
    }
    throw conflict();
  }
  private async receipt(id: string, requestId: string, fingerprint: string) {
    const raw = await this.get(id, `REQUEST#${requestId}`);
    if (!raw) return null;
    const result = receiptSchema.safeParse(raw);
    if (!result.success) throw unavailable();
    if (result.data.fingerprint !== fingerprint) throw new StudioError(409, "같은 요청 ID로 다른 내용을 저장할 수 없습니다.");
    return { version: result.data.version, replayed: true };
  }
  async commit(project: Project, expectedVersion: number, requestId: string): Promise<{ version: number; replayed: boolean }> {
    return this.commitSnapshot(project, expectedVersion, requestId);
  }
  async createWith(project: Project, requestId: string, items: NonNullable<TransactWriteCommandInput["TransactItems"]>) {
    return this.commitSnapshot(project, 0, requestId, undefined, items);
  }
  private async commitSnapshot(project: Project, expectedVersion: number, requestId: string, fence?: { token: string; fingerprint: string }, additional: NonNullable<TransactWriteCommandInput["TransactItems"]> = []) {
    idSchema.parse(requestId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) throw new StudioError(400, "저장 버전이 올바르지 않습니다.");
    validateProject(project, project.id);
    const bytes = Buffer.from(JSON.stringify(project));
    if (bytes.length > PROJECT_SNAPSHOT_LIMIT) throw new StudioError(413, "작품 스냅샷 저장 한도를 초과했습니다. 기록 분리 후 다시 시도하세요.");
    const hash = digest(bytes);
    const fingerprint = digest(`${expectedVersion}:${hash}`);
    const previousReceipt = await this.receipt(project.id, requestId, fingerprint);
    if (previousReceipt) return previousReceipt;
    const raw = await this.get(project.id, "META");
    const old = raw ? this.meta(raw, project.id) : null;
    if ((old?.version ?? 0) !== expectedVersion) throw conflict();
    const version = expectedVersion + 1;
    const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
    const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [{ Put: {
      TableName: this.table,
      Item: { ...this.key(project.id, "META"), schema: 1, workspaceId: this.workspaceId, projectId: project.id, version, chunks, bytes: bytes.length, digest: hash, sequence: project.platform?.sequence ?? 0, revision: project.revision },
      ConditionExpression: expectedVersion === 0 ? "attribute_not_exists(pk)" : "#v = :expected",
      ...(expectedVersion === 0 ? {} : { ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion } }),
    } }, { Put: {
      TableName: this.table, Item: { ...this.key(project.id, `REQUEST#${requestId}`), fingerprint, version }, ConditionExpression: "attribute_not_exists(pk)",
    } }];
    for (let i = 0; i < chunks; i++) items.push({ Put: { TableName: this.table, Item: { ...this.key(project.id, `PART#${i}`), version, bytes: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) } } });
    for (let i = chunks; i < (old?.chunks ?? 0); i++) items.push({ Delete: { TableName: this.table, Key: this.key(project.id, `PART#${i}`) } });
    if (fence) {
      items.push({ Delete: { TableName: this.table, Key: this.key(project.id, "LOCK"), ConditionExpression: "#t = :token AND expiresAt > :now", ExpressionAttributeNames: { "#t": "token" }, ExpressionAttributeValues: { ":token": fence.token, ":now": this.now() } } });
      items.push({ Put: { TableName: this.table, Item: { ...this.key(project.id, `COMMAND#${requestId}`), fingerprint: fence.fingerprint, status: "done", version }, ConditionExpression: "#t = :token AND #s = :pending", ExpressionAttributeNames: { "#t": "token", "#s": "status" }, ExpressionAttributeValues: { ":token": fence.token, ":pending": "pending" } } });
    }
    items.push(...additional);
    try {
      // Durable receipt, snapshot and all chunk removals commit atomically.
      // No automatic callback/model retry. Ambiguous transport results require
      // the SAME request ID and unchanged payload, not a new paid generation.
      await this.client.send(new TransactWriteCommand({ TransactItems: items }), { abortSignal: AbortSignal.timeout(30_000) });
      return { version, replayed: false };
    } catch (error) {
      const receipt = await this.receipt(project.id, requestId, fingerprint);
      if (receipt) return receipt;
      const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
      if (reasons?.some(r => r.Code === "ConditionalCheckFailed")) throw conflict();
      throw unavailable();
    }
  }

  // A pending command is never retried. Only a confirmed failed, pure text edit
  // can be explicitly retried with an unchanged fingerprint.
  async execute<T>(id: string, revision: number | undefined, requestId: string, action: string, fn: (p: Project) => Promise<T>, retryFailedTextEdit = false) {
    idSchema.parse(id); idSchema.parse(requestId);
    const fingerprint = digest(JSON.stringify([revision ?? null, action]));
    const replay = async () => {
      const command = await this.get(id, `COMMAND#${requestId}`);
      if (!command) return null;
      if (command.fingerprint !== fingerprint) throw new StudioError(409, "같은 요청 ID의 작업 내용이 다릅니다.");
      if (retryFailedTextEdit && command.status === "failed") return null;
      if (command.status !== "done") throw new StudioError(409, "이 요청은 진행 중이거나 결과 확인이 필요합니다. 자동으로 다시 실행하지 않았습니다.");
      const current = await this.load(id);
      if (!current) throw unavailable();
      current.project.platform ??= defaultPlatform(current.project.story);
      return { project: current.project, value: undefined };
    };
    const prior = await replay(); if (prior) return prior;
    const token = randomUUID();
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.table, Item: { ...this.key(id, "LOCK"), token, expiresAt: this.now() + 240_000 }, ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now", ExpressionAttributeValues: { ":now": this.now() } } },
        { Put: { TableName: this.table, Item: { ...this.key(id, `COMMAND#${requestId}`), token, fingerprint, status: "pending" }, ...(retryFailedTextEdit
          ? { ConditionExpression: "attribute_not_exists(pk) OR (#s = :failed AND #f = :fingerprint)", ExpressionAttributeNames: { "#s": "status", "#f": "fingerprint" }, ExpressionAttributeValues: { ":failed": "failed", ":fingerprint": fingerprint } }
          : { ConditionExpression: "attribute_not_exists(pk)" }) } },
      ] }), { abortSignal: AbortSignal.timeout(30_000) });
    } catch (error) {
      const prior = await replay(); if (prior) return prior;
      const reasons = (error as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons;
      if (reasons?.some(r => ["ConditionalCheckFailed", "TransactionConflict"].includes(r.Code ?? ""))) throw new StudioError(409, "이 작품의 다른 요청이 진행 중입니다. 잠시 후 다시 시도하세요.");
      throw unavailable();
    }
    try {
      const snapshot = await this.load(id);
      if (!snapshot) throw new StudioError(404, "클라우드 작품을 찾지 못했습니다. 로컬로 전환하지 않았습니다.");
      const p = snapshot.project; p.platform ??= defaultPlatform(p.story);
      if (revision !== undefined && revision !== p.revision) throw conflict();
      const value = await fn(p);
      p.updatedAt = new Date(this.now()).toISOString();
      p.platform.sequence++;
      p.receipts = [...p.receipts, { id: requestId, action }].slice(-200);
      await this.commitSnapshot(p, snapshot.version, requestId, { token, fingerprint });
      return { project: p, value };
    } catch (error) {
      // Do not erase a newer holder's lock, nor change a committed command.
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Delete: { TableName: this.table, Key: this.key(id, "LOCK"), ConditionExpression: "#t = :token", ExpressionAttributeNames: { "#t": "token" }, ExpressionAttributeValues: { ":token": token } } },
        { Put: { TableName: this.table, Item: { ...this.key(id, `COMMAND#${requestId}`), fingerprint, status: "failed" }, ConditionExpression: "#t = :token AND #s = :pending", ExpressionAttributeNames: { "#t": "token", "#s": "status" }, ExpressionAttributeValues: { ":token": token, ":pending": "pending" } } },
      ] }), { abortSignal: AbortSignal.timeout(30_000) }).catch(() => {});
      throw error;
    }
  }
}
