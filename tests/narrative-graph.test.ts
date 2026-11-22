import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { advanceNarrative, compileNarrative, initialNarrativeState, narrativeContext, narrativeDefinitionSchema, narrativeGraph, publicNarrative, type NarrativeState } from "../lib/platform/narrative-graph";
import { sarangNarrative as definition } from "../examples/agentcore-character-demo/sarang-story";
import { sqliteStore } from "../examples/agentcore-character-demo/sqlite-store";
import { verifiedNarrativeState } from "../examples/agentcore-character-demo/narrative-state";
import { localizeStory } from "../examples/agentcore-character-demo/story-locales";
import { publicStory, stories } from "../examples/agentcore-character-demo/stories";

const input = "천천히 글로 함께 푸딩을 먹고 창가에 앉자. 같이 걷고 다음 날 다시 왔어. 네 이야기를 듣고 함께 도움을 정하자. 친구로 곁에 있을게. 이제 갈게.";
function step(state: NarrativeState, events: string[] = [], transition?: string) {
  return advanceNarrative(definition, state, input, { events: events.map(id => ({ id, quote: input })), transition: transition ? { id: transition, quote: input } : null }).state;
}
function pathToSupport() {
  let state = initialNarrativeState(definition);
  const trace: NarrativeState[] = [];
  const actions: [string[], string?][] = [
    [["respectful-communication"]], [["share-pudding"], "sit-together"],
    [["respectful-communication"]], [["walk-together"], "walk-home"],
    [["respectful-communication"]], [["next-visit"], "meet-again"],
    [["share-memory"]], [[], "quiet-place"],
    [["respectful-communication"]], [["support-chosen"], "plan-support"],
    [[], undefined], [[], undefined],
  ];
  for (const [events, transition] of actions) { state = step(state, events, transition); trace.push(state); }
  return trace;
}

test("ontology compiles gates, facts and state values into isolated graph instances", () => {
  const initial = initialNarrativeState(definition);
  const one = narrativeGraph(definition, initial), two = narrativeGraph(definition, initial);
  assert.ok(one.nodes().some(id => one.getNodeAttribute(id, "kind") === "Gate"));
  assert.ok(one.edges().some(id => one.getEdgeAttribute(id, "kind") === "READS"));
  one.setNodeAttribute("counter/affection", "value", 200);
  assert.equal(two.getNodeAttribute("counter/affection", "value"), 10);
  assert.equal(compileNarrative(narrativeDefinitionSchema.parse(JSON.parse(JSON.stringify(definition)))).hash, initial.definitionHash);
  const invalid = structuredClone(definition); invalid.transitions[0].conditions[0].counter = "missing";
  assert.throws(() => compileNarrative(invalid), /Unknown gate counter/);
  const duplicate = structuredClone(definition); duplicate.scenes.push(duplicate.scenes[0]);
  assert.throws(() => compileNarrative(duplicate));
});

test("transitions require the conjunction of authored counters and minimum scene turns", () => {
  const initial = initialNarrativeState(definition);
  const premature = step(initial, ["respectful-communication", "share-pudding"], "sit-together");
  assert.equal(premature.scene, "store"); assert.equal(premature.sceneTurns, 1);
  assert.deepEqual(initial, initialNarrativeState(definition));
  assert.equal(step(premature, [], "sit-together").scene, "first-conversation");
  const missingOne = step(step(initial, ["respectful-communication"]), [], "sit-together");
  assert.equal(missingOne.scene, "store");
  const noChoice = step(premature);
  assert.equal(noChoice.scene, "store");
  assert.equal(publicNarrative(definition, noChoice).gates[0].ready, true);
});

