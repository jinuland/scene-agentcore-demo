import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { strictToolSchema } from "./strict-tool-schema";
import { mantleStoryResult } from "./bedrock-mantle";
import { StudioError } from "./store";
import { imageOptionsSchema, responseImageSeed, type ImageOptions } from "./image-options";
import { checkEnglishMediaPrompt, mediaTranslationInstructions, mediaTranslationProfile, needsEnglishMediaPrompt, type MediaPromptKind } from "./media-prompt";

export class ModelOutputError extends StudioError {
  constructor(
    public readonly diagnostics: Array<{
      code: string;
      path: string;
      received?: string;
    }>,
    public readonly usage: { inputTokens: number; outputTokens: number },
  ) {
    super(
      502,
      "모델의 설계 형식이 올바르지 않아 적용하지 않았습니다. 요청을 조정해 다시 제안받을 수 있습니다.",
    );
  }
}

// Only code-owned paths/codes may cross the decoder boundary. Never retain
// model values, JSON parser messages, or arbitrary property names here.
export class ModelTransportError extends Error {
  constructor(public readonly diagnostics: Array<{ code: string; path: string }>) {
    super("Invalid model transport");
  }
}
export class ModelTokenLimitError extends StudioError {
  constructor() {
    super(502, "설계가 너무 길어 생성이 잘렸습니다. 수정 범위를 줄여 다시 요청하세요.");
  }
}

