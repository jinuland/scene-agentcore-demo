import { randomUUID, createHash } from "node:crypto";
import { ontologyNodeSchema, ontologyEdgeSchema } from "./ontology";
import { z } from "zod";
import { cognitoSubjectSchema } from "./team-subject";
import { bindingAccess } from "./binding-access";
import type { EditorSession } from "./team-sessions";
import {
  characterSchema,
  factSchema,
  sceneSchema,
  storySchema,
  validateStory,
  type Project,
  type Story,
} from "../studio/schema";
import {
  getProject,
  listProjects,
  revise,
  StudioError,
  withProject,
} from "../studio/store";
import {
  defaultPlatform,
  undoneIndexes,
  type Delta,
  type EditorBinding,
  type Selection,
} from "./types";

const uid = z.string().uuid();
const entityId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const selectionSchema = z
  .object({
    kind: z.enum(["world", "character", "relationship", "fact", "scene", "ontologyNode", "ontologyEdge"]),
    id: entityId,
  })
  .strict();
const worldSchema = storySchema
  .pick({
    title: true,
    premise: true,
    genre: true,
    audience: true,
    playerRole: true,
    playMode: true,
    tone: true,
    artDirection: true,
    rules: true,
    boundaries: true,
    locations: true,
    variables: true,
    scenes: true,
    startSceneId: true,
    startSettings: true,
    authoring: true,
  })
  .partial();
export const editOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scene"), id: entityId, fields: sceneSchema.omit({ id: true }).partial() }).strict(),
  z.object({ kind: z.literal("ontologyNode"), id: entityId, fields: ontologyNodeSchema.omit({ id: true }).partial() }).strict(),
  z.object({ kind: z.literal("ontologyEdge"), id: entityId, fields: ontologyEdgeSchema.omit({ id: true }).partial() }).strict(),
  z.object({ kind: z.literal("world"), fields: worldSchema }).strict(),
  z
    .object({
      kind: z.literal("character"),
      id: entityId,
      fields: characterSchema.omit({ id: true }).partial(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship"),
      id: entityId,
      fields: storySchema.shape.relationships.element
        .omit({ id: true })
        .partial(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fact"),
      id: entityId,
      fields: factSchema.omit({ id: true }).partial(),
    })
    .strict(),
]);
// Derive model routing guidance from the same strict editor contract, not a
// second permissive schema. No source text or user data is included here.
export const editOperationFieldGuide = Object.fromEntries(
  editOperationSchema.options.map(operation => [operation.shape.kind.value, Object.keys(operation.shape.fields.shape)]),
);
export const editRequestSchema = z
  .object({
    projectId: uid,
    requestId: uid,
    revision: z.number().int().positive(),
    summary: z.string().trim().min(1).max(200),
    operations: z.array(editOperationSchema).min(1).max(20),
    bindingId: uid.optional(),
    selectionToken: uid.optional(),
  })
  .strict();
export const undoSchema = z
  .object({
    projectId: uid,
    requestId: uid,
    revision: z.number().int().positive(),
    eventId: uid,
    deltaIndexes: z
      .array(z.number().int().nonnegative())
      .min(1)
      .max(200)
      .optional(),
    bindingId: uid.optional(),
    selectionToken: uid.optional(),
  })
  .strict();
export const bindingSchema = z
  .object({
    projectId: uid,
    requestId: uid,
    bindingId: uid,
    counter: z.number().int().nonnegative(),
    selection: selectionSchema,
    workItemId: uid.optional(),
    token: uid,
    dirty: z.boolean(),
    connected: z.boolean(),
    libraryRead: z.boolean().optional(),
  })
  .strict();
export const sourceSchema = z
  .object({
    projectId: uid,
    requestId: uid,
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["text", "link"]),
    text: z.string().max(30000),
    url: z.string().max(2048),
  })
  .strict();
