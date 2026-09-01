import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  actionRequestSchema,
  llmConfigurationRequestSchema,
  llmConfigurationStatusSchema,
  llmProviderSchema,
  strategyGenerationRequestSchema,
  strategyPlanSchema,
} from "./schemas.ts";

describe("LLM schemas", () => {
  test("accepts ChatGPT configuration and preserves blank replacement semantics", () => {
    const result = llmConfigurationRequestSchema.parse({
      provider: "openai",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      apiKey: "",
    });
    assert.equal(result.provider, "openai");
    assert.equal(result.apiKey, undefined);
  });

  test("rejects unknown providers and invalid action parameters", () => {
    assert.equal(llmProviderSchema.safeParse("chatgpt").success, false);
    assert.equal(actionRequestSchema.safeParse({ actionId: "drive-to", parameters: ["not", "json-object"] }).success, false);
  });

  test("validates bounded strategy plans and generation requests", () => {
    const plan = strategyPlanSchema.parse({
      summary: "Collect before scoring.",
      actions: [{ actionId: "collect", parameters: {} }],
    });
    assert.equal(plan.actions.length, 1);
    const request = strategyGenerationRequestSchema.parse({
      strategy: "Collect and score safely.",
      selectedFeatureIds: ["collector"],
      robotCustomization: { translationSpeedFeetPerSecond: 8 },
      decisionContext: { timeRemainingSeconds: 120 },
    });
    assert.deepEqual(request.enabledActions, []);
    assert.equal(llmConfigurationStatusSchema.safeParse({
      provider: "openai",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      configured: false,
    }).success, true);
  });

  test("rejects empty and oversized user strategies", () => {
    const base = {
      selectedFeatureIds: [],
      robotCustomization: {},
      decisionContext: {},
    };
    assert.equal(strategyGenerationRequestSchema.safeParse({ ...base, strategy: "" }).success, false);
    assert.equal(strategyGenerationRequestSchema.safeParse({ ...base, strategy: "x".repeat(4001) }).success, false);
  });
});
