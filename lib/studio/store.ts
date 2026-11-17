import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
  open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyStory, storySchema, type Project, type Story } from "./schema";
import { defaultPlatform, lockedField } from "../platform/types";

export class StudioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const dataRoot = () =>
  resolve(process.env.STUDIO_DATA_DIR || join(process.cwd(), ".studio"));
export function safeId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
    throw new StudioError(400, "잘못된 작업실 ID입니다.");
  return id;
}
async function dirs() {
  await mkdir(join(dataRoot(), "projects"), { recursive: true, mode: 0o700 });
  await mkdir(join(dataRoot(), "assets"), { recursive: true, mode: 0o700 });
}
export async function listProjects() {
  await dirs();
  const names = (await readdir(join(dataRoot(), "projects"))).filter((n) =>
    /^[0-9a-f-]{36}\.json$/.test(n),
  );
  const { cloudProjectIds } = await import("../platform/project-storage");
  const ids = [...new Set([...names.map(name => name.slice(0, -5)), ...await cloudProjectIds()])];
  const entries = await Promise.all(
    ids.map(async (id) => {
      const p = await getProject(id);
      return {
        id: p.id,
        title: p.title,
        revision: p.revision,
        updatedAt: p.updatedAt,
      };
    }),
  );
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id: string): Promise<Project> {
  const cloud = await (await import("../platform/project-storage")).configuredProjects(id);
  if (cloud) {
    const snapshot = await cloud.load(id);
    if (!snapshot) throw new StudioError(404, "클라우드 작품을 찾지 못했습니다. 로컬로 전환하지 않았습니다.");
    snapshot.project.platform ??= defaultPlatform(snapshot.project.story);
    return snapshot.project;
  }
  try {
    const p = JSON.parse(
      await readFile(
        join(dataRoot(), "projects", `${safeId(id)}.json`),
        "utf8",
      ),
    ) as Project;
    storySchema.parse(p.story);
    // Lazy additive migration: reading never rewrites existing customer files.
    p.platform ??= defaultPlatform(p.story);
    return p;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new StudioError(404, "작품을 찾지 못했습니다.");
    if (e instanceof StudioError) throw e;
    throw new StudioError(
      500,
      "작품 파일을 읽지 못했습니다. .studio의 원본 파일을 확인하세요.",
    );
  }
}
export async function projectChangeStamp(id: string) {
  const cloud = await (await import("../platform/project-storage")).configuredProjects(id);
  if (cloud) return cloud.changeStamp(id);
  const p = await getProject(id);
  return { sequence: p.platform?.sequence ?? 0, revision: p.revision };
}
async function writeProject(project: Project) {
  await dirs();
  const target = join(dataRoot(), "projects", `${safeId(project.id)}.json`);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(project));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function createProject(story = emptyStory(), summary = "새 작품") {
  if ((await listProjects()).length >= 100)
    throw new StudioError(
      409,
      "작업실 100개 한도입니다. 별도 STUDIO_DATA_DIR로 새 워크숍을 시작하세요.",
    );
  const p = newProject(story, summary);
  await writeProject(p);
  return p;
}
export function newProject(story = emptyStory(), summary = "새 작품", id = randomUUID(), now = new Date().toISOString()): Project {
  const p: Project = {
    id,
    title: story.title,
    revision: 1,
    story,
    createdAt: now,
    updatedAt: now,
    messages: [],
    revisions: [{ number: 1, createdAt: now, summary, story }],
    assets: [],
    play: null,
    deployment: {
      region: "ap-northeast-2",
      accountId: "",
      profile: "",
      stackName: `Story-${id.slice(0, 8)}`,
      monthlyBudgetUsd: 100,
    },
    receipts: [],
    usage: { textCalls: 0, imageCalls: 0, inputTokens: 0, outputTokens: 0 },
  };
  return p;
}
export function revise(p: Project, story: Story, summary: string) {
  // Every editing path (direct, proposal, undo) must preserve references in
  // existing art and historical board versions, not just the current draft.
  const removed = new Set((["scenes", "locations", "characters"] as const).flatMap(collection =>
    p.story[collection].filter(old => !story[collection].some(next => next.id === old.id)).map(old => old.id)));
  if (p.assets.some(asset => removed.has(asset.subjectId)) || p.platform?.production?.items.some(item =>
    removed.has(item.subjectId) ||
    [item.content, ...item.versions.map(version => version.content)].some(content =>
      ("sceneId" in content && removed.has(content.sceneId)) ||
      ("characterId" in content && typeof content.characterId === "string" && removed.has(content.characterId)) ||
      ("characterIds" in content && content.characterIds.some(id => removed.has(id))))))
    throw new StudioError(409, "이미지 또는 스토리보드 기록에 쓰인 장면·장소·캐릭터는 삭제할 수 없습니다. 기존 작업을 보존하며 내용을 수정하세요.");
  for (const lock of p.platform?.locks ?? []) {
    if (
      JSON.stringify(lockedField(p.story, lock)) !==
      JSON.stringify(lockedField(story, lock))
    )
      throw new StudioError(
        409,
        `고정한 설정은 수정할 수 없습니다: ${lock.selection.id} / ${lock.field}. 먼저 고정을 해제하세요.`,
      );
  }
  if (p.revisions.length >= 200)
    throw new StudioError(
      409,
      "이 작품의 200개 버전 한도에 도달했습니다. JSON을 새 작품으로 가져와 이어가세요.",
    );
  p.revision += 1;
  p.title = story.title;
  p.story = story;
  p.platform ??= defaultPlatform(story);
  p.platform.worldGraph = { revision: p.revision, status: "pending" };
  p.play = null;
  p.revisions.push({
    number: p.revision,
    story,
    summary: summary.slice(0, 200),
    createdAt: new Date().toISOString(),
  });
}

