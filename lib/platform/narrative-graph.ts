import { createHash } from "node:crypto";
import { MultiDirectedGraph } from "graphology";
import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const condition = z.object({ counter: id, op: z.enum(["gte", "lte", "eq"]), value: z.number().finite() }).strict();
export const narrativeDefinitionSchema = z.object({
  id, version: z.number().int().positive(), startScene: id,
  startTime: z.string().datetime({ offset: true }), minutesPerTurn: z.number().int().min(0).max(60),
  summary: z.string().max(1600).optional(),
  clockStyle: z.enum(["calendar", "elapsed"]).optional(), clockLabel: z.string().max(80).optional(),
  translations: z.object({ en: z.record(z.string(), z.string()).optional(), ja: z.record(z.string(), z.string()).optional() }).strict().optional(),
  characters: z.array(z.object({ id, name: z.string().min(1).max(80), role: z.string().max(300), voice: z.string().max(600), description: z.string().max(1200), appearance: z.string().max(600) }).strict()).max(12).optional(),
  media: z.array(z.object({ id, emotion: z.enum(["neutral", "focused", "concerned", "relieved", "happy", "sad", "angry"]), when: z.string().max(400), scenes: z.array(id).max(24), conditions: z.array(condition).max(8), eventId: id.optional(), characterId: id.optional(), priority: z.number().int().min(0).max(100), once: z.boolean(), cooldown: z.number().int().min(0).max(200) }).strict()).max(40).optional(),
  statusFields: z.array(z.object({ id, label: z.string().max(80), cases: z.array(z.object({ text: z.string().max(300), conditions: z.array(condition).max(8) }).strict()).min(1).max(8) }).strict()).max(12).optional(),
  plotThreads: z.array(z.object({ id, title: z.string().max(120), description: z.string().max(500), activeWhen: z.array(condition).max(8), resolveWhen: z.array(condition).min(1).max(8), resolution: z.string().max(300).optional() }).strict()).max(12).optional(),
  milestones: z.array(z.object({ id, title: z.string().max(120), text: z.string().max(1200), conditions: z.array(condition).min(1).max(8) }).strict()).max(16).optional(),
  counters: z.array(z.object({ id, label: z.string().max(80), initial: z.number().finite(), min: z.number().finite(), max: z.number().finite(), unit: z.string().max(12), visible: z.boolean(), values: z.array(z.string().max(80)).min(2).max(20).optional() }).strict()).max(16),
  facts: z.array(z.object({ id, text: z.string().max(1600), conditions: z.array(condition).max(8), keywords: z.array(z.string().min(1).max(60)).max(12).optional() }).strict()).max(40),
  scenes: z.array(z.object({ id, speaker: id.optional(), title: z.string().max(120), location: z.string().max(120), opening: z.string().max(1800), objective: z.string().max(300), minTurns: z.number().int().min(0).max(30), suggestions: z.array(z.string().max(150)).max(3), choices: z.array(z.object({ id, text: z.string().max(180), conditions: z.array(condition).max(8), unless: z.array(condition).max(8).optional(), actionId: id.optional(), transitionId: id.optional(), priority: z.number().optional() }).strict()).max(12).optional(), mood: z.enum(["neutral", "focused", "concerned", "relieved"]) }).strict()).min(1).max(24),
  events: z.array(z.object({ id, when: z.string().max(500), scenes: z.array(id).max(24), once: z.boolean(), opensTransition: id.optional(), opensTransitions: z.array(id).max(24).optional(), label: z.string().max(100).optional(), result: z.string().max(500).optional(), conditions: z.array(condition).max(8).optional(), effects: z.array(z.object({ counter: id, delta: z.number().finite() }).strict()).max(8), minutes: z.number().int().min(0).max(1440) }).strict()).max(32),
  transitions: z.array(z.object({ id, from: id, to: id, label: z.string().max(150), when: z.string().max(500), conditions: z.array(condition).max(8), minutes: z.number().int().min(0).max(1440).optional() }).strict()).max(40),
  endings: z.array(z.object({ id, title: z.string().max(120), text: z.string().max(1200), scenes: z.array(id).max(24), conditions: z.array(condition).min(1).max(8), priority: z.number().int().min(0).max(100) }).strict()).min(1).max(10),
}).strict();
export type NarrativeDefinition = z.infer<typeof narrativeDefinitionSchema>;
const eventRecord = z.object({ id, turn: z.number().int().positive(), quote: z.string().min(2).max(300) }).strict();
export const narrativeStateSchema = z.object({
  schema: z.literal("narrative-graph/1"), definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  scene: id, turns: z.number().int().min(0).max(200), sceneTurns: z.number().int().min(0).max(200), elapsedMinutes: z.number().int().min(0).max(100000),
  counters: z.record(id, z.number().finite()), events: z.array(eventRecord).max(200),
  transitions: z.array(z.object({ id, from: id, to: id, turn: z.number().int().positive(), quote: z.string().min(2).max(300) }).strict()).max(100),
  ending: id.optional(),
}).strict();
export type NarrativeState = z.infer<typeof narrativeStateSchema>;
export const narrativePlanSchema = z.object({
  events: z.array(z.object({ id, quote: z.string().min(2).max(300) }).strict()).max(2),
  transition: z.object({ id, quote: z.string().min(2).max(300) }).strict().nullable(),
}).strict();
export type NarrativePlan = z.infer<typeof narrativePlanSchema>;
const builtinCounters = new Set(["total-turns", "scene-turns", "elapsed-minutes"]);
const definitionHash = (definition: NarrativeDefinition) => {
  // Schema parsing fixes object field order; translation records have arbitrary
  // user-authored keys and DynamoDB can return them in any order. Canonicalize
  // those maps while preserving hashes of older releases without translations.
  const canonical = structuredClone(definition);
  for (const language of ["en", "ja"] as const) {
    const dictionary = canonical.translations?.[language];
    if (dictionary) canonical.translations![language] = Object.fromEntries(Object.entries(dictionary).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};
const templates = new Map<string, MultiDirectedGraph>();

export function compileNarrative(definition: NarrativeDefinition) {
  // Hash the canonical schema order so JSON/API decoding cannot change release identity.
  definition = narrativeDefinitionSchema.parse(definition);
  const hash = definitionHash(definition);
  const cached = templates.get(hash);
  if (cached) return { hash, graph: cached.copy() };
  const graph = new MultiDirectedGraph({ allowSelfLoops: false });
  const node = (key: string, kind: string, attributes: Record<string, unknown>) => graph.addNode(key, { kind, ...attributes });
  node("world", "Story", { id: definition.id, version: definition.version });
  const counters = new Set([...builtinCounters, ...definition.counters.map(counter => counter.id)]);
  for (const counter of definition.counters) {
    if (builtinCounters.has(counter.id) || counter.min > counter.max || counter.initial < counter.min || counter.initial > counter.max) throw Error("Invalid narrative counter");
    if (counter.values && (counter.min !== 0 || counter.max !== counter.values.length-1 || !Number.isInteger(counter.initial))) throw Error("Invalid enum counter");
    node("counter/" + counter.id, "Counter", counter);
  }
  for (const name of builtinCounters) node("counter/" + name, "Counter", { id: name });
  for (const character of definition.characters ?? []) node("character/" + character.id, "Character", character);
  for (const scene of definition.scenes) {
    node("scene/" + scene.id, "Scene", scene);
    if (scene.speaker) {
      if (!definition.characters?.some(c=>c.id === scene.speaker)) throw Error("Unknown scene speaker");
      graph.addDirectedEdge("scene/"+scene.id,"character/"+scene.speaker,{kind:"SPEAKS"});
    }
  }
  if (!graph.hasNode("scene/" + definition.startScene)) throw Error("Missing narrative opening");
  const gates = (key: string, conditions: z.infer<typeof condition>[]) => {
    for (const [index, gate] of conditions.entries()) {
      if (!counters.has(gate.counter)) throw Error("Unknown gate counter");
      node(key + "/gate/" + index, "Gate", gate);
      graph.addDirectedEdge(key, key + "/gate/" + index, { kind: "REQUIRES" });
      graph.addDirectedEdge(key + "/gate/" + index, "counter/" + gate.counter, { kind: "READS" });
    }
  };
  for (const event of definition.events) {
    node("event/" + event.id, "Action", event);
    for (const scene of event.scenes) {
      if (!graph.hasNode("scene/" + scene)) throw Error("Unknown action scene");
      graph.addDirectedEdge("scene/" + scene, "event/" + event.id, { kind: "ALLOWS" });
    }
    gates("event/" + event.id, event.conditions ?? []);
    for (const effect of event.effects) {
      if (!definition.counters.some(counter => counter.id === effect.counter)) throw Error("Unknown action counter");
      graph.addDirectedEdge("event/" + event.id, "counter/" + effect.counter, { kind: "CHANGES", delta: effect.delta });
    }
  }
  for (const transition of definition.transitions) {
    if (!graph.hasNode("scene/" + transition.from) || !graph.hasNode("scene/" + transition.to)) throw Error("Unknown transition scene");
    const key = "transition/" + transition.id;
    node(key, "Transition", transition);
    graph.addDirectedEdge("scene/" + transition.from, key, { kind: "CAN_TRANSITION" });
    graph.addDirectedEdge(key, "scene/" + transition.to, { kind: "OPENS" });
    gates(key, transition.conditions);
  }
  for (const event of definition.events) {
    for (const target of new Set([...(event.opensTransition ? [event.opensTransition] : []), ...(event.opensTransitions ?? [])])) {
      const transition = definition.transitions.find(item => item.id === target);
      if (!transition || !event.scenes.includes(transition.from)) throw Error("Invalid authored action transition");
      graph.addDirectedEdge("event/" + event.id, "transition/" + transition.id, { kind: "REQUESTS_TRANSITION" });
    }
  }
  for (const media of definition.media ?? []) {
    const key = "media/"+media.id; node(key,"Media",media); gates(key,media.conditions);
    for (const scene of media.scenes) {
      if (!graph.hasNode("scene/"+scene)) throw Error("Unknown media scene");
      graph.addDirectedEdge("scene/"+scene,key,{kind:"SHOWS"});
    }
    if (media.characterId && !graph.hasNode("character/"+media.characterId)) throw Error("Unknown media character");
    if (media.eventId && !graph.hasNode("event/"+media.eventId)) throw Error("Unknown media event");
  }
  for (const milestone of definition.milestones ?? []) {
    const key = "milestone/" + milestone.id;
    node(key, "Milestone", milestone); gates(key, milestone.conditions);
  }
  for (const ending of definition.endings) {
    const key = "ending/" + ending.id;
    node(key, "Ending", ending);
    for (const scene of ending.scenes) {
      if (!graph.hasNode("scene/" + scene)) throw Error("Unknown ending scene");
      graph.addDirectedEdge("scene/" + scene, key, { kind: "CAN_END" });
    }
    gates(key, ending.conditions);
  }
  for (const scene of definition.scenes) for (const choice of scene.choices ?? []) {
    const key = `scene/${scene.id}/choice/${choice.id}`;
    node(key, "Suggestion", choice);
    graph.addDirectedEdge("scene/" + scene.id, key, { kind: "OFFERS" });
    gates(key, choice.conditions);
    for (const gate of choice.unless ?? []) if (!counters.has(gate.counter)) throw Error("Unknown suggestion counter");
    if (choice.actionId) {
      const action = definition.events.find(event => event.id === choice.actionId && event.scenes.includes(scene.id));
      if (!action) throw Error("Unknown suggestion action");
      graph.addDirectedEdge(key, "event/" + action.id, { kind: "SUGGESTS" });
    }
    if (choice.transitionId && !definition.transitions.some(item => item.id === choice.transitionId && item.from === scene.id)) throw Error("Unknown suggestion transition");
  }
  for (const field of definition.statusFields ?? []) {
    const key = "status/" + field.id;
    node(key, "StatusField", { id: field.id, label: field.label });
    for (const [i, value] of field.cases.entries()) { node(key + "/" + i, "StatusCase", { text: value.text }); graph.addDirectedEdge(key, key + "/" + i, { kind: "DISPLAYS" }); gates(key + "/" + i, value.conditions); }
  }
  for (const thread of definition.plotThreads ?? []) {
    const key = "thread/" + thread.id;
    node(key, "PlotThread", thread);
    for (const [phase, conditions] of [["active", thread.activeWhen], ["resolved", thread.resolveWhen]] as const) {
      node(key + "/" + phase, "ThreadPhase", { phase }); graph.addDirectedEdge(key, key + "/" + phase, { kind: "HAS_PHASE" }); gates(key + "/" + phase, conditions);
    }
  }
  for (const fact of definition.facts) { node("fact/" + fact.id, "Fact", fact); gates("fact/" + fact.id, fact.conditions); }
  for (const key of graph.nodes().filter(key => key !== "world")) graph.addDirectedEdge("world", key, { kind: "CONTAINS" });
  if (templates.size >= 8) templates.delete(templates.keys().next().value!);
  templates.set(hash, graph.copy());
  return { hash, graph };
}
export function initialNarrativeState(definition: NarrativeDefinition): NarrativeState {
  const { hash } = compileNarrative(definition);
  return { schema: "narrative-graph/1", definitionHash: hash, scene: definition.startScene, turns: 0, sceneTurns: 0, elapsedMinutes: 0,
    counters: Object.fromEntries(definition.counters.map(counter => [counter.id, counter.initial])), events: [], transitions: [] };
}
export function narrativeGraph(definition: NarrativeDefinition, rawState: NarrativeState) {
  const state = narrativeStateSchema.parse(rawState);
  const { hash, graph } = compileNarrative(definition);
  if (state.definitionHash !== hash || !graph.hasNode("scene/" + state.scene)) throw Error("Narrative release mismatch");
  if (Object.keys(state.counters).length !== definition.counters.length || definition.counters.some(counter => !Number.isFinite(state.counters[counter.id]) || state.counters[counter.id] < counter.min || state.counters[counter.id] > counter.max)) throw Error("Invalid narrative state counters");
  if (state.ending && !definition.endings.some(ending => ending.id === state.ending)) throw Error("Unknown narrative ending");
  if (state.events.some(event => !definition.events.some(candidate => candidate.id === event.id)) || state.transitions.some(event => !definition.transitions.some(candidate => candidate.id === event.id && candidate.from === event.from && candidate.to === event.to))) throw Error("Unknown narrative history");
  const values = { ...state.counters, "total-turns": state.turns, "scene-turns": state.sceneTurns, "elapsed-minutes": state.elapsedMinutes };
  for (const [key, value] of Object.entries(values)) graph.setNodeAttribute("counter/" + key, "value", value);
  graph.setNodeAttribute("scene/" + state.scene, "active", true);
  return graph;
}
function gatePasses(graph: MultiDirectedGraph, key: string) {
  return graph.outNeighbors(key).filter(neighbor => graph.getNodeAttribute(neighbor, "kind") === "Gate").every(neighbor => {
    const gate = graph.getNodeAttributes(neighbor);
    const value = graph.getNodeAttribute("counter/" + gate.counter, "value");
    return gate.op === "gte" ? value >= gate.value : gate.op === "lte" ? value <= gate.value : value === gate.value;
  });
}
export function availableNarrativeActions(definition: NarrativeDefinition, state: NarrativeState) {
  const graph = narrativeGraph(definition, state);
  return definition.events.filter(event => event.scenes.includes(state.scene) && (!event.once || !state.events.some(done => done.id === event.id)) && gatePasses(graph, "event/" + event.id));
}
export function advanceNarrative(definition: NarrativeDefinition, current: NarrativeState, message: string, rawPlan: NarrativePlan) {
  narrativeGraph(definition, current);
  if (current.ending) throw Error("Narrative already ended");
  const plan = narrativePlanSchema.parse(rawPlan), next = structuredClone(current);
  const allowed = availableNarrativeActions(definition, current);
  const applied: string[] = [], seen = new Set<string>();
  next.turns++; next.sceneTurns++; next.elapsedMinutes += definition.minutesPerTurn;
  for (const candidate of plan.events) {
    const event = allowed.find(event => event.id === candidate.id);
    if (!event || seen.has(candidate.id) || !message.includes(candidate.quote) || !gatePasses(narrativeGraph(definition, next), "event/" + event.id)) continue;
    seen.add(candidate.id);
    for (const effect of event.effects) {
      const counter = definition.counters.find(counter => counter.id === effect.counter)!;
      next.counters[effect.counter] = Math.min(counter.max, Math.max(counter.min, next.counters[effect.counter] + effect.delta));
    }
    next.events.push({ id: event.id, turn: next.turns, quote: candidate.quote });
    next.elapsedMinutes += event.minutes;
    applied.push(event.id);
  }
  let graph = narrativeGraph(definition, next);
  const scene = definition.scenes.find(scene => scene.id === next.scene)!;
  // An authored action can request its linked transition. The same gates and
  // exact input evidence still apply; ambiguous links never choose a destination.
  const linked = next.events.filter(event => event.turn === next.turns).flatMap(record => {
    const action = definition.events.find(event => event.id === record.id)!;
    const targets = new Set([...(action.opensTransition ? [action.opensTransition] : []), ...(action.opensTransitions ?? [])]);
    return definition.transitions.filter(item => targets.has(item.id) && item.from === next.scene).map(item => ({ id: item.id, quote: record.quote }));
  });
  const linkedIds = new Set(linked.map(item => item.id));
  const explicit = plan.transition && message.includes(plan.transition.quote) && definition.transitions.some(item => item.id === plan.transition!.id && item.from === next.scene) ? plan.transition : null;
  const requested = explicit ?? (linkedIds.size === 1 ? linked[0] : null);
  const transition = requested && definition.transitions.find(transition => transition.id === requested.id && transition.from === next.scene);
  if (transition && next.sceneTurns >= scene.minTurns && message.includes(requested!.quote) && gatePasses(graph, "transition/" + transition.id)) {
    next.transitions.push({ id: transition.id, from: transition.from, to: transition.to, turn: next.turns, quote: requested!.quote });
    next.scene = transition.to; next.sceneTurns = 0;
    next.elapsedMinutes += transition.minutes ?? 0;
    graph = narrativeGraph(definition, next);
  }
  const ending = definition.endings.filter(ending => ending.scenes.includes(next.scene) && gatePasses(graph, "ending/" + ending.id)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  if (ending) next.ending = ending.id;
  return { state: next, applied, transitioned: current.scene !== next.scene, ending };
}
export function narrativeContext(definition: NarrativeDefinition, state: NarrativeState) {
  const graph = narrativeGraph(definition, state);
  const scene = definition.scenes.find(scene => scene.id === state.scene)!;
  return { scene, facts: definition.facts.filter(fact => gatePasses(graph, "fact/" + fact.id)), ending: definition.endings.find(ending => ending.id === state.ending) };
}
export function publicNarrative(definition: NarrativeDefinition, state: NarrativeState) {
  const graph = narrativeGraph(definition, state), { scene, ending } = narrativeContext(definition, state);
  return {
    sceneId: scene.id, scene: scene.title, location: scene.location, objective: scene.objective, turns: state.turns, sceneTurns: state.sceneTurns,
    day: 1 + Math.floor((Number(definition.startTime.slice(11, 13)) * 60 + Number(definition.startTime.slice(14, 16)) + state.elapsedMinutes) / 1440),
    time: new Date(new Date(definition.startTime).getTime() + state.elapsedMinutes * 60000).toISOString(),
    counters: definition.counters.filter(counter => counter.visible).map(counter => ({ id: counter.id, label: counter.label, value: state.counters[counter.id], min: counter.min, max: counter.max, unit: counter.unit, ...(counter.values ? {displayValue: counter.values[state.counters[counter.id]]} : {}) })),
    gates: definition.transitions.filter(transition => transition.from === scene.id).map(transition => ({ id: transition.id, label: transition.label,
      ready: state.sceneTurns >= scene.minTurns && gatePasses(graph, "transition/" + transition.id),
      minimumTurns: scene.minTurns,
      conditions: transition.conditions.filter(condition => definition.counters.some(counter => counter.id === condition.counter && counter.visible)).map(condition => ({ ...condition, label: definition.counters.find(counter => counter.id === condition.counter)!.label, actual: state.counters[condition.counter] })),
    })),
    milestones: (definition.milestones ?? []).filter(item => gatePasses(graph, "milestone/" + item.id)).map(({id,title,text}) => ({id,title,text})),
    suggestions: scene.suggestions, ending: ending && { id: ending.id, title: ending.title, text: ending.text }, endingCount: definition.endings.length,
    graph: { nodes: graph.order, edges: graph.size },
  };
}

/** Candidate media use the same canonical gates as state and story transitions. */
export function eligibleNarrativeMedia(definition: NarrativeDefinition, state: NarrativeState) {
  const graph=narrativeGraph(definition,state);
  return (definition.media ?? []).filter(m=>(!m.scenes.length || m.scenes.includes(state.scene)) && gatePasses(graph,"media/"+m.id) && (!m.eventId || state.events.some(e=>e.id===m.eventId && e.turn===state.turns))).sort((a,b)=>b.priority-a.priority || a.id.localeCompare(b.id));
}
