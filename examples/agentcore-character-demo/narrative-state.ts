import { isDeepStrictEqual } from "node:util";
import { advanceNarrative, type NarrativeDefinition, type NarrativeState } from "../../lib/platform/narrative-graph";

export function verifiedNarrativeState(definition: NarrativeDefinition, previous: NarrativeState, message: string, returned?: NarrativeState) {
  if (!returned || returned.turns !== previous.turns + 1) throw Error("Narrative turn mismatch");
  const transition = returned.transitions.find(event => event.turn === returned.turns);
  const verified = advanceNarrative(definition, previous, message, {
    events: returned.events.filter(event => event.turn === returned.turns).map(({ id, quote }) => ({ id, quote })),
    transition: transition ? { id: transition.id, quote: transition.quote } : null,
  }).state;
  // DynamoDB maps do not preserve JSON object key order. Array order and all
  // state values/evidence must still match the deterministic replay exactly.
  if (!isDeepStrictEqual(verified, returned)) throw Error("Narrative replay mismatch");
  return verified;
}
