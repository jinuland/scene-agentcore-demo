import { createHash } from "node:crypto";
import { z } from "zod";
import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoProjects } from "./dynamo-projects";
import { membershipKey } from "./team-access";
import { cognitoSubjectSchema } from "./team-subject";
import { newProject, StudioError } from "../studio/store";
import { starterStory } from "../studio/starter-story";
import { discoverGenres, starterTemplates } from "../studio/starter-catalog";
import { defaultPlatform } from "./types";
import { rejectCredentials } from "./commands";

const uuid = z.string().uuid();
const directorySchema = z.object({ version: z.number().int().positive(), ids: z.array(uuid).max(100) }).strict();
export const discoverySettingsSchema = z.object({
  version: z.number().int().positive(),
  hiddenProjectIds: z.array(uuid).max(100).refine(ids => new Set(ids).size === ids.length),
}).strict();
export const workspaceCreatorSchema = z.object({ subject: cognitoSubjectSchema, workspaceId: uuid, status: z.enum(["active", "revoked"]), version: z.number().int().positive(), permission: z.literal("create_projects") }).strict();
export const createTeamProjectSchema = z.object({ title: z.string().trim().min(1).max(120), requestId: uuid, template: z.enum(starterTemplates).optional(), genre: z.enum(discoverGenres).optional() }).strict();
const receiptSchema = z.object({ projectId: uuid, subject: cognitoSubjectSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const workspaceCreatorKey = (workspaceId: string, subject: string) => ({ pk: `WORKSPACE#${uuid.parse(workspaceId)}`, sk: `CREATOR#${cognitoSubjectSchema.parse(subject)}` });
const failure = () => new StudioError(503, "AWS 작품 목록을 확인하지 못했습니다. 로컬로 전환하지 않았습니다.");
type IdentityCheck = () => Promise<{ sub: string }>;
export class WorkspaceCatalog {
  constructor(readonly client: DynamoDBDocumentClient, readonly table: string, readonly membersTable: string, readonly workspaceId: string) { uuid.parse(workspaceId); }
  key(sk: string) { return { pk: `WORKSPACE#${this.workspaceId}`, sk }; }
  private async get(table: string, key: { pk: string; sk: string }) {
    try { return (await this.client.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }), { abortSignal: AbortSignal.timeout(10_000) })).Item; }
    catch { throw failure(); }
  }
  async directory() {
    const row = await this.get(this.table, this.key("DIRECTORY"));
    if (!row) return { version: 0, ids: [] as string[] };
    const parsed = directorySchema.safeParse(row.directory);
    if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) throw failure();
    return parsed.data;
  }
  async discoverySettings() {
    const row = await this.get(this.table, this.key("DISCOVERY"));
    if (!row) return { version: 0, hiddenProjectIds: [] as string[] };
    const parsed = discoverySettingsSchema.safeParse(row.discovery);
    if (!parsed.success) throw failure();
    return parsed.data;
  }
  async creator(check: IdentityCheck) {
    const identity = await check(), subject = cognitoSubjectSchema.parse(identity.sub);
    const row = await this.get(this.membersTable, workspaceCreatorKey(this.workspaceId, subject));
    const parsed = workspaceCreatorSchema.safeParse(row?.grant);
    if (!parsed.success || parsed.data.subject !== subject || parsed.data.workspaceId !== this.workspaceId || parsed.data.status !== "active") throw new StudioError(403, "작업실에 새 작품을 만들 권한이 없습니다. 운영자에게 요청하세요.");
    return parsed.data;
  }
  async create(raw: unknown, check: IdentityCheck) {
    const input = createTeamProjectSchema.parse(raw); rejectCredentials(input);
    const grant = await this.creator(check);
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, subject: grant.subject, workspaceId: this.workspaceId })).digest("hex");
    const key = this.key(`CREATE#${grant.subject}#${input.requestId}`);
    const replay = async () => {
      const row = await this.get(this.table, key);
      if (!row) return null;
      const parsed = receiptSchema.safeParse(row.receipt);
      if (!parsed.success) throw failure();
      if (parsed.data.fingerprint !== fingerprint || parsed.data.subject !== grant.subject) throw new StudioError(409, "같은 요청 ID로 다른 작품을 만들 수 없습니다.");
      return parsed.data.projectId;
    };
    const current = async () => { const next = await this.creator(check); if (next.subject !== grant.subject || next.version !== grant.version) throw new StudioError(403, "생성 권한이 바뀌었습니다. 다시 확인하세요."); };
    const previous = await replay();
    if (previous) { await current(); return { projectId: previous, replayed: true }; }
    const directory = await this.directory();
    if (directory.ids.length >= 100) throw new StudioError(429, "작업실의 클라우드 작품 100개 한도입니다.");
    const story = starterStory(input.title, input.template, input.genre);
    const project = newProject(story, "팀 작품 생성");
    project.platform = defaultPlatform(project.story);
    const store = new DynamoProjects(this.client, this.table, this.workspaceId);
    await current();
    try {
      await store.createWith(project, input.requestId, [
        { ConditionCheck: { TableName: this.membersTable, Key: workspaceCreatorKey(this.workspaceId, grant.subject), ConditionExpression: "#g.#v = :v AND #g.#s = :s AND #g.#p = :p", ExpressionAttributeNames: { "#g": "grant", "#v": "version", "#s": "status", "#p": "permission" }, ExpressionAttributeValues: { ":v": grant.version, ":s": "active", ":p": "create_projects" } } },
        { Put: { TableName: this.table, Item: { ...this.key("DIRECTORY"), directory: { version: directory.version + 1, ids: [...directory.ids, project.id] } }, ConditionExpression: directory.version ? "#d.#v = :v" : "attribute_not_exists(pk)", ...(directory.version ? { ExpressionAttributeNames: { "#d": "directory", "#v": "version" }, ExpressionAttributeValues: { ":v": directory.version } } : {}) } },
        { Put: { TableName: this.membersTable, Item: { ...membershipKey(this.workspaceId, project.id, grant.subject), membership: { workspaceId: this.workspaceId, projectId: project.id, subject: grant.subject, role: "owner", status: "active", version: 1 } }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.table, Item: { ...key, receipt: { projectId: project.id, subject: grant.subject, fingerprint } }, ConditionExpression: "attribute_not_exists(pk)" } },
      ]);
    } catch (error) {
      // A concurrent duplicate or lost acknowledgement may already be complete.
      // Resolve the durable receipt; never generate another project on retry.
      const done = await replay();
      await current();
      if (done) return { projectId: done, replayed: true };
      throw error;
    }
    await current();
    return { projectId: project.id, replayed: false };
  }
}
