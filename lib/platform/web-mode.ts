import { isTeamHosted as readMode, teamHostedOrigin, teamHostedPath } from "../../scripts/hosted-policy.mjs";
import { StudioError } from "../studio/store";
export { teamHostedPath };
export function isTeamHosted() {
  try { return readMode(); }
  catch { throw new StudioError(503, "웹 배포 모드 설정을 확인하세요."); }
}
export function teamAppOrigin() {
  try {
    if (isTeamHosted()) return teamHostedOrigin();
    const origin = process.env.STUDIO_TEAM_APP_ORIGIN ?? "http://localhost:3000";
    if (origin !== "http://localhost:3000") throw new Error("Local origin mismatch");
    return origin;
  } catch { throw new StudioError(503, "웹 배포 모드와 작업실 주소 설정을 확인하세요."); }
}
