import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { build } from "esbuild";
import { verifyRuntimePackage } from "./verify-runtime-package.mjs";

const root = ".studio/scene-demo-build";
const runtime = root + "/runtime/server.js";
const app = "examples/agentcore-character-demo";
await mkdir(root + "/web", { recursive: true });
await mkdir(root + "/projector", { recursive: true });
await mkdir(root + "/author", { recursive: true });
const options = { bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: false };
await Promise.all([
  build({ ...options, entryPoints: ["cloud/runtime/server.ts"], outfile: runtime }),
  build({ ...options, entryPoints: [app + "/lambda.ts"], outfile: root + "/web/index.js" }),
  build({ ...options, entryPoints: [app + "/graph-projector.ts"], outfile: root + "/projector/index.js" }),
  build({ ...options, entryPoints: [app + "/creator-job-worker.ts"], outfile: root + "/author/index.js" }),
  cp(app + "/web", root + "/web/web", { recursive: true }),
]);
await verifyRuntimePackage(runtime);

// Import both deployed CommonJS bundles: source tests cannot detect bundled initialization cycles.
const check = await mkdtemp(join(tmpdir(), 'scene-lambda-init-'));
try {
  for (const name of ['web', 'author']) await cp(root + '/' + name + '/index.js', join(check, name + '.cjs'));
  execFileSync(process.execPath, ['-e', "global.awslambda={streamifyResponse:f=>f};require('./web.cjs');require('./author.cjs');"], {
    cwd: check, stdio: 'pipe', env: { PATH: process.env.PATH, AWS_EC2_METADATA_DISABLED: 'true', AWS_REGION: 'ap-northeast-2', CHARACTER_DEMO_TABLE: 'bundle-check', CHARACTER_DEMO_ACCESS_CODE: 'bundle-check', CHARACTER_DEMO_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/check' },
  });
} finally { await rm(check, { recursive: true, force: true }); }
