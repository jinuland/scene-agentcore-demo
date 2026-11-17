import { createHash } from "node:crypto";
import { z } from "zod";
import type { Story } from "../studio/schema";
import { StudioError } from "../studio/store";
import { predicateLabels, validateOntology } from "./ontology";

export const graphNodeKinds = ["character", "location", "fact", "organization", "object", "event"] as const;
type Certainty = "draft" | "inferred" | "confirmed" | "not_recorded";
type Node = { id: string; kind: typeof graphNodeKinds[number]; name: string; description: string; textTruncated: boolean; certainty: Certainty; visibility: "public" | "secret" | "author" | "not_recorded"; evidenceFactIds: string[] };
type Edge = { id: string; from: string; to: string; kind: "relationship" | "ontology" | "knowledge" | "evidence"; predicate: string; label: string; description: string; textTruncated: boolean; certainty: Certainty; visibility: Node["visibility"]; evidenceFactIds: string[] };
export type AuthorGraph = { projectId: string; revision: number; hash: string; nodes: Node[]; edges: Edge[]; searchText: Map<string, string> };
const excerpt = (text: string) => ({ description: text.slice(0, 400), textTruncated: text.length > 400 });
const base = { certainty: "not_recorded" as const, visibility: "not_recorded" as const, evidenceFactIds: [] as string[] };
export function authorGraph(projectId: string, revision: number, story: Story): AuthorGraph {
  const nodes: Node[] = [
    ...story.characters.map(c => ({ ...base, id: c.id, kind: "character" as const, name: c.name, ...excerpt(c.role) })),
    ...story.locations.map(l => ({ ...base, id: l.id, kind: "location" as const, name: l.name, ...excerpt(l.description) })),
    ...story.facts.map(f => ({ ...base, id: f.id, kind: "fact" as const, name: f.statement.slice(0, 100), visibility: f.visibility, ...excerpt(f.statement) })),
    ...(story.ontologyNodes ?? []).map(n => ({ ...n, ...excerpt(n.description), evidenceFactIds: [...n.evidenceFactIds] })),
  ];
  const edges: Edge[] = [
    ...story.relationships.map(r => ({ ...base, id: r.id, from: r.from, to: r.to, kind: "relationship" as const, predicate: r.type, label: r.type, ...excerpt(r.description) })),
    ...(story.ontologyEdges ?? []).map(e => ({ ...e, kind: "ontology" as const, label: predicateLabels[e.predicate], ...excerpt(e.description), evidenceFactIds: [...e.evidenceFactIds] })),
    ...story.characters.flatMap(c => c.knownFactIds.map(id => ({ ...base, id: `knowledge:${c.id}:${id}`, from: c.id, to: id, kind: "knowledge" as const, predicate: "knows", label: "알고 있는 사실로 설정됨", ...excerpt("캐릭터의 knownFactIds에 명시된 연결입니다. 사실의 확정 여부나 플레이어 공개 허가를 뜻하지 않습니다.") }))),
    ...(story.ontologyNodes ?? []).flatMap(n => n.evidenceFactIds.map(id => ({ ...base, id: `evidence:${n.id}:${id}`, from: n.id, to: id, kind: "evidence" as const, predicate: "supported_by", label: "설정 근거", ...excerpt("작가가 등록한 근거 사실 참조입니다. 자동 추론으로 만든 새 관계가 아닙니다.") }))),
  ];
  const ids = new Set(nodes.map(n => n.id)), edgeIds = new Set(edges.map(e => e.id)), facts = new Set(story.facts.map(f => f.id));
  if (ids.size !== nodes.length || edgeIds.size !== edges.length || edges.some(e => ids.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || (e.kind === "knowledge" || e.kind === "evidence") && !facts.has(e.to)) || [...nodes, ...edges].some(e => e.evidenceFactIds.some(id => !facts.has(id))) || validateOntology(story).some(i => i.severity === "error")) throw new StudioError(422, "세계관 연결에 중복 ID나 잘못된 참조가 있습니다. 원본 그래프를 먼저 확인하세요.");
  nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => a.id.localeCompare(b.id));
  // Hash full canon, not excerpts: changing omitted text must invalidate a read.
  const hash = createHash("sha256").update(JSON.stringify({ format: "author-graph/1", projectId, revision, story })).digest("hex");
  const searchText = new Map([
    ...story.characters.map(c => [c.id, [c.id, c.name, c.role, c.personality, c.desire, c.voice, c.appearance, c.firstLine].join("\n")] as const),
    ...story.locations.map(l => [l.id, `${l.id}\n${l.name}\n${l.description}`] as const),
    ...story.facts.map(f => [f.id, `${f.id}\n${f.statement}`] as const),
    ...(story.ontologyNodes ?? []).map(n => [n.id, `${n.id}\n${n.name}\n${n.description}`] as const),
  ]);
  return { projectId, revision, hash, nodes, edges, searchText };
}
export const graphSearchSchema = z.object({ query: z.string().trim().max(160).default(""), kind: z.enum(graphNodeKinds).optional(), offset: z.number().int().min(0).max(500).default(0), limit: z.number().int().min(1).max(30).default(20) }).strict();
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ko");
export function searchAuthorGraph(graph: AuthorGraph, raw: unknown) {
  const input = graphSearchSchema.parse(raw), words = normalized(input.query).split(/\s+/u).filter(Boolean);
  const hits = graph.nodes.filter(n => (!input.kind || n.kind === input.kind) && words.every(w => normalized(graph.searchText.get(n.id) ?? "").includes(w)));
  return { projectId: graph.projectId, revision: graph.revision, graphHash: graph.hash, mode: "keyword", total: hits.length, offset: input.offset, nodes: hits.slice(input.offset, input.offset + input.limit), hasMore: hits.length > input.offset + input.limit, searchScope: "full_node_text" };
}
export const graphExploreSchema = z.object({ rootId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), graphHash: z.string().regex(/^[a-f0-9]{64}$/), direction: z.enum(["both", "outgoing", "incoming"]).default("both"), depth: z.number().int().min(1).max(3).default(2), maxNodes: z.number().int().min(1).max(40).default(20), maxEdges: z.number().int().min(1).max(60).default(30) }).strict();
export function exploreAuthorGraph(graph: AuthorGraph, raw: unknown) {
  const input = graphExploreSchema.parse(raw);
  if (input.graphHash !== graph.hash) throw new StudioError(409, "검색 후 세계관이 바뀌었습니다. 다시 검색하세요.");
  if (!graph.nodes.some(n => n.id === input.rootId)) throw new StudioError(404, "이 작품에 없는 시작 항목입니다.");
  const distance = new Map([[input.rootId, 0]]), queue = [input.rootId], selected = new Set<string>();
  let nodeLimitReached = false, edgeLimitReached = false;
  const neighbors = (id: string) => graph.edges.filter(e => input.direction === "outgoing" ? e.from === id : input.direction === "incoming" ? e.to === id : e.from === id || e.to === id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], depth = distance.get(id)!;
    if (depth >= input.depth) continue;
    for (const edge of neighbors(id)) {
      if (selected.has(edge.id)) continue;
      const next = edge.from === id ? edge.to : edge.from;
      if (!distance.has(next) && distance.size >= input.maxNodes) { nodeLimitReached = true; continue; }
      if (selected.size >= input.maxEdges) { edgeLimitReached = true; continue; }
      selected.add(edge.id);
      if (!distance.has(next)) { distance.set(next, depth + 1); queue.push(next); }
    }
  }
  const boundaryNodeIds = queue.filter(id => distance.get(id) === input.depth && neighbors(id).some(e => !selected.has(e.id)));
  const result = { projectId: graph.projectId, revision: graph.revision, graphHash: graph.hash, rootId: input.rootId, direction: input.direction, depth: input.depth,
    nodes: graph.nodes.filter(n => distance.has(n.id)).map(n => ({ ...n, distance: distance.get(n.id)! })), edges: graph.edges.filter(e => selected.has(e.id)),
    truncated: nodeLimitReached || edgeLimitReached, nodeLimitReached, edgeLimitReached, boundaryNodeIds,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 64000) throw new StudioError(413, "관계 결과가 큽니다. 탐색 깊이 또는 항목 수를 줄이세요.");
  return result;
}
