import { z } from "zod";

export const agentFailureCode = z.enum(["model_limit", "model_format", "model_provider", "runtime_validation", "runtime_reply"]);
export type AgentFailureCode = z.infer<typeof agentFailureCode>;
export function safeAwsStatus(error: unknown) {
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}
export const safeAwsName = (error: unknown) => {
  const name = (error as { name?: string } | null)?.name;
  return name && new Set(["AbortError", "TimeoutError", "RuntimeClientError", "RuntimeClientErrorException", "InternalServerException", "ThrottlingException", "RetryableConflictException", "ConflictException", "AccessDeniedException", "ValidationException", "ServiceUnavailableException", "ModelTimeoutException", "ModelErrorException"]).has(name) ? name : "other";
};
