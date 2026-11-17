import { z } from "zod";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { FetchError } from "aws-jwt-verify/error";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { StudioError } from "../studio/store";
import { requestTeamToken, unifiedLogin, type TeamCredential } from "./team-sessions";
import { playerLoginConfig } from "./player-sessions";
import { cognitoSubjectSchema, serviceCreatorSubject } from "./team-subject";

import { teamRoles, rolePermissions, type TeamPermission } from "./team-permissions";
export { teamRoles, permissionNames, rolePermissions, type TeamRole, type TeamPermission } from "./team-permissions";
const uuid = z.string().uuid();
export const membershipSchema = z.object({
  subject: cognitoSubjectSchema, workspaceId: uuid, projectId: uuid,
  role: z.enum(teamRoles), status: z.enum(["active", "revoked"]),
  version: z.number().int().positive(),
}).strict();
export type TeamMembership = z.infer<typeof membershipSchema>;
export type TeamPrincipal = TeamMembership & { issuer: string; expiresAt: number };
export function membershipKey(workspaceId: string, projectId: string, subject: string) {
  uuid.parse(workspaceId); uuid.parse(projectId); cognitoSubjectSchema.parse(subject);
  return { pk: `WORKSPACE#${workspaceId}#PROJECT#${projectId}`, sk: `MEMBER#${subject}` };
}
export function requireTeamPermission(principal: TeamPrincipal, permission: TeamPermission) {
  if (principal.status !== "active" || principal.expiresAt <= Date.now() / 1000 || !rolePermissions[principal.role]?.includes(permission)) throw new StudioError(403, "이 작품에서 해당 작업을 할 권한이 없습니다.");
}
type TokenVerifier = { verify(token: string): Promise<{ sub: string; iss: string; exp: number }> };
export class TeamAuthorizer {
  constructor(private verifier: TokenVerifier, private client: DynamoDBDocumentClient, private table: string, private workspaceId: string, private shared?: { verifier: TokenVerifier; poolId: string }) { uuid.parse(workspaceId); }
  async identity(credential: TeamCredential) {
    const shared = typeof credential !== "string", token = shared ? credential.serviceSessionToken : credential;
    if (!token || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new StudioError(401, "로그인이 필요합니다.");
    let identity;
    try {
      const verifier = shared ? this.shared?.verifier : this.verifier;
      if (!verifier) throw new Error("missing verifier");
      identity = await verifier.verify(token);
      cognitoSubjectSchema.parse(identity.sub);
      if (!Number.isFinite(identity.exp) || identity.exp <= Date.now() / 1000) throw new Error("expired");
    } catch (error) {
      if (error instanceof FetchError) throw new StudioError(503, "로그인 서비스를 확인하지 못했습니다. 잠시 후 다시 시도하세요.");
      throw new StudioError(401, "로그인을 확인하지 못했습니다. 다시 로그인하세요.");
    }
    return shared && this.shared ? { ...identity, sub: serviceCreatorSubject(this.shared.poolId, identity.sub) } : identity;
  }
  async authorize(token: TeamCredential, projectId: string, permission: TeamPermission): Promise<TeamPrincipal> {
    uuid.parse(projectId);
    const identity = await this.identity(token);
    let row;
    try {
      row = (await this.client.send(new GetCommand({ TableName: this.table, Key: membershipKey(this.workspaceId, projectId, identity.sub), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(10_000) })).Item;
    } catch { throw new StudioError(503, "작품 접근 권한을 확인하지 못했습니다. 권한을 완화하지 않았습니다."); }
    const parsed = membershipSchema.safeParse(row?.membership);
    if (!parsed.success || parsed.data.subject !== identity.sub || parsed.data.workspaceId !== this.workspaceId || parsed.data.projectId !== projectId || parsed.data.status !== "active") throw new StudioError(403, "이 작품에 접근할 권한이 없습니다.");
    const principal = { ...parsed.data, issuer: identity.iss, expiresAt: identity.exp };
    requireTeamPermission(principal, permission);
    return principal;
  }
}
const instances = new Map<string, TeamAuthorizer>();
export function configuredTeamAuthorizer() {
  const pool = process.env.STUDIO_TEAM_USER_POOL_ID ?? "", clientId = process.env.STUDIO_TEAM_CLIENT_ID ?? "";
  const table = process.env.STUDIO_TEAM_TABLE_ARN ?? "", workspace = process.env.STUDIO_CONTENT_WORKSPACE_ID ?? "";
  const profile = process.env.STUDIO_TEAM_PROFILE;
  const match = /^arn:aws:dynamodb:([a-z]{2}-[a-z]+-\d):\d{12}:table\/[A-Za-z0-9_.-]{3,255}$/.exec(table);
  if (!match || !pool.startsWith(`${match[1]}_`) || !/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(pool) || !/^[a-z0-9]{10,128}$/.test(clientId) || !uuid.safeParse(workspace).success) throw new StudioError(503, "팀 로그인 연결 설정이 필요합니다.");
  const shared = unifiedLogin() ? playerLoginConfig() : null;
  const key = JSON.stringify([pool, clientId, table, workspace, profile, shared?.poolId, shared?.clientId]);
  let instance = instances.get(key);
  if (!instance) {
    const verifier = CognitoJwtVerifier.create({ userPoolId: pool, clientId, tokenUse: "access" });
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: match[1], ...(profile ? { credentials: fromIni({ profile }) } : {}), maxAttempts: 2 }));
    instance = new TeamAuthorizer(verifier, client, table, workspace, shared ? { poolId: shared.poolId, verifier: CognitoJwtVerifier.create({ userPoolId: shared.poolId, clientId: shared.clientId, tokenUse: "access" }) } : undefined); instances.set(key, instance);
  }
  return instance;
}
export async function teamAccess(request: Request, projectId: string, permission: TeamPermission) {
  const token = await requestTeamToken(request);
  return configuredTeamAuthorizer().authorize(token, projectId, permission);
}
