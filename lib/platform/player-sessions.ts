import { createHash } from "node:crypto";
import { z } from "zod";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { BrowserSessions, readSessionCookie, type LoginConfig } from "./team-sessions";
import { teamAppOrigin } from "./web-mode";
import { cognitoSubjectSchema } from "./team-subject";
import { StudioError } from "../studio/store";

/** Different pool, client, table, cookie, storage prefix and owner hash from
 * authors. A player account conveys no project membership or MCP delegation. */
export function playerLoginConfig(): LoginConfig {
  const appOrigin = teamAppOrigin(), env = process.env;
  const poolId = env.STUDIO_PLAYER_USER_POOL_ID ?? "", clientId = env.STUDIO_PLAYER_CLIENT_ID ?? "";
  const table = env.STUDIO_PLAYER_SESSION_TABLE_ARN ?? "", loginOrigin = env.STUDIO_PLAYER_LOGIN_ORIGIN ?? "";
  const arn = /^arn:aws:dynamodb:([a-z]{2}-[a-z]+-\d):(\d{12}):table\/[A-Za-z0-9_.-]{3,255}$/.exec(table);
  const teamTable = env.STUDIO_TEAM_SESSION_TABLE_ARN ?? "";
  if (!arn || !poolId.startsWith(`${arn[1]}_`) || !/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(poolId) || !/^[a-z0-9]{10,128}$/.test(clientId) || !new RegExp(`^https://[a-z0-9-]+\\.auth\\.${arn[1]}\\.amazoncognito\\.com$`).test(loginOrigin)
    || poolId === env.STUDIO_TEAM_USER_POOL_ID || clientId === env.STUDIO_TEAM_CLIENT_ID || table === teamTable || loginOrigin === env.STUDIO_TEAM_LOGIN_ORIGIN
    || !teamTable.startsWith(`arn:aws:dynamodb:${arn[1]}:${arn[2]}:table/`)) throw new StudioError(503, "플레이어 전용 로그인 연결을 확인하세요.");
  return { appOrigin, poolId, clientId, table, loginOrigin, region: arn[1], profile: env.STUDIO_PLAYER_PROFILE, audience: "player" };
}
const instances = new Map<string, BrowserSessions>();
export function configuredPlayerSessions() {
  const config = playerLoginConfig(), key = JSON.stringify(config); let instance = instances.get(key);
  if (!instance) {
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region, ...(config.profile ? { credentials: fromIni({ profile: config.profile }) } : {}), maxAttempts: 2 }));
    instance = new BrowserSessions(config, db, CognitoJwtVerifier.create({ userPoolId: config.poolId, clientId: config.clientId, tokenUse: "access" }), CognitoJwtVerifier.create({ userPoolId: config.poolId, clientId: config.clientId, tokenUse: "id" }));
    instances.set(key, instance);
  }
  return instance;
}
export function playerOwnerHash(projectId: string, poolId: string, subject: string) {
  z.string().uuid().parse(projectId); z.string().regex(/^[a-z0-9-]+_[A-Za-z0-9]+$/).parse(poolId); cognitoSubjectSchema.parse(subject);
  return createHash("sha256").update(JSON.stringify(["player/1", poolId, projectId, subject])).digest("hex");
}
export async function requestPlayerIdentity(request: Request) {
  if (request.headers.has("authorization")) throw new StudioError(400, "플레이어 웹 로그인을 사용하세요.");
  const handle = readSessionCookie(request, "session", "player");
  if (!handle) throw new StudioError(401, "캐릭터 챗에 로그인하세요.");
  const sessions = configuredPlayerSessions();
  if (new URL(request.url).origin !== sessions.config.appOrigin) throw new StudioError(403, "설정된 캐릭터 챗 주소에서 로그인하세요.");
  const result = await sessions.resolve(handle);
  return { subject: result.subject, poolId: sessions.config.poolId, expiresAt: result.expiresAt };
}
