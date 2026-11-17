import { z } from "zod";
import type { PlatformState } from "../platform/types";
import type { ImageGenerationRecord } from "./image-options";
import { ontologyNodeSchema, ontologyEdgeSchema, validateOntology } from "../platform/ontology";
import { authoringExtrasSchema } from "./authoring-extras";

const text = z.string().max(4000);
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const label = z.string().min(1).max(120);
const ids = z.array(id).max(40);
export const conditionSchema = z.object({ variable: id, operator: z.enum(["gte", "lte", "eq"]), value: z.number().finite() }).strict();
export const effectSchema = z.object({ variable: id, operation: z.enum(["set", "add"]), value: z.number().finite() }).strict();
export const characterSchema = z.object({
  id, name: label, role: text, personality: text, desire: text, voice: text,
  appearance: text, firstLine: text, knownFactIds: ids,
}).strict();
export const factSchema = z.object({
  id, statement: text, visibility: z.enum(["public", "secret"]), revealWhen: z.array(conditionSchema).max(8),
}).strict();
export const sceneSchema = z.object({
  id, title: label, locationId: id, characterIds: ids, opening: text,
  entryConditions: z.array(conditionSchema).max(8),
  choices: z.array(z.object({ id, label, nextSceneId: z.string().max(64), effects: z.array(effectSchema).max(8), conditions: z.array(conditionSchema).max(8) }).strict()).max(8),
  pacing: z.object({ minExchanges: z.number().int().min(1).max(20), objective: label, suggestions: z.array(label).min(1).max(3) }).strict().optional(),
  ending: z.boolean(),
  endingMinTurns: z.number().int().min(1).max(100).optional(),
}).strict();
export const artBriefSchema = z.object({
  id, kind: z.enum(["character", "expression", "background", "cover", "scene"]),
  title: label, subjectId: id, prompt: text, aspectRatio: z.enum(["1:1", "2:3", "3:2", "16:9", "9:16"]),
}).strict();
export const startSettingSchema = z.object({
  id, title: z.string().trim().min(1).max(32), prologue: z.string().trim().min(1).max(1600),
  situation: z.string().trim().max(800), role: z.string().trim().max(500),
  greeting: z.string().trim().max(500), guide: z.string().trim().max(500),
  suggestions: z.array(z.string().trim().min(1).max(140)).max(3),
}).strict();
export type StartSetting = z.infer<typeof startSettingSchema>;
export const storySchema = z.object({
  schemaVersion: z.literal("story-workshop/1"), title: label, premise: text,
  genre: label, audience: text, playerRole: text, tone: text, artDirection: text,
  playMode: z.enum(["free", "ensemble", "story"]).optional(),
  startSettings: z.array(startSettingSchema).max(4).refine(settings => new Set(settings.map(item => item.id)).size === settings.length, "시작 설정 ID가 겹칩니다.").optional(),
  authoring: authoringExtrasSchema.optional(),
  rules: z.array(text).max(30), boundaries: z.array(text).max(20),
  characters: z.array(characterSchema).max(12),
  locations: z.array(z.object({ id, name: label, description: text }).strict()).max(30),
  facts: z.array(factSchema).max(60),
  relationships: z.array(z.object({ id, from: id, to: id, type: label, description: text }).strict()).max(60),
  ontologyNodes: z.array(ontologyNodeSchema).max(60).optional(),
  ontologyEdges: z.array(ontologyEdgeSchema).max(100).optional(),
  variables: z.array(z.object({ id, name: label, initial: z.number().finite(), min: z.number().finite(), max: z.number().finite(),
    presentation: z.object({ icon: z.enum(["star", "heart", "key", "shield"]), color: z.enum(["amber", "rose", "teal", "violet"]), unit: z.string().trim().max(8) }).strict().optional(),
    dialogueRule: z.object({ when: z.string().trim().min(1).max(300), delta: z.number().int().min(-10).max(10).refine(n => n !== 0) }).strict().optional(),
    dialogueDecrease: z.object({ id, when: z.string().trim().min(1).max(300), delta: z.number().int().min(-10).max(-1) }).strict().optional(),
    levels: z.array(z.object({ threshold: z.number().finite(), name: z.string().trim().min(1).max(40), prompt: z.string().trim().max(100) }).strict()).max(7).optional(),
  }).strict()).max(20),
  scenes: z.array(sceneSchema).max(40), startSceneId: z.string().max(64),
  artBriefs: z.array(artBriefSchema).max(40), openQuestions: z.array(text).max(12),
}).strict();
export type Story = z.infer<typeof storySchema>;
export type Character = Story["characters"][number];
export type Scene = Story["scenes"][number];
export type Condition = z.infer<typeof conditionSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type ArtBrief = z.infer<typeof artBriefSchema>;
export type Issue = { severity: "error" | "warning"; path: string; message: string };
export const deploymentSchema = z.object({
  region: z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/), accountId: z.string().regex(/^(\d{12})?$/),
  profile: z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/), stackName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/),
  monthlyBudgetUsd: z.number().min(10).max(100000),
}).strict();
export type Deployment = z.infer<typeof deploymentSchema>;
export type Asset = { generation?: ImageGenerationRecord; authorSubject?: string; id: string; briefId: string; title: string; subjectId: string; revision: number; approvedRevision?: number; prompt: string; model: string; createdAt: string; referenceAssetId?: string; bytes: number; approved: boolean; upload?: { originalFormat: "png" | "jpeg" | "webp"; width: number; height: number; rightsConfirmedAt: string; sha256: string }; libraryOrigin?: { projectId: string; assetId: string; projectTitle: string; title: string; revision: number; hash: string; sha256: string; width: number; height: number; rightsConfirmedAt: string; root: { projectId: string; assetId: string; model: string; createdAt: string } } };
export type Message = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
export type Revision = { number: number; createdAt: string; summary: string; story: Story };
export type PlayTurn = { role: "user" | "assistant"; text: string; characterId: string; sceneId: string };
export type PlaySession = { id: string; revision: number; sceneId: string; state: Record<string, number>; visitedSceneIds: string[]; turns: PlayTurn[]; ended: boolean };
export type Project = {
  id: string; title: string; revision: number; createdAt: string; updatedAt: string;
  story: Story; messages: Message[]; revisions: Revision[]; assets: Asset[];
  deployment: Deployment; play: PlaySession | null; receipts: Array<{ id: string; action: string }>;
  usage: { textCalls: number; imageCalls: number; inputTokens: number; outputTokens: number };
  platform?: PlatformState;
};
export type ProjectSummary = Pick<Project, "id" | "title" | "revision" | "updatedAt">;

