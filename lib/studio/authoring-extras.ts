import { z } from "zod";

const line = (limit: number) => z.string().trim().min(1).max(limit);
const trigger = line(40);
const note = z.object({ keyword: trigger, aliases: z.array(trigger).max(4).optional(), text: line(500), openingId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).optional() }).strict();
const example = z.object({ input: line(500), output: line(500) }).strict();
const shortcut = z.object({ name: z.string().trim().regex(/^[a-zA-Z0-9가-힣_-]{1,24}$/), description: z.string().trim().max(60).optional(), message: line(400) }).strict();
export const authoringExtrasSchema = z.object({
  tagline: z.string().trim().max(80),
  description: z.string().trim().max(1000),
  tags: z.array(line(24)).max(10),
  examples: z.array(example).max(3),
  keywords: z.array(note).max(20),
  shortcuts: z.array(shortcut).max(20),
}).strict().refine(value => new Set(value.shortcuts.map(item => normalize(item.name))).size === value.shortcuts.length, "같은 단축어 이름을 두 번 쓸 수 없습니다.");
export type AuthoringExtras = z.infer<typeof authoringExtrasSchema>;
export const emptyAuthoringExtras = (): AuthoringExtras => ({ tagline: "", description: "", tags: [], examples: [], keywords: [], shortcuts: [] });
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

export const authoringGuidanceSchema = z.object({ examples: z.array(example).max(3), matchedNotes: z.array(z.object({ keyword: trigger, text: line(500) }).strict()).max(3) }).strict();

/** Notes are creator-authored player-facing lore, not a secret/reveal system. */
export function authoringGuidance(extras: AuthoringExtras | undefined, message: string, openingId?: string, lastStoryText = "") {
  if (!extras) return undefined;
  const current = normalize(message);
  const prior = normalize(lastStoryText);
  const eligible = extras.keywords.filter(item => !item.openingId || item.openingId === openingId);
  const matches = (item: AuthoringExtras["keywords"][number], input: string) => [item.keyword, ...item.aliases ?? []].some(key => input.includes(normalize(key)));
  const fromPlayer = eligible.filter(item => matches(item, current));
  const matchedNotes = [...fromPlayer, ...eligible.filter(item => !fromPlayer.includes(item) && matches(item, prior))]
    .slice(0, 3).map(({ keyword, text }) => ({ keyword, text }));
  return extras.examples.length || matchedNotes.length ? { examples: extras.examples, matchedNotes } : undefined;
}
export function authoredShortcut(extras: AuthoringExtras | undefined, message: string) {
  const key = /^\/([a-zA-Z0-9가-힣_-]{1,24})$/u.exec(message.trim())?.[1];
  return key ? extras?.shortcuts.find(item => normalize(item.name) === normalize(key)) : undefined;
}
