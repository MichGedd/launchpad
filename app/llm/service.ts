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
  ): Promise<{ readonly plan: StrategyPlan; readonly usage: TokenUsage }> {
    const prompts = buildStrategyPrompt(request);
    let response: StrategyModelResponse;
    try {
      response = await this.#runnerFactory(configuration.apiKey).generate({
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort,
        system: prompts.system,
        prompt: prompts.prompt,
        schema: strategyPlanSchema,
      });
    } catch (error) {
      const usage = normalizeTokenUsage(error instanceof Object && "usage" in error
        ? error.usage
        : undefined);
      throw new StrategyPlanningError("The configured LLM could not generate a strategy plan.", usage);
    }

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
      return {
        output: {
          summary: "Mock plan generated locally without contacting OpenAI.",
          actions: canDrive
            ? [{
                actionId: "drive-to",
                parameters: { xFeet: 12, yFeet: 6, headingRotations: 0 },
              }]
            : [],
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
