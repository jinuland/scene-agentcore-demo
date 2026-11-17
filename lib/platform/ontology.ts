import { z } from "zod";
import type { Story, Issue } from "../studio/schema";
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const common = { id, description: z.string().max(2000), certainty: z.enum(["draft", "inferred", "confirmed"]), visibility: z.enum(["public", "author"]), evidenceFactIds: z.array(id).max(20) };
export const ontologyNodeSchema = z.object({ ...common, kind: z.enum(["organization", "object", "event"]), name: z.string().min(1).max(120) }).strict();
export const ontologyEdgeSchema = z.object({ ...common, from: id, to: id, predicate: z.enum(["belongs_to", "owns", "participates_in", "located_at", "caused", "related_to"]) }).strict();
export type OntologyNode = z.infer<typeof ontologyNodeSchema>;
export type OntologyEdge = z.infer<typeof ontologyEdgeSchema>;
export const ontologyLabels = { character: "인물", location: "장소", fact: "사실·비밀", organization: "조직", object: "사물", event: "사건" } as const;
export const predicateLabels = { belongs_to: "소속됨", owns: "소유함", participates_in: "참여함", located_at: "위치함", caused: "원인이 됨", related_to: "관련됨" } as const;
export function ontologyAnchors(story: Story) {
  return [
    ...story.characters.map(c => ({ id: c.id, kind: "character" as const, name: c.name })),
    ...story.locations.map(l => ({ id: l.id, kind: "location" as const, name: l.name })),
    ...story.facts.map(f => ({ id: f.id, kind: "fact" as const, name: f.statement.slice(0, 100) || f.id })),
    ...(story.ontologyNodes ?? []).map(n => ({ id: n.id, kind: n.kind, name: n.name })),
  ];
}
export function validateOntology(story: Story): Issue[] {
  const issues: Issue[] = [], anchors = new Map(ontologyAnchors(story).map(n => [n.id, n]));
  const facts = new Set(story.facts.map(f => f.id));
  for (const entry of [...story.ontologyNodes ?? [], ...story.ontologyEdges ?? []]) {
    for (const fact of entry.evidenceFactIds) if (!facts.has(fact)) issues.push({ severity: "error", path: entry.id, message: `없는 온톨로지 근거 사실: ${fact}` });
    if (new Set(entry.evidenceFactIds).size !== entry.evidenceFactIds.length) issues.push({ severity: "error", path: entry.id, message: "근거 사실 ID가 중복됩니다." });
    if (entry.certainty === "inferred" && !entry.evidenceFactIds.length) issues.push({ severity: "warning", path: entry.id, message: "추론의 근거 사실을 연결해주세요. 추론은 실제 챗에 전달되지 않습니다." });
  }
  for (const edge of story.ontologyEdges ?? []) {
    const from = anchors.get(edge.from), to = anchors.get(edge.to);
    const bad = !from || !to || edge.from === edge.to ||
      (edge.predicate === "belongs_to" && (!(["character", "organization"] as string[]).includes(from.kind) || to.kind !== "organization")) ||
      (edge.predicate === "owns" && (!(["character", "organization"] as string[]).includes(from.kind) || to.kind !== "object")) ||
      (edge.predicate === "participates_in" && (!(["character", "organization"] as string[]).includes(from.kind) || to.kind !== "event")) ||
      (edge.predicate === "located_at" && to.kind !== "location") ||
      (edge.predicate === "caused" && (from.kind !== "event" || to.kind !== "event"));
    if (bad) issues.push({ severity: "error", path: edge.id, message: "관계의 대상·방향·종류를 확인하세요. 소속→조직, 소유→사물, 참여→사건, 위치→장소, 원인→사건입니다." });
  }
  return issues;
}
// A bounded projection into the existing runtime facts protocol. Do not send
// author notes, inference candidates, evidence registries or the whole graph.
export function ontologyRuntimeFacts(story: Story, visibleFactIds: Set<string>) {
  const eligible = (entry: OntologyNode | OntologyEdge) => entry.certainty === "confirmed" && entry.visibility === "public" && entry.evidenceFactIds.every(id => visibleFactIds.has(id));
  const nodes = (story.ontologyNodes ?? []).filter(eligible);
  const allowed = new Set([...story.characters.map(c => c.id), ...story.locations.map(l => l.id), ...visibleFactIds, ...nodes.map(n => n.id)]);
  const anchors = new Map(ontologyAnchors(story).filter(n => allowed.has(n.id)).map(n => [n.id, n]));
  return [
    ...nodes.map(n => ({ id: n.id, statement: `[${ontologyLabels[n.kind]}] ${n.name}: ${n.description}` })),
    ...(story.ontologyEdges ?? []).filter(e => eligible(e) && allowed.has(e.from) && allowed.has(e.to)).map(e => ({ id: e.id, statement: `${anchors.get(e.from)!.name} → ${predicateLabels[e.predicate]} → ${anchors.get(e.to)!.name}. ${e.description}` })),
  ];
}