test("event evidence, scene scope, deduplication and once-only actions are enforced in code", () => {
  const initial = initialNarrativeState(definition);
  let state = advanceNarrative(definition, initial, "안녕", { events: [{ id: "share-pudding", quote: "없는 근거" }], transition: null }).state;
  assert.equal(state.counters.affection, 10);
  state = step(state, ["share-pudding", "share-pudding"]);
  assert.equal(state.counters.affection, 14); assert.equal(state.events.length, 1);
  state = step(state, ["share-pudding", "support-chosen"]);
  assert.equal(state.counters.affection, 14); assert.equal(state.counters["support-chosen"], 0);
  assert.equal(state.events.length, 1);
  const empty = advanceNarrative(definition, state, input, { events: [], transition: { id: "sit-together", quote: "전혀 없는 이동" } }).state;
  assert.equal(empty.scene, "store");
});

test("counters clamp to author ranges and private facts unlock only through gates", () => {
  let state = initialNarrativeState(definition);
  assert.equal(narrativeContext(definition, state).facts.some(f => f.id === "sarang-family"), false);
  for (let i = 0; i < 4; i++) state = step(state, ["pressure"]);
  assert.equal(state.counters.affection, 0);
  state = initialNarrativeState(definition); state.counters.affection = 199;
  state = step(state, ["respectful-communication"]);
  assert.equal(state.counters.affection, 200);
  assert.equal(narrativeContext(definition, state).facts.some(f => f.id === "sarang-family"), true);
  assert.equal(narrativeContext(definition, state).facts.some(f => f.id === "sarang-father"), false);
});

test("all six scenes and three authored endings are reachable; terminal state cannot advance", () => {
  const trace = pathToSupport(), final = trace.at(-1)!;
  assert.equal(new Set([definition.startScene, ...trace.map(state => state.scene)]).size, 6);
  assert.equal(final.ending, "a-new-step"); assert.equal(final.turns, 12);
  assert.equal(trace[9].ending, undefined); assert.equal(trace[10].ending, undefined);
  assert.equal(publicNarrative(definition, final).day, 2);
  assert.throws(() => step(final), /already ended/);
  const friend = step(step(trace[5], ["friendship-chosen"]));
  assert.equal(friend.ending, "our-own-pace");
  const farewell = step(step(initialNarrativeState(definition)), ["goodbye"]);
  assert.equal(farewell.ending, "until-next-time");
  const priority = structuredClone(trace[10]); priority.counters["friendship-chosen"] = 1; priority.counters.goodbye = 1;
  assert.equal(step(priority).ending, "a-new-step");
});

test("time jumps commit with a successful transition and plans replay deterministically", () => {
  const trace = pathToSupport();
  assert.equal(trace[4].elapsedMinutes, 10);
  assert.equal(trace[5].elapsedMinutes, 1452);
  assert.equal(new Date(publicNarrative(definition, trace[5]).time).toISOString(), "2026-03-17T07:52:00.000Z");
  let previous = initialNarrativeState(definition);
  for (const returned of trace) {
    const transition = returned.transitions.find(event => event.turn === returned.turns);
    const replay = advanceNarrative(definition, previous, input, { events: returned.events.filter(event => event.turn === returned.turns).map(({id, quote}) => ({id, quote})), transition: transition ? {id:transition.id, quote:transition.quote} : null }).state;
    assert.deepEqual(replay, returned); previous = returned;
  }
  const another = structuredClone(definition); another.version = definition.version + 1;
  assert.throws(() => narrativeGraph(another, previous), /release mismatch/);
});

test("public data excludes private definitions and English/Japanese preserve the same graph release", () => {
  const story = stories.find(story => story.id === "sarang")!;
  for (const locale of ["ko", "en", "ja"] as const) {
    const localized = localizeStory(story, locale), publicData = publicStory(localized);
    assert.equal(publicData.hasNarrative, true); assert.equal(publicData.previewTurns?.length, 3);
    assert.equal("narrative" in publicData, false); assert.equal("facts" in publicData, false);
    assert.equal(initialNarrativeState(localized.narrative!).definitionHash, initialNarrativeState(definition).definitionHash);
  }
});