// Filesystem locks also coordinate independent local server processes. A lock
// left by a dead process can be recovered without dropping a live operation.
export async function withProject<T>(
  id: string,
  revision: number | undefined,
  requestId: string,
  action: string,
  fn: (p: Project) => Promise<T>,
  retryFailedTextEdit = false,
) {
  const cloud = await (await import("../platform/project-storage")).configuredProjects(id);
  if (cloud) {
    const result = await cloud.execute(id, revision, requestId, action, fn, retryFailedTextEdit);
    if (process.env.STUDIO_WORLD_GRAPH_ARN && result.project.platform?.worldGraph?.status === "pending") {
      const { syncWorldProjection } = await import("../platform/world-projection");
      return { ...result, project: await syncWorldProjection(result.project, cloud) };
    }
    return result;
  }
  await dirs();
  safeId(id);
  const path = join(dataRoot(), "projects", `${id}.lock`);
  let lock;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    let dead = false;
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          dead = (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
    } catch {
      /* another process may be acquiring */
    }
    if (!dead)
      throw new StudioError(
        409,
        "이 작품의 다른 요청이 진행 중입니다. 완료 후 다시 시도하세요.",
      );
    await unlink(path).catch(() => {});
    try {
      lock = await open(path, "wx", 0o600);
    } catch {
      throw new StudioError(409, "작품 잠금을 다시 시도하세요.");
    }
  }
  try {
    await lock.writeFile(String(process.pid));
    const p = await getProject(id);
    const receipt = p.receipts.find((r) => r.id === requestId);
    if (receipt) {
      if (receipt.action !== action)
        throw new StudioError(
          409,
          "중복 요청 ID가 다른 작업에 사용되었습니다.",
        );
      return { project: p, value: undefined };
    }
    if (revision !== undefined && revision !== p.revision)
      throw new StudioError(
        409,
        "다른 창에서 설계가 바뀌었습니다. 최신 버전을 불러왔으니 다시 시도하세요.",
      );
    const value = await fn(p);
    p.updatedAt = new Date().toISOString();
    p.platform ??= defaultPlatform(p.story);
    p.platform.sequence += 1;
    p.receipts = [...p.receipts, { id: requestId, action }].slice(-200);
    await writeProject(p);
    return { project: p, value };
  } finally {
    await lock.close();
    await unlink(path).catch(() => {});
  }
}
export async function saveAsset(
  projectId: string,
  assetId: string,
  png: Uint8Array,
) {
  const cloud = await (await import("../platform/s3-assets")).configuredAssets(projectId);
  if (cloud) return cloud.put(projectId, assetId, png);
  if (await (await import("../platform/project-storage")).configuredProjects(projectId)) throw new StudioError(503, "클라우드 작품의 S3 이미지 저장소를 먼저 연결하세요.");
  await dirs();
  const folder = join(dataRoot(), "assets", safeId(projectId));
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(join(folder, `${safeId(assetId)}.png`), png, {
    mode: 0o600,
    flag: "wx",
  });
}
export async function readAsset(projectId: string, assetId: string) {
  const cloud = await (await import("../platform/s3-assets")).configuredAssets(projectId);
  if (cloud) return cloud.get(projectId, assetId);
  if (await (await import("../platform/project-storage")).configuredProjects(projectId)) throw new StudioError(503, "클라우드 작품의 S3 이미지 저장소를 먼저 연결하세요.");
  try {
    return await readFile(
      join(dataRoot(), "assets", safeId(projectId), `${safeId(assetId)}.png`),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new StudioError(404, "이미지 파일을 찾지 못했습니다.");
    throw e;
  }
}
