import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDevelopmentMockStrategyRunner,
  StrategyPlanner,
  type StrategyModelRequest,
} from "../llm/service.ts";
import { createNeutralGameDefinition } from "./neutral.ts";
import {
  runSimulationWithLlm,
  SimulationControllerError,
} from "./controller.ts";

const input = {
  strategy: "Drive a useful route and finish the match.",
  selectedFeatureIds: ["drive-planning", "object-intake", "goal-scoring"],
  robotCustomization: {
    widthFeet: 2.375,
    lengthFeet: 2.375,
    translationSpeedFeetPerSecond: 15,
    spinSpeedRotationsPerSecond: 1,
  },
};
const configuration = { model: "mock-model", reasoningEffort: "low" as const, apiKey: "not-used" };

test("runs the neutral match through multiple LLM decisions and records optional traces", async () => {
  const planner = new StrategyPlanner({ runnerFactory: () => createDevelopmentMockStrategyRunner() });
  const result = await runSimulationWithLlm({ planner, configuration, input, includeDebugTraces: true });

  assert.equal(result.scene.playback.frames.at(-1)?.status, "complete");
  assert.equal(result.scene.playback.frames.at(-1)?.timeSeconds, 135);
  assert.deepEqual(result.debugTrace?.map((trace) => trace.response.actions.length), [2, 3, 4, 1]);
  assert.ok(result.debugTrace?.every((trace) => trace.system.length > 0 && trace.prompt.length > 0));
  const finalFrame = result.scene.playback.frames.at(-1)!;
  assert.equal(finalFrame.metrics.points, 24);
  assert.deepEqual(finalFrame.robot.inventory, { "game-object": 0 });
  assert.equal(finalFrame.metrics.rankingPoints.collection?.earned, true);
  assert.equal(finalFrame.metrics.rankingPoints.scoring?.earned, true);
  assert.equal(result.scene.playback.events.filter((event) => event.type === "object-collected").length, 2);
  assert.equal(result.scene.playback.events.filter((event) => event.type === "object-scored").length, 2);

  const productionResult = await runSimulationWithLlm({ planner, configuration, input });
  assert.equal("debugTrace" in productionResult, false);
});

test("development mock omits pickup and scoring actions when their features are unavailable", async () => {
  const planner = new StrategyPlanner({ runnerFactory: () => createDevelopmentMockStrategyRunner() });
  const result = await runSimulationWithLlm({
    planner,
    configuration,
    input: { ...input, selectedFeatureIds: ["drive-planning", "goal-scoring"] },
    includeDebugTraces: true,
  });

  const actionIds = result.debugTrace?.flatMap((trace) => trace.response.actions.map((action) => action.actionId));
  assert.equal(actionIds?.includes("collect-object"), false);
  assert.equal(actionIds?.includes("score-object"), false);
  assert.equal(result.scene.playback.frames.at(-1)?.status, "complete");
});

test("feeds queue validation back to the LLM and replaces a blocked route", async () => {
  const requests: StrategyModelRequest[] = [];
  let call = 0;
  const planner = new StrategyPlanner({
    runnerFactory: () => ({
      async generate(request) {
        requests.push(request);
        call += 1;
        if (call === 1) {
          return {
            output: { summary: "bad queue", actions: [{ actionId: "drive-to", parameters: { xFeet: "bad" } }] },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
          };
        }
        if (call === 2) {
          return {
            output: { summary: "blocked route", actions: [{ actionId: "drive-to", parameters: { xFeet: 10, yFeet: 0, headingRotations: 0 } }] },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
          };
        }
        return {
          output: {
            summary: "recovery",
            actions: [{
              actionId: "drive-to",
              parameters: call === 3
                ? { xFeet: 0, yFeet: 10, headingRotations: 0 }
                : { xFeet: 10, yFeet: 10, headingRotations: 0 },
            }],
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
        };
      },
    }),
  });
  const result = await runSimulationWithLlm({
    planner,
    configuration,
    input: { ...input, selectedFeatureIds: [] },
    game: {
      ...createNeutralGameDefinition(),
      timing: { durationSeconds: 1, endgameDurationSeconds: 0.2 },
      zones: [{
        id: "obstacle",
        kind: "non-traversal",
        shape: { type: "rectangle", center: { xFeet: 5, yFeet: 0 }, widthFeet: 1, heightFeet: 1 },
      }],
      actions: [],
      robotFeatures: [],
    },
    createRobotConfiguration: () => ({
      initialPose: { xFeet: 0, yFeet: 0, headingRotations: 0 },
      totalGameObjectCapacity: 0,
      widthFeet: 2.375,
      lengthFeet: 2.375,
      translationSpeedFeetPerSecond: 15,
      spinSpeedRotationsPerSecond: 1,
    }),
    includeDebugTraces: true,
  });

  assert.equal(result.scene.playback.frames.at(-1)?.status, "complete");
  assert.match(requests[1]?.prompt ?? "", /action-queue-validation/);
  assert.match(requests[2]?.prompt ?? "", /non-traversal-zone/);
  assert.equal(result.debugTrace?.length, 4);
});

test("rejects an action stream that makes no progress", async () => {
  const planner = new StrategyPlanner({
    runnerFactory: () => ({
      async generate() {
        return {
          output: { summary: "stuck", actions: [{ actionId: "drive-to", parameters: { xFeet: 0, yFeet: 0, headingRotations: 0 } }] },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
        };
      },
    }),
  });
  await assert.rejects(
    runSimulationWithLlm({ planner, configuration, input, maxDecisions: 4 }),
    (error: unknown) => error instanceof SimulationControllerError && /no progress/.test(error.message),
  );
});

test("rejects empty queues and enforces the decision limit", async () => {
  const emptyPlanner = new StrategyPlanner({
    runnerFactory: () => ({
      async generate() {
        return {
          output: { summary: "nothing to do", actions: [] },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
        };
      },
    }),
  });
  await assert.rejects(
    runSimulationWithLlm({ planner: emptyPlanner, configuration, input }),
    (error: unknown) => error instanceof SimulationControllerError && /empty action queue/.test(error.message),
  );

  const shortQueuePlanner = new StrategyPlanner({
    runnerFactory: () => ({
      async generate() {
        return {
          output: {
            summary: "make a little progress",
            actions: [{ actionId: "wait", parameters: { durationSeconds: 0.2 } }],
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 },
        };
      },
    }),
  });
  await assert.rejects(
    runSimulationWithLlm({ planner: shortQueuePlanner, configuration, input, maxDecisions: 2 }),
    (error: unknown) => error instanceof SimulationControllerError && /did not complete within 2/.test(error.message),
  );
});