export function emptyStory(): Story {
  return { schemaVersion: "story-workshop/1", title: "제목 없는 세계", premise: "", genre: "미정", audience: "", playerRole: "", tone: "", artDirection: "", rules: [], boundaries: [], characters: [], locations: [], facts: [], relationships: [], variables: [], scenes: [], startSceneId: "", artBriefs: [], openQuestions: [] };
}

export function validateStory(story: Story, { draft = false } = {}): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warning = (path: string, message: string) => issues.push({ severity: "warning", path, message });
  if (story.playMode === "ensemble" && ((!draft && story.characters.length < 2) || story.characters.length > 4)) error("playMode", "다인물 스토리 챗은 캐릭터 2~4명이 필요합니다.");
  if (story.playMode === "story" && (!draft || story.scenes.length || story.startSceneId) && !story.scenes.some(scene => scene.id === story.startSceneId)) error("playMode", "선택지 스토리는 시작 장면을 작성해야 합니다.");
  const groups = [story.characters, story.locations, story.facts, story.relationships, story.variables, story.scenes, story.artBriefs, story.ontologyNodes ?? [], story.ontologyEdges ?? []];
  issues.push(...validateOntology(story));
  const seen = new Set<string>();
  for (const group of groups) for (const entity of group) { if (seen.has(entity.id)) error(entity.id, `ID 중복: ${entity.id}`); seen.add(entity.id); }
  const chars = new Set(story.characters.map(c => c.id));
  const locations = new Set(story.locations.map(l => l.id));
  const facts = new Set(story.facts.map(f => f.id));
  const scenes = new Map(story.scenes.map(s => [s.id, s]));
  const variables = new Map(story.variables.map(v => [v.id, v]));
  function conditions(items: Condition[], path: string) { for (const c of items) if (!variables.has(c.variable)) error(path, `없는 상태 변수: ${c.variable}`); }
  for (const c of story.characters) for (const f of c.knownFactIds) if (!facts.has(f)) error(c.id, `없는 사실: ${f}`);
  for (const f of story.facts) conditions(f.revealWhen, f.id);
  for (const r of story.relationships) if (!chars.has(r.from) || !chars.has(r.to)) error(r.id, "관계의 인물이 존재하지 않습니다.");
  for (const v of story.variables) {
    if (v.min > v.max || v.initial < v.min || v.initial > v.max) error(v.id, "상태 초기값과 범위를 확인하세요.");
    if (v.dialogueDecrease) {
      if (seen.has(v.dialogueDecrease.id)) error(v.id, "스탯 감소 규칙 ID가 중복됩니다.");
      seen.add(v.dialogueDecrease.id);
      if (!v.dialogueRule || v.dialogueRule.delta <= 0) error(v.id, "별도의 감소 조건을 쓰려면 기본 대화 조건을 증가로 먼저 설정하세요.");
    }
    const levels = v.levels ?? [];
    if (levels.some((level, index) => level.threshold > v.max || (index === 0 ? level.threshold !== v.min : level.threshold <= levels[index - 1].threshold)))
      error(v.id, "첫 스탯 레벨은 최솟값에서 시작하고, 이후 기준값은 이전보다 커야 합니다.");
  }
  if (story.variables.reduce((sum, v) => sum + Number(!!v.dialogueRule) + Number(!!v.dialogueDecrease), 0) > 20)
    error("variables", "작품 전체에 대화로 스탯을 바꾸는 조건은 최대 20개까지 설정할 수 있습니다.");
  for (const s of story.scenes) {
    if (!locations.has(s.locationId)) error(s.id, "장면의 장소가 없습니다.");
    for (const c of s.characterIds) if (!chars.has(c)) error(s.id, `장면에 없는 인물 ID: ${c}`);
    conditions(s.entryConditions, s.id);
    const choiceIds = new Set<string>();
    for (const choice of s.choices) {
      if (choiceIds.has(choice.id)) error(s.id, "선택지 ID가 중복됩니다."); choiceIds.add(choice.id);
      if (!scenes.has(choice.nextSceneId)) error(s.id, `연결할 장면이 없습니다: ${choice.nextSceneId}`);
      conditions(choice.conditions, s.id);
      for (const e of choice.effects) if (!variables.has(e.variable)) error(s.id, `없는 상태 변수: ${e.variable}`);
    }
    if (!s.ending && !s.choices.length) warning(s.id, "다음 장면으로 이어지는 선택지가 없습니다.");
    if (s.ending && s.choices.length) error(s.id, "엔딩에는 다음 장면 선택지를 둘 수 없습니다.");
    if (s.ending && s.pacing) error(s.id, "결말에는 장면 진행 조건을 설정할 수 없습니다.");
    if (s.endingMinTurns !== undefined && (!s.ending || s.id === story.startSceneId)) error(s.id, "결말 최소 턴은 시작 장면이 아닌 결말에만 설정하세요.");
    if (s.pacing && !s.characterIds.length) error(s.id, "대화 뒤 다음 장면을 여는 장면에는 대화할 인물이 필요합니다.");
  }
  if (story.scenes.length && !scenes.has(story.startSceneId)) error("startSceneId", "시작 장면을 지정하세요.");
  if (scenes.has(story.startSceneId)) {
    const reached = new Set<string>(); const queue = [story.startSceneId];
    while (queue.length) { const s = queue.pop()!; if (reached.has(s)) continue; reached.add(s); for (const c of scenes.get(s)?.choices ?? []) queue.push(c.nextSceneId); }
    for (const s of story.scenes) if (!reached.has(s.id)) error(s.id, "시작 장면에서 연결되지 않는 장면입니다.");
    const initial = Object.fromEntries(story.variables.map(v => [v.id, v.initial]));
    if (!meets(scenes.get(story.startSceneId)!.entryConditions, initial)) error("startSceneId", "초기 상태에서 시작 장면에 진입할 수 없습니다.");
    // Bounded concrete state exploration catches reachable-looking diagrams
    // whose conditions actually make every ending impossible.
    const pending = [{ sceneId: story.startSceneId, state: initial }];
    const visited = new Set<string>(); const possibleScenes = new Set<string>();
    let explored = 0;
    while (pending.length && explored < 5000) {
      const current = pending.pop()!;
      const key = current.sceneId + JSON.stringify(Object.entries(current.state).sort());
      if (visited.has(key)) continue; visited.add(key); explored++; possibleScenes.add(current.sceneId);
      const s = scenes.get(current.sceneId); if (!s) continue;
      let exits = 0;
      for (const c of s.choices) {
        const next = scenes.get(c.nextSceneId);
        if (!next || !meets(c.conditions, current.state) || c.effects.some(e => !variables.has(e.variable))) continue;
        const state = applyEffects(story, current.state, c.effects);
        if (meets(next.entryConditions, state)) { exits++; pending.push({ sceneId: next.id, state }); }
      }
      let dialogueMayHelp = false;
      if (!s.ending && s.characterIds.length) for (const v of story.variables) {
        for (const rule of [v.dialogueRule, v.dialogueDecrease]) {
          if (!rule) continue;
          const state = applyEffects(story, current.state, [{ variable: v.id, operation: "add", value: rule.delta }]);
          if (state[v.id] !== current.state[v.id]) { pending.push({ sceneId: s.id, state }); dialogueMayHelp = true; }
        }
      }
      // A transient state can still open a route after eligible dialogue.
      if (!s.ending && !exits && !dialogueMayHelp) error(s.id, "선택 조건 때문에 진행이 멈추는 상태가 있습니다.");
    }
    if (pending.length) warning("scenes", "상태 경로가 많아 5,000개까지만 검증했습니다. 추가 플레이 검증이 필요합니다.");
    else for (const s of story.scenes) if (!possibleScenes.has(s.id)) error(s.id, "상태 조건상 도달할 수 없는 장면입니다.");
  }
  const subjects = new Set([...chars, ...locations, ...scenes.keys(), "world"]);
  for (const art of story.artBriefs) if (!subjects.has(art.subjectId)) error(art.id, "이미지에 연결된 대상이 없습니다.");
  if (!story.premise.trim()) warning("premise", "이야기의 중심 아이디어를 정해주세요.");
  if (!story.characters.length) warning("characters", "캐릭터가 필요합니다.");
  if (!story.scenes.some(s => s.ending)) warning("scenes", "최소 한 개의 엔딩이 필요합니다.");
  if (story.premise && !story.artBriefs.length) warning("artBriefs", "캐릭터·배경 이미지 제작 계획이 필요합니다.");
  if (story.openQuestions.length) warning("openQuestions", `미정 질문 ${story.openQuestions.length}개가 있습니다.`);
  return issues;
}
export function meets(conditions: Condition[], state: Record<string, number>) {
  return conditions.every(c => Number.isFinite(state[c.variable]) && (c.operator === "gte" ? state[c.variable] >= c.value : c.operator === "lte" ? state[c.variable] <= c.value : state[c.variable] === c.value));
}
export function applyEffects(story: Story, state: Record<string, number>, effects: Effect[]) {
  const next = { ...state };
  for (const effect of effects) {
    const variable = story.variables.find(v => v.id === effect.variable);
    if (!variable) throw new Error("알 수 없는 상태 변수입니다.");
    next[variable.id] = Math.max(variable.min, Math.min(variable.max, effect.operation === "set" ? effect.value : (next[variable.id] ?? variable.initial) + effect.value));
  }
  return next;
}
export function visibleFacts(story: Story, characterId: string, state: Record<string, number>) {
  const character = story.characters.find(c => c.id === characterId);
  // Director-controlled secrets never enter a model before reveal conditions.
  return story.facts.filter(f => f.visibility === "public" || (character?.knownFactIds.includes(f.id) && f.revealWhen.length > 0 && meets(f.revealWhen, state)));
}
