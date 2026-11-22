import { initialNarrativeState } from "../../lib/platform/narrative-graph";
import type { Episode } from "./scene-store";
import type { Story } from "./stories";

/** Read-only hydration; the next normal leased turn commits it with the transcript. */
export function adoptWorldEngine(episode: Episode, story: Story): Episode {
  if (episode.narrative) {
    // The first multilingual rollout could persist an unordered-map hash before
    // its first successful turn. Normalize only pristine, unplayed snapshots.
    const pinned = episode.narrativeDefinition;
    if (pinned?.translations && episode.narrative.turns === 0 && !episode.narrative.events.length && !episode.narrative.transitions.length) {
      const initial = initialNarrativeState(pinned);
      if (episode.narrative.scene === initial.scene && episode.narrative.sceneTurns === 0 && episode.narrative.elapsedMinutes === 0 && initial.definitionHash !== episode.narrative.definitionHash) {
        return { ...episode, narrative: { ...episode.narrative, definitionHash: initial.definitionHash } };
      }
    }
    return episode;
  }
  if (!story.narrative) return episode;
  const state = initialNarrativeState(story.narrative);
  const trust = story.narrative.counters.find(c => c.id === "trust" && c.min === 0 && c.max === 5);
  if (trust) state.counters.trust = Math.min(5, episode.turns.filter(turn => turn.trustQuote).length);
  return { ...episode, narrative: state, narrativeDefinition: structuredClone(story.narrative), narrativeStartedAtTurn: episode.turns.length };
}
