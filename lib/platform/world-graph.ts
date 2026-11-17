import { createHash } from "node:crypto";
import { ExecuteOpenCypherQueryCommand, type NeptunedataClient } from "@aws-sdk/client-neptunedata";
import { z } from "zod";
import { storySchema } from "../studio/schema";
import { authorGraph } from "./author-graph";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const worldGraphInput = z.object({ projectId: z.string().uuid(), revision: z.number().int().positive(), story: storySchema }).strict();
export type WorldGraphInput = z.infer<typeof worldGraphInput>;
export type WorldGraphDocument = ReturnType<typeof worldGraphDocument>;
export function worldGraphDocument(raw: WorldGraphInput) {
  const input = worldGraphInput.parse(raw);
  const graph = authorGraph(input.projectId, input.revision, input.story);
  const nodes = [
    { id: "world", kind: "world", name: input.story.title, description: input.story.premise, certainty: "confirmed", visibility: "author" },
    ...graph.nodes,
    ...input.story.scenes.map(s => ({ id: s.id, kind: "scene", name: s.title, description: s.opening, certainty: "confirmed", visibility: "author", ...(s.pacing ? { pacing: s.pacing, entryConditions: s.entryConditions } : {}) })),
    ...input.story.variables.map(v => ({ id: v.id, kind: "variable", name: v.name, description: "", certainty: "confirmed", visibility: "author" })),
  ];
  const edges = [...graph.edges,
    ...nodes.filter(n => n.id !== "world").map(n => ({ id: `contains:${n.id}`, from: "world", to: n.id, kind: "contains", predicate: "contains", label: "세계관 구성", description: "", certainty: "confirmed", visibility: "author" })),
    ...input.story.scenes.flatMap(s => s.characterIds.map(id => ({ id: `cast:${s.id}:${id}`, from: s.id, to: id, kind: "cast", predicate: "appears_in", label: "등장", description: "", certainty: "confirmed", visibility: "author" }))),
    ...input.story.scenes.filter(s => s.pacing).flatMap(s => s.choices.filter(c => input.story.scenes.some(next => next.id === c.nextSceneId)).map(c => ({
      id: `route:${s.id}:${c.id}`, from: s.id, to: c.nextSceneId, kind: "route", predicate: "leads_to", label: c.label,
      description: "대화 최소 횟수와 회차 상태가 맞을 때만 열리는 전환", certainty: "confirmed", visibility: "author",
      minExchanges: s.pacing!.minExchanges, conditions: c.conditions, effects: c.effects,
    }))),
  ];
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length || new Set(edges.map(e => e.id)).size !== edges.length || edges.some(e => !ids.has(e.from) || !ids.has(e.to))) throw new Error("World graph references invalid");
  if (nodes.length > 400 || edges.length > 1500 || Buffer.byteLength(JSON.stringify(input.story)) > 500_000) throw new Error("World graph workshop size limit exceeded");
  const hash = digest(input), scope = `world/${input.projectId}/${input.revision}/${hash}`;
  return { projectId: input.projectId, revision: input.revision, hash, scope, nodes, edges, story: input.story };
}
const scopeSchema = z.string().regex(/^(world\/[a-f0-9-]{36}\/\d+\/[a-f0-9]{64}|episode-world\/[a-f0-9]{64})$/);
const rootQuery = "MATCH (g:WorldGraph {`~id`: $scope}) RETURN g.hash AS hash, g.ready AS ready, g.deleted AS deleted, g.story AS story";
const nodesQuery = "MATCH (g:WorldGraph {`~id`: $scope})-[:WORLD_MEMBER]->(n:WorldEntity {scope: $scope}) RETURN n.localId AS id, n.payload AS payload ORDER BY id";
const edgesQuery = "MATCH (a:WorldEntity {scope: $scope})-[e:WORLD_LINK {scope: $scope}]->(b:WorldEntity {scope: $scope}) RETURN e.localId AS id, e.payload AS payload ORDER BY id";
// Every batch locks/checks the root. A deleted episode root is retained as a
// fence, so an older clone worker cannot recreate children after deletion.
export const worldNodeBatchQuery = `MATCH (g:WorldGraph {\`~id\`: $scope}) WHERE g.deleted = false AND g.hash = $hash
SET g.writing = true WITH g UNWIND $rows AS row
MERGE (n:WorldEntity {\`~id\`: row.key}) ON CREATE SET n.scope = $scope, n.localId = row.id, n.payload = row.payload
MERGE (g)-[:WORLD_MEMBER]->(n)`;
export const worldEdgeBatchQuery = `MATCH (g:WorldGraph {\`~id\`: $scope}) WHERE g.deleted = false AND g.hash = $hash
SET g.writing = true WITH g UNWIND $rows AS row
MATCH (a:WorldEntity {\`~id\`: row.fromKey, scope: $scope}), (b:WorldEntity {\`~id\`: row.toKey, scope: $scope})
MERGE (a)-[e:WORLD_LINK {\`~id\`: row.key}]->(b) ON CREATE SET e.scope = $scope, e.localId = row.id, e.payload = row.payload`;

