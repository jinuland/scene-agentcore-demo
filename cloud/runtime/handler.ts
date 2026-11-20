import { createServer } from "node:http";
import { z } from "zod";
import {
  bedrockRuntimeModel,
  runtimeContextSchema,
  runtimeReplyWithUsageSchema,
  type RuntimeModel,
} from "../../lib/platform/runtime-model";
import { StudioError } from "../../lib/studio/store";
import { rejectCredentials } from "../../lib/platform/commands";
import { ModelOutputError, ModelTokenLimitError } from "../../lib/studio/bedrock";
import { safeAwsName, safeAwsStatus, type AgentFailureCode } from "../../lib/platform/runtime-failure";
import { judgeTurnSignals } from "./dialogue-referee";
import { expressionReply } from "../../lib/platform/expressions";
import { sceneDemoModel } from "./scene-demo-model";
import { sceneNarrativeModel } from "./scene-narrative-model";
import { narrativeContext } from "../../lib/platform/narrative-graph";
const invocation = z
  .object({
    schemaVersion: z.enum(["character-turn/1", "character-turn/2"]),
    context: runtimeContextSchema,
  })
  .strict();
const warmup = z.object({ schemaVersion: z.literal("runtime-warmup/1") }).strict();
export function createRuntimeServer(model: RuntimeModel = bedrockRuntimeModel) {
  return createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.url === "/ping") {
      res.end(JSON.stringify({ status: "Healthy" }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/invocations") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    const abort = new AbortController();
    const started = performance.now();
    let schemaVersion: string | undefined;
    let stage: AgentFailureCode = "runtime_validation";
    req.on("aborted", () => abort.abort());
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 250000)
          throw new StudioError(413, "Invocation exceeds 250KB");
        chunks.push(Buffer.from(chunk));
      }
      let raw;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new StudioError(400, "Invalid JSON");
      }
      if (warmup.safeParse(raw).success) {
        res.end(JSON.stringify({ schemaVersion: "runtime-warmup/1", ready: true }));
        return;
      }
      const input = invocation.parse(raw);
      if (input.schemaVersion === "character-turn/1" && (input.context.entities || input.context.memories.some(m => m.ontology)))
        throw new StudioError(400, "Episode ontology requires character-turn/2");
      if (input.schemaVersion === "character-turn/2" && !input.context.entities)
        throw new StudioError(400, "Episode entities are required");
      rejectCredentials(input);
      schemaVersion = input.schemaVersion;
      stage = "model_provider";
      const referee = model === bedrockRuntimeModel;
      const sceneDemo = referee && process.env.SCENE_DEMO_RUNTIME === "true";
      const generate = sceneDemo ? input.context.narrative ? sceneNarrativeModel : sceneDemoModel : model;
      const { dialogueStatRules: _rules, ...narration } = input.context;
      void _rules;
      // These standalone messages cannot meet an authored action or image rule.
      const quickExchange = sceneDemo && input.context.scene?.id === "opening"
        && /^(?:안녕(?:하세요)?|(?:너\s*)?이름이?\s*(?:뭐니|뭐야|뭔가요|뭐예요|뭐에요))[\s.!?。！?]*$/u.test(input.context.message);
      let refereeMs = 0;
      const judge = async () => {
        if (!referee || quickExchange || input.context.narrative) return;
        const began = performance.now();
        const verdict = await judgeTurnSignals(input.context, abort.signal);
        refereeMs = Math.round(performance.now() - began);
        return verdict;
      };
      const [turn, verdict] = await Promise.all([generate(referee ? narration : input.context, abort.signal), judge()]);
      const posted = referee && verdict ? { ...turn, dialogueStatMatches: verdict.matches } : turn;
      const presented = verdict?.imageKey ? expressionReply(posted.text) : undefined;
      const returned = verdict?.imageKey && presented && !presented.key && !presented.mood && presented.text.length < 5960
        ? { ...posted, text: `[표정:${verdict.imageKey}]\n${presented.text}` } : posted;
      stage = "runtime_reply";
      const { usage, ...value } = runtimeReplyWithUsageSchema.parse(returned);
      const reply = { ...value, ...(input.context.reportUsage && usage ? { usage: sceneDemo ? { ...usage, refereeMs } : usage } : {}) };
      if (input.schemaVersion === "character-turn/1" && reply.memories.some(m => m.ontology))
        throw new StudioError(502, "Legacy reply cannot contain episode ontology");
      rejectCredentials(reply);
      const graphFacts = input.context.narrative && reply.narrativeState
        ? narrativeContext(input.context.narrative.definition, reply.narrativeState).facts : [];
      if (
        reply.usedFactIds.some(
          (id) => !input.context.visibleFacts.some((f) => f.id === id) && !graphFacts.some(f => f.id === id),
        )
      )
        throw new StudioError(502, "Response referenced an unavailable fact");
      res.end(JSON.stringify({ schemaVersion: input.schemaVersion, reply }));
    } catch (error) {
      if (schemaVersion) {
        const code = error instanceof ModelTokenLimitError ? "model_limit" : error instanceof ModelOutputError ? "model_format" : stage;
        console.info(JSON.stringify({ event: "agentcore_turn_failure", code, durationMs: Math.round(performance.now() - started), awsError: safeAwsName(error), awsHttpStatus: safeAwsStatus(error) }));
        // Preserve the application failure across the AWS HTTP bridge without
        // leaking generated text, schema issues, arbitrary error strings or IDs.
        res.end(JSON.stringify({ schemaVersion, error: "Runtime could not produce a usable turn", errorCode: code }));
        return;
      }
      res.statusCode =
        error instanceof StudioError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 502;
      // Never log requests, transcripts, provider exceptions or credentials.
      res.end(
        JSON.stringify({
          error:
            error instanceof StudioError
              ? error.message
              : "Runtime request failed validation or model invocation",
        }),
      );
    }
  });
}
