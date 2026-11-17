import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { verifyRuntimePackage } from "./verify-runtime-package.mjs";

const root = ".studio/scene-demo-build";
const runtime = root + "/runtime/server.js";
const app = "examples/agentcore-character-demo";
await mkdir(root + "/web", { recursive: true });
const options = { bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: false };
await Promise.all([
  build({ ...options, entryPoints: ["cloud/runtime/server.ts"], outfile: runtime }),
  build({ ...options, entryPoints: [app + "/lambda.ts"], outfile: root + "/web/index.js" }),
  cp(app + "/web", root + "/web/web", { recursive: true }),
]);
await verifyRuntimePackage(runtime);
