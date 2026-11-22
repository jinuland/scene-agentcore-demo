import { z } from "zod";
import { StudioError } from "../studio/store";

export const dialogueModeSchema = z.enum(["quick", "story", "opus", "nova", "grok", "grok43", "gemma", "gemma26", "gemmae2b", "haiku55", "sonnet5", "sonnet55", "opus55", "opus47", "opus48", "opus5", "gpt6luna", "gpt61sol", "gpt61terra", "gpt6astra"]);
export type DialogueMode = z.infer<typeof dialogueModeSchema>;
export const haikuFoundationModel = "anthropic.claude-haiku-4-5-20251001-v1:0";
export const haikuInferenceProfile = `global.${haikuFoundationModel}`;
export const mantleRegionSchema = z.enum(["us-west-2", "us-east-1", "us-east-2", "eu-central-1"]);
export type MantleRegion = z.infer<typeof mantleRegionSchema>;
export const grok43FoundationModel = "xai.grok-4.3";
export function supportsGrok43Mantle(region: string | undefined) {
  return region === "us-west-2" || region === "us-east-1" || region === "us-east-2";
}
export const gptMantleModels = {
  "openai.gpt-6-luna": "low",
  "openai.gpt-6.1-sol": "low",
  "openai.gpt-6.1-terra": "low",
  "openai.gpt-6-astra": "low",
} as const;
export function gptMantleEffort(modelId: string) {
  return Object.hasOwn(gptMantleModels, modelId) ? gptMantleModels[modelId as keyof typeof gptMantleModels] : undefined;
}
const gemmaModels = [
  ["gemma", "Gemma 4 31B", "google.gemma-4-31b", "Google의 개방형 대화 모델."],
  ["gemma26", "Gemma 4 26B-A4B", "google.gemma-4-26b-a4b", "가볍게 다양한 대화를 이어가요."],
  ["gemmae2b", "Gemma 4 E2B", "google.gemma-4-e2b", "짧고 가벼운 대화에 맞는 소형 모델."],
] as const;
export const isGemmaMantleModel = (modelId: string) => gemmaModels.some(([, , id]) => id === modelId);
type DialogueModel = { id: DialogueMode; label: string; provider: string; description: string; foundationModel: string; modelId: string; maxTokens: number; transport?: "converse-auto" | "grok-json" | "mantle"; legacy?: true };
export const playerDialogueModels: readonly DialogueModel[] = [
  { id: "sonnet5", label: "Claude Sonnet 5", provider: "Anthropic", description: "대사와 이야기 전개를 자연스럽게 이어가요.", foundationModel: "anthropic.claude-sonnet-5", modelId: "global.anthropic.claude-sonnet-5", maxTokens: 2200, transport: "converse-auto" },
  { id: "haiku55", label: "Claude Haiku 5.5", provider: "Anthropic", description: "짧은 대사를 주고받는 데 잘 맞아요.", foundationModel: "anthropic.claude-haiku-5-5", modelId: "global.anthropic.claude-haiku-5-5", maxTokens: 3200, transport: "converse-auto" },
  { id: "sonnet55", label: "Claude Sonnet 5.5", provider: "Anthropic", description: "대사와 장면 전개를 균형 있게 이어가요.", foundationModel: "anthropic.claude-sonnet-5-5", modelId: "global.anthropic.claude-sonnet-5-5", maxTokens: 3000, transport: "converse-auto" },
  { id: "opus55", label: "Claude Opus 5.5", provider: "Anthropic", description: "인물의 감정과 복잡한 장면을 깊게 다뤄요.", foundationModel: "anthropic.claude-opus-5-5", modelId: "global.anthropic.claude-opus-5-5", maxTokens: 3600, transport: "converse-auto" },
  ...([
    ["gpt6luna", "GPT-6 Luna", "가볍고 짧은 대화.", "openai.gpt-6-luna"],
    ["gpt61sol", "GPT-6.1 Sol", "대화와 이야기 전개의 균형.", "openai.gpt-6.1-sol"],
    ["gpt61terra", "GPT-6.1 Terra", "장면 묘사와 자연스러운 문장.", "openai.gpt-6.1-terra"],
    ["gpt6astra", "GPT-6 Astra", "복잡한 맥락을 다루는 대화.", "openai.gpt-6-astra"],
  ] as const).map(([id, label, description, modelId]): DialogueModel => ({
    id, label, provider: "OpenAI", description: description + " 미국 Bedrock 리전에서 처리해요.", foundationModel: modelId, modelId, maxTokens: 4500, transport: "mantle",
  })),
  { id: "opus5", label: "Claude Opus 5", provider: "Anthropic", description: "", foundationModel: "anthropic.claude-opus-5", modelId: "global.anthropic.claude-opus-5", maxTokens: 3200, transport: "converse-auto", legacy: true },
  { id: "opus48", label: "Claude Opus 4.8", provider: "Anthropic", description: "", foundationModel: "anthropic.claude-opus-4-8", modelId: "global.anthropic.claude-opus-4-8", maxTokens: 3000, transport: "converse-auto", legacy: true },
  { id: "opus47", label: "Claude Opus 4.7", provider: "Anthropic", description: "", foundationModel: "anthropic.claude-opus-4-7", modelId: "global.anthropic.claude-opus-4-7", maxTokens: 2800, transport: "converse-auto", legacy: true },
  { id: "quick", label: "Claude Haiku 4.5", provider: "Anthropic", description: "", foundationModel: haikuFoundationModel, modelId: haikuInferenceProfile, maxTokens: 1200, legacy: true },
  { id: "story", label: "Claude Sonnet 4.6", provider: "Anthropic", description: "", foundationModel: "anthropic.claude-sonnet-4-6", modelId: "global.anthropic.claude-sonnet-4-6", maxTokens: 2400, legacy: true },
  { id: "opus", label: "Claude Opus 4.6", provider: "Anthropic", description: "", foundationModel: "anthropic.claude-opus-4-6-v1", modelId: "global.anthropic.claude-opus-4-6-v1", maxTokens: 2600, legacy: true },
  { id: "nova", label: "Amazon Nova 2 Lite", provider: "Amazon", description: "가볍게 다른 말투와 전개를 시도하고 싶을 때.", foundationModel: "amazon.nova-2-lite-v1:0", modelId: "global.amazon.nova-2-lite-v1:0", maxTokens: 1500 },
  { id: "grok", label: "Grok 4.7 · Low", provider: "xAI", description: "낮은 추론 강도. 글로벌 Bedrock 추론을 사용해요.", foundationModel: "xai.grok-4.7", modelId: "global.xai.grok-4.7", maxTokens: 5000, transport: "grok-json" },
  { id: "grok43", label: "Grok 4.3 · None", provider: "xAI", description: "최소 추론 강도(None)를 사용해요. 미국 Bedrock 리전에서 처리해요.", foundationModel: grok43FoundationModel, modelId: grok43FoundationModel, maxTokens: 5000, transport: "mantle" },
  ...gemmaModels.map(([id, label, modelId, description]): DialogueModel => ({
    id, label, provider: "Google", description: description + " 설정된 별도 Bedrock 리전에서 처리해요.", foundationModel: modelId, modelId, maxTokens: 3000, transport: "mantle",
  })),
];
export type PlayerDialogueOption = Pick<typeof playerDialogueModels[number], "id" | "label" | "provider" | "description">;
export function mantleDialogueModels(region: MantleRegion) {
  return playerDialogueModels.filter(m => m.transport === "mantle" && (m.id !== "grok43" || supportsGrok43Mantle(region)) && (!gptMantleEffort(m.modelId) || region === "us-east-1"));
}

