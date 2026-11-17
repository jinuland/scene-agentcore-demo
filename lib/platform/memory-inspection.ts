import type { MemoryAssertion, RuntimeSession, RuntimeTurn } from "./memory";

type LedgerView = Pick<RuntimeSession, "turns" | "memories">;
export type ContextReceipt = {
  version: 1;
  memoryIds: string[];
  recentTurnIds: string[];
  visibleFactCount: number;
  sceneId?: string;
  witnessedChoiceCount?: number;
};
// Also used by the player UI; this module has no server or credential imports.
export function memoryEvidence(s: LedgerView, memory: MemoryAssertion, characterId: string) {
  const source = s.turns.find(t => t.id === memory.sourceTurnId);
  const predicate = { claim: "said", promise: "promised", question: "asked" };
  if (!source || source.characterId !== characterId && !source.witnessedBy?.includes(characterId) || !memory.knownBy.includes(characterId) ||
      !memory.sourceQuote || !source.text.includes(memory.sourceQuote) ||
      memory.subjectId !== (source.role === "user" ? "player" : source.characterId) ||
      predicate[memory.kind] !== memory.predicate) return undefined;
  return source;
}
export function retractionImpact(s: LedgerView, memoryId: string) {
  const selected = s.memories.find(m => m.id === memoryId);
  if (!selected || selected.status !== "reported") return undefined;
  const index = s.turns.findIndex(t => t.id === selected.sourceTurnId);
  const downstream = new Set(s.turns.slice(Math.max(0, index)).map(t => t.id));
  return {
    memoryIds: s.memories.filter(m => m.status === "reported" && (m.id === memoryId || downstream.has(m.sourceTurnId))).map(m => m.id),
    resetRecentContext: true as const,
    keepsTranscript: true as const,
  };
}
export function contextReceipt(context: { memories: Array<{ id: string }>; recent: Array<{ id: string }>; visibleFacts: unknown[]; scene?: { id: string; witnessedChoices: unknown[] } }): ContextReceipt {
  return { version: 1, memoryIds: context.memories.map(m => m.id), recentTurnIds: context.recent.map(t => t.id), visibleFactCount: context.visibleFacts.length, ...(context.scene ? { sceneId: context.scene.id, witnessedChoiceCount: context.scene.witnessedChoices.length } : {}) };
}
export function receiptMemories(s: LedgerView, turn: RuntimeTurn) {
  if (turn.role !== "assistant" || turn.contextReceipt?.version !== 1) return [];
  return turn.contextReceipt.memoryIds.flatMap(id => {
    const memory = s.memories.find(m => m.id === id);
    if (!memory || !memoryEvidence(s, memory, turn.characterId)) return [];
    return [memory];
  });
}
