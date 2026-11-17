import { z } from "zod";
import { applyEffects, meets, type Story } from "../studio/schema";
import { StudioError } from "../studio/store";
import type { RuntimeSession } from "./memory";
import { applyDialogueStats } from "./dialogue-stats";

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const progressSchema = z.object({ schema: z.literal("scene-engine/1"), sceneId: id, events: z.array(z.object({ fromSceneId: id, choiceId: id, toSceneId: id, createdAt: z.string().datetime(), exchanges: z.number().int().min(0).max(200).optional() }).strict()).max(200) }).strict();
export type StoryProgress = z.infer<typeof progressSchema>;
export const requiresStoryMode = (story: Story) => story.playMode === "story" && story.scenes.some(scene => scene.pacing);
const unavailable = () => new StudioError(503, "저장된 이야기 진행을 확인할 수 없습니다. 원본을 보존했습니다.");
export function startStoryProgress(story: Story): StoryProgress {
  const scene = story.scenes.find(s => s.id === story.startSceneId);
  const state = Object.fromEntries(story.variables.map(v => [v.id, v.initial]));
  if (!scene || !meets(scene.entryConditions, state)) throw new StudioError(422, "시작 장면과 진입 조건을 확인하세요.");
  return { schema: "scene-engine/1", sceneId: scene.id, events: [] };
}
function transition(story: Story, sceneId: string, state: Record<string, number>, choiceId: string, exchanges: number, totalTurns: number) {
  const scene = story.scenes.find(s => s.id === sceneId), choice = scene?.choices.find(c => c.id === choiceId);
  if (!scene || scene.ending || !choice || exchanges < (scene.pacing?.minExchanges ?? 0) || !meets(choice.conditions, state)) return undefined;
  const next = story.scenes.find(s => s.id === choice.nextSceneId);
  if (!next || totalTurns < (next.endingMinTurns ?? 0)) return undefined;
  const changed = applyEffects(story, state, choice.effects);
  if (Object.values(changed).some(v => !Number.isFinite(v)) || !meets(next.entryConditions, changed)) return undefined;
  return { scene, choice, next, state: changed };
}
function checked(story: Story, session: RuntimeSession) {
  if (!session.progress) return undefined; // Legacy/free sessions never auto-migrate.
  const parsed = progressSchema.safeParse(session.progress);
  if (!parsed.success) throw unavailable();
  const progress = parsed.data;
  let sceneId = startStoryProgress(story).sceneId;
  let state = Object.fromEntries(story.variables.map(v => [v.id, v.initial]));
  const exchanges = new Map<number, number>();
  const dialogue = new Map<number, string[][]>();
  for (let i = 0; i + 1 < session.turns.length; i += 2) {
    const [user, assistant] = [session.turns[i], session.turns[i + 1]];
    const step = user.sceneStep;
    if (step !== undefined && step === assistant.sceneStep && user.role === "user" && assistant.role === "assistant" && user.characterId === assistant.characterId) {
      exchanges.set(step, (exchanges.get(step) ?? 0) + 1);
      if (assistant.dialogueStatIds?.length) dialogue.set(step, [...dialogue.get(step) ?? [], assistant.dialogueStatIds]);
    }
  }
  let completedTurns = 0;
  for (const [index, event] of progress.events.entries()) {
    const elapsed = exchanges.get(index) ?? 0;
    completedTurns += elapsed;
    for (const ids of dialogue.get(index) ?? []) state = applyDialogueStats(story, state, ids);
    if (story.scenes.find(scene => scene.id === sceneId)?.pacing && elapsed !== event.exchanges) throw unavailable();
    const step = transition(story, sceneId, state, event.choiceId, elapsed, completedTurns);
    if (!step || event.fromSceneId !== sceneId || event.toSceneId !== step.next.id) throw unavailable();
    sceneId = step.next.id; state = step.state;
  }
  for (const ids of dialogue.get(progress.events.length) ?? []) state = applyDialogueStats(story, state, ids);
  if (sceneId !== progress.sceneId || Object.keys(session.state).length !== Object.keys(state).length || Object.entries(state).some(([k, v]) => session.state[k] !== v)) throw unavailable();
  const scene = story.scenes.find(s => s.id === sceneId); if (!scene) throw unavailable();
  const current = exchanges.get(progress.events.length) ?? 0;
  return { progress, scene, exchanges: current, totalTurns: completedTurns + current };
}
export function chooseStory(story: Story, session: RuntimeSession, sceneId: string, choiceId: string) {
  if (session.status !== "active") throw new StudioError(409, "활성 회차에서만 선택할 수 있습니다.");
  const view = checked(story, session);
  if (!view || view.scene.id !== sceneId) throw new StudioError(409, "현재 장면의 선택지가 아닙니다. 저장 상태를 다시 확인하세요.");
  if (view.progress.events.length >= 200) throw new StudioError(429, "이 회차의 장면 진행 한도입니다. 새 회차를 시작하세요.");
  const next = transition(story, sceneId, session.state, choiceId, view.exchanges, view.totalTurns);
  if (!next) throw new StudioError(409, "현재 상태에서 사용할 수 없는 선택지입니다.");
  const now = new Date().toISOString();
  session.state = next.state;
  session.progress = { schema: "scene-engine/1", sceneId: next.next.id, events: [...view.progress.events, { fromSceneId: sceneId, choiceId, toSceneId: next.next.id, createdAt: now, exchanges: view.exchanges }] };
  session.revision++; session.updatedAt = now;
}
export function publicStoryProgress(story: Story, session: RuntimeSession) {
  if (session.status === "deleted") return undefined;
  const view = checked(story, session); if (!view) return undefined;
  const { scene, progress, exchanges, totalTurns } = view;
  const wait = scene.choices.flatMap(c => {
    const readyExceptTurns = transition(story, scene.id, session.state, c.id, exchanges, Infinity);
    const min = readyExceptTurns?.next.endingMinTurns;
    return min !== undefined && min > totalTurns ? [min - totalTurns] : [];
  });
  const start = story.startSettings?.find(item => item.id === session.openingId);
  return {
    mode: "story" as const, sceneId: scene.id, title: scene.title, opening: !progress.events.length && start?.situation || scene.opening, playerRole: start?.role || story.playerRole,
    location: story.locations.find(l => l.id === scene.locationId)?.name ?? "",
    characterIds: [...scene.characterIds], ending: scene.ending,
    choices: scene.ending || session.status !== "active" ? [] : scene.choices.filter(c => transition(story, scene.id, session.state, c.id, exchanges, totalTurns)).map(c => ({ id: c.id, label: c.label })),
    endingTurnsRemaining: session.status === "active" && wait.length ? Math.min(...wait) : undefined,
    pacing: scene.pacing ? { objective: scene.pacing.objective, suggestions: scene.pacing.suggestions, ready: exchanges >= scene.pacing.minExchanges } : undefined,
    history: progress.events.map((e, index) => {
      // checked() already verified this route against the immutable release.
      const prior = story.scenes.find(s => s.id === e.fromSceneId)!;
      return { createdAt: e.createdAt, sceneId: prior.id, title: prior.title, opening: !index && start?.situation || prior.opening,
        location: story.locations.find(location => location.id === prior.locationId)?.name ?? "",
        choice: prior.choices.find(c => c.id === e.choiceId)!.label };
    }),
  };
}
/** Read-only release preview: never creates a session or reveals later scenes. */
export function publicStoryOpening(story: Story) {
  const scene = story.scenes.find(s => s.id === story.startSceneId);
  const state = Object.fromEntries(story.variables.map(v => [v.id, v.initial]));
  if (!scene || !meets(scene.entryConditions, state)) return undefined;
  return {
    mode: "story" as const, sceneId: scene.id, title: scene.title, opening: scene.opening, playerRole: story.playerRole,
    location: story.locations.find(l => l.id === scene.locationId)?.name ?? "",
    characterIds: [...scene.characterIds], ending: scene.ending,
    choices: scene.ending ? [] : scene.choices.filter(c => transition(story, scene.id, state, c.id, 0, 0)).map(c => ({ id: c.id, label: c.label })),
    endingTurnsRemaining: undefined,
    pacing: scene.pacing ? { objective: scene.pacing.objective, suggestions: scene.pacing.suggestions, ready: false } : undefined,
    history: [] as NonNullable<ReturnType<typeof publicStoryProgress>>["history"],
  };
}