function availableDialogueModels() {
  const region = configuredMantleRegion();
  return process.env.STUDIO_MULTI_MODEL_CHAT === "true"
    ? playerDialogueModels.filter(m => m.transport !== "mantle" || (region && mantleDialogueModels(region).includes(m))) : [];
}
// Legacy IDs stay resolvable while already-open players and in-flight turns finish.
export function enabledDialogueModes(): PlayerDialogueOption[] {
  return availableDialogueModels().filter(m => !m.legacy).map(({ id, label, provider, description }) => ({ id, label, provider, description }));
}
function configuredMantleRegion() {
  return mantleRegionSchema.safeParse(process.env.STUDIO_MANTLE_CHAT_REGION).data;
}
export function assertDialogueMode(mode?: DialogueMode) {
  if (mode && !availableDialogueModels().some(option => option.id === mode))
    throw new StudioError(422, "이 서비스에서 해당 대화 모드를 사용할 수 없습니다.");
}
export function dialogueModelSettings(mode?: DialogueMode) {
  assertDialogueMode(mode);
  const option = playerDialogueModels.find(x => x.id === mode);
  return { modelId: option?.modelId, maxTokens: option?.maxTokens ?? 2400,
    converseAuto: option?.transport === "converse-auto", grokJson: option?.transport === "grok-json",
    mantleRegion: option?.transport === "mantle" ? configuredMantleRegion() : undefined };
}
