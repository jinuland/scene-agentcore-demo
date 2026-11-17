import type { EditorBinding } from "./types";
import type { ProductionAccess } from "./production-access";
import type { EditorSession, TeamCredential } from "./team-sessions";
import { configuredBrowserSessions } from "./team-sessions";
import { configuredTeamAuthorizer } from "./team-access";
import { configuredProjects } from "./project-storage";
import { StudioError } from "../studio/store";
import type { TeamPermission, TeamPrincipal } from "./team-access";

type Dependencies = {
  cloud: (projectId: string) => unknown;
  token: (reference: EditorSession) => Promise<TeamCredential>;
  authorize: (token: TeamCredential, projectId: string, permission: TeamPermission) => Promise<TeamPrincipal>;
};
const defaults: Dependencies = {
  cloud: configuredProjects,
  token: async reference => {
    if (!reference.audience) return configuredBrowserSessions().editorToken(reference);
    const { configuredPlayerSessions } = await import("./player-sessions");
    return { serviceSessionToken: await configuredPlayerSessions().editorToken(reference) };
  },
  authorize: (token, id, permission) => configuredTeamAuthorizer().authorize(token, id, permission),
};
export async function bindingAccess(projectId: string, binding: EditorBinding, dependencies = defaults): Promise<ProductionAccess | undefined> {
  if (!binding.teamSession) return undefined; // The separate local-operator workbench is not the hosted Studio.
  if (dependencies === defaults) throw new StudioError(410, "웹 작업실의 외부 편집 공유는 종료되었습니다.");
  const reference = binding.teamSession;
  const access: ProductionAccess = { subject: reference.subject, check: async permission => {
    if (!binding.connected || Date.parse(binding.expiresAt) <= Date.now()) throw new StudioError(409, "편집 공유가 만료되었습니다.");
    if (!await dependencies.cloud(projectId)) throw new StudioError(403, "팀 편집에 연결된 클라우드 작품이 아닙니다.");
    const token = await dependencies.token(reference);
    const principal = await dependencies.authorize(token, projectId, permission);
    if (principal.subject !== reference.subject) throw new StudioError(403, "공유한 로그인 사용자를 확인하지 못했습니다.");
  } };
  await access.check("read");
  return access;
}
