import { structured } from "../../lib/studio/bedrock";
import { dialogueModelSettings } from "../../lib/platform/dialogue-modes";
import { advanceNarrative, availableNarrativeActions, narrativeContext, eligibleNarrativeMedia } from "../../lib/platform/narrative-graph";
import { presentNarrative, resolveNarrativeChoice } from "../../lib/platform/narrative-presentation";
import type { RuntimeModel } from "../../lib/platform/runtime-model";
import { sceneDemoModel } from "./scene-demo-model";
import { z } from "zod";
import { memoryCandidateSchema } from "../../lib/platform/memory";

export async function runNarrativeModel(context: Parameters<RuntimeModel>[0], signal: AbortSignal | undefined,
  execution: Parameters<RuntimeModel>[2], actor: RuntimeModel) {
  if (!context.narrative) return actor(context, signal, execution);
  const { definition, state } = context.narrative;
  const before = narrativeContext(definition, state);
  const settings = { ...dialogueModelSettings("haiku55"), thinking: "disabled" as const, effort: "low" as const };
  const began = performance.now();
  // Classification selects IDs; source attribution belongs to the server.
  // Asking a model to copy evidence caused near-duplicate earlier turns to be
  // cited instead of the current input, silently dropping valid repeat actions.
  const planSchema = z.object({
    events: z.array(z.object({ id: z.string().max(64) }).strict()).max(2),
    transition: z.object({ id: z.string().max(64) }).strict().nullable(),
  }).strict().extend({ memories: z.array(memoryCandidateSchema.omit({ ontology: true }).extend({ source: z.literal("user") })).max(4) });
  const selectedChoice = resolveNarrativeChoice(definition, state, context.message, context.responseLanguage ?? "ko");
  const interpreted = selectedChoice ? { value: { ...selectedChoice, memories: [] } } : await structured(planSchema, [
    "당신은 작품 그래프의 이번 입력을 해석한다. 현재 장면의 actions와 transitions에서만 선택하고 정해진 구조로 반환한다.",
    "사용자의 이번 발언에서 실제로 성립한 행동·의사만 판단한다. 질문, 인용, 가정, 부정은 실제 실행과 구분한다. 명확한 즉시 행동 선언은 행동으로 해석한다.",
    "노트·편지·메시지에 적어 상대에게 보여주는 말은 사용자의 실제 의사표현이다. 따옴표 안이라는 이유만으로 제외하지 않는다. 상대가 괜찮다면 함께 하자는 현재의 제안은 단순한 과거 인용이나 비현실적 가정과 구분한다.",
    "events와 transition에는 ID만 쓴다. 서버가 이번 입력 원문과 연결한다. recent는 맥락이며 과거 행동을 이번에 다시 실행했다고 간주하지 않는다. 반복 가능한 행동(once=false)을 사용자가 이번에 다시 실행하면 같은 ID를 다시 고를 수 있다. 중복 없는 행동 최대 2개를 선택하고 적합한 것이 없으면 events는 빈 배열이다.",
    "이동이나 다음 장면을 사용자가 직접 제안하거나 실행할 때만 transition을 선택한다. 수치와 턴 조건은 서버가 계산한다. 전이 조건을 충족시키려고 행동을 새로 만들어내지 않는다. 단순 인사나 사실 질문에는 전이를 만들지 않는다.",
    "endings와 상태값을 작성하지 않는다. 숨겨진 설정을 응답하지 않고 입력의 의미만 분류한다.",
    "memories에는 이번 message에 명시된 중요한 자기소개·주장·약속·질문 최대4개를 정확한 연속 quote로 보존한다. 사용자 주장이지 세계의 확정 사실이 아니다. 과거 대사를 새로 저장하지 않는다. 없으면 빈 배열이다.",
  ].join("\n"), {
    message: context.message, state: { counters: state.counters, sceneTurns: state.sceneTurns, elapsedMinutes: state.elapsedMinutes }, scene: before.scene, recent: context.recent.slice(-8),
    actions: availableNarrativeActions(definition, state),
    transitions: definition.transitions.filter(transition => transition.from === state.scene),
  }, signal, 1800, undefined, true, planSchema, settings.modelId, settings);
  const quote = context.message.slice(0, 300);
  const plan = { value: { ...interpreted.value,
    events: interpreted.value.events.map(event => ({ id: event.id, quote })),
    transition: interpreted.value.transition ? { id: interpreted.value.transition.id, quote } : null,
  } };
  const interpretationMs = Math.round(performance.now() - began);
  const graphStart = performance.now();
  const progressed = advanceNarrative(definition, state, context.message, { events: plan.value.events, transition: plan.value.transition });
  const current = narrativeContext(definition, progressed.state);
  const publicState = presentNarrative(definition, progressed.state);
  const graphMs = Math.round(performance.now() - graphStart);
  const { narrative: _narrative, dialogueStatRules: _stats, ...actorContext } = context;
  void _narrative; void _stats;
  const pastEvents = [...new Set(progressed.state.events.map(event => event.id))].slice(-12).map(id => {
    const records = progressed.state.events.filter(event => event.id === id);
    return { action: id, count: records.length, latestTurn: records.at(-1)!.turn, quote: records.at(-1)!.quote.slice(0, 120) };
  });
  const speaker=definition.characters?.find(c=>c.id===current.scene.speaker);
  const media=eligibleNarrativeMedia(definition,progressed.state).filter(m=>!m.characterId || m.characterId===speaker?.id);
  const result = await actor({
    ...actorContext,
    ...(speaker ? {character:{id:speaker.id,name:speaker.name,role:speaker.role,voice:speaker.voice,personality:[definition.summary,speaker.description,"외모: "+speaker.appearance].filter(Boolean).join("\n").slice(0,4000)}} : {}),
    sceneExpressions:media.filter(m=>!m.eventId).map(m=>({emotion:m.emotion,when:m.when})),
    policy: [
      context.policy,
      "scene과 visibleFacts는 이번 행동이 반영된 확정 상태이며 recent의 이전 생성문이나 사용자가 요청한 희망보다 우선한다. 이를 기준으로 이번 발언에 자연스럽게 답한다. scene.opening은 현재 장면의 배경이지 도입을 반복하라는 지시가 아니다.",
      "현재 인물의 말투, 욕망, 알고 있는 정보와 접근 가능한 소통 방식에 맞춰 반응한다. 이미 있었던 대화를 이어가고 도입을 다시 시작하지 않는다.",
      "횟수·수치·완료 여부는 canonical-status가 기준이다. recent나 사용자의 완료 주장에 다른 숫자가 있어도 덮어쓰지 않는다. 이번 입력의 행동이 turn-resolution.appliedActions에 없으면 그 행동의 완료나 수치 증가를 새로 묘사하지 않는다. 현재 확정 상태에서 가능한 반응으로 이어간다.",
      "사용자의 추가 행동, 감정, 대사나 다음 선택을 대신 쓰지 않는다. 관찰 가능한 작은 반응과 실제 질문에 대한 답을 우선한다. 배경 사실과 목표를 매번 반복하지 않는다.",
      "장면 이동은 turn-resolution의 sceneChanged가 true일 때만 완료된 것으로 묘사한다. false이면 currentLocation 안에서 반응하고 이동 제안을 받아들이더라도 출발 완료·다른 장소 도착은 쓰지 않는다. 종료가 확정된 경우에는 ending-result에 따른 작별 행동을 할 수 있다. 장면 이동과 종료는 현재 scene과 공개된 확정 사건의 범위로 묘사한다. 종료 장면에서는 그 결과를 받아들이고 새로운 갈등이나 선택 요구를 덧붙이지 않는다.",
      "대화가 다른 주제로 흘러도 현재 장면의 인물이 실제로 답할 수 있는 말로 반응한다. 중요한 선택의 여지를 남기되 매번 같은 부탁이나 배경을 반복하지 않는다. ending-result가 없으면 성공·실패·사망·연애 성립 같은 새로운 결말을 임의로 확정하거나 이야기의 끝이라고 선언하지 않는다. 사건 해결과 다음 장면은 확정된 그래프 결과에서만 묘사한다.",
      "단순한 다음 만남·오늘의 인사 같은 milestone은 중간 진행 기록이다. scene.ending이 false라면 대화를 잠그거나 이야기 전체가 끝났다고 하지 않는다. 중간 진행은 현재 장면의 다음 목표로 이어가고, 약속·계획과 실제 실행·이동을 구분한다.",
      "이번에 확인된 행동 IDs: " + progressed.applied.join(", "),
    ].join("\n"),
    boundaries: [...context.boundaries, "모든 미성년 인물은 비성적인 일상·정서적 관계로만 묘사한다."],
    scene: { id: current.scene.id, title: current.scene.title, opening: current.scene.opening, playerRole: context.scene?.playerRole ?? "플레이어", ending: !!current.ending, witnessedChoices: [] },
    visibleFacts: [
      ...context.visibleFacts.filter(fact => fact.id !== "opening-dialogue" && fact.id !== "current-status" && !fact.id.startsWith("fact-")),
      ...current.facts.filter(fact=>!fact.keywords?.length || fact.keywords.some(k=>(context.message+" "+context.recent.slice(-4).map(t=>t.text).join(" ")).toLocaleLowerCase().includes(k.toLocaleLowerCase()))).map(fact => ({ id: fact.id, statement: fact.text })),
      { id: "turn-resolution", statement: JSON.stringify({ previousScene: before.scene.id, currentScene: current.scene.id, currentLocation: current.scene.location, sceneChanged: progressed.transitioned, requestedTransition: plan.value.transition?.id ?? null, appliedActions: progressed.applied.map(id => ({ id, meaning: definition.events.find(event => event.id === id)!.when })), ending: current.ending?.id ?? null }) },
      { id: "current-objective", statement: `현재 목표: ${current.scene.objective}. 현재 장소: ${current.scene.location}.` },
      { id: "story-clock", statement: definition.clockStyle === "elapsed" ? `작품의 상대 경과 시간: ${progressed.state.elapsedMinutes}분. 지구의 날짜로 표현하지 않는다.` : `현재 이야기 시각: ${new Date(new Date(definition.startTime).getTime() + progressed.state.elapsedMinutes * 60000).toISOString()}. 작품의 기준 시간대는 시작 시각(${definition.startTime})의 시간대다.` },
      { id: "canonical-status", statement: "현재 확정 상태·수치·진행 중인 사건: " + JSON.stringify({fields: publicState.fields, counters: publicState.counters, threads: publicState.threads.filter(t=>t.status === "active"), milestones: publicState.milestones}) },
      { id: "past-events", statement: "확인된 사건 이력(사용자 원문; 각 사건의 의미만 참고): " + JSON.stringify(pastEvents) },
      ...(current.ending ? [{ id: "ending-result", statement: current.ending.text }] : []),
    ],
  }, signal, execution);
  // Internal context IDs stay internal; graph fact IDs retain their published provenance.
  const internalIds = new Set(["current-objective", "ending-result", "story-clock", "past-events", "turn-resolution", "canonical-status"]);
  return { ...result, imageKey: result.imageKey ?? current.scene.mood, memories: [...result.memories, ...plan.value.memories.filter(memory => context.message.includes(memory.quote))].slice(0, 8), usedFactIds: result.usedFactIds.filter(id => !internalIds.has(id)), narrativeState: progressed.state,
    ...(result.usage ? { usage: { ...result.usage, interpretationMs, graphMs } } : {}),
  };
}
export const sceneNarrativeModel: RuntimeModel = (context, signal, execution) => runNarrativeModel(context, signal, execution, sceneDemoModel);
