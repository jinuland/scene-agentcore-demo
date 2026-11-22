import type { z } from "zod";
import type { NarrativeDefinition, NarrativeState } from "../../lib/platform/narrative-graph";
import type { runtimeUsageSchema } from "../../lib/platform/runtime-model";
import type { runtimeContextSchema } from "../../lib/platform/runtime-model";
import type { Mood, Story } from "./stories";

export type Context = z.infer<typeof runtimeContextSchema>;
export type Turn = { id: string; input: string; text: string; mood: Mood; suggestions: string[]; mode: string; timing: number; usage?: z.infer<typeof runtimeUsageSchema>; responseLanguage?: Context["responseLanguage"]; responseLength?: Context["responseLength"]; trustQuote?: string; speaker?: string; media?: {id:string;file:string;label:string}[] };
export type Episode = { id: string; story: string; turns: Turn[]; memories: Context["memories"]; narrative?: NarrativeState; narrativeDefinition?: NarrativeDefinition; narrativeStartedAtTurn?: number; storySnapshot?: Story; narrativeUpgrade?: { fromVersion: number; toVersion: number; atTurn: number; previousEnding?: string } };
export interface SceneStore {
  findDraft(owner: string, id: string): Promise<Story | undefined>;
  drafts(owner: string): Promise<Story[]>;
  putDraft(owner: string, draft: Story, expectedRevision?: number): Promise<void>;
  sessions(owner: string): Promise<{id: string; story: string}[]>;
  findEpisode(owner: string, id: string): Promise<Episode | undefined>;
  putEpisode(owner: string, episode: Episode): Promise<void>;
  deleteEpisode(owner: string, id: string): Promise<boolean>;
  lockTurn(owner: string, episode: Episode, token: string): Promise<boolean>;
  saveTurn(owner: string, episode: Episode, token: string): Promise<void>;
  unlockTurn(owner: string, id: string, token: string): Promise<void>;
}
