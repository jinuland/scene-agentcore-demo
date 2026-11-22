import { availableNarrativeActions, narrativeContext, publicNarrative, type NarrativeDefinition, type NarrativeState } from "./narrative-graph";

export type NarrativeLocale = "ko" | "en" | "ja";
type Locale = "ko" | "en" | "ja";
/** A read-only view of the committed state. Presentation updates never rewrite a pinned release. */
function eligibleChoices(definition: NarrativeDefinition, state: NarrativeState, options: { locale?: Locale; presentation?: NarrativeDefinition } = {}) {
  const view = options.presentation ?? definition, locale = options.locale ?? "ko";
  const tr = (text: string) => locale === "ko" ? text : view.translations?.[locale]?.[text] ?? definition.translations?.[locale]?.[text] ?? text;
  const values: Record<string, number> = { ...state.counters, "total-turns": state.turns, "scene-turns": state.sceneTurns, "elapsed-minutes": state.elapsedMinutes };
  const pass = (conditions: { counter: string; op: string; value: number }[]) => conditions.every(c => {
    const value = values[c.counter];
    return Number.isFinite(value) && (c.op === "gte" ? value >= c.value : c.op === "lte" ? value <= c.value : value === c.value);
  });
  const base = publicNarrative(definition, state), current = narrativeContext(definition, state);
  const scene = view.scenes.find(scene => scene.id === state.scene) ?? current.scene;
  const actions = availableNarrativeActions(definition, state);
  const allowed = new Set(actions.map(action => action.id));
  const score = (choice: NonNullable<typeof scene.choices>[number]) => (choice.priority ?? 0) + (actions.find(a => a.id === choice.actionId)?.opensTransition || actions.find(a => a.id === choice.actionId)?.opensTransitions?.length ? 50 : 0) + (actions.find(a => a.id === choice.actionId)?.once ? 10 : 0);
  const choices = (scene.choices ?? []).filter(choice => pass(choice.conditions)
    && !(choice.unless?.length && pass(choice.unless)) && (!choice.actionId || allowed.has(choice.actionId))
    && (!choice.transitionId || base.gates.some(gate => gate.id === choice.transitionId && gate.ready)))
    .sort((a, b) => score(b) - score(a));
  return { view, tr, base, current, scene, pass, choices };
}
/** Exact eligible authored buttons carry explicit intent; free text still uses interpretation. */
export function resolveNarrativeChoice(definition: NarrativeDefinition, state: NarrativeState, message: string, locale: Locale = "ko") {
  if (state.ending) return undefined;
  const { choices, tr } = eligibleChoices(definition, state, { locale });
  const choice = choices.find(choice => tr(choice.text) === message.trim() && (choice.actionId || choice.transitionId));
  if (!choice) return undefined;
  return { events: choice.actionId ? [{ id: choice.actionId, quote: message }] : [], transition: choice.transitionId ? { id: choice.transitionId, quote: message } : null };
}
export function presentNarrative(definition: NarrativeDefinition, state: NarrativeState, options: { locale?: Locale; presentation?: NarrativeDefinition; turnOffset?: number } = {}) {
  const { view, tr, base, current, scene, pass, choices } = eligibleChoices(definition, state, options);
  const previousChoices = state.ending ? [] : choices.length ? choices.map(choice => tr(choice.text)) : scene.choices ? [] : scene.suggestions.map(tr);
  const suggestions = [...new Set(previousChoices)].slice(0, 3);
  const offset = options.turnOffset ?? 0;
  const timeline = [...state.events.map(event => {
    const action = view.events.find(action => action.id === event.id) ?? definition.events.find(action => action.id === event.id)!;
    return { kind: "action", turn: event.turn + offset, label: tr(action.label ?? action.id), result: action.result ? tr(action.result) : undefined, quote: event.quote };
  }), ...state.transitions.map(event => ({ kind: "transition", turn: event.turn + offset, label: tr(view.transitions.find(item => item.id === event.id)?.label ?? event.id), result: tr(view.scenes.find(scene => scene.id === event.to)?.title ?? event.to), quote: event.quote }))]
    .sort((a, b) => b.turn - a.turn).slice(0, 8);
  return { ...base, scene: tr(scene.title), location: tr(scene.location), objective: tr(scene.objective), suggestions,
    clockStyle: view.clockStyle ?? "calendar", clockLabel: tr(view.clockLabel ?? "이야기 시간"), elapsedMinutes: state.elapsedMinutes,
    counters: base.counters.map(counter => ({ ...counter, label: tr(counter.label) })),
    world: { summary: tr(view.summary ?? ""), facts: current.facts.map(fact => ({ id: fact.id, text: tr(fact.text) })), version: definition.version, trackingSinceTurn: offset },
    fields: (view.statusFields ?? []).flatMap(field => { const value = field.cases.find(value => pass(value.conditions)); return value ? [{ id: field.id, label: tr(field.label), value: tr(value.text) }] : []; }),
    threads: (view.plotThreads ?? []).flatMap(thread => { const resolved = pass(thread.resolveWhen); return resolved || pass(thread.activeWhen) ? [{ id: thread.id, title: tr(thread.title), description: tr(resolved ? thread.resolution ?? "완료" : thread.description), status: resolved ? "resolved" : "active" }] : []; }),
    milestones: base.milestones.map(item=>({...item,title:tr(item.title),text:tr(item.text)})),
    timeline, gates: base.gates.map(gate => ({ ...gate, label: tr(gate.label), conditions: gate.conditions.map(c => ({ ...c, label: tr(c.label) })) })),
    ending: base.ending && { ...base.ending, title: tr(base.ending.title), text: tr(base.ending.text) },
  };
}
