import assert from "node:assert/strict";
import { test } from "node:test";

import { createSimulation } from "../engine/index.ts";
import {
  evaluatePolicy,
  type PolicyEvaluationContext,
} from "../policy/index.ts";
import {
  createNeutralGameDefinition,
  createNeutralPolicyCatalog,
  DEFAULT_NEUTRAL_POLICY,
  neutralRobotConfiguration,
  runSimulationWithPolicy,
} from "./index.ts";
import { NEUTRAL_NAV_GRID } from "./neutral-presentation.ts";

const customization = {
  widthFeet: 2.375,
  lengthFeet: 2.375,
  translationSpeedFeetPerSecond: 15,
  spinSpeedRotationsPerSecond: 1,
};

test("neutral policy catalog validates the default policy and deterministically tie-breaks targets", () => {
  const catalog = createNeutralPolicyCatalog();
  assert.equal(catalog.validatePolicy(DEFAULT_NEUTRAL_POLICY).name, DEFAULT_NEUTRAL_POLICY.name);

  const game = {
    ...createNeutralGameDefinition(),
    zones: [
      { id: "zeta", kind: "pickup" as const, tags: ["game-object"], shape: { type: "circle" as const, center: { xFeet: 4, yFeet: 5 }, radiusFeet: 1 } },
      { id: "alpha", kind: "pickup" as const, tags: ["game-object"], shape: { type: "circle" as const, center: { xFeet: 5, yFeet: 6 }, radiusFeet: 1 } },
    ],
    actions: createNeutralGameDefinition().actions,
    robotFeatures: createNeutralGameDefinition().robotFeatures,
    navGrid: undefined,
  };
  const simulation = createSimulation(game, {
    initialPose: { xFeet: 5, yFeet: 5, headingRotations: 0.25 },
    selectedFeatureIds: ["object-intake"],
    totalGameObjectCapacity: 3,
    perObjectCapacity: { "game-object": 3 },
  });
  const policy = {
    version: 1 as const,
    name: "Tie break",
    match: { rules: [], fallback: { goalId: "collect-nearest-object", parameters: {} } },
    endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
  };
  const context: PolicyEvaluationContext = { decision: simulation.getDecisionState(), game };
  const result = evaluatePolicy(policy, "match", context, catalog, { decisionNumber: 1, elapsedSeconds: 0 });
  assert.equal(result.plan.targetId, "alpha");
  assert.deepEqual(result.plan.actions[0]?.parameters, { xFeet: 5, yFeet: 6, headingRotations: 0.25 });

  const alternate = evaluatePolicy(policy, "match", {
    ...context,
    rejectedTargetIds: new Set(["alpha"]),
  }, catalog, { decisionNumber: 2, elapsedSeconds: 0 });
  assert.equal(alternate.plan.targetId, "zeta");
});

test("policy controller reevaluates at the exact endgame boundary with no provider", async () => {
  const policy = {
    version: 1 as const,
    name: "Wait-only policy",
    match: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
    endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
  };
  const result = await runSimulationWithPolicy({
    input: {
      policy,
      selectedFeatureIds: [],
      robotCustomization: customization,
      navGrid: NEUTRAL_NAV_GRID,
    },
  });
  assert.equal(result.scene.playback.frames.at(-1)?.status, "complete");
  assert.ok(result.policyTrace.some((trace) => trace.phase === "endgame"));
  assert.equal(result.scene.playback.events.find((event) => event.type === "endgame-started")?.timeSeconds, 105);
});

test("parking is rejected before endgame and completes terminally during endgame", async () => {
  const preEndgame = createSimulation(createNeutralGameDefinition(), neutralRobotConfiguration(["endgame-parking"]), {
    interruptAtEndgameStart: true,
  });
  assert.equal(preEndgame.queueActions([{ actionId: "park", parameters: {} }]).accepted, true);
  assert.equal(preEndgame.runUntilDecision().status, "blocked");
  assert.equal(preEndgame.getDecisionState().decisionReason, "blocked");

  const result = await runSimulationWithPolicy({
    input: {
      policy: DEFAULT_NEUTRAL_POLICY,
      selectedFeatureIds: ["drive-planning", "object-intake", "goal-scoring", "endgame-parking"],
      robotCustomization: customization,
      navGrid: NEUTRAL_NAV_GRID,
    },
  });
  assert.ok((result.scene.playback.events.find((event) => event.type === "parked")?.timeSeconds ?? 0) > 105);
  assert.equal(result.scene.playback.frames.at(-1)?.timeSeconds, 135);
  assert.equal(result.scene.playback.frames.at(-1)?.metrics.rankingPoints.endgame?.earned, true);
});

test("default policy completes its collection/score cycle and parks at the exact boundary", async () => {
  const input = {
    policy: DEFAULT_NEUTRAL_POLICY,
    selectedFeatureIds: ["drive-planning", "object-intake", "goal-scoring", "endgame-parking"],
    robotCustomization: customization,
    navGrid: NEUTRAL_NAV_GRID,
  };
  const result = await runSimulationWithPolicy({ input, seed: 7 });
  assert.equal(result.scene.playback.frames.at(-1)?.status, "complete");
  assert.equal(result.scene.playback.events.find((event) => event.type === "endgame-started")?.timeSeconds, 105);
  assert.ok(result.policyTrace.some((trace) => trace.goalId === "collect-nearest-object"));
  assert.ok(result.policyTrace.some((trace) => trace.goalId === "score-nearest-object"));
  assert.equal(result.policyTrace.at(-1)?.goalId, "park-for-endgame");

  const waitingPolicy = {
    version: 1 as const,
    name: "Wait-only policy",
    match: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
    endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
  };
  const waiting = await runSimulationWithPolicy({
    input: { ...input, policy: waitingPolicy, selectedFeatureIds: [] },
    seed: 7,
  });
  assert.notEqual(result.scene.playback.frames.at(-1)?.metrics.points, waiting.scene.playback.frames.at(-1)?.metrics.points);
});

test("identical policy inputs and seeds produce byte-equivalent playback and traces", async () => {
  const policy = {
    version: 1 as const,
    name: "Wait-only policy",
    match: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
    endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
  };
  const input = { policy, selectedFeatureIds: [], robotCustomization: customization, navGrid: NEUTRAL_NAV_GRID };
  const first = await runSimulationWithPolicy({ input, seed: 22 });
  const second = await runSimulationWithPolicy({ input, seed: 22 });
  assert.equal(JSON.stringify(first.scene.playback), JSON.stringify(second.scene.playback));
  assert.equal(JSON.stringify(first.policyTrace), JSON.stringify(second.policyTrace));
});

test("an unresolvable configured phase fails instead of spinning", async () => {
  const policy = {
    version: 1 as const,
    name: "Missing intake",
    match: { rules: [], fallback: { goalId: "collect-nearest-object", parameters: {} } },
    endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
  };
  await assert.rejects(() => runSimulationWithPolicy({
    input: { policy, selectedFeatureIds: [], robotCustomization: customization, navGrid: NEUTRAL_NAV_GRID },
  }), /could not resolve/);
});
