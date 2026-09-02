import { z } from "zod";

import {
  strategyPlanSchema,
  type StrategyGenerationRequest,
  type StrategyPlan,
  tokenUsageSchema,
  type TokenUsage,
  type ReasoningEffort,
} from "./schemas.ts";
import { buildStrategyPrompt } from "./prompt.ts";

export const MAX_OUTPUT_TOKENS = 768;
export const MODEL_TIMEOUT_MILLISECONDS = 30_000;

export interface StrategyModelRequest {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType<StrategyPlan>;
}

export interface StrategyModelResponse {
  readonly output: unknown;
  readonly usage?: unknown;
}

/** The exact provider request/response pair, available only to opt-in diagnostics. */
export interface StrategyModelTrace {
  readonly request: StrategyModelRequest;
  readonly response: StrategyModelResponse | null;
}

export interface StrategyGenerationOptions {
  /** Called with the exact request and response used for this generation. */
  readonly onTrace?: (trace: StrategyModelTrace) => void;
}

export interface StrategyModelRunner {
  generate(request: StrategyModelRequest): Promise<StrategyModelResponse>;
}

export type StrategyModelRunnerFactory = (apiKey: string) => StrategyModelRunner;

export interface StrategyPlannerOptions {
  readonly runnerFactory: StrategyModelRunnerFactory;
}

export interface StrategyPlanningConfiguration {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly apiKey: string;
}

export class StrategyPlanningError extends Error {
  readonly usage: TokenUsage | null;

  constructor(message: string, usage: TokenUsage | null = null) {
    super(message);
    this.name = "StrategyPlanningError";
    this.usage = usage;
  }
}

export class StrategyPlanner {
  readonly #runnerFactory: StrategyModelRunnerFactory;

  constructor(options: StrategyPlannerOptions) {
    this.#runnerFactory = options.runnerFactory;
  }

  async generate(
    configuration: StrategyPlanningConfiguration,
    request: StrategyGenerationRequest,
    options: StrategyGenerationOptions = {},
  ): Promise<{ readonly plan: StrategyPlan; readonly usage: TokenUsage }> {
    const prompts = buildStrategyPrompt(request);
    const modelRequest: StrategyModelRequest = {
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
      system: prompts.system,
      prompt: prompts.prompt,
      schema: strategyPlanSchema,
    };
    let response: StrategyModelResponse;
    try {
      response = await this.#runnerFactory(configuration.apiKey).generate(modelRequest);
    } catch (error) {
      options.onTrace?.({ request: modelRequest, response: null });
      const usage = normalizeTokenUsage(error instanceof Object && "usage" in error
        ? error.usage
        : undefined);
      throw new StrategyPlanningError("The configured LLM could not generate a strategy plan.", usage);
    }

    options.onTrace?.({ request: modelRequest, response });

    const usage = normalizeTokenUsage(response.usage);
    if (!usage) throw new StrategyPlanningError("The LLM response did not include token usage.");
    const parsedPlan = strategyPlanSchema.safeParse(response.output);
    if (!parsedPlan.success) {
      throw new StrategyPlanningError("The LLM returned an invalid strategy plan.", usage);
    }
    const enabledActionIds = new Set(request.enabledActions.map((action) => action.id));
    if (parsedPlan.data.actions.some((action) => !enabledActionIds.has(action.actionId))) {
      throw new StrategyPlanningError("The LLM returned an unavailable action.", usage);
    }
    return { plan: parsedPlan.data, usage };
  }
}