test("state verification accepts DynamoDB map reordering and rejects altered history or counters", () => {
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  const trace = pathToSupport();
  const previous = reorder(trace[6]) as NarrativeState, returned = trace[7];
  assert.deepEqual(verifiedNarrativeState(definition, previous, input, returned), returned);
  assert.deepEqual(verifiedNarrativeState(definition, trace[6], input, reorder(returned) as NarrativeState), returned);
  const changed = structuredClone(returned); changed.counters.affection++;
  assert.throws(() => verifiedNarrativeState(definition, previous, input, changed), /replay mismatch/);
  const altered = structuredClone(returned); altered.events[0].quote = "변조된 과거";
  assert.throws(() => verifiedNarrativeState(definition, previous, input, altered), /replay mismatch/);
  assert.throws(() => verifiedNarrativeState(definition, previous, input, undefined), /turn mismatch/);
});

test("SQLite persists graph snapshots and event evidence across new connections with owner isolation and deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-narrative-"));
  try {
    const path = join(dir, "demo.sqlite"), first = sqliteStore(path);
    const narrative = pathToSupport()[7], id = randomUUID();
    const episode = {id, story:"sarang", turns:[], memories:[], narrative, narrativeDefinition:structuredClone(definition)};
    await first.putEpisode("owner", episode);
    const restored = await sqliteStore(path).findEpisode("owner", id);
    assert.deepEqual(restored, episode);
    assert.deepEqual(narrativeGraph(definition, restored!.narrative!).export(), narrativeGraph(definition, narrative).export());
    assert.equal(await first.findEpisode("other-owner", id), undefined);
    assert.equal(await first.deleteEpisode("other-owner", id), false);
    assert.equal(await first.deleteEpisode("owner", id), true);
    assert.equal(await sqliteStore(path).findEpisode("owner", id), undefined);
  } finally { await rm(dir, {recursive:true, force:true}); }
});


test("authored action links move only with evidence and satisfied gates, and old releases retain their rules", () => {
  const atWindow = step(step(step(initialNarrativeState(definition), ["respectful-communication"]), ["share-pudding"], "sit-together"));
  const progressed = advanceNarrative(definition, atWindow, input, { events: [{ id: "walk-together", quote: input }], transition: null }).state;
  assert.equal(progressed.scene, "school-road");
  assert.equal(progressed.transitions.at(-1)?.quote, input);
  assert.deepEqual(verifiedNarrativeState(definition, atWindow, input, progressed), progressed);
  const badEvidence = advanceNarrative(definition, atWindow, input, { events: [{ id: "walk-together", quote: "없는 근거" }], transition: null }).state;
  assert.equal(badEvidence.scene, "first-conversation");
  const early = step(step(initialNarrativeState(definition), ["respectful-communication"]), ["share-pudding"], "sit-together");
  assert.equal(advanceNarrative(definition, early, input, { events: [{ id: "walk-together", quote: input }], transition: null }).state.scene, "first-conversation");
  const legacy = structuredClone(definition); legacy.version = 1;
  for (const event of legacy.events) delete event.opensTransition;
  const pinned = { ...structuredClone(atWindow), definitionHash: initialNarrativeState(legacy).definitionHash };
  assert.equal(advanceNarrative(legacy, pinned, input, { events: [{ id: "walk-together", quote: input }], transition: null }).state.scene, "first-conversation");
  const badDefinition = structuredClone(definition); badDefinition.events[0].opensTransition = "missing-transition";
  assert.throws(() => compileNarrative(badDefinition), /authored action transition/);
});

test("two authored action links do not silently choose an ambiguous destination", () => {
  const variant = structuredClone(definition);
  variant.transitions.push({ id: "alternate-road", from: "first-conversation", to: "quiet-conversation", label: "다른 길", when: "명시적인 다른 선택", conditions: [] });
  variant.events.find(event => event.id === "respectful-communication")!.opensTransition = "alternate-road";
  const atWindow = step(step(step(initialNarrativeState(definition), ["respectful-communication"]), ["share-pudding"], "sit-together"));
  atWindow.definitionHash = initialNarrativeState(variant).definitionHash;
  const result = advanceNarrative(variant, atWindow, input, { events: [{ id: "walk-together", quote: input }, { id: "respectful-communication", quote: input }], transition: null });
  assert.equal(result.state.scene, "first-conversation");
  assert.equal(result.transitioned, false);
});
