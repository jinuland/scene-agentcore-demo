import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { FetchError } from "aws-jwt-verify/error";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { StudioError } from "../studio/store";
import { cognitoSubjectSchema, serviceCreatorSubject } from "./team-subject";
import { teamAppOrigin } from "./web-mode";
import { serviceReturnPath } from "./player-path";

export const unifiedLogin = () => process.env.STUDIO_UNIFIED_LOGIN === "true";
export type TeamCredential = string | { serviceSessionToken: string };

const random = () => randomBytes(32).toString("base64url");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const credential = z.string().min(1).max(16384);
export const editorSessionSchema = z.object({
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/), subject: cognitoSubjectSchema,
  expiresAt: z.number().int().positive(), audience: z.literal("player").optional(),
}).strict();
export type EditorSession = z.infer<typeof editorSessionSchema>;
const sessionSchema = z.object({ pk: z.string(), kind: z.literal("session"), subject: cognitoSubjectSchema, accessToken: credential, refreshToken: credential, tokenExpiresAt: z.number().int(), expiresAt: z.number().int(), version: z.number().int().positive() }).strict();
const flowSchema = z.object({ pk: z.string(), kind: z.literal("flow"), browserHash: z.string(), verifier: opaque, nonce: opaque, expiresAt: z.number().int(), playerReturnTo: serviceReturnPath.optional() }).strict();
const tokenSchema = z.object({ access_token: credential, id_token: credential, refresh_token: credential.optional(), token_type: z.literal("Bearer") });
type Tokens = z.infer<typeof tokenSchema>;
type Claims = { sub: string; exp: number; nonce?: unknown };
export type LoginConfig = { appOrigin: string; loginOrigin: string; poolId: string; clientId: string; table: string; profile?: string; region: string; audience?: "player" };
type Verifier = { verify(token: string): Promise<Claims> };
const missing = () => new StudioError(401, "로그인이 만료되었거나 취소되었습니다. 다시 로그인하세요.");
const unavailable = () => new StudioError(503, "로그인 서비스를 확인하지 못했습니다. 잠시 후 다시 시도하세요.");
const conditional = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";

export function loginConfig(): LoginConfig {
  const appOrigin = teamAppOrigin();
  const poolId = process.env.STUDIO_TEAM_USER_POOL_ID ?? "", clientId = process.env.STUDIO_TEAM_CLIENT_ID ?? "";
  const table = process.env.STUDIO_TEAM_SESSION_TABLE_ARN ?? "", loginOrigin = process.env.STUDIO_TEAM_LOGIN_ORIGIN ?? "";
  const arn = /^arn:aws:dynamodb:([a-z]{2}-[a-z]+-\d):\d{12}:table\/[A-Za-z0-9_.-]{3,255}$/.exec(table);
  if (!arn || !poolId.startsWith(`${arn[1]}_`) || !/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(poolId) || !/^[a-z0-9]{10,128}$/.test(clientId) || !new RegExp(`^https://[a-z0-9-]+\\.auth\\.${arn[1]}\\.amazoncognito\\.com$`).test(loginOrigin)) throw new StudioError(503, "팀 로그인 연결 설정이 필요합니다.");
  return { appOrigin, loginOrigin, poolId, clientId, table, region: arn[1], profile: process.env.STUDIO_TEAM_PROFILE };
}

export function cookieName(kind: "session" | "flow", origin: string, audience: "team" | "player" = "team") { return `${origin.startsWith("https:") ? "__Host-" : ""}bf_${audience}_${kind}`; }
export function sessionCookie(kind: "session" | "flow", value: string, origin: string, maxAge: number, audience: "team" | "player" = "team") {
  if (value) opaque.parse(value);
  return `${cookieName(kind, origin, audience)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export function readSessionCookie(request: Request, kind: "session" | "flow", audience: "team" | "player" = "team") {
  const name = cookieName(kind, new URL(request.url).origin, audience);
  const values = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`)).map(v => v.slice(name.length + 1));
  if (!values.length) return undefined;
  if (values.length !== 1 || !opaque.safeParse(values[0]).success) throw missing();
  return values[0];
}

