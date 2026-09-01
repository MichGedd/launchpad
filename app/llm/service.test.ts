import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDevelopmentMockStrategyRunner,
  StrategyPlanner,
  StrategyPlanningError,
  normalizeTokenUsage,
  type StrategyModelRequest,
} from "./service.ts";
import { strategyPlanSchema, type StrategyGenerationRequest } from "./schemas.ts";

const generationRequest: StrategyGenerationRequest = {
  strategy: "Score efficiently.",
  selectedFeatureIds: ["scorer"],
  robotCustomization: {},
  decisionContext: { timeRemainingSeconds: 90 },
  enabledActions: [{ id: "score", description: "Score.", zoneKind: "score" }],
};
const configuration = { model: "custom-model", reasoningEffort: "low" as const, apiKey: "sentinel-api-key" };

test("uses an injected runner, validates output, and records exact usage", async () => {
  let captured: StrategyModelRequest | null = null;
  let receivedKey = "";
  const planner = new StrategyPlanner({
    runnerFactory: (apiKey) => {
      receivedKey = apiKey;
      return {
        generate: async (request) => {
          captured = request;
          return {
            output: { summary: "Score now.", actions: [{ actionId: "score", parameters: {} }] },
            usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, cachedInputTokens: 3 },
          };
        },
      };
    },
  });
  const result = await planner.generate(configuration, generationRequest);
  assert.equal(result.usage.totalTokens, 18);
  assert.equal(result.plan.actions[0]?.actionId, "score");
  assert.equal(receivedKey, "sentinel-api-key");
  const completedRequest = captured as StrategyModelRequest | null;
  assert.ok(completedRequest);
  assert.equal(completedRequest.model, "custom-model");
  assert.equal(completedRequest.reasoningEffort, "low");
  assert.doesNotMatch(`${completedRequest.system}\n${completedRequest.prompt}`, /sentinel-api-key/);
});

test("reports usage-bearing malformed output without leaking provider details", async () => {
  const planner = new StrategyPlanner({
    runnerFactory: () => ({
      generate: async () => ({
        output: { summary: "missing actions" },
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7, cachedInputTokens: 0 },
      }),
    }),
  });
  await assert.rejects(
    planner.generate(configuration, generationRequest),
    (error: unknown) => {
      assert.ok(error instanceof StrategyPlanningError);
      assert.equal(error.usage?.totalTokens, 7);
      assert.doesNotMatch(error.message, /sentinel-api-key|missing actions/);
      return true;
    },
  );
});

test("sanitizes provider failures with no usage", async () => {
  const planner = new StrategyPlanner({
    runnerFactory: () => ({
      generate: async () => { throw new Error("provider secret sentinel-api-key"); },
    }),
  });
  await assert.rejects(
    planner.generate(configuration, generationRequest),
    (error: unknown) => {
      assert.ok(error instanceof StrategyPlanningError);
      assert.equal(error.usage, null);
      assert.doesNotMatch(error.message, /sentinel-api-key/);
      return true;
    },
  );
});

test("normalizes AI SDK and OpenAI usage field names", () => {
  assert.deepEqual(normalizeTokenUsage({
    inputTokens: 8,
    outputTokens: 2,
    totalTokens: 10,
    inputTokenDetails: { cachedTokens: 5 },
  }), { inputTokens: 8, outputTokens: 2, totalTokens: 10, cachedInputTokens: 5 });
  assert.equal(normalizeTokenUsage({ input_tokens: 1, output_tokens: 1 }), null);
});

test("development mock returns deterministic usage without a provider", async () => {
  const response = await createDevelopmentMockStrategyRunner().generate({
    model: "ignored-by-local-mock",
    reasoningEffort: "low",
    system: "trusted instructions",
    prompt: '{"enabledActions":[{"id":"drive-to"}]}',
    schema: strategyPlanSchema,
  });
  assert.deepEqual(response.output, {
    summary: "Mock plan generated locally without contacting OpenAI.",
    actions: [{
      actionId: "drive-to",
      parameters: { xFeet: 12, yFeet: 6, headingRotations: 0 },
    }],
  });
  assert.deepEqual(response.usage, {
    inputTokens: 120,
    outputTokens: 24,
    totalTokens: 144,
    cachedInputTokens: 16,
  });
});
