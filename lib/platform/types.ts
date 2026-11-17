import type { Story } from "../studio/schema";
import type { EditOperation } from "./commands";
import type { ProductionBoard } from "./production";
import type { LibraryReuse, LibraryRef } from "./library";

export type TargetKind =
  "world" | "character" | "relationship" | "fact" | "scene" | "ontologyNode" | "ontologyEdge";
export type Selection = { kind: TargetKind; id: string };
export type EditorBinding = {
  libraryRead?: boolean;
  teamSession?: import("./team-sessions").EditorSession;
  id: string;
  workItemId?: string;
  selection: Selection;
  token: string;
  counter: number;
  dirty: boolean;
  connected: boolean;
  expiresAt: string;
};
export type Delta = {
  collectionWasAbsent?: boolean;
  collection: "world" | "characters" | "relationships" | "facts" | "scenes" | "ontologyNodes" | "ontologyEdges";
  id: string;
  field: string;
  before: unknown;
  after: unknown;
};
export type EditEvent = {
  id: string;
  requestId: string;
  actor: "web" | "mcp" | "ai";
  authorSubject?: string;
  proposalId?: string;
  summary: string;
  createdAt: string;
  revision: number;
  deltas: Delta[];
  undoes?: string;
  undoneDeltaIndexes?: number[];
};
export function undoneIndexes(
  event: EditEvent,
  events: EditEvent[],
): Set<number> {
  return new Set(
    events
      .filter((e) => e.undoes === event.id)
      .flatMap((e) => e.undoneDeltaIndexes ?? event.deltas.map((_, i) => i)),
  );
}
export type Source = {
  authorSubject?: string;
  id: string;
  title: string;
  kind: "text" | "link";
  text: string;
  url: string;
  status: "text_saved" | "link_only" | "web_imported";
  createdAt: string;
  provenance?: { parentSourceId: string; requestedUrl: string; finalUrl: string; fetchedAt: string; contentHash: string; textHash: string; bytes: number; mime: string; truncated: boolean; extractor: "html-text/1" };
  libraryOrigin?: LibraryRef & { revision: number };
};
export type SourceImport = { id: string; fingerprint: string; sourceId: string; status: "fetching" | "ready" | "failed"; createdAt: string; expiresAt: string; message: string; resultSourceId?: string };
export type PlatformState = {
  schemaVersion: "platform/1";
  sequence: number;
  mode: "free" | "branch";
  sources: Source[];
  sourceImports?: SourceImport[];
  bindings: EditorBinding[];
  events: EditEvent[];
  proposals?: DesignProposal[];
  worldGraph?: { revision: number; status: "pending" | "ready" | "failed"; hash?: string; checkedAt?: string };
  locks?: FieldLock[];
  designAudit?: Array<{ requestId: string; authorSubject: string; action: "apply" | "reject" | "lock" | "unlock"; targetId: string; deltaIndexes?: number[]; revision: number; createdAt: string }>;
  production?: ProductionBoard;
  libraryReuses?: LibraryReuse[];
  launchCandidates?: import("./launch").LaunchCandidate[];
  teamReleases?: import("./team-releases").TeamReleaseEntry[];
  playerReleases?: import("./team-releases").TeamReleaseEntry[];
};
export type FieldLock = {
  authorSubject?: string;
  selection: Selection;
  field: string;
  createdAt: string;
};
export function lockedField(story: Story, lock: FieldLock): unknown {
  const collections = {
    character: "characters",
    relationship: "relationships",
    fact: "facts",
    scene: "scenes",
    ontologyNode: "ontologyNodes",
    ontologyEdge: "ontologyEdges",
  } as const;
  const entity =
    lock.selection.kind === "world"
      ? story
      : story[collections[lock.selection.kind]]?.find(
          (e) => e.id === lock.selection.id,
        );
  return entity
    ? (entity as unknown as Record<string, unknown>)[lock.field]
    : undefined;
}
export type DesignProposal = {
  authorSubject?: string;
  id: string;
  requestId: string;
  fingerprint: string;
  baseRevision: number;
  reviewRevision: number;
  createdAt: string;
  expiresAt: string;
  selection: Selection;
  scope: "selection" | "world";
  prompt: string;
  sourceIds: string[];
  parentId?: string;
  /** Provisional human changes, never canonical until reviewed and accepted. */
  manualOperations?: EditOperation[];
  manualDeltaCount?: number;
  status: "generating" | "ready" | "failed";
  message: string;
  model?: string;
  diagnostics?: Array<{ code: string; path: string; received?: string }>;
  suggestions: Array<{
    operation: EditOperation;
    reason: string;
    evidence: Array<{ sourceId: string; quote: string }>;
  }>;
  deltas: Delta[];
  applied: number[];
  rejected: number[];
};
export function defaultPlatform(story: Story): PlatformState {
  return {
    schemaVersion: "platform/1",
    sequence: 0,
    mode: story.scenes.length ? "branch" : "free",
    sources: [],
    bindings: [],
    events: [],
  };
}