export function configuration() {
  const bearer = !!process.env.AWS_BEARER_TOKEN_BEDROCK;
  const iam =
    process.env.STUDIO_AWS_AUTH === "iam" ||
    !!process.env.AWS_PROFILE ||
    !!process.env.AWS_ACCESS_KEY_ID;
  const imageModel =
    process.env.STUDIO_IMAGE_MODEL_ID || "stability.sd3-5-large-v1:0";
  return {
    configured: bearer || iam,
    auth: bearer
      ? "Bedrock API key"
      : iam
        ? "AWS credential chain (IAM/SSO)"
        : "설정 안 됨",
    model:
      process.env.STUDIO_BEDROCK_MODEL_ID ||
      process.env.CHATBOT_BUILDER_BEDROCK_MODEL_ID ||
      "global.anthropic.claude-sonnet-4-6",
    region:
      process.env.STUDIO_BEDROCK_REGION ||
      process.env.CHATBOT_BUILDER_BEDROCK_REGION ||
      "ap-northeast-2",
    imageModel,
    imageRegion: process.env.STUDIO_IMAGE_REGION || "us-west-2",
    referenceImages: imageModel === "stability.sd3-5-large-v1:0",
  };
}
let activeCalls = 0;
const recentCalls: number[] = [];
async function limit<T>(fn: () => Promise<T>) {
  const now = Date.now();
  while (recentCalls.length && recentCalls[0] < now - 60_000)
    recentCalls.shift();
  // Hosted SCENE already charges a daily API turn quota. Its two-stage turns
  // must not exhaust the editor's twelve-call allowance after six exchanges.
  const minuteLimit = process.env.SCENE_DEMO_RUNTIME === "true" ? 60 : 12;
  if (activeCalls >= 2 || recentCalls.length >= minuteLimit)
    throw new StudioError(
      429,
      "모델 요청이 많습니다. 잠시 후 다시 시도해주세요.",
    );
  activeCalls++;
  recentCalls.push(now);
  try {
    return await fn();
  } finally {
    activeCalls--;
  }
}
function providerError(error: unknown): never {
  if (error instanceof StudioError) throw error;
  const name = error instanceof Error ? error.name : "";
  if (/Abort|Timeout/.test(name))
    throw new StudioError(
      504,
      "Bedrock 응답 시간이 초과되었거나 취소되었습니다. 다시 시도하세요.",
    );
  if (/Credentials|AccessDenied|UnrecognizedClient/.test(name))
    throw new StudioError(
      502,
      "AWS 인증 또는 Bedrock 모델 사용 권한을 확인하세요.",
    );
  throw new StudioError(
    502,
    "Bedrock 호출에 실패했습니다. 모델 ID·리전·호출 한도를 확인하고 다시 시도하세요.",
  );
}
async function bearerRequest(
  region: string,
  model: string,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region))
    throw new StudioError(500, "서버 리전 설정을 확인하세요.");
  const result = await fetch(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    },
  );
  if (!result.ok) {
    if ([401, 403].includes(result.status))
      throw new StudioError(
        502,
        "Bedrock 인증 또는 모델 사용 권한이 없습니다. 서버의 AWS 설정을 확인하세요.",
      );
    if (result.status === 429)
      throw new StudioError(
        429,
        "Bedrock 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
      );
    throw new StudioError(
      502,
      `Bedrock 요청 실패 (${result.status}). 모델 ID와 해당 리전의 지원 여부를 확인하세요.`,
    );
  }
  return result.json();
}
export async function structured<T>(
  schema: z.ZodType<T>,
  system: string,
  input: unknown,
  signal?: AbortSignal,
  maxTokens = 12000,
  decodeToolInput: (raw: unknown) => unknown = (raw) => raw,
  strictTool = false,
  toolSchema: z.ZodType = schema,
  serverModelId?: string,
  chatTransport?: { converseAuto?: boolean; grokJson?: boolean; mantleRegion?: string; thinking?: "disabled" | "adaptive" | "between_tools"; effort?: "low" | "medium" | "high" },
) {
  const config = configuration();
  const modelId = serverModelId ?? config.model;
  if (!config.configured)
    throw new StudioError(
      503,
      "Bedrock 연결이 필요합니다. 연결과 저장 화면에서 설정 방법을 확인하세요.",
    );
  return limit(async () => {
    const abort = AbortSignal.any([
      AbortSignal.timeout(120_000),
      ...(signal ? [signal] : []),
    ]);
    const jsonSchema = z.toJSONSchema(toolSchema);
    delete jsonSchema.$schema;
    const payload = {
      system: [{ text: system + (chatTransport?.converseAuto ? "\n최종 응답은 반드시 story_result 도구를 한 번 호출해 전달한다. 채팅 본문으로 답변을 따로 출력하지 않는다." : "") }],
      messages: [
        { role: "user" as const, content: [{ text: JSON.stringify(input) }] },
      ],
      inferenceConfig: { maxTokens, ...(!chatTransport?.converseAuto && !chatTransport?.grokJson ? { temperature: 0.6 } : {}) },
      ...(chatTransport?.thinking ? { additionalModelRequestFields: { thinking: { type: chatTransport.thinking },
        ...(chatTransport.effort ? { output_config: { effort: chatTransport.effort } } : {}) } } : {}),
      ...(chatTransport?.grokJson ? { additionalModelRequestFields: { reasoning: { effort: "low" } },
        outputConfig: { textFormat: { type: "json_schema", structure: { jsonSchema: { name: "story_result", schema: JSON.stringify(strictToolSchema(jsonSchema)) } } } },
      } : { toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "story_result",
              description: "Validated story workshop output",
              ...(strictTool ? { strict: true } : {}),
              inputSchema: { json: strictTool ? strictToolSchema(jsonSchema) : jsonSchema },
            },
          },
        ],
        toolChoice: chatTransport?.converseAuto ? { auto: {} } : { tool: { name: "story_result" } },
      } }),
    };
    try {
      const response = (
        chatTransport?.mantleRegion
          ? await mantleStoryResult({ region: chatTransport.mantleRegion, modelId, system, input, schema: jsonSchema, maxTokens, signal: abort })
          : process.env.AWS_BEARER_TOKEN_BEDROCK
          ? await bearerRequest(
              config.region,
              modelId,
              "converse",
              payload,
              abort,
            )
          : await new BedrockRuntimeClient({
              region: config.region,
              maxAttempts: 1,
            }).send(
              new ConverseCommand({
                modelId,
                ...payload,
              } as never),
              { abortSignal: abort },
            )
      ) as {
        stopReason?: string;
        output?: {
          message?: {
            content?: Array<{ text?: string; toolUse?: { name: string; input: unknown } }>;
          };
        };
        usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number; reasoningTokens?: number };
      };
      if (response.stopReason === "max_tokens") throw new ModelTokenLimitError();
      let decoded;
      try {
        const content = response.output?.message?.content;
        const raw = chatTransport?.grokJson
          ? JSON.parse(content?.flatMap(part => "text" in part && part.text ? [part.text] : []).join("") ?? "")
          : content?.find((c) => c.toolUse?.name === "story_result")?.toolUse?.input;
        decoded = decodeToolInput(raw);
      }
      catch (error) { throw new ModelOutputError(error instanceof ModelTransportError ? error.diagnostics : [{ code: "invalid_transport", path: "tool.output" }], { inputTokens: Number(response.usage?.inputTokens ?? 0), outputTokens: Number(response.usage?.outputTokens ?? 0) }); }
      const parsed = schema.safeParse(decoded);
      if (!parsed.success)
        throw new ModelOutputError(
          parsed.error.issues.map((i) => ({
            code: i.code,
            received: (() => {
              let v: unknown = decoded;
              for (const key of i.path) {
                v =
                  v && typeof v === "object"
                    ? (v as Record<PropertyKey, unknown>)[key]
                    : undefined;
              }
              return Array.isArray(v)
                ? `array(${v.length})`
                : v === null
                  ? "null"
                  : typeof v;
            })(),
            path: i.path
              .map((s) =>
                typeof s === "number"
                  ? s
                  : /^[A-Za-z_][A-Za-z_0-9]*$/.test(String(s))
                    ? String(s)
                    : "field",
              )
              .join("."),
          })),
          {
            inputTokens: Number(response.usage?.inputTokens ?? 0),
            outputTokens: Number(response.usage?.outputTokens ?? 0),
          },
        );
      return {
        value: parsed.data,
        model: modelId,
        usageReported: response.usage?.inputTokens !== undefined && response.usage?.outputTokens !== undefined,
        usage: {
          inputTokens: Number(response.usage?.inputTokens ?? 0),
          outputTokens: Number(response.usage?.outputTokens ?? 0),
          ...(response.usage?.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: response.usage.cacheReadInputTokens }),
          ...(response.usage?.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: response.usage.cacheWriteInputTokens }),
          ...(response.usage?.reasoningTokens === undefined ? {} : { reasoningTokens: response.usage.reasoningTokens }),
        },
      };
    } catch (e) {
      return providerError(e);
    }
  });
}
export async function englishMediaPrompt(prompt: string, kind: MediaPromptKind, signal?: AbortSignal) {
  const original = prompt.trim();
  if (!needsEnglishMediaPrompt(original)) return original;
  const { region } = configuration();
  const request: Omit<ConverseCommandInput, "modelId"> = {
    system: [{ text: mediaTranslationInstructions(kind) }],
    messages: [{ role: "user", content: [{ text: JSON.stringify({ prompt: original }) }] }],
    inferenceConfig: { maxTokens: kind === "video" ? 225 : 1400, temperature: 0 },
  };
  const abort = AbortSignal.any([AbortSignal.timeout(14000), ...(signal ? [signal] : [])]);
  try {
    const result: ConverseCommandOutput = process.env.AWS_BEARER_TOKEN_BEDROCK
      ? await bearerRequest(region, mediaTranslationProfile, "converse", request, abort)
      : await new BedrockRuntimeClient({ region, maxAttempts: 1 }).send(new ConverseCommand({ modelId: mediaTranslationProfile, ...request }), { abortSignal: abort });
    const candidate = result.output?.message?.content?.map(c => c.text ?? "").join("\n") ?? "";
    const checked = result.stopReason === "end_turn" && checkEnglishMediaPrompt(candidate, kind);
    if (!checked) throw new Error("Unusable media translation");
    if (process.env.STUDIO_AWS_AUTH === "iam") console.info(JSON.stringify({ event: "studio.media.prompt_translated", kind, model: mediaTranslationProfile }));
    return checked;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const diagnostic = ["AccessDeniedException", "ValidationException", "ThrottlingException", "AbortError", "TimeoutError"].includes(name) ? name : "failed";
    if (process.env.STUDIO_AWS_AUTH === "iam") console.warn(JSON.stringify({ event: "studio.media.prompt_translation_failed", kind, reason: diagnostic }));
    throw new StudioError(502, "생성 지시를 번역하지 못해 미디어 모델은 호출하지 않았습니다. 한국어 지시를 확인한 뒤 같은 요청을 다시 확인해 주세요.");
  }
}

