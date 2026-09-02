import { z } from "zod";

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema = z.object({}).passthrough();

export const llmProviderSchema = z.enum(["openai", "anthropic", "ollama"]);
export type LlmProvider = z.infer<typeof llmProviderSchema>;
export const DEFAULT_LLM_MODEL = "gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

export const reasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const llmConfigurationRequestSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().trim().min(1).max(128),
  reasoningEffort: reasoningEffortSchema.default("low"),
  /** A blank key deliberately means “keep the existing session key”. */
  apiKey: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1).max(512).optional(),
  ),
}).strict();
export type LlmConfigurationRequest = z.infer<typeof llmConfigurationRequestSchema>;

export const llmConfigurationStatusSchema = z.object({
  provider: llmProviderSchema.nullable(),
  model: z.string().nullable(),
  reasoningEffort: reasoningEffortSchema.nullable(),
  configured: z.boolean(),
}).strict();
export type LlmConfigurationStatus = z.infer<typeof llmConfigurationStatusSchema>;

export const actionMetadataSchema = z.object({
  id: z.string().min(1).max(128),
  description: z.string().max(500),
  zoneKind: z.enum(["pickup", "score"]).optional(),
  zoneTags: z.array(z.string().max(64)).max(32).readonly().optional(),
  zoneIds: z.array(z.string().max(128)).max(64).readonly().optional(),
  zoneGameObjectCount: z.number().int().positive().optional(),
}).strict();
export type LlmActionMetadata = z.infer<typeof actionMetadataSchema>;

export const actionRequestSchema = z.object({
  actionId: z.string().min(1).max(128),
  parameters: z.record(z.string(), jsonValueSchema),
}).strict();
export type LlmActionRequest = z.infer<typeof actionRequestSchema>;

export const strategyPlanSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  actions: z.array(actionRequestSchema).max(32),
}).strict();
export type StrategyPlan = z.infer<typeof strategyPlanSchema>;

export const strategyGenerationRequestSchema = z.object({
  strategy: z.string().trim().min(1).max(4000),
  selectedFeatureIds: z.array(z.string().min(1).max(128)).max(100),
  robotCustomization: jsonObjectSchema,
  decisionContext: jsonObjectSchema,
  enabledActions: z.array(actionMetadataSchema).max(100).default([]),
}).strict();
export type StrategyGenerationRequest = z.infer<typeof strategyGenerationRequestSchema>;

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
}).strict();
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const tokenStatisticsSchema = z.object({
  decisions: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  averageTokensPerDecision: z.number().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative(),
}).strict();
export type TokenStatistics = z.infer<typeof tokenStatisticsSchema>;
/** Public name used by the frontend for one generation or session aggregate. */
export type GenerationStatistics = TokenStatistics;

export const llmStatisticsSchema = z.object({
  latestGeneration: tokenStatisticsSchema.nullable(),
  sessionTotal: tokenStatisticsSchema,
}).strict();
export type LlmStatistics = z.infer<typeof llmStatisticsSchema>;

export const strategyGenerationResponseSchema = z.object({
  plan: strategyPlanSchema,
  usage: tokenUsageSchema,
  statistics: llmStatisticsSchema.optional(),
}).strict();
export type StrategyGenerationResponse = z.infer<typeof strategyGenerationResponseSchema>;

export function isJsonValue(value: unknown): value is JsonValue {
  return jsonValueSchema.safeParse(value).success;
}
