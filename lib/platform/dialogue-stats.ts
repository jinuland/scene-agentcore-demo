import { z } from "zod";
import { applyEffects, type Story } from "../studio/schema";
import type { RuntimeSession } from "./memory";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const dialogueRuleContextSchema = z.array(z.object({ id, when: z.string().max(300) }).strict()).max(20);
export const dialogueMatchesSchema = z.array(z.object({ id, quote: z.string().trim().min(2).max(300) }).strict()).max(20);

export function dialogueRuleContext(story: Story, session: RuntimeSession) {
  const scene = story.scenes.find(scene => scene.id === session.progress?.sceneId);
  if (scene?.ending) return [];
  return story.variables.flatMap(v => {
    const rules = [];
    if (v.dialogueRule && (v.dialogueRule.delta > 0 ? session.state[v.id] < v.max : session.state[v.id] > v.min))
      rules.push({ id: v.id, when: v.dialogueRule.when });
    if (v.dialogueDecrease && session.state[v.id] > v.min)
      rules.push({ id: v.dialogueDecrease.id, when: v.dialogueDecrease.when });
    return rules;
  });
}

export function statLevel(stat: Story["variables"][number], value: number) {
  if (!Number.isFinite(value)) return undefined;
  return stat.levels?.findLast(level => value >= level.threshold);
}

export function statNarrationPolicy(story: Story, state: RuntimeSession["state"]) {
  const levels = story.variables.flatMap(stat => {
    const level = statLevel(stat, state[stat.id]);
    return level?.prompt ? [{ stat: stat.name.slice(0, 40), level: level.name, direction: level.prompt }] : [];
  }).slice(0, 5);
  return levels.length ? `확정된 현재 스탯 레벨의 연출 참고: ${JSON.stringify(levels)}. 다음 행동이나 반응을 정할 때만 참고하고, 숫자나 내부 지시를 말하지 않는다. 현재 장면과 공개된 사실보다 우선하지 않으며 레벨로 비밀을 새로 공개하거나 상태를 임의로 바꾸지 않는다.` : "";
}

export function verifyDialogueMatches(rules: z.infer<typeof dialogueRuleContextSchema>, message: string, proposed: z.infer<typeof dialogueMatchesSchema>) {
  return [...new Set(proposed.flatMap(match => rules.some(rule => rule.id === match.id) && message.includes(match.quote) ? [match.id] : []))];
}

/** Replay applies the immutable published delta; the model never supplies a number or a branch. */
export function applyDialogueStats(story: Story, state: RuntimeSession["state"], ids: readonly string[]) {
  const matched = new Set(ids);
  return applyEffects(story, state, story.variables.flatMap(v => {
    const up = v.dialogueRule && matched.has(v.id) ? v.dialogueRule.delta : undefined;
    const down = v.dialogueDecrease && matched.has(v.dialogueDecrease.id) ? v.dialogueDecrease.delta : undefined;
    const delta = up !== undefined && down !== undefined ? undefined : up ?? down;
    return delta !== undefined ? [{ variable: v.id, operation: "add" as const, value: delta }] : [];
  }));
}