const collections = {
  character: "characters",
  relationship: "relationships",
  fact: "facts",
  scene: "scenes",
  ontologyNode: "ontologyNodes",
  ontologyEdge: "ontologyEdges",
} as const;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const actionKey = (action: string, input: unknown) =>
  `${action}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
export function rejectCredentials(value: unknown) {
  if (
    /(?:ABSK[A-Za-z0-9+/=]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})/.test(
      JSON.stringify(value),
    )
  )
    throw new StudioError(400, "인증 키는 설정이나 자료에 저장할 수 없습니다.");
}
function state(p: Project) {
  return (p.platform ??= defaultPlatform(p.story));
}
export function selectedEntity(story: Story, selection: Selection): unknown {
  if (selection.kind === "world") {
    if (selection.id !== "world")
      throw new StudioError(400, "세계관 대상 ID는 world입니다.");
    return story;
  }
  const entity = story[collections[selection.kind]]?.find(
    (e) => e.id === selection.id,
  );
  if (!entity)
    throw new StudioError(404, "선택한 항목이 더 이상 존재하지 않습니다.");
  return entity;
}
export function requireBinding(
  p: Project,
  bindingId?: string,
  token?: string,
  scope: "story" | "work" = "story",
): EditorBinding {
  const b = state(p).bindings.find((b) => b.id === bindingId);
  if (!b || !b.connected || Date.parse(b.expiresAt) <= Date.now())
    throw new StudioError(
      409,
      "웹 에디터에서 이 탭을 Codex에 연결하세요. 연결이 없거나 만료되었습니다.",
    );
  if (token !== b.token)
    throw new StudioError(
      409,
      "선택 대상이 바뀌었습니다. 현재 편집 컨텍스트를 다시 확인하세요.",
    );
  if (b.dirty)
    throw new StudioError(
      409,
      "선택된 웹 탭에 저장하지 않은 수정이 있습니다. 저장 또는 취소 후 음성 편집을 요청하세요.",
    );
  selectedEntity(p.story, b.selection);
  if (scope === "story" && b.workItemId) throw new StudioError(409, "현재 선택은 스토리보드입니다. 보드 컨텍스트와 보드 편집 도구를 사용하세요.");
  if (scope === "work" && (!b.workItemId || !p.platform?.production?.items.some(i => i.id === b.workItemId))) throw new StudioError(409, "웹에서 편집할 보드 항목을 선택하세요.");
  return b;
}
export async function saveBinding(raw: unknown, team?: { reference: EditorSession; check: () => Promise<void> }) {
  const input = bindingSchema.parse(raw);
  await team?.check();
  const commit = () =>
    withProject(
      input.projectId,
      undefined,
      input.requestId,
      actionKey("binding", { input, team: team?.reference }),
      async (p) => {
        await team?.check();
        const s = state(p);
        selectedEntity(p.story, input.selection);
        if (input.workItemId && !p.platform?.production?.items.some(i => i.id === input.workItemId)) throw new StudioError(409, "현재 작품에 없는 보드 선택입니다.");
        const current = s.bindings.find((b) => b.id === input.bindingId);
        if (current && !same(current.teamSession, team?.reference)) throw new StudioError(403, "다른 로그인 세션의 공유 연결은 변경할 수 없습니다.");
        // An unshared page is not an MCP binding. Retain existing disconnect
        // tombstones to reject delayed counters, but do not allocate new ones.
        if (!input.connected && !current) return;
        if (current && current.counter >= input.counter)
          throw new StudioError(409, "오래된 선택 알림은 적용하지 않았습니다.");
        s.bindings = s.bindings.filter(
          (b) =>
            b.id !== input.bindingId && Date.parse(b.expiresAt) > Date.now(),
        );
        if (
          input.connected &&
          s.bindings.filter((b) => b.connected).length >= 20
        )
          throw new StudioError(429, "열린 편집 탭 한도입니다.");
        s.bindings.push({
          ...(team ? { teamSession: team.reference } : {}),
          id: input.bindingId,
          counter: input.counter,
          selection: input.selection,
          ...(input.workItemId ? { workItemId: input.workItemId } : {}),
          token: input.token,
          dirty: input.dirty,
          connected: input.connected,
          libraryRead: input.libraryRead === true,
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        });
        await team?.check();
      },
    );
  // Selection cleanup and the next selection can arrive concurrently. Retry
  // only a busy file lock; never retry an obsolete counter as a new selection.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await commit();
      await team?.check();
      if (team) {
        const saved = result.project.platform?.bindings.find(b => b.id === input.bindingId);
        if (saved && (saved.counter !== input.counter || saved.token !== input.token || saved.connected !== input.connected || !same(saved.teamSession, team.reference))) throw new StudioError(409, "공유 선택이 이미 바뀌었습니다. 현재 화면에서 다시 연결하세요.");
        if (!saved && input.connected) throw new StudioError(409, "공유 연결이 더 이상 존재하지 않습니다.");
      }
      return result;
    } catch (error) {
      if (
        !(error instanceof StudioError) ||
        error.status !== 409 ||
        !/진행 중|잠금/.test(error.message) ||
        attempt >= 8
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 35 * (attempt + 1)));
    }
  }
}
export async function listBindings() {
  const list = await listProjects();
  const result = [];
  for (const item of list) {
    const p = await getProject(item.id);
    for (const b of state(p).bindings)
      if (b.connected && Date.parse(b.expiresAt) > Date.now()) {
        try { await bindingAccess(p.id, b); }
        catch (error) { if (error instanceof StudioError && [401, 403, 409].includes(error.status)) continue; throw error; }
        result.push({
          projectId: p.id,
          title: p.title,
          revision: p.revision,
          bindingId: b.id,
          selection: b.selection,
          ...(b.workItemId ? { workItemId: b.workItemId } : {}),
          dirty: b.dirty,
          libraryRead: b.libraryRead === true,
          expiresAt: b.expiresAt,
        });
      }
  }
  return result;
}
export async function editorContext(projectId: string, bindingId: string) {
  uid.parse(projectId);
  uid.parse(bindingId);
  const p = await getProject(projectId);
  const b = state(p).bindings.find((b) => b.id === bindingId);
  requireBinding(p, bindingId, b?.token);
  const access = await bindingAccess(projectId, b!);
  const latest = await getProject(projectId);
  requireBinding(latest, bindingId, b!.token);
  if (latest.revision !== p.revision) throw new StudioError(409, "읽는 동안 작품이 변경되었습니다. 다시 조회하세요.");
  await access?.check("read");
  return {
    projectId,
    bindingId,
    revision: p.revision,
    selectionToken: b!.token,
    selection: b!.selection,
    selected: selectedEntity(p.story, b!.selection),
    story: p.story,
    lockedFields: state(p).locks ?? [],
    recentChanges: state(p).events.slice(-8),
  };
}
function validateDraft(story: Story) {
  const validated = storySchema.parse(story);
  const errors = validateStory(validated, { draft: true }).filter((i) => i.severity === "error");
  if (errors.length)
    throw new StudioError(
      422,
      errors
        .slice(0, 5)
        .map((i) => i.message)
        .join(" / "),
    );
  return validated;
}
function targetRecord(
  story: Story,
  delta: Pick<Delta, "collection" | "id">,
): Record<string, unknown> {
  if (delta.collection === "world")
    return story as unknown as Record<string, unknown>;
  const record = story[delta.collection]?.find((e) => e.id === delta.id);
  if (!record)
    throw new StudioError(409, "변경 대상이 없어 되돌릴 수 없습니다.");
  return record as unknown as Record<string, unknown>;
}
export type EditOperation = z.infer<typeof editOperationSchema>;
export function previewEdit(story: Story, operations: EditOperation[]) {
  if (operations.some(op => op.kind === "world" && op.fields.scenes !== undefined) && operations.some(op => op.kind === "scene"))
    throw new StudioError(422, "장면 전체 수정과 개별 장면 수정은 한 요청에 섞을 수 없습니다.");
  const next = structuredClone(story);
  const deltas: Delta[] = [];
  const touched = new Set<string>();
  for (const op of operations) {
    const collection = op.kind === "world" ? "world" : collections[op.kind];
    const id = op.kind === "world" ? "world" : op.id;
    const target = `${collection}:${id}`;
    if (touched.has(target))
      throw new StudioError(
        422,
        "같은 대상의 필드는 하나의 수정 항목으로 묶어주세요.",
      );
    touched.add(target);
    if (collection !== "world" && !next[collection]?.some((e) => e.id === id)) {
      const collectionWasAbsent = next[collection] === undefined;
      const entity = { id, ...op.fields };
      if (op.kind === "character")
        next.characters.push(characterSchema.parse(entity));
      else if (op.kind === "relationship")
        next.relationships.push(
          storySchema.shape.relationships.element.parse(entity),
        );
      else if (op.kind === "fact") next.facts.push(factSchema.parse(entity));
      else if (op.kind === "scene") next.scenes.push(sceneSchema.parse(entity));
      else if (op.kind === "ontologyNode") (next.ontologyNodes ??= []).push(ontologyNodeSchema.parse(entity));
      else if (op.kind === "ontologyEdge") (next.ontologyEdges ??= []).push(ontologyEdgeSchema.parse(entity));
      deltas.push({
        ...(collectionWasAbsent ? { collectionWasAbsent: true } : {}),
        collection,
        id,
        field: "$entity",
        before: null,
        after: entity,
      });
      continue;
    }
    const record = targetRecord(next, { collection, id });
    for (const [field, after] of Object.entries(op.fields))
      if (!same(record[field], after)) {
        deltas.push({
          collection,
          id,
          field,
          before: record[field],
          after,
        });
        record[field] = after;
      }
  }
  if (!deltas.length) throw new StudioError(422, "변경된 항목이 없습니다.");

  return { story: validateDraft(next), deltas };
}
export async function editProject(raw: unknown, actor: "web" | "mcp", access?: { subject: string; check: () => Promise<void> }) {
  const input = editRequestSchema.parse(raw);
  if (actor === "mcp") {
    const p = await getProject(input.projectId), binding = requireBinding(p, input.bindingId, input.selectionToken);
    const delegated = await bindingAccess(p.id, binding);
    if (delegated) access = { subject: delegated.subject, check: async () => { await delegated.check("read"); await delegated.check("edit"); } };
  }
  rejectCredentials(input);
  if (access) { cognitoSubjectSchema.parse(access.subject); await access.check(); }
  if (actor === "mcp")
    requireBinding(
      await getProject(input.projectId),
      input.bindingId,
      input.selectionToken,
    );
  const result = await withProject(
    input.projectId,
    input.revision,
    input.requestId,
    actionKey(access ? `edit:${actor}:team:${access.subject}` : `edit:${actor}`, input),
    async (p) => {
      if (access) await access.check();
      const b =
        actor === "mcp"
          ? requireBinding(p, input.bindingId, input.selectionToken)
          : null;
      // A batch can include related edits, but must touch the explicitly selected subject.
      if (
        b &&
        !input.operations.some(
          (op) =>
            op.kind === b.selection.kind &&
            (op.kind === "world" || op.id === b.selection.id),
        )
      )
        throw new StudioError(
          409,
          "선택한 대상과 수정 요청이 다릅니다. 수정할 항목을 먼저 선택하세요.",
        );
      const { story, deltas } = previewEdit(p.story, input.operations);
      revise(p, story, input.summary);
      state(p).events.push({
        id: randomUUID(),
        requestId: input.requestId,
        actor,
        ...(access ? { authorSubject: access.subject } : {}),
        summary: input.summary,
        createdAt: new Date().toISOString(),
        revision: p.revision,
        deltas,
      });
      if (access) await access.check();
    },
    actor === "web" && !!access,
  );
  // Receipt replay must not reveal prior edits after sharing has been revoked.
  if (actor === "mcp")
    requireBinding(result.project, input.bindingId, input.selectionToken);
  if (access) await access.check();
  return result;
}
export async function undoEdit(raw: unknown, actor: "web" | "mcp", access?: { subject: string; check: () => Promise<void> }) {
  const input = undoSchema.parse(raw);
  if (actor === "mcp") {
    const p = await getProject(input.projectId), binding = requireBinding(p, input.bindingId, input.selectionToken);
    const delegated = await bindingAccess(p.id, binding);
    if (delegated) access = { subject: delegated.subject, check: async () => { await delegated.check("read"); await delegated.check("edit"); } };
  }
  if (access) { cognitoSubjectSchema.parse(access.subject); await access.check(); }
  if (actor === "mcp")
    requireBinding(
      await getProject(input.projectId),
      input.bindingId,
      input.selectionToken,
    );
  const result = await withProject(
    input.projectId,
    input.revision,
    input.requestId,
    actionKey(access ? `undo:${actor}:team:${access.subject}` : `undo:${actor}`, input),
    async (p) => {
      if (access) await access.check();
      const binding =
        actor === "mcp"
          ? requireBinding(p, input.bindingId, input.selectionToken)
          : null;
      const s = state(p);
      const event = s.events.find((e) => e.id === input.eventId);
      if (!event || event.undoes)
        throw new StudioError(409, "되돌릴 수 없는 변경입니다.");
      const done = undoneIndexes(event, s.events);
      const indexes =
        input.deltaIndexes ??
        event.deltas.map((_, i) => i).filter((i) => !done.has(i));
      if (
        !indexes.length ||
        new Set(indexes).size !== indexes.length ||
        indexes.some((i) => i >= event.deltas.length || done.has(i))
      )
        throw new StudioError(
          409,
          "이미 되돌렸거나 유효하지 않은 변경 항목입니다.",
        );
      const selectedDeltas = indexes.map((i) => event.deltas[i]);
      if (
        binding &&
        !selectedDeltas.some(
          (d) =>
            d.collection ===
              (binding.selection.kind === "world"
                ? "world"
                : collections[binding.selection.kind]) &&
            d.id === binding.selection.id,
        )
      )
        throw new StudioError(409, "되돌릴 변경의 대상을 먼저 선택하세요.");
      const next = structuredClone(p.story);
      for (const d of [...selectedDeltas].reverse()) {
        if (d.field === "$entity" && d.collection !== "world") {
          // A board/image can be added without changing canon revision or the
          // character record. Undoing creation must not orphan that work.
          const board = p.platform?.production;
          if ((d.collection === "characters" && (p.assets.some(a => a.subjectId === d.id) || board?.items.some(item => item.kind === "character" && item.subjectId === d.id || item.content.characterIds.includes(d.id) || item.versions.some(v => v.content.characterIds.includes(d.id))) || board?.references[d.id])) ||
            (d.collection === "scenes" && board?.items.some(item => item.content.sceneId === d.id || item.versions.some(v => v.content.sceneId === d.id))))
            throw new StudioError(409, "연결된 보드·이미지 작업이 있어 항목 추가를 되돌리지 않았습니다.");
          const list = next[d.collection] ?? [];
          const index = list.findIndex((e) => e.id === d.id);
          if (index < 0 || !same(list[index], d.after))
            throw new StudioError(
              409,
              "이후 수정이 있어 자동으로 되돌리지 않았습니다.",
            );
          list.splice(index, 1);
          if (!list.length && d.collectionWasAbsent) {
            if (d.collection === "ontologyNodes") delete next.ontologyNodes;
            if (d.collection === "ontologyEdges") delete next.ontologyEdges;
          }
        } else {
          const record = targetRecord(next, d);
          if (!same(record[d.field], d.after))
            throw new StudioError(
              409,
              "이후 수정이 있어 자동으로 되돌리지 않았습니다.",
            );
          record[d.field] = d.before;
        }
      }
      revise(p, validateDraft(next), `되돌리기: ${event.summary}`);
      s.events.push({
        id: randomUUID(),
        requestId: input.requestId,
        actor,
        ...(access ? { authorSubject: access.subject } : {}),
        summary: `되돌리기: ${event.summary}`,
        createdAt: new Date().toISOString(),
        revision: p.revision,
        undoes: event.id,
        undoneDeltaIndexes: indexes,
        deltas: selectedDeltas.map((d) => ({
          ...d,
          before: d.after,
          after: d.before,
        })),
      });
      if (access) await access.check();
    },
  );
  if (actor === "mcp")
    requireBinding(result.project, input.bindingId, input.selectionToken);
  if (access) await access.check();
  return result;
}
export async function addSource(raw: unknown, access?: { subject: string; check: () => Promise<void> }) {
  const input = sourceSchema.parse(raw);
  if (access) { cognitoSubjectSchema.parse(access.subject); await access.check(); }
  rejectCredentials(input);
  if (input.kind === "link") {
    let url;
    try {
      url = new URL(input.url);
    } catch {
      throw new StudioError(400, "올바른 링크를 입력하세요.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new StudioError(
        400,
        "인증 정보 없는 웹 링크만 등록할 수 있습니다.",
      );
  } else if (!input.text.trim())
    throw new StudioError(400, "자료 내용을 입력하세요.");
  const result = await withProject(
    input.projectId,
    input.revision,
    input.requestId,
    actionKey("source", access ? { ...input, subject: access.subject } : input),
    async (p) => {
      await access?.check();
      const s = state(p);
      if (s.sources.length >= 100)
        throw new StudioError(429, "작품 자료 100개 한도입니다.");
      s.sources.push({
        ...(access ? { authorSubject: access.subject } : {}),
        id: randomUUID(),
        title: input.title,
        kind: input.kind,
        text: input.text,
        url: input.kind === "link" ? input.url : "",
        status: input.kind === "link" ? "link_only" : "text_saved",
        createdAt: new Date().toISOString(),
      });
      await access?.check();
    },
  );
  await access?.check();
  return result;
}
