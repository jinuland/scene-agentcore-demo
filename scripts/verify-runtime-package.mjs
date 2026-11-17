import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, copyFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run only the distributed file, outside the repository and without credentials,
// node_modules, or native image libraries. Health/validation never invoke Bedrock.
export async function verifyRuntimePackage(artifact = ".platform-runtime-dist/server.js") {
  const source = await readFile(artifact, "utf8");
  assert.doesNotMatch(source, /node_modules\/sharp\/|sharp-linux|libvips/, "Text runtime must not bundle native image dependencies");
  const directory = await mkdtemp(join(tmpdir(), "botfactory-runtime-package-"));
  let child;
  try {
    await copyFile(resolve(artifact), join(directory, "server.cjs"));
    child = spawn(process.execPath, [join(directory, "server.cjs")], {
      cwd: directory,
      env: { PORT: "0", NODE_ENV: "test", AWS_EC2_METADATA_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = new Promise(resolveClose => child.once("close", resolveClose));
    // Attach immediately so a failure before readiness can still be cleaned up.
    child.closed = closed;
    const port = await new Promise((resolveReady, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Standalone runtime did not start")), 10000);
      const fail = () => { clearTimeout(timeout); reject(new Error("Standalone runtime exited before readiness")); };
      child.once("error", fail);
      child.once("exit", fail);
      child.stdout.on("data", chunk => {
        output += chunk.toString();
        if (output.length > 4096) return fail();
        for (const line of output.split("\n")) {
          try {
            const message = JSON.parse(line);
            if (message.runtimeReady === true && Number.isInteger(message.port) && message.port > 0) {
              clearTimeout(timeout);
              child.removeListener("exit", fail);
              resolveReady(message.port);
              return;
            }
          } catch { /* wait for complete JSON line */ }
        }
      });
      // Drain stderr without logging runtime/provider output.
      child.stderr.resume();
    });
    const origin = `http://127.0.0.1:${port}`;
    const health = await fetch(`${origin}/ping`, { signal: AbortSignal.timeout(3000) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "Healthy" });
    for (const body of ["{", JSON.stringify({ schemaVersion: "invalid" })]) {
      const invalid = await fetch(`${origin}/invocations`, { method: "POST", body, signal: AbortSignal.timeout(3000) });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.headers.get("cache-control"), "no-store");
      await invalid.arrayBuffer();
    }
    const missing = await fetch(`${origin}/missing`, { signal: AbortSignal.timeout(3000) });
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
    assert.equal(child.exitCode, null);
  } finally {
    if (child) {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      await child.closed;
      clearTimeout(force);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