export async function imageFromBedrock(
  prompt: string,
  aspectRatio: string,
  reference?: Uint8Array,
  signal?: AbortSignal,
  options: ImageOptions = {},
) {
  const config = configuration();
  if (!config.configured)
    throw new StudioError(503, "Bedrock 연결 설정이 필요합니다.");
  if (reference && !config.referenceImages)
    throw new StudioError(
      400,
      "현재 이미지 모델은 참조 입력을 지원하지 않습니다. SD3.5 모델을 설정하세요.",
    );
  const settings = imageOptionsSchema.safeParse(options);
  if (!settings.success) throw new StudioError(422, "이미지 시드 또는 참조 강도의 범위를 확인하세요.");
  if (config.imageModel !== "stability.sd3-5-large-v1:0" && (settings.data.seed !== undefined || settings.data.referenceStrength !== undefined))
    throw new StudioError(422, "현재 모델에서 생성 설정을 확인할 수 없습니다. SD3.5 모델을 설정하세요.");
  // Validate the real bytes before admitting a paid model call. Never upscale a small reference.
  // Image decoding is only needed by the web image workflow. Keep native Sharp
  // out of the text-only, standalone AgentCore runtime's module initialization.
  const referencePng = reference
    ? await (await import("./raster-image")).prepareBedrockReference(reference)
    : undefined;
  return limit(async () => {
    const abort = AbortSignal.any([
      AbortSignal.timeout(180_000),
      ...(signal ? [signal] : []),
    ]);
    const payload = {
      prompt: config.imageModel === "stability.sd3-5-large-v1:0" ? await englishMediaPrompt(prompt.slice(0, 4000), "image", abort) : prompt.slice(0, 4000),
      output_format: "png",
      ...(config.imageModel === "stability.sd3-5-large-v1:0" ? { seed: settings.data.seed ?? 0 } : {}),
      ...(referencePng
        ? {
            image: referencePng.toString("base64"),
            mode: "image-to-image",
            strength: settings.data.referenceStrength ?? 0.45,
          }
        : { aspect_ratio: aspectRatio }),
    };
    try {
      const raw = process.env.AWS_BEARER_TOKEN_BEDROCK
        ? await bearerRequest(
            config.imageRegion,
            config.imageModel,
            "invoke",
            payload,
            abort,
          )
        : JSON.parse(
            Buffer.from(
              (
                await new BedrockRuntimeClient({
                  region: config.imageRegion,
                  maxAttempts: 1,
                }).send(
                  new InvokeModelCommand({
                    modelId: config.imageModel,
                    contentType: "application/json",
                    accept: "application/json",
                    body: Buffer.from(JSON.stringify(payload)),
                  }),
                  { abortSignal: abort },
                )
              ).body,
            ).toString("utf8"),
          );
      if (raw.finish_reasons?.[0]) {
        const reasons: Record<string, string> = {
          "Filter reason: prompt": "이미지 모델의 안전 정책으로 생성 요청이 차단됐습니다.",
          "Filter reason: output image": "생성 결과가 이미지 모델의 안전 정책으로 차단됐습니다.",
          "Filter reason: input image": "참조 이미지가 이미지 모델의 안전 정책으로 차단됐습니다.",
          "Inference error": "이미지 모델 내부 오류로 생성하지 못했습니다. 자동 재시도하지 않았습니다.",
        };
        throw new StudioError(
          422,
          Object.hasOwn(reasons, raw.finish_reasons[0])
            ? reasons[raw.finish_reasons[0]]
            : "이미지 모델이 생성 요청을 완료하지 못했습니다. 자동 재시도하지 않았습니다.",
        );
      }
      const encoded = raw.images?.[0];
      if (typeof encoded !== "string" || encoded.length > 16_000_000)
        throw new StudioError(
          502,
          "이미지 응답 크기 또는 형식이 올바르지 않습니다.",
        );
      const bytes = Buffer.from(encoded, "base64");
      if (
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new StudioError(502, "모델이 유효한 PNG를 반환하지 않았습니다.");
      const seed = responseImageSeed(raw.seeds?.[0]);
      return { bytes, model: config.imageModel, ...(seed !== undefined ? { seed } : {}) };
    } catch (e) {
      return providerError(e);
    }
  });
}
