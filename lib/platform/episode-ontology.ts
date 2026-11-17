import { z } from "zod";

const id = z.string().min(1).max(64);
export const episodeEntitySchema = z.object({ id, name: z.string().max(4000), kind: z.enum(["player", "character", "organization", "object", "event", "fact"]) }).strict();
export type EpisodeEntity = z.infer<typeof episodeEntitySchema>;
export const episodeInterpretationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("relationship"), subjectId: id, predicate: z.enum(["trusts", "distrusts", "cooperates_with", "opposes", "protects"]), targetId: id }).strict(),
  z.object({ kind: z.literal("event"), subjectId: id, predicate: z.enum(["encounters", "receives", "gives", "joins", "leaves"]), targetId: id }).strict(),
  z.object({ kind: z.literal("belief"), subjectId: id, predicate: z.enum(["believes", "doubts"]), targetId: id }).strict(),
]);
export type EpisodeInterpretation = z.infer<typeof episodeInterpretationSchema>;
export type EpisodeOntology = EpisodeInterpretation & { version: 1; certainty: "inferred" };
const storedFields = { version: z.literal(1), certainty: z.literal("inferred") };
export const episodeOntologySchema = z.discriminatedUnion("kind", [
  episodeInterpretationSchema.options[0].extend(storedFields),
  episodeInterpretationSchema.options[1].extend(storedFields),
  episodeInterpretationSchema.options[2].extend(storedFields),
]);

// Shape/source/type checks do not prove the semantic truth of a model's
// interpretation. Every annotation stays inferred and scoped to its evidence.
export function validEpisodeInterpretation(raw: unknown, speakerId: string, entities: EpisodeEntity[]): raw is EpisodeInterpretation {
  const parsed = episodeInterpretationSchema.safeParse(raw);
  if (!parsed.success) return false;
  const value = parsed.data, subject = entities.find(e => e.id === value.subjectId), target = entities.find(e => e.id === value.targetId);
  if (value.subjectId !== speakerId || !subject || !target || value.subjectId === value.targetId || !["player", "character"].includes(subject.kind)) return false;
  if (value.kind === "relationship") return ["player", "character", "organization"].includes(target.kind);
  if (value.kind === "belief") return target.kind === "fact";
  if (["receives", "gives"].includes(value.predicate)) return target.kind === "object";
  if (["joins", "leaves"].includes(value.predicate)) return ["organization", "event"].includes(target.kind);
  return ["player", "character"].includes(target.kind);
}
export function storedInterpretation(raw: unknown): EpisodeOntology | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { version, certainty, ...value } = raw as Record<string, unknown>;
  const parsed = episodeInterpretationSchema.safeParse(value);
  return version === 1 && certainty === "inferred" && parsed.success ? { ...parsed.data, version, certainty } : undefined;
}
export const episodePredicateLabels: Record<EpisodeInterpretation["predicate"], string> = {
  trusts: "신뢰한다고 말함", distrusts: "불신한다고 말함", cooperates_with: "협력한다고 말함", opposes: "반대한다고 말함", protects: "보호한다고 말함",
  encounters: "만났다고 말함", receives: "받았다고 말함", gives: "주었다고 말함", joins: "참여했다고 말함", leaves: "떠났다고 말함",
  believes: "믿는다고 말함", doubts: "의심한다고 말함",
};
