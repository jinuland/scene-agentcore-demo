import { MultiDirectedGraph } from "graphology";
import { narrativeGraph } from "../../lib/platform/narrative-graph";
import type { Episode } from "./scene-store";

/** Rebuildable read model. The episode snapshot, not this graph, owns live state. */
export function sceneGraphProjection(episode: Episode) {
  const graph = episode.narrative && episode.narrativeDefinition
    ? narrativeGraph(episode.narrativeDefinition, episode.narrative) : new MultiDirectedGraph();
  graph.mergeNode("session", { kind: "Session", id: episode.id, story: episode.story, version: episode.turns.length });
  for (const turn of episode.turns) {
    const key = "turn/" + turn.id;
    graph.mergeNode(key, { kind: "Turn", input: turn.input, text: turn.text });
    graph.addDirectedEdge("session", key, { kind: "HAS_TURN" });
  }
  for (const memory of episode.memories) {
    const key = "memory/" + memory.id;
    graph.mergeNode(key, { kind: "ReportedMemory", subject: memory.subject, quote: memory.quote });
    if (graph.hasNode("turn/" + memory.sourceTurnId)) graph.addDirectedEdge(key, "turn/" + memory.sourceTurnId, { kind: "EVIDENCED_BY" });
  }
  return { version: episode.turns.length, graph: graph.export(), projectedAt: new Date().toISOString() };
}
