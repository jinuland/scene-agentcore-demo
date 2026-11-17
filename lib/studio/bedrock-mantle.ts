import { createHash, createHmac, type Hash, type Hmac } from "node:crypto";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { SignatureV4 } from "@smithy/signature-v4";
import { StudioError } from "./store";
import { gptMantleEffort, grok43FoundationModel, isGemmaMantleModel, mantleRegionSchema, supportsGrok43Mantle } from "../platform/dialogue-modes";
import { strictToolSchema } from "./strict-tool-schema";

const bytes = (value: ArrayBuffer | ArrayBufferView) => ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
class Sha256 {
  private readonly hash: Hash | Hmac;
  constructor(secret?: string | ArrayBuffer | ArrayBufferView) {
    this.hash = secret === undefined ? createHash("sha256") : createHmac("sha256", typeof secret === "string" ? secret : bytes(secret));
  }
  update(data: string | ArrayBuffer | ArrayBufferView) {
    if (typeof data === "string") this.hash.update(data);
    else this.hash.update(bytes(data));
  }
  async digest() { return this.hash.digest(); }
}

type MantleOutput = {
    status?: string; incomplete_details?: { reason?: string }; output?: { type?: string; name?: string; arguments?: string }[];
    choices?: { finish_reason?: string; message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number };
      input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
};

export class MantleCapacityError extends StudioError {
  constructor(status: number) {
    super(status === 429 ? 429 : 503, "Bedrock 모델이 일시적으로 혼잡합니다. 잠시 후 다시 시도하세요.");
  }
}

async function mantleRequest(region: string, path: string, body: string, signal: AbortSignal, classifyCapacity = false): Promise<MantleOutput> {
  const hostname = `bedrock-mantle.${region}.api.aws`;
  let headers: Record<string, string> = { host: hostname, "content-type": "application/json" };
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (key && process.env.STUDIO_AWS_AUTH !== "iam") headers.authorization = `Bearer ${key}`;
  else {
    const aws = new BedrockRuntimeClient({ region });
    try {
      const signer = new SignatureV4({ credentials: aws.config.credentials, service: "bedrock-mantle", region, sha256: Sha256 });
      headers = (await signer.sign({ protocol: "https:", hostname, path, method: "POST", headers, body })).headers;
    } finally { aws.destroy(); }
  }
  const res = await fetch(`https://${hostname}${path}`, { method: "POST", headers, body, signal, redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel();
    if (classifyCapacity && (res.status === 429 || res.status === 503)) throw new MantleCapacityError(res.status);
    throw new StudioError(res.status === 429 ? 429 : 502,
      res.status === 429 ? "Bedrock 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요." : "Bedrock Mantle 호출에 실패했습니다. 모델 사용 권한·리전을 확인하세요.");
  }
  return await res.json() as MantleOutput;
}

function mantleUsage(usage: MantleOutput["usage"]) {
  return {
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? usage?.completion_tokens_details?.reasoning_tokens,
    cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens,
  };
}

export async function mantleNarration(options: { region: string; modelId: string; system: string; message: string; signal: AbortSignal; effort: "none" | "high" }) {
  const { region, modelId, system, message, signal, effort } = options;
  if (modelId === grok43FoundationModel ? !supportsGrok43Mantle(region) : !isGemmaMantleModel(modelId) || !mantleRegionSchema.safeParse(region).success)
    throw new StudioError(500, "Bedrock Mantle 서버 모델과 리전 설정을 확인하세요.");
  const output = await mantleRequest(region, "/openai/v1/chat/completions", JSON.stringify({
    model: modelId, stream: false, reasoning_effort: effort,
    max_tokens: effort === "high" ? 1400 : 480,
    messages: [{ role: "system", content: system }, { role: "user", content: message }],
  }), signal, true);
  return { text: output.choices?.[0]?.message?.content,
    complete: output.choices?.[0]?.finish_reason === "stop", usage: mantleUsage(output.usage) };
}

export async function mantleStoryResult(options: { region: string; modelId: string; system: string; input: unknown; schema: object; maxTokens: number; signal: AbortSignal }) {
  const { region, modelId, system, input, schema, maxTokens, signal } = options;
  const grok = modelId === grok43FoundationModel;
  const gptEffort = gptMantleEffort(modelId);
  if (gptEffort ? region !== "us-east-1" : grok ? !supportsGrok43Mantle(region) : !isGemmaMantleModel(modelId) || !mantleRegionSchema.safeParse(region).success)
    throw new StudioError(500, "Bedrock Mantle 서버 모델과 리전 설정을 확인하세요.");
  const path = gptEffort ? "/openai/v1/responses" : "/openai/v1/chat/completions";
  const tool = { name: "story_result", description: "Validated story workshop output", parameters: schema };
  const body = JSON.stringify(gptEffort ? {
    model: modelId, store: false, stream: false, max_output_tokens: maxTokens, reasoning: { effort: gptEffort },
    instructions: system, input: JSON.stringify(input), parallel_tool_calls: false,
    tools: [{ type: "function", ...tool, strict: false }],
    tool_choice: { type: "function", name: tool.name },
  } : {
    model: modelId, stream: false, max_tokens: maxTokens, reasoning_effort: grok ? "none" : "low",
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
    ...(grok ? { response_format: { type: "json_schema", json_schema: { name: "story_result", strict: true, schema: strictToolSchema(schema) } } }
      : { tools: [{ type: "function", function: tool }],
        tool_choice: { type: "function", function: { name: "story_result" } } }),
  });
  const output = await mantleRequest(region, path, body, signal);
  const choice = output.choices?.[0];
  const args = gptEffort
    ? output.status === "completed" ? output.output?.find(item => item.type === "function_call" && item.name === tool.name)?.arguments : undefined
    : grok ? choice?.message?.content : choice?.message?.tool_calls?.find(call => call.function?.name === tool.name)?.function?.arguments;
  let value: unknown;
  try { if (typeof args === "string") value = JSON.parse(args); } catch { /* Shared validator rejects malformed tool arguments. */ }
  return {
    stopReason: choice?.finish_reason === "length" || output.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : choice?.finish_reason,
    output: { message: { content: [{ toolUse: { name: "story_result", input: value } }] } },
    usage: mantleUsage(output.usage),
  };
}
