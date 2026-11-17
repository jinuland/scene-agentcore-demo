import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StudioError } from "../../lib/studio/store";
import type { Episode, SceneStore } from "./scene-store";
import type { Story } from "./stories";

export function sqliteStore(path: string): SceneStore {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS draft (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS episode (id TEXT PRIMARY KEY, owner TEXT NOT NULL, story TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS demo_episodes_owner ON episode(owner, updated DESC);
  `);
  const locks = new Map<string, string>();
  const data = <T>(row?: { data?: unknown }) => typeof row?.data === "string" ? JSON.parse(row.data) as T : undefined;
  return {
    async findDraft(owner, id) {
      return data<Story>(database.prepare("SELECT data FROM draft WHERE id = ? AND owner = ?").get(id, owner));
    },
    async drafts(owner) {
      return database.prepare("SELECT data FROM draft WHERE owner = ? ORDER BY rowid DESC").all(owner).flatMap(row => data<Story>(row) ?? []);
    },
    async putDraft(owner, draft) {
      database.prepare("INSERT INTO draft (id, owner, data) VALUES (?, ?, ?)").run(draft.id, owner, JSON.stringify(draft));
    },
    async sessions(owner) {
      return database.prepare("SELECT id, story FROM episode WHERE owner = ? ORDER BY updated DESC LIMIT 30").all(owner)
        .map(row => ({id: String(row.id), story: String(row.story)}));
    },
    async findEpisode(owner, id) {
      return data<Episode>(database.prepare("SELECT data FROM episode WHERE id = ? AND owner = ?").get(id, owner));
    },
    async putEpisode(owner, episode) {
      database.prepare("INSERT INTO episode (id, owner, story, data, updated) VALUES (?, ?, ?, ?, ?)").run(episode.id, owner, episode.story, JSON.stringify(episode), Date.now());
    },
    async deleteEpisode(owner, id) {
      const deleted = database.prepare("DELETE FROM episode WHERE id = ? AND owner = ?").run(id, owner);
      if (!deleted.changes) return false;
      locks.delete(id);
      return true;
    },
    async lockTurn(owner, episode, token) {
      const row = database.prepare("SELECT data FROM episode WHERE id = ? AND owner = ?").get(episode.id, owner);
      if (locks.has(episode.id) || data<Episode>(row)?.turns.length !== episode.turns.length) return false;
      locks.set(episode.id, token);
      return true;
    },
    async saveTurn(owner, episode, token) {
      if (locks.get(episode.id) !== token) throw new StudioError(409, "회차가 변경됐습니다. 다시 열어 주세요.");
      database.prepare("UPDATE episode SET data = ?, updated = ? WHERE id = ? AND owner = ?").run(JSON.stringify(episode), Date.now(), episode.id, owner);
    },
    async unlockTurn(_owner, id, token) {
      if (locks.get(id) === token) locks.delete(id);
    },
  };
}