export function hasVisitedScene(story: Story, session: RuntimeSession, sceneIds: ReadonlySet<string>) {
  if (session.status === "deleted") return false;
  const view = checked(story, session);
  return Boolean(view && (sceneIds.has(view.scene.id) || view.progress.events.some(e => sceneIds.has(e.toSceneId))));
}
export function storyTurnContext(story: Story, session: RuntimeSession, characterId: string) {
  const view = checked(story, session); if (!view) return undefined;
  if (!view.scene.characterIds.includes(characterId)) throw new StudioError(409, "현재 장면에 등장하는 캐릭터와 대화하세요.");
  const start = story.startSettings?.find(item => item.id === session.openingId);
  const opening = start && !view.progress.events.length ? [...new Set([start.prologue, start.situation || view.scene.opening, start.greeting].filter(Boolean))].join("\n\n").slice(0, 4000) : view.scene.opening;
  return {
    id: view.scene.id, title: view.scene.title, opening: view.scene.pacing || view.scene.ending && story.scenes.some(s => s.pacing)
      ? `현재 장소: ${story.locations.find(l => l.id === view.scene.locationId)?.name ?? ""}\n\n${opening}`.slice(0, 4000) : opening,
    ...(view.scene.pacing ? { objective: view.scene.pacing.objective, playableActions: view.scene.pacing.suggestions } : {}),
    playerRole: start?.role || story.playerRole, ending: view.scene.ending,
    // Only characters present at the source scene witnessed its chosen action.
    witnessedChoices: view.progress.events.filter(e => story.scenes.find(s => s.id === e.fromSceneId)?.characterIds.includes(characterId)).slice(-8).map(e => ({ sceneId: e.fromSceneId, choice: story.scenes.find(s => s.id === e.fromSceneId)!.choices.find(c => c.id === e.choiceId)!.label, createdAt: e.createdAt })),
  };
}