export function normalizeTokenUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const inputTokens = numberOrUndefined(candidate.inputTokens ?? candidate.input_tokens);
  const outputTokens = numberOrUndefined(candidate.outputTokens ?? candidate.output_tokens);
  const totalTokens = numberOrUndefined(candidate.totalTokens ?? candidate.total_tokens);
  const details = candidate.inputTokenDetails ?? candidate.input_tokens_details;
  const detailsRecord = details && typeof details === "object" ? details as Record<string, unknown> : {};
  const cachedInputTokens = numberOrUndefined(
    candidate.cachedInputTokens
      ?? candidate.cached_input_tokens
      ?? detailsRecord.cachedTokens
      ?? detailsRecord.cached_tokens
      ?? detailsRecord.cacheReadTokens,
  ) ?? 0;
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return null;
  return tokenUsageSchema.parse({ inputTokens, outputTokens, totalTokens, cachedInputTokens });
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Production runner. The imports stay server-only and the API key never enters a prompt. */
export function createVercelStrategyRunner(apiKey: string): StrategyModelRunner {
  return {
    async generate(request) {
      const [{ generateText, Output }, { createOpenAI }] = await Promise.all([
        import("ai"),
        import("@ai-sdk/openai"),
      ]);
      const result = await generateText({
        model: createOpenAI({ apiKey })(request.model),
        system: request.system,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        timeout: MODEL_TIMEOUT_MILLISECONDS,
        providerOptions: {
          openai: {
            reasoningEffort: request.reasoningEffort,
            store: false,
          },
        },
      });
      return { output: result.output, usage: result.usage };
    },
  };
}

/** Development-only runner for visually checking the LLM dialogs without a provider call. */
export function createDevelopmentMockStrategyRunner(): StrategyModelRunner {
  return {
    async generate(request) {
      const canDrive = request.prompt.includes('"id":"drive-to"');
      const canCollect = request.prompt.includes('"id":"collect-object"');
      const canScore = request.prompt.includes('"id":"score-object"');
      const holdsGameObject = request.prompt.includes('"inventory":{"game-object":1}');
      // Keep the original one-shot behavior for focused runner tests that do
      // not provide a controller decision context.
      const elapsedMatch = request.prompt.match(/"elapsedSeconds":([0-9]+(?:\.[0-9]+)?)/);
      const elapsedSeconds = elapsedMatch ? Number(elapsedMatch[1]) : null;
      const hasWait = request.prompt.includes('"id":"wait"');
      const actions = elapsedSeconds === null
        ? canDrive
          ? [{ actionId: "drive-to", parameters: { xFeet: 12, yFeet: 6, headingRotations: 0 } }]
          : []
        : elapsedSeconds < 0.5
          ? [
              { actionId: "drive-to", parameters: { xFeet: 18, yFeet: 5, headingRotations: 0 } },
              ...(canCollect ? [{ actionId: "collect-object", parameters: {} }] : []),
            ]
          : elapsedSeconds < 3
            ? [
                { actionId: "drive-to", parameters: { xFeet: 38, yFeet: 18, headingRotations: 0.25 } },
                ...(canScore && holdsGameObject ? [{ actionId: "score-object", parameters: {} }] : []),
                { actionId: "drive-to", parameters: { xFeet: 48, yFeet: 8, headingRotations: 0.875 } },
              ]
            : elapsedSeconds < 8 && canDrive
              ? [
                  { actionId: "drive-to", parameters: { xFeet: 18, yFeet: 5, headingRotations: 0 } },
                  ...(canCollect ? [{ actionId: "collect-object", parameters: {} }] : []),
                  { actionId: "drive-to", parameters: { xFeet: 38, yFeet: 18, headingRotations: 0.25 } },
                  ...(canCollect && canScore ? [{ actionId: "score-object", parameters: {} }] : []),
                ]
              : hasWait
                ? [{ actionId: "wait", parameters: { durationSeconds: 135 } }]
                : canDrive
                  ? [{ actionId: "drive-to", parameters: { xFeet: 48, yFeet: 22, headingRotations: 0 } }]
                  : [];
      return {
        output: {
          summary: `Mock plan ${elapsedSeconds === null ? "generated" : `at ${elapsedSeconds.toFixed(1)} seconds`} locally without contacting OpenAI.`,
          actions,
        },
        usage: {
          inputTokens: 120,
          outputTokens: 24,
          totalTokens: 144,
          cachedInputTokens: 16,
        },
      };
    },
  };
}
