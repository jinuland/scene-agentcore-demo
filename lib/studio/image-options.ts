import { z } from "zod";

export const imageSeedSchema = z.number().int().min(0).max(4294967294);
export const referenceStrengthSchema = z.number().finite().min(0).max(1);
export const imageOptionsSchema = z.object({ seed: imageSeedSchema.optional(), referenceStrength: referenceStrengthSchema.optional() }).strict();
export type ImageOptions = z.infer<typeof imageOptionsSchema>;
export type ImageGenerationRecord = {
  requestedSeed: number;
  resolvedSeed?: number;
  mode: "text-to-image" | "image-to-image";
  referenceStrength?: number;
};
export function imageOptionsChanged(before: ImageOptions, after: ImageOptions) {
  return before.seed !== after.seed || before.referenceStrength !== after.referenceStrength;
}
export function responseImageSeed(value: unknown): number | undefined {
  const number = typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : value;
  const parsed = imageSeedSchema.safeParse(number);
  return parsed.success ? parsed.data : undefined;
}