export class BrowserSessions {
  constructor(readonly config: LoginConfig, private db: DynamoDBDocumentClient, private accessVerifier: Verifier, private idVerifier: Verifier, private fetcher: typeof fetch = fetch, private now: () => number = () => Math.floor(Date.now() / 1000)) {}
  private async send(command: GetCommand | PutCommand | DeleteCommand): Promise<{ Item?: Record<string, unknown>; Attributes?: Record<string, unknown> }> {
    try {
      const options = { abortSignal: AbortSignal.timeout(10000) };
      if (command instanceof GetCommand) return await this.db.send(command, options);
      if (command instanceof PutCommand) return await this.db.send(command, options);
      return await this.db.send(command, options);
    }
    catch (e) { if (conditional(e)) throw missing(); throw unavailable(); }
  }
  private get home() { return this.config.audience === "player" ? "/play" : "/team"; }
  private get callback() { return `/api/${this.config.audience === "player" ? "player" : "team"}/session/callback`; }
  private key(value: string, kind: "flow" | "session") { opaque.parse(value); return `${this.config.audience === "player" ? "PLAYER#" : ""}${kind.toUpperCase()}#${digest(value)}`; }
  async begin(playerReturnTo?: string) {
    if (playerReturnTo !== undefined) {
      if (this.config.audience !== "player") throw new StudioError(400, "플레이어 로그인에서만 작품으로 돌아갈 수 있습니다.");
      serviceReturnPath.parse(playerReturnTo);
      if (playerReturnTo === "/team" && !unifiedLogin()) throw missing();
    }
    const state = random(), browser = random(), verifier = random(), nonce = random();
    const row = { pk: this.key(state, "flow"), kind: "flow", browserHash: digest(browser), verifier, nonce, expiresAt: this.now() + 300, ...(playerReturnTo ? { playerReturnTo } : {}) };
    await this.send(new PutCommand({ TableName: this.config.table, Item: row, ConditionExpression: "attribute_not_exists(pk)" }));
    const url = new URL("/oauth2/authorize", this.config.loginOrigin);
    url.search = new URLSearchParams({ response_type: "code", client_id: this.config.clientId, redirect_uri: `${this.config.appOrigin}${this.callback}`, scope: "openid", state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return { browser, url: url.href };
  }
  private async exchange(parameters: Record<string, string>): Promise<Tokens> {
    let response: Response;
    try { response = await this.fetcher(`${this.config.loginOrigin}/oauth2/token`, { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.config.clientId, ...parameters }), signal: AbortSignal.timeout(10000), cache: "no-store" }); }
    catch { throw unavailable(); }
    if (!response.ok) { await response.body?.cancel(); throw response.status >= 500 || response.status === 429 ? unavailable() : missing(); }
    try {
      const reader = response.body?.getReader(); if (!reader) throw unavailable();
      let length = 0; const chunks: Uint8Array[] = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 60000) { await reader.cancel(); throw unavailable(); } chunks.push(value); }
      return tokenSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch { throw unavailable(); }
  }
  private async verify(tokens: Tokens) {
    try {
      const [access, id] = await Promise.all([this.accessVerifier.verify(tokens.access_token), this.idVerifier.verify(tokens.id_token)]);
      if (!cognitoSubjectSchema.safeParse(access.sub).success || access.sub !== id.sub || !Number.isInteger(access.exp) || access.exp <= this.now() || id.exp <= this.now()) throw missing();
      return { access, id };
    } catch (e) { if (e instanceof FetchError) throw unavailable(); throw missing(); }
  }
  async finish(state: string, browser: string, code: string) {
    if (!opaque.safeParse(state).success || !opaque.safeParse(browser).success || !code || code.length > 4096) throw missing();
    // Atomic one-time consumption, bound to the browser that started login.
    const consumed = await this.send(new DeleteCommand({ TableName: this.config.table, Key: { pk: this.key(state, "flow") }, ConditionExpression: "browserHash = :hash AND expiresAt > :now", ExpressionAttributeValues: { ":hash": digest(browser), ":now": this.now() }, ReturnValues: "ALL_OLD" }));
    const parsed = flowSchema.safeParse(consumed.Attributes); if (!parsed.success) throw missing();
    const tokens = await this.exchange({ grant_type: "authorization_code", redirect_uri: `${this.config.appOrigin}${this.callback}`, code, code_verifier: parsed.data.verifier });
    const { access, id } = await this.verify(tokens);
    if (id.nonce !== parsed.data.nonce || !tokens.refresh_token) throw missing();
    const session = random(), expiresAt = this.now() + 8 * 3600;
    const row = sessionSchema.parse({ pk: this.key(session, "session"), kind: "session", subject: access.sub, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: access.exp, expiresAt, version: 1 });
    await this.send(new PutCommand({ TableName: this.config.table, Item: row, ConditionExpression: "attribute_not_exists(pk)" }));
    const returnTo = parsed.data.playerReturnTo === "/team" && !unifiedLogin() ? "/play" : parsed.data.playerReturnTo;
    return { session, expiresAt, ...(this.config.audience === "player" ? { returnTo: returnTo ?? "/play" } : {}) };
  }
  private async read(session: string) {
    if (!opaque.safeParse(session).success) throw missing();
    const pk = this.key(session, "session");
    const result = await this.send(new GetCommand({ TableName: this.config.table, Key: { pk }, ConsistentRead: true }));
    const parsed = sessionSchema.safeParse(result.Item);
    if (!parsed.success || parsed.data.pk !== pk || parsed.data.expiresAt <= this.now()) throw missing();
    return parsed.data;
  }
  async resolve(session: string) {
    const row = await this.read(session);
    if (row.tokenExpiresAt > this.now() + 30) return { token: row.accessToken, subject: row.subject, expiresAt: row.expiresAt };
    const tokens = await this.exchange({ grant_type: "refresh_token", refresh_token: row.refreshToken });
    const { access } = await this.verify(tokens);
    if (access.sub !== row.subject) throw missing();
    const next = { ...row, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? row.refreshToken, tokenExpiresAt: access.exp, version: row.version + 1 };
    try {
      await this.send(new PutCommand({ TableName: this.config.table, Item: next, ConditionExpression: "#version = :version AND expiresAt > :now", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": row.version, ":now": this.now() } }));
    } catch (e) {
      if (!(e instanceof StudioError) || e.status !== 401) throw e;
      // Another refresh may win; a deleted/expired row must never be recreated.
      const winner = await this.read(session);
      if (winner.subject !== row.subject || winner.version <= row.version || winner.tokenExpiresAt <= this.now() + 30) throw missing();
      return { token: winner.accessToken, subject: winner.subject, expiresAt: winner.expiresAt };
    }
    // Logout between the CAS and this read remains fail-closed.
    const saved = await this.read(session);
    return { token: saved.accessToken, subject: saved.subject, expiresAt: saved.expiresAt };
  }
  async logout(session: string) {
    if (!opaque.safeParse(session).success) throw missing();
    await this.send(new DeleteCommand({ TableName: this.config.table, Key: { pk: this.key(session, "session") } }));
  }
  // This reference is server-only: it is neither a cookie nor an OAuth token.
  // Only an authenticated browser may create it. The local MCP operator can
  // resolve it through IAM; there is deliberately no public resolver route.
  async editorReference(session: string): Promise<EditorSession> {
    if (this.config.audience === "player" && !unifiedLogin()) throw missing();
    await this.resolve(session);
    const row = await this.read(session);
    return { sessionHash: digest(session), subject: this.config.audience === "player" ? serviceCreatorSubject(this.config.poolId, row.subject) : row.subject, expiresAt: row.expiresAt, ...(this.config.audience ? { audience: this.config.audience } : {}) };
  }
  async editorToken(raw: EditorSession) {
    if (this.config.audience === "player" && !unifiedLogin()) throw missing();
    const reference = editorSessionSchema.safeParse(raw);
    if (!reference.success || reference.data.expiresAt <= this.now()) throw missing();
    const r = reference.data;
    if (r.audience !== this.config.audience) throw missing();
    const pk = `${r.audience ? "PLAYER#" : ""}SESSION#${r.sessionHash}`;
    const result = await this.send(new GetCommand({ TableName: this.config.table, Key: { pk }, ConsistentRead: true }));
    const parsed = sessionSchema.safeParse(result.Item);
    if (!parsed.success || parsed.data.pk !== pk || (r.audience ? serviceCreatorSubject(this.config.poolId, parsed.data.subject) : parsed.data.subject) !== r.subject || parsed.data.expiresAt !== r.expiresAt || parsed.data.expiresAt <= this.now() || parsed.data.tokenExpiresAt <= this.now()) throw missing();
    // Do not refresh on behalf of a disconnected browser. Its heartbeat must
    // renew the session and binding; logout is effective on the next check.
    return parsed.data.accessToken;
  }
  logoutUrl() { const url = new URL("/logout", this.config.loginOrigin); url.search = new URLSearchParams({ client_id: this.config.clientId, logout_uri: `${this.config.appOrigin}${this.home}` }).toString(); return url.href; }
}
const instances = new Map<string, BrowserSessions>();
export function configuredBrowserSessions() {
  const config = loginConfig(), key = JSON.stringify(config); let instance = instances.get(key);
  if (!instance) {
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region, ...(config.profile ? { credentials: fromIni({ profile: config.profile }) } : {}), maxAttempts: 2 }));
    instance = new BrowserSessions(config, db, CognitoJwtVerifier.create({ userPoolId: config.poolId, clientId: config.clientId, tokenUse: "access" }), CognitoJwtVerifier.create({ userPoolId: config.poolId, clientId: config.clientId, tokenUse: "id" }));
    instances.set(key, instance);
  }
  return instance;
}
export async function studioBrowserSession(request: Request) {
  const player = unifiedLogin() ? readSessionCookie(request, "session", "player") : undefined;
  if (player) {
    const { configuredPlayerSessions } = await import("./player-sessions");
    return { cookie: player, sessions: configuredPlayerSessions(), shared: true };
  }
  const cookie = readSessionCookie(request, "session");
  return cookie ? { cookie, sessions: configuredBrowserSessions(), shared: false } : null;
}
export async function requestTeamToken(request: Request): Promise<TeamCredential> {
  const header = request.headers.get("authorization"), cookie = readSessionCookie(request, "session");
  if (header && (cookie || (unifiedLogin() && readSessionCookie(request, "session", "player")))) throw new StudioError(400, "로그인 방식을 하나만 사용하세요.");
  if (header) { const match = /^Bearer ([^\s,]+)$/.exec(header); if (!match) throw missing(); return match[1]; }
  const session = await studioBrowserSession(request);
  if (!session) throw missing();
  const { sessions, shared } = session;
  if (new URL(request.url).origin !== sessions.config.appOrigin) throw missing();
  const { token } = await sessions.resolve(session.cookie);
  return shared ? { serviceSessionToken: token } : token;
}
