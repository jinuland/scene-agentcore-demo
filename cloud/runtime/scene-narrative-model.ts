import { structured } from "../../lib/studio/bedrock";
import { dialogueModelSettings } from "../../lib/platform/dialogue-modes";
import { advanceNarrative, availableNarrativeActions, narrativeContext, narrativePlanSchema } from "../../lib/platform/narrative-graph";
import type { RuntimeModel } from "../../lib/platform/runtime-model";
import { sceneDemoModel } from "./scene-demo-model";

export const sceneNarrativeModel: RuntimeModel = async (context, signal) => {
  if (!context.narrative) return sceneDemoModel(context, signal);
  const { definition, state } = context.narrative;
  const before = narrativeContext(definition, state);
  const settings = dialogueModelSettings("haiku55");
  const began = performance.now();
  const plan = await structured(narrativePlanSchema, [
    "당신은 작품 그래프의 이번 입력을 해석한다. 현재 장면의 actions와 transitions에서만 선택하고 정해진 구조로 반환한다.",
    "사용자의 이번 발언에서 실제로 성립한 행동·의사만 판단한다. 질문, 인용, 가정, 부정은 실제 실행과 구분한다. 명확한 즉시 행동 선언은 행동으로 해석한다.",
    "각 quote는 이번 message에서 연속된 원문을 정확히 복사한다. 기억이나 이전 대사에서 근거를 가져오지 않는다. 중복 없는 행동 최대 2개를 선택하고 적합한 것이 없으면 events는 빈 배열이다.",
    "이동이나 다음 장면을 사용자가 직접 제안하거나 실행할 때만 transition을 선택한다. 수치와 턴 조건은 서버가 계산한다. 전이 조건을 충족시키려고 행동을 새로 만들어내지 않는다. 단순 인사나 사실 질문에는 전이를 만들지 않는다.",
    "endings와 상태값을 작성하지 않는다. 숨겨진 설정을 응답하지 않고 입력의 의미만 분류한다.",
  ].join("\n"), {
    message: context.message, scene: before.scene, recent: context.recent.slice(-8),
    actions: availableNarrativeActions(definition, state),
    transitions: definition.transitions.filter(transition => transition.from === state.scene),
  }, signal, 3000, undefined, true, narrativePlanSchema, settings.modelId, settings);
  const interpretationMs = Math.round(performance.now() - began);
  const graphStart = performance.now();
  const progressed = advanceNarrative(definition, state, context.message, plan.value);
  const current = narrativeContext(definition, progressed.state);
  const graphMs = Math.round(performance.now() - graphStart);
  const { narrative: _narrative, dialogueStatRules: _stats, ...actorContext } = context;
  void _narrative; void _stats;
  const pastEvents = [...new Set(progressed.state.events.map(event => event.id))].slice(-12).map(id => {
    const records = progressed.state.events.filter(event => event.id === id);
    return { action: id, count: records.length, latestTurn: records.at(-1)!.turn, quote: records.at(-1)!.quote.slice(0, 120) };
  });
  const result = await sceneDemoModel({
    ...actorContext,
    policy: [
      context.policy,
      "scene과 visibleFacts는 이번 행동이 반영된 확정 상태다. 이를 기준으로 이번 사용자 발언에 자연스럽게 답한다.",
      "현재 인물의 말투, 욕망, 알고 있는 정보와 접근 가능한 소통 방식에 맞춰 반응한다. 이미 있었던 대화를 이어가고 도입을 다시 시작하지 않는다.",
      "사용자의 추가 행동, 감정, 대사나 다음 선택을 대신 쓰지 않는다. 관찰 가능한 작은 반응과 실제 질문에 대한 답을 우선한다. 배경 사실과 목표를 매번 반복하지 않는다.",
      "장면 이동과 종료는 현재 scene과 공개된 확정 사건의 범위로 묘사한다. 종료 장면에서는 그 결과를 받아들이고 새로운 갈등이나 선택 요구를 덧붙이지 않는다.",
      "이번에 확인된 행동 IDs: " + progressed.applied.join(", "),
    ].join("\n"),
    boundaries: [...context.boundaries, "모든 미성년 인물은 비성적인 일상·정서적 관계로만 묘사한다."],
    scene: { id: current.scene.id, title: current.scene.title, opening: current.scene.opening, playerRole: context.scene?.playerRole ?? "플레이어", ending: !!current.ending, witnessedChoices: [] },
    visibleFacts: [
      ...context.visibleFacts.filter(fact => fact.id !== "opening-dialogue" && fact.id !== "current-status"),
      ...current.facts.map(fact => ({ id: fact.id, statement: fact.text })),
      { id: "current-objective", statement: `현재 목표: ${current.scene.objective}. 현재 장소: ${current.scene.location}.` },
      { id: "story-clock", statement: `현재 이야기 시각: ${new Date(new Date(definition.startTime).getTime() + progressed.state.elapsedMinutes * 60000).toISOString()}. 작품의 기준 시간대는 시작 시각(${definition.startTime})의 시간대다.` },
      { id: "past-events", statement: "확인된 사건 이력(사용자 원문; 각 사건의 의미만 참고): " + JSON.stringify(pastEvents) },
      ...(current.ending ? [{ id: "ending-result", statement: current.ending.text }] : []),
    ],
  }, signal);
  // Internal context IDs stay internal; graph fact IDs retain their published provenance.
  const internalIds = new Set(["current-objective", "ending-result", "story-clock", "past-events"]);
  return { ...result, usedFactIds: result.usedFactIds.filter(id => !internalIds.has(id)), narrativeState: progressed.state,
    ...(result.usage ? { usage: { ...result.usage, interpretationMs, graphMs } } : {}),
  };
};
