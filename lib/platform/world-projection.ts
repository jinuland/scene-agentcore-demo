import { randomUUID } from "node:crypto";
import type { Project } from "../studio/schema";
import type { DynamoProjects } from "./dynamo-projects";
import { configuredWorldGraph } from "./world-graph-client";
import { defaultPlatform } from "./types";

// Canon is committed first. A failed external projection is explicitly pending
// or failed, never rolled back or represented as a successful graph write.
// Re-running is idempotent by immutable project/revision/content-hash scope.
export async function syncWorldProjection(project: Project, storage: DynamoProjects) {
  const graph = configuredWorldGraph();
  if (!graph) return project;
  let status: "ready" | "failed" = "failed", hash: string | undefined;
  try { const result = await graph.ensure({ projectId: project.id, revision: project.revision, story: project.story }); status = "ready"; hash = result.hash; }
  catch { /* Provider payloads can contain story text; retain no raw error. */ }
  try {
    return (await storage.execute(project.id, project.revision, randomUUID(), "world-graph-projection-status", async p => {
      p.platform ??= defaultPlatform(p.story);
      p.platform.worldGraph = { revision: project.revision, status, ...(hash ? { hash } : {}), checkedAt: new Date().toISOString() };
    })).project;
  } catch { return project; } // A newer draft wins; its own pending state survives.
}
