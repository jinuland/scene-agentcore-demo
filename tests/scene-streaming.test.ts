import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { streamEvent, streamEvents } from "../lib/platform/event-stream";
import { createRuntimeServer } from "../cloud/runtime/handler";
import { createSceneService } from "../examples/agentcore-character-demo/service";
import { sqliteStore } from "../examples/agentcore-character-demo/sqlite-store";
import { stories } from "../examples/agentcore-character-demo/stories";
import { initialNarrativeState } from "../lib/platform/narrative-graph";
import { sceneGraphProjection } from "../examples/agentcore-character-demo/graph-projection";

test("SSE frames preserve Korean split across byte chunks and reject truncated JSON", async () => {
  const bytes = new TextEncoder().encode(streamEvent("dialogue.delta", { text: "안녕, 지안!" }).replaceAll("\n", "\r\n"));
  async function* chunks() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const rows = []; for await (const row of streamEvents(chunks())) rows.push(row);
  assert.deepEqual(rows, [{ event: "dialogue.delta", data: { text: "안녕, 지안!" } }]);
  await assert.rejects(async () => { for await (const _ of streamEvents((async function* () { yield bytes.slice(0, -4); })())) void _; }, /Incomplete/);
});

test("Runtime delivers dialogue before generation completes and marks failures without a completion", async () => {
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  const server = createRuntimeServer(async () => ({ text: "buffered", memories: [], usedFactIds: [] }), async (context, _signal, execution) => {
    await execution?.onTextDelta?.("안녕");
    await finished;
    if (context.message === "fail") throw Error("private provider error");
    await execution?.onTextDelta?.(" 지안");
    return { text: "안녕 지안", memories: [], usedFactIds: [] };
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/invocations`;
  const context = { policy: "test", character: { id: "c", name: "리에", role: "test", voice: "test", personality: "test" }, tone: "test", boundaries: [], visibleFacts: [], memories: [], recent: [], message: "hello" };
  try {
    const response = await fetch(url, { method: "POST", headers: { accept: "text/event-stream" }, body: JSON.stringify({ schemaVersion: "character-turn/1", context }) });
    const iterator = streamEvents(response.body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.event, "runtime.ready");
    assert.deepEqual((await iterator.next()).value, { event: "dialogue.delta", data: { text: "안녕" } });
    release();
    assert.equal((await iterator.next()).value?.event, "dialogue.delta");
    assert.equal((await iterator.next()).value?.event, "runtime.complete");
    const failure = await fetch(url, { method: "POST", headers: { accept: "text/event-stream" }, body: JSON.stringify({ schemaVersion: "character-turn/1", context: { ...context, message: "fail" } }) });
    const rows = []; for await (const row of streamEvents(failure.body as unknown as AsyncIterable<Uint8Array>)) rows.push(row);
    assert.equal(rows.at(-1)?.event, "runtime.error"); assert.ok(!JSON.stringify(rows).includes("private provider"));
  } finally { release(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test("service commits before acknowledging, reloads canonical state, deduplicates retry and projects asynchronously", async () => {
  process.env.STUDIO_MULTI_MODEL_CHAT = "true"; process.env.STUDIO_MANTLE_CHAT_REGION = "us-east-1";
  const path = join(mkdtempSync(join(tmpdir(), "scene-stream-test-")), "test.sqlite");
  const store = sqliteStore(path);
  const handle = createSceneService({ store, web: resolve("examples/agentcore-character-demo/web"), aws: { arn: "arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/test_runtime", region: "ap-northeast-2" } });
  let cookie = "", calls = 0, failStream = false;
  const send = async (path: string, data?: unknown, streaming = false) => {
    const response = await handle(new Request("http://scene.test/api/" + path, { method: data ? "POST" : "GET", headers: { origin: "http://scene.test", cookie, "content-type": "application/json", ...(streaming ? { accept: "text/event-stream" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }));
    cookie ||= response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return response;
  };
  const original = BedrockAgentCoreClient.prototype.send;
  BedrockAgentCoreClient.prototype.send = (async () => {
    calls++;
    return { statusCode: 200, response: (async function* () {
      const encode = (e: string, d: unknown) => new TextEncoder().encode(streamEvent(e, d));
      yield encode("dialogue.delta", { text: "[Action] She waves.\n\n[Dialogue] Hello, Jian." });
      if (failStream) { yield encode("runtime.error", { errorCode: "model_provider" }); return; }
      yield encode("runtime.complete", { schemaVersion: "character-turn/1", reply: { text: "[Action] She waves.\n\n[Dialogue] Hello, Jian.", imageKey: "focused", usedFactIds: [], memories: [{ kind: "claim", predicate: "said", source: "user", quote: "나는 지안이야" }] } });
    })() };
  }) as never;
  try {
    await send("library");
    const episode = await (await send("episodes", { story: "academy" })).json();
    const input = { message: "나는 지안이야", mode: "sonnet5", requestId: "11111111-1111-4111-8111-111111111111" };
    const response = await send(`episodes/${episode.id}/turn`, input, true);
    const rows = []; for await (const row of streamEvents(response.body as unknown as AsyncIterable<Uint8Array>)) rows.push(row);
    assert.equal(rows[1].event, "dialogue.delta");
    const committed = rows.find(row => row.event === "state.committed")!.data.episode;
    assert.equal(committed.version, 1); assert.equal(committed.memoryCount, 1);
    assert.equal(committed.turns[0].mood, "focused");
    assert.deepEqual(committed.turns[0].beats, [{ kind: "action", text: "She waves." }, { kind: "speech", text: "Hello, Jian." }]);
    const reload = await (await send(`episodes/${episode.id}`)).json();
    assert.deepEqual(reload, committed);
    const replay = await send(`episodes/${episode.id}/turn`, input, true);
    for await (const row of streamEvents(replay.body as unknown as AsyncIterable<Uint8Array>)) assert.equal(row.data.replay, true);
    assert.equal(calls, 1);
    assert.equal((await send(`episodes/${episode.id}/turn`, { ...input, message: "changed" }, true)).status, 409);
    await new Promise<void>(r => setImmediate(r));
    const db = new DatabaseSync(path); const projection = db.prepare("SELECT version FROM graph_projection WHERE id = ?").get(episode.id); db.close();
    assert.equal(projection?.version, 1);
    failStream = true;
    const second = { ...input, requestId: "22222222-2222-4222-8222-222222222222" };
    const failure = await send(`episodes/${episode.id}/turn`, second, true);
    const failed = []; for await (const row of streamEvents(failure.body as unknown as AsyncIterable<Uint8Array>)) failed.push(row);
    assert.ok(failed.some(row => row.event === "turn.error"));
    assert.ok(!failed.some(row => row.event === "state.committed"));
    assert.equal((await (await send(`episodes/${episode.id}`)).json()).version, 1);
    // A failed stream releases the lease and a retry commits exactly one new turn.
    failStream = false;
    const retry = await send(`episodes/${episode.id}/turn`, second, true);
    for await (const row of streamEvents(retry.body as unknown as AsyncIterable<Uint8Array>)) {
      if (row.event === "state.committed") assert.equal(row.data.episode.version, 2);
    }
  } finally { BedrockAgentCoreClient.prototype.send = original; }
});

test("graph read model rebuilds the current canon and never changes the authoritative snapshot", () => {
  const story = stories.find(story => story.narrative)!;
  const episode = { id: "test", story: story.id, turns: [], memories: [], narrativeDefinition: story.narrative!, narrative: initialNarrativeState(story.narrative!) };
  const before = JSON.stringify(episode);
  const projection = sceneGraphProjection(episode);
  assert.equal(projection.version, 0);
  assert.ok(projection.graph.nodes.some(node => node.key.startsWith("counter/")));
  assert.equal(JSON.stringify(episode), before);
});
