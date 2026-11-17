// Shared by the outer HTTP ingress and route-level checks. No credentials.
/** @param {Record<string, string | undefined>} env */
export function isTeamHosted(env = process.env) {
  const mode = env.STUDIO_WEB_MODE;
  if (!mode || mode === "local") return false;
  if (mode !== "team-hosted") throw new Error("Unsupported web deployment mode");
  return true;
}
/** @param {Record<string, string | undefined>} env */
export function teamHostedOrigin(env = process.env) {
  const raw = env.STUDIO_TEAM_APP_ORIGIN ?? "";
  const url = new URL(raw);
  if (url.origin !== raw || url.protocol !== "https:" || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(url.hostname)) throw new Error("A canonical HTTPS team origin is required");
  return raw;
}
const uuid = "[a-fA-F0-9-]{36}";
/** @param {string} raw @param {string} method @param {Record<string, string | undefined>} env */
export function teamHostedPath(raw, method, env = process.env) {
  const path = raw.split("?")[0];
  if (!path.startsWith("/") || /[%\\#\x00-\x20]/.test(path) || path.includes("//") || path.split("/").some(s => s === "." || s === "..")) return "deny";
  if (method === "GET" || method === "HEAD") {
    if (env.STUDIO_PLAYER_WEB_ENABLED === "true") {
      if (path === "/play" || path === "/play/policy" || new RegExp(`^/play/${uuid}$`).test(path)) return "page";
      if (path === "/api/player/session/callback") return "callback";
      if (path === "/api/player/catalog") return "api";
      if (new RegExp(`^/api/player/catalog/cover/${uuid}/${uuid}$`).test(path)) return "api";
      if (new RegExp(`^/api/player/play/assets/${uuid}/${uuid}/${uuid}$`).test(path)) return "api";
    }
    if (path === "/healthz") return "health";
    if (path === "/") return "redirect";
    if (path === "/team" || new RegExp(`^/team/chat/${uuid}$`).test(path)) return "page";
    if (/^\/(?:assets|_next\/static)\/[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|woff2|png|svg|ico)$/.test(path) && !path.split("/").some(s => s.startsWith("."))) return "static";
    if (["/favicon.ico", "/og.png"].includes(path)) return "static";
    if (new RegExp(`^/api/team/(?:assets/${uuid}/${uuid}|play/assets/${uuid}/${uuid}/${uuid})$`).test(path)) return "api";
    if (path === "/api/team/session/callback") return "callback";
  }
  if (!["GET", "HEAD", "POST"].includes(method)) return "deny";
  if (path === "/api/player/prewarm") return env.STUDIO_PLAYER_WEB_ENABLED === "true" && env.STUDIO_PLAYER_RUNTIME_PREWARM === "true" && method === "POST" ? "api" : "deny";
  if (env.STUDIO_PLAYER_WEB_ENABLED === "true" && ["session", "session/logout", "play", "catalog", "safety", "wallet"].some(r => path === `/api/player/${r}`)) return "api";
  const routes = ["session", "session/logout", "projects", "edit", "production", "design", "history", "binding", "launch", "play", "access", "events", "assets", "library", "world-graph", ...(env.STUDIO_VIDEO_BUCKET ? ["video"] : [])];
  return routes.some(r => path === `/api/team/${r}`) ? "api" : "deny";
}