export class NeptuneWorldGraph {
  constructor(readonly client: NeptunedataClient) {}
  private async run(query: string, parameters: Record<string, unknown>) {
    const response = await this.client.send(new ExecuteOpenCypherQueryCommand({ openCypherQuery: query, parameters: JSON.stringify(parameters) }), { abortSignal: AbortSignal.timeout(25_000) });
    return response.results as unknown;
  }
  async read(scope: string) {
    scopeSchema.parse(scope);
    const root = z.array(z.object({ hash: z.string(), ready: z.boolean(), deleted: z.boolean(), story: z.string().optional() })).max(1).parse(await this.run(rootQuery, { scope }))[0];
    if (!root || root.deleted || !root.ready || !root.story) return null;
    const parse = (value: unknown) => z.array(z.object({ id: z.string(), payload: z.string() })).max(1500).parse(value).map(r => JSON.parse(r.payload) as { id: string });
    const nodes = parse(await this.run(nodesQuery, { scope }));
    const edges = parse(await this.run(edgesQuery, { scope }));
    // Read the fence again: do not return data across a concurrent deletion.
    const after = z.array(z.object({ hash: z.string(), ready: z.boolean(), deleted: z.boolean() })).max(1).parse(await this.run(rootQuery, { scope }))[0];
    if (!after || after.deleted || !after.ready || after.hash !== root.hash) return null;
    return { scope, hash: root.hash, nodes, edges, story: storySchema.parse(JSON.parse(root.story)) };
  }
  async ensure(document: WorldGraphDocument, targetScope = document.scope) {
    scopeSchema.parse(targetScope);
    const scope = targetScope, hash = document.hash;
    const prior = await this.read(scope);
    if (prior) { this.verify(document, prior); return prior; }
    await this.run(`MERGE (g:WorldGraph {\`~id\`: $scope}) ON CREATE SET g.hash = $hash, g.ready = false, g.deleted = false, g.story = $story`, { scope, hash, story: JSON.stringify(document.story) });
    const nodes = document.nodes.map(n => ({ id: n.id, key: `${scope}/node/${n.id}`, payload: JSON.stringify(n) }));
    const edges = document.edges.map(e => ({ id: e.id, key: `${scope}/edge/${e.id}`, fromKey: `${scope}/node/${e.from}`, toKey: `${scope}/node/${e.to}`, payload: JSON.stringify(e) }));
    for (let i = 0; i < nodes.length; i += 20) await this.run(worldNodeBatchQuery, { scope, hash, rows: nodes.slice(i, i + 20) });
    for (let i = 0; i < edges.length; i += 20) await this.run(worldEdgeBatchQuery, { scope, hash, rows: edges.slice(i, i + 20) });
    await this.run(`MATCH (g:WorldGraph {\`~id\`: $scope}) WHERE g.deleted = false AND g.hash = $hash
OPTIONAL MATCH (g)-[:WORLD_MEMBER]->(n:WorldEntity {scope: $scope}) WITH g, count(n) AS nodes
OPTIONAL MATCH (a:WorldEntity {scope: $scope})-[e:WORLD_LINK {scope: $scope}]->(b:WorldEntity {scope: $scope})
WITH g, nodes, count(e) AS edges WHERE nodes = $nodes AND edges = $edges SET g.ready = true`, { scope, hash, nodes: nodes.length, edges: edges.length });
    const result = await this.read(scope);
    if (!result) throw new Error("World graph not ready or deleted");
    this.verify(document, result);
    return result;
  }
  private verify(document: WorldGraphDocument, stored: NonNullable<Awaited<ReturnType<NeptuneWorldGraph["read"]>>>) {
    const sorted = (rows: { id: string }[]) => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
    if (stored.hash !== document.hash || digest(stored.story) !== digest(document.story) || digest(sorted(stored.nodes)) !== digest(sorted(document.nodes)) || digest(sorted(stored.edges)) !== digest(sorted(document.edges))) throw new Error("World graph projection mismatch");
  }
  async deleteEpisode(scope: string) {
    if (!/^episode-world\/[a-f0-9]{64}$/.test(scope)) throw new Error("Only episode graph deletion allowed");
    await this.run(`MERGE (g:WorldGraph {\`~id\`: $scope}) SET g.deleted = true, g.ready = false REMOVE g.story
WITH g OPTIONAL MATCH (n:WorldEntity {scope: $scope}) DETACH DELETE n`, { scope });
    const status = await this.inspectEpisode(scope);
    if (!status?.deleted || status.nodes !== 0 || status.hasStory) throw new Error("Episode world deletion not verified");
  }
  async inspectEpisode(scope: string) {
    if (!/^episode-world\/[a-f0-9]{64}$/.test(scope)) throw new Error("Only exact episode inspection allowed");
    const raw = await this.run(`MATCH (g:WorldGraph {\`~id\`: $scope}) OPTIONAL MATCH (n:WorldEntity {scope: $scope}) RETURN g.deleted AS deleted, g.story IS NOT NULL AS hasStory, count(n) AS nodes`, { scope });
    return z.array(z.object({ deleted: z.boolean(), hasStory: z.boolean(), nodes: z.number().int().nonnegative() })).max(1).parse(raw)[0] ?? null;
  }
}
