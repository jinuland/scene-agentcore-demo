import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSceneService } from "./service";
import { sqliteStore } from "./sqlite-store";

function studioConfig() {
  try { return JSON.parse(readFileSync(new URL("../../infra/platform-config.json", import.meta.url), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { stackName: "BotFactoryPlatformDev", region: "ap-northeast-2", multiModelChat: true, mantleChatRegion: "us-east-1" };
  }
}
const config = studioConfig();
function runtimeOutput(path: string, stack: string) {
  try { return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))[stack]?.AgentRuntimeArn; }
  catch { return undefined; }
}
const aws = {
  arn: process.env.CHARACTER_DEMO_RUNTIME_ARN
    ?? runtimeOutput("../../outputs/scene-demo-stack.json", "BotFactorySceneDemo")
    ?? process.env.STUDIO_AGENTCORE_RUNTIME_ARN
    ?? runtimeOutput("../../platform-outputs.json", config.stackName)
    ?? "",
  region: process.env.STUDIO_AGENTCORE_REGION ?? config.region,
  profile: process.env.STUDIO_AGENTCORE_PROFILE ?? process.env.AWS_PROFILE ?? config.profile,
};
process.env.STUDIO_MULTI_MODEL_CHAT ??= String(config.multiModelChat ?? true);
process.env.STUDIO_MANTLE_CHAT_REGION ??= config.mantleChatRegion ?? "us-east-1";
const port = Number(process.env.CHARACTER_DEMO_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid CHARACTER_DEMO_PORT");
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const handle = createSceneService({
  store: sqliteStore(resolve(process.env.CHARACTER_DEMO_DB ?? ".studio/agentcore-character-demo/demo.sqlite")),
  web: fileURLToPath(new URL("./web/", import.meta.url)),
  aws,
});
createServer(async (req, res) => {
  const host = req.headers.host;
  if (!host || !hosts.has(host)) {
    res.writeHead(403).end();
    return;
  }
  const abort = new AbortController();
  res.once("close", () => { if (!res.writableEnded) abort.abort(); });
  try {
    const origin = `http://${host}`;
    const url = new URL(req.url ?? "/", origin);
    if (url.origin !== origin) {
      res.writeHead(400).end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const response = await handle(new Request(url, {
      method: req.method, headers, body: chunks.length ? Uint8Array.from(Buffer.concat(chunks)) : undefined, signal: abort.signal,
    }));
    if (!res.destroyed) res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.destroyed) res.writeHead(400).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`SCENE · http://127.0.0.1:${port} · AgentCore`));
