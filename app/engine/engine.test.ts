import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createSimulation,
  createZoneInteractionAction,
  robotContactsZone,
  shapesIntersect,
  type ActionDefinition,
  type GameDefinition,
  type Pose,
  type RobotConfiguration,
  type Zone,
} from "./index.ts";

const EMPTY_GAME: GameDefinition = { gameObjectTypes: [], zones: [] };

function robot(overrides: Partial<RobotConfiguration> = {}): RobotConfiguration {
  return {
    initialPose: { xFeet: 0, yFeet: 0, headingRotations: 0 },
    totalGameObjectCapacity: 1,
    ...overrides,
  };
}

function drive(xFeet: number, yFeet: number, headingRotations = 0) {
  return { actionId: "drive-to", parameters: { xFeet, yFeet, headingRotations } };
}

function assertClose(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

describe("drive action and simulation timing", () => {
  test("drives A to B to C in the correct amount of simulated time", () => {
    const simulation = createSimulation(EMPTY_GAME, robot(), { recordPlayback: true });
    assert.equal(simulation.queueActions([drive(15, 0), drive(15, 15)]).accepted, true);

    const state = simulation.runUntilDecision();

    assert.equal(state.status, "awaiting-actions");
    assertClose(state.elapsedSeconds, 2);
    assert.deepEqual(state.robot.pose, { xFeet: 15, yFeet: 15, headingRotations: 0 });
    const completions = simulation.exportPlayback()!.events.filter((event) => event.type === "action-completed");
    assertClose(completions[0]!.timeSeconds, 1);
    assertClose(completions[1]!.timeSeconds, 2);
  });

  test("carries unused tick time through actions and a decision request", () => {
    const simulation = createSimulation(EMPTY_GAME, robot());
    simulation.queueActions([drive(1.5, 0)]);
    let state = simulation.advanceOneTick();
    assert.equal(state.status, "awaiting-actions");
    assertClose(state.elapsedSeconds, 0.1);

    simulation.queueActions([drive(3, 0)]);
    state = simulation.advanceOneTick();
    assert.equal(state.status, "awaiting-actions");
    assertClose(state.elapsedSeconds, 0.2);
    assertClose(state.robot.pose.xFeet, 3);
  });

  test("translates and rotates concurrently, using the longer duration", () => {
    const simulation = createSimulation(EMPTY_GAME, robot({ translationSpeedFeetPerSecond: 10 }));
    simulation.queueActions([drive(10, 0, 0.25)]);
    const state = simulation.runUntilDecision();
    assertClose(state.elapsedSeconds, 1);
    assert.deepEqual(state.robot.pose, { xFeet: 10, yFeet: 0, headingRotations: 0.25 });
  });

  test("uses shortest heading wrap, handles zero-distance drives, and clamps targets", () => {
    const simulation = createSimulation(EMPTY_GAME, robot({
      initialPose: { xFeet: 2, yFeet: 3, headingRotations: 0.9 },
    }), { recordPlayback: true });
    simulation.queueActions([drive(2, 3, 0.1), drive(2, 3, 1.1)]);
    const state = simulation.runUntilDecision();
    assertClose(state.elapsedSeconds, 0.2);
    assert.deepEqual(state.robot.pose, { xFeet: 2, yFeet: 3, headingRotations: 0.10000000000000009 });
    const completions = simulation.exportPlayback()!.events.filter((event) => event.type === "action-completed");
    assert.equal(completions.length, 2);
    assertClose(completions[0]!.timeSeconds, 0.2);
    assertClose(completions[1]!.timeSeconds, 0.2);
  });

  test("ends exactly at configured match time and exposes endgame boundaries", () => {
    const game: GameDefinition = {
      ...EMPTY_GAME,
      timing: { durationSeconds: 1, endgameDurationSeconds: 0.4 },
    };
    const simulation = createSimulation(game, robot({ translationSpeedFeetPerSecond: 1 }));
    simulation.queueActions([drive(10, 0)]);
    for (let count = 0; count < 3; count += 1) simulation.advanceOneTick();
    assert.equal(simulation.getDecisionState().endgameActive, true);
    const state = simulation.runUntilDecision();
    assert.equal(state.status, "complete");
    assertClose(state.elapsedSeconds, 1);
    assertClose(state.timeRemainingSeconds, 0);
    assertClose(state.robot.pose.xFeet, 1);
    assert.equal(state.activeAction, null);
    assert.equal(state.decisionReason, "match-complete");
  });

  test("optionally interrupts an active action exactly at the endgame boundary", () => {
    const game: GameDefinition = {
      ...EMPTY_GAME,
      timing: { durationSeconds: 2, endgameDurationSeconds: 1 },
    };
    const simulation = createSimulation(game, robot({ translationSpeedFeetPerSecond: 1 }), {
      tickSeconds: 0.75,
      recordPlayback: true,
      interruptAtEndgameStart: true,
    });
    simulation.queueActions([drive(10, 0), drive(20, 0)]);
    const state = simulation.runUntilDecision();

    assert.equal(state.status, "awaiting-actions");
    assert.equal(state.decisionReason, "endgame-start");
    assertClose(state.elapsedSeconds, 1);
    assertClose(state.timeRemainingSeconds, 1);
    assert.equal(state.endgameActive, true);
    assertClose(state.robot.pose.xFeet, 1);
    assert.equal(state.activeAction, null);
    assert.deepEqual(state.queuedActions, []);

    const playback = simulation.exportPlayback()!;
    const boundaryFrame = playback.frames.find((frame) => frame.timeSeconds === 1);
    assert.equal(boundaryFrame?.status, "awaiting-actions");
    assert.deepEqual(
      playback.events.filter((event) => event.timeSeconds === 1).map((event) => event.type),
      ["action-interrupted", "queued-actions-cleared", "endgame-started"],
    );
  });

  test("keeps boundary crossing behavior disabled by default", () => {
    const simulation = createSimulation({
      ...EMPTY_GAME,
      timing: { durationSeconds: 2, endgameDurationSeconds: 1 },
    }, robot({ translationSpeedFeetPerSecond: 1 }), { tickSeconds: 0.75, recordPlayback: true });
    simulation.queueActions([drive(10, 0)]);
    const state = simulation.runUntilDecision();
    assert.equal(state.status, "complete");
    assert.equal(state.decisionReason, "match-complete");
    assert.equal(simulation.exportPlayback()!.events.some((event) => event.type === "endgame-started"), false);
  });
});

describe("zones, collision, and decision state", () => {
  const pickupZone: Zone = {
    id: "source",
    kind: "pickup",
    tags: ["cone"],
    shape: { type: "circle", center: { xFeet: 4, yFeet: 0 }, radiusFeet: 1 },
  };
  const scoreZone: Zone = {
    id: "goal",
    kind: "score",
    tags: ["cone"],
    shape: {
      type: "rectangle",
      center: { xFeet: 0, yFeet: 0 },
      widthFeet: 1,
      heightFeet: 4,
      headingRotations: 0.125,
    },
  };
  const polygonZone: Zone = {
    id: "triangle",
    kind: "score",
    shape: {
      type: "polygon",
      vertices: [{ xFeet: -1, yFeet: -1 }, { xFeet: 1, yFeet: -1 }, { xFeet: 0, yFeet: 1 }],
    },
  };

  test("detects oriented robot contact with circle, rectangle, and polygon zones", () => {
    const simulation = createSimulation({ gameObjectTypes: [], zones: [] }, robot({
      initialPose: { xFeet: 0, yFeet: 0, headingRotations: 0.125 },
    }));
    const robotState = simulation.getDecisionState().robot;
    assert.equal(robotContactsZone(robotState, scoreZone), true);
    assert.equal(robotContactsZone(robotState, polygonZone), true);
    assert.equal(robotContactsZone(robotState, pickupZone), false);
    assert.equal(shapesIntersect(
      { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 },
      { type: "rectangle", center: { xFeet: 2, yFeet: 0 }, widthFeet: 2, heightFeet: 1 },
    ), true);
  });

  test("finds relevant zones and footprint-to-boundary distances", () => {
    const pickup = createZoneInteractionAction({
      id: "pickup-cone",
      description: "Pickup a cone",
      zone: { kind: "pickup", tags: ["cone"] },
      durationSeconds: 1,
      successProbability: 1,
    });
    const game: GameDefinition = {
      gameObjectTypes: ["cone"],
      zones: [pickupZone, scoreZone],
      actions: [pickup],
      robotFeatures: [{ id: "intake", actionIds: ["pickup-cone"] }],
    };
    const simulation = createSimulation(game, robot({ selectedFeatureIds: ["intake"] }));
    const state = simulation.getDecisionState();
    assert.deepEqual(state.pickupZones.map((zone) => zone.id), ["source"]);
    assert.deepEqual(state.scoreZones, []);
    assertClose(state.distanceToNearestPickupZoneFeet!, 4 - 1 - (28.5 / 12 / 2));
    assert.equal(state.distanceToNearestScoreZoneFeet, null);
  });

  test("exposes only usable matching zone IDs when alternatives remain", () => {
    const pickup = createZoneInteractionAction({
      id: "pickup-cone",
      description: "Pickup a cone",
      zone: { kind: "pickup", tags: ["cone"] },
      durationSeconds: 1,
      successProbability: 1,
    });
    const simulation = createSimulation({
      gameObjectTypes: [],
      zones: [
        { ...pickupZone, id: "empty", initialGameObjectCount: 0 },
        { ...pickupZone, id: "available", initialGameObjectCount: 2 },
      ],
      actions: [pickup],
      robotFeatures: [{ id: "intake", actionIds: [pickup.metadata.id] }],
    }, robot({ selectedFeatureIds: ["intake"] }));

    const state = simulation.getDecisionState();
    assert.deepEqual(state.pickupZones.map((zone) => zone.id), ["available"]);
    assert.deepEqual(state.enabledActions.find((action) => action.id === pickup.metadata.id)?.zoneIds, ["available"]);
  });

  test("accepts zero-capacity score zones and keeps them unavailable", () => {
    const score = createZoneInteractionAction({
      id: "score-cone",
      description: "Score a cone",
      zone: { kind: "score" },
      durationSeconds: 1,
      successProbability: 1,
    });
    const simulation = createSimulation({
      gameObjectTypes: [],
      zones: [{ ...scoreZone, gameObjectCapacity: 0 }],
      actions: [score],
      robotFeatures: [{ id: "scorer", actionIds: [score.metadata.id] }],
    }, robot({ selectedFeatureIds: ["scorer"] }));

    assert.deepEqual(simulation.getDecisionState().scoreZones, []);
    assert.equal(simulation.getDecisionState().enabledActions.some((action) => action.id === score.metadata.id), false);
  });

  test("stops at first swept contact with a narrow obstacle and preserves the queue", () => {
    const obstacle: Zone = {
      id: "thin-wall",
      kind: "non-traversal",
      shape: { type: "rectangle", center: { xFeet: 5, yFeet: 0 }, widthFeet: 0.005, heightFeet: 10 },
    };
    const simulation = createSimulation({ gameObjectTypes: [], zones: [obstacle] }, robot());
    simulation.queueActions([drive(10, 0), drive(0, 10)]);
    const state = simulation.runUntilDecision();
    assert.equal(state.status, "blocked");
    assert.equal(state.block?.code, "non-traversal-zone");
    assert.equal(state.block?.zoneId, "thin-wall");
    assertClose(state.robot.pose.xFeet, 5 - 0.0025 - 28.5 / 12 / 2, 1e-6);
    assert.equal(state.activeAction?.actionId, "drive-to");
    assert.equal(state.queuedActions.length, 1);

    assert.equal(simulation.replaceActions([drive(0, 0)]).accepted, true);
    assert.equal(simulation.runUntilDecision().status, "awaiting-actions");
  });
});

describe("action registration, inventory, and probabilities", () => {
  function interactionGame(successProbability: number): GameDefinition {
    const pickup = createZoneInteractionAction({
      id: "collect-ball",
      description: "Collect one ball",
      zone: { kind: "pickup", zoneIds: ["collection"] },
      durationSeconds: 0.3,
      successProbability,
      inventoryDeltaOnSuccess: { ball: 1 },
      successEventType: "ball-collected",
    });
    return {
      gameObjectTypes: ["ball", "disc"],
      zones: [{
        id: "collection",
        kind: "pickup",
        shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 },
      }],
      actions: [pickup],
      robotFeatures: [{ id: "collector", actionIds: [pickup.metadata.id] }],
    };
  }

  test("validates batches atomically and rejects feature-disabled actions", () => {
    const simulation = createSimulation(interactionGame(1), robot());
    const result = simulation.queueActions([drive(1, 0), { actionId: "collect-ball", parameters: {} }]);
    assert.equal(result.accepted, false);
    assert.equal(result.errors.length, 1);
    assert.equal(simulation.getDecisionState().queuedActions.length, 0);
  });

  test("applies dwell timing and capacity-safe inventory changes", () => {
    const simulation = createSimulation(interactionGame(1), robot({
      selectedFeatureIds: ["collector"],
      totalGameObjectCapacity: 2,
      perObjectCapacity: { ball: 1, disc: 1 },
      inventory: { disc: 1 },
    }), { recordPlayback: true });
    simulation.queueActions([{ actionId: "collect-ball", parameters: {} }]);
    const state = simulation.runUntilDecision();
    assertClose(state.elapsedSeconds, 0.3);
    assert.deepEqual(state.robot.inventory, { disc: 1, ball: 1 });
    assert.equal(simulation.exportPlayback()!.events.some((event) => event.type === "ball-collected"), true);
    assert.equal(simulation.exportPlayback()!.events.some((event) => event.type === "inventory-changed"), true);

    simulation.queueActions([{ actionId: "collect-ball", parameters: {} }]);
    const blocked = simulation.advanceOneTick();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.block!.message, /capacity/);
    assert.equal(blocked.activeAction?.actionId, "collect-ball");
  });

  test("produces reproducible seeded probability outcomes", () => {
    const outcomes = (seed: number): readonly string[] => {
      const simulation = createSimulation(interactionGame(0.5), robot({
        selectedFeatureIds: ["collector"],
        totalGameObjectCapacity: 20,
      }), { seed, recordPlayback: true });
      for (let count = 0; count < 5; count += 1) {
        simulation.queueActions([{ actionId: "collect-ball", parameters: {} }]);
        simulation.runUntilDecision();
      }
      return simulation.exportPlayback()!.events
        .filter((event) => event.type === "ball-collected" || event.type === "zone-interaction-failed")
        .map((event) => event.type);
    };
    assert.deepEqual(outcomes(12345), outcomes(12345));
    assert.notDeepEqual(outcomes(12345), outcomes(67890));
  });

  test("tracks finite pickup and score counts and hides exhausted interactions", () => {
    const collect = createZoneInteractionAction({
      id: "collect-ball",
      description: "Collect one ball",
      zone: { kind: "pickup", zoneIds: ["source"] },
      durationSeconds: 0.1,
      successProbability: 1,
      inventoryDeltaOnSuccess: { ball: 1 },
    });
    const score = createZoneInteractionAction({
      id: "score-ball",
      description: "Score one ball",
      zone: { kind: "score", zoneIds: ["goal"] },
      durationSeconds: 0.1,
      successProbability: 1,
      requiredInventory: { ball: 1 },
      inventoryDeltaOnSuccess: { ball: -1 },
    });
    const simulation = createSimulation({
      gameObjectTypes: ["ball"],
      zones: [
        { id: "source", kind: "pickup", initialGameObjectCount: 1, shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
        { id: "goal", kind: "score", gameObjectCapacity: 1, shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
      ],
      actions: [collect, score],
      robotFeatures: [{ id: "handler", actionIds: [collect.metadata.id, score.metadata.id] }],
    }, robot({ selectedFeatureIds: ["handler"] }), { recordPlayback: true });

    assert.equal(simulation.getDecisionState().pickupZones[0]?.availableGameObjectCount, 1);
    simulation.queueActions([{ actionId: collect.metadata.id, parameters: {} }]);
    let state = simulation.runUntilDecision();
    assert.deepEqual(state.pickupZones, []);
    assert.equal(state.enabledActions.some((action) => action.id === collect.metadata.id), false);
    assert.equal(state.scoreZones[0]?.scoredGameObjectCount, 0);

    simulation.queueActions([{ actionId: collect.metadata.id, parameters: {} }]);
    const depleted = simulation.advanceOneTick();
    assert.equal(depleted.status, "blocked");
    assert.match(depleted.block!.message, /do not have 1 game objects available/);
    simulation.replaceActions([{ actionId: score.metadata.id, parameters: {} }]);
    state = simulation.runUntilDecision();
    assert.deepEqual(state.scoreZones, []);
    assert.equal(state.enabledActions.some((action) => action.id === score.metadata.id), false);
    simulation.queueActions([{ actionId: score.metadata.id, parameters: {} }]);
    const full = simulation.advanceOneTick();
    assert.equal(full.status, "blocked");
    assert.match(full.block!.message, /do not have space for 1 game objects/);
    const finalFrame = simulation.exportPlayback()!.frames.at(-1)!;
    assert.deepEqual(finalFrame.zoneStates, {
      source: { kind: "pickup", availableGameObjectCount: 0 },
      goal: { kind: "score", scoredGameObjectCount: 1 },
    });
  });

  test("keeps unlimited zones usable and does not change failed interactions", () => {
    const failedPickup = createZoneInteractionAction({
      id: "failed-pickup",
      description: "Fail to collect",
      zone: { kind: "pickup" },
      durationSeconds: 0.1,
      successProbability: 0,
    });
    const simulation = createSimulation({
      gameObjectTypes: [],
      zones: [
        { id: "source", kind: "pickup", shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
        { id: "goal", kind: "score", shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
      ],
      actions: [failedPickup],
      robotFeatures: [{ id: "collector", actionIds: [failedPickup.metadata.id] }],
    }, robot({ selectedFeatureIds: ["collector"] }), { recordPlayback: true });

    simulation.queueActions([{ actionId: failedPickup.metadata.id, parameters: {} }]);
    const state = simulation.runUntilDecision();
    assert.equal(state.pickupZones[0]?.availableGameObjectCount, null);
    assert.equal(state.enabledActions.some((action) => action.id === failedPickup.metadata.id), true);
    assert.equal(simulation.exportPlayback()!.events.some((event) => event.type === "zone-game-object-count-changed"), false);
  });

  test("rejects invalid custom zone deltas without partially changing counts", () => {
    const invalidDeltaAction = (id: string, zoneGameObjectDeltas: Readonly<Record<string, number>>): ActionDefinition<Record<string, never>, null> => ({
      metadata: { id, description: "Invalid zone delta", zoneKind: "score", zoneIds: ["goal"] },
      validate: () => ({ valid: true, value: {} }),
      start: () => ({ ready: true, state: null }),
      advance: () => ({ state: null, consumedSeconds: 0.1, complete: true, zoneGameObjectDeltas }),
    });
    const shape = { type: "circle" as const, center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 };
    for (const [delta, message] of [
      [{ goal: 2 }, /exceeded score zone "goal" capacity/],
      [{ missing: 1 }, /unknown game-object zone "missing"/],
    ] as const) {
      const action = invalidDeltaAction("change-zone", delta);
      const simulation = createSimulation({
        gameObjectTypes: [],
        zones: [{ id: "goal", kind: "score", gameObjectCapacity: 1, shape }],
        actions: [action],
        robotFeatures: [{ id: "feature", actionIds: [action.metadata.id] }],
      }, robot({ selectedFeatureIds: ["feature"] }));
      simulation.queueActions([{ actionId: action.metadata.id, parameters: {} }]);
      assert.throws(() => simulation.advanceOneTick(), message);
      assert.equal(simulation.getDecisionState().scoreZones[0]?.scoredGameObjectCount, 0);
    }
  });

  test("recycles multi-object scores into a finite source at the exact delayed time", () => {
    const collect = createZoneInteractionAction({
      id: "collect-one",
      description: "Collect one ball",
      zone: { kind: "pickup", zoneIds: ["source"] },
      durationSeconds: 0.1,
      successProbability: 1,
    });
    const score = createZoneInteractionAction({
      id: "score-two",
      description: "Score two balls",
      zone: { kind: "score", zoneIds: ["goal"] },
      durationSeconds: 0.1,
      successProbability: 1,
      gameObjectCountOnSuccess: 2,
      requiredInventory: { ball: 2 },
      inventoryDeltaOnSuccess: { ball: -2 },
    });
    const wait: ActionDefinition<{ readonly durationSeconds: number }, { readonly elapsedSeconds: number }> = {
      metadata: { id: "wait", description: "Wait" },
      validate: (parameters) => typeof parameters === "object" && parameters !== null && "durationSeconds" in parameters
        && typeof parameters.durationSeconds === "number"
        ? { valid: true, value: { durationSeconds: parameters.durationSeconds } }
        : { valid: false, message: "durationSeconds is required" },
      start: () => ({ ready: true, state: { elapsedSeconds: 0 } }),
      advance: (_context, request, state, availableSeconds) => {
        const consumedSeconds = Math.min(availableSeconds, request.durationSeconds - state.elapsedSeconds);
        const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
        return { state: { elapsedSeconds }, consumedSeconds, complete: elapsedSeconds >= request.durationSeconds };
      },
    };
    const simulation = createSimulation({
      timing: { durationSeconds: 2, endgameDurationSeconds: 0 },
      gameObjectTypes: ["ball"],
      zones: [
        { id: "source", kind: "pickup", initialGameObjectCount: 0, shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
        { id: "goal", kind: "score", shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 } },
      ],
      zoneRecyclingRules: [{ scoreZoneId: "goal", sourceZoneId: "source", delaySeconds: 0.35 }],
      actions: [collect, score, wait],
      robotFeatures: [{ id: "handler", actionIds: [collect.metadata.id, score.metadata.id, wait.metadata.id] }],
    }, robot({
      inventory: { ball: 2 },
      totalGameObjectCapacity: 2,
      selectedFeatureIds: ["handler"],
    }), { recordPlayback: true });

    simulation.queueActions([
      { actionId: score.metadata.id, parameters: {} },
      { actionId: wait.metadata.id, parameters: { durationSeconds: 0.6 } },
    ]);
    const state = simulation.runUntilDecision();
    assert.equal(state.pickupZones[0]?.availableGameObjectCount, 2);
    assert.equal(state.enabledActions.some((action) => action.id === collect.metadata.id), true);
    const playback = simulation.exportPlayback()!;
    const recycled = playback.events.find((event) => event.type === "zone-recycled")!;
    assertClose(recycled.timeSeconds, 0.45);
    const recycleFrame = playback.frames.find((frame) => Math.abs(frame.timeSeconds - 0.45) < 1e-9);
    assert.equal(recycleFrame?.zoneStates.source?.kind, "pickup");
    assert.equal(recycleFrame?.zoneStates.source?.kind === "pickup"
      ? recycleFrame.zoneStates.source.availableGameObjectCount
      : null, 2);
  });

  test("supports a typed custom action lifecycle", () => {
    interface Request { readonly durationSeconds: number }
    interface Runtime { readonly elapsedSeconds: number }
    const waitAction: ActionDefinition<Request, Runtime> = {
      metadata: { id: "wait", description: "Wait" },
      validate(parameters) {
        if (typeof parameters === "object" && parameters !== null && "durationSeconds" in parameters
            && typeof parameters.durationSeconds === "number") {
          return { valid: true, value: { durationSeconds: parameters.durationSeconds } };
        }
        return { valid: false, message: "durationSeconds is required" };
      },
      start: () => ({ ready: true, state: { elapsedSeconds: 0 } }),
      advance(_context, request, state, availableSeconds) {
        const consumedSeconds = Math.min(availableSeconds, request.durationSeconds - state.elapsedSeconds);
        const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
        return { state: { elapsedSeconds }, consumedSeconds, complete: elapsedSeconds >= request.durationSeconds };
      },
    };
    const simulation = createSimulation({
      gameObjectTypes: [], zones: [], actions: [waitAction],
      robotFeatures: [{ id: "timer", actionIds: ["wait"] }],
    }, robot({ selectedFeatureIds: ["timer"] }));
    simulation.queueActions([{ actionId: "wait", parameters: { durationSeconds: 0.35 } }]);
    assertClose(simulation.runUntilDecision().elapsedSeconds, 0.35);
  });

  test("tracks declarative scoring only after a successful interaction", () => {
    const score = createZoneInteractionAction({
      id: "score-ball",
      description: "Score one ball",
      zone: { kind: "score", zoneIds: ["goal"] },
      durationSeconds: 0.2,
      successProbability: 1,
      pointsOnSuccess: 4,
      rankingPointProgressDeltaOnSuccess: { mobility: 0.6 },
    });
    const game: GameDefinition = {
      gameObjectTypes: [],
      zones: [{
        id: "goal",
        kind: "score",
        shape: { type: "circle", center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 },
      }],
      rankingPoints: [{ id: "mobility", label: "Mobility" }],
      actions: [score],
      robotFeatures: [{ id: "scoring", actionIds: [score.metadata.id] }],
    };
    const simulation = createSimulation(game, robot({ selectedFeatureIds: ["scoring"] }), { recordPlayback: true });
    assert.deepEqual(simulation.getDecisionState().metrics, {
      points: 0,
      rankingPoints: { mobility: { progress: 0, earned: false } },
    });
    simulation.queueActions([{ actionId: score.metadata.id, parameters: {} }]);
    const state = simulation.runUntilDecision();
    assert.equal(state.metrics.points, 4);
    assert.deepEqual(state.metrics.rankingPoints.mobility, { progress: 0.6, earned: false });
    const playback = simulation.exportPlayback()!;
    assert.deepEqual(playback.rankingPointDefinitions, [{ id: "mobility", label: "Mobility", value: 1 }]);
    assert.equal(playback.frames.at(-1)!.metrics.points, 4);
    assert.equal(playback.events.some((event) => event.type === "points-changed"), true);
    assert.equal(playback.events.some((event) => event.type === "ranking-point-progress-changed"), true);

    const failedScore = createZoneInteractionAction({
      id: "failed-score",
      description: "Failed score",
      zone: { kind: "score", zoneIds: ["goal"] },
      durationSeconds: 0.2,
      successProbability: 0,
      pointsOnSuccess: 8,
      rankingPointProgressDeltaOnSuccess: { mobility: 1 },
    });
    const failedGame = { ...game, actions: [failedScore], robotFeatures: [{ id: "scoring", actionIds: [failedScore.metadata.id] }] };
    const failedSimulation = createSimulation(failedGame, robot({ selectedFeatureIds: ["scoring"] }), { recordPlayback: true });
    failedSimulation.queueActions([{ actionId: failedScore.metadata.id, parameters: {} }]);
    assert.deepEqual(failedSimulation.runUntilDecision().metrics, {
      points: 0,
      rankingPoints: { mobility: { progress: 0, earned: false } },
    });
  });

  test("clamps ranking-point progress, supports negative points, and rejects invalid telemetry", () => {
    interface RuntimeState { readonly complete: boolean }
    const telemetryAction = (id: string, result: {
      readonly pointsDelta?: number;
      readonly rankingPointProgressDelta?: Readonly<Record<string, number>>;
    }): ActionDefinition<Record<string, never>, RuntimeState> => ({
      metadata: { id, description: "Telemetry" },
      validate: () => ({ valid: true, value: {} }),
      start: () => ({ ready: true, state: { complete: false } }),
      advance: () => ({ ...result, state: { complete: true }, consumedSeconds: 0.1, complete: true }),
    });
    const action = telemetryAction("telemetry-success", { pointsDelta: 3, rankingPointProgressDelta: { bonus: 1.5 } });
    const simulation = createSimulation({
      gameObjectTypes: [],
      zones: [],
      rankingPoints: [{ id: "bonus", label: "Bonus", value: 2 }],
      actions: [action],
      robotFeatures: [{ id: "telemetry", actionIds: [action.metadata.id] }],
    }, robot({ selectedFeatureIds: ["telemetry"] }));
    simulation.queueActions([{ actionId: action.metadata.id, parameters: {} }]);
    assert.deepEqual(simulation.runUntilDecision().metrics, {
      points: 3,
      rankingPoints: { bonus: { progress: 1, earned: true } },
    });

    const negativeProgress = telemetryAction("telemetry-negative-progress", {
      rankingPointProgressDelta: { bonus: -2 },
    });
    const negativeProgressSimulation = createSimulation({
      gameObjectTypes: [],
      zones: [],
      rankingPoints: [{ id: "bonus", label: "Bonus" }],
      actions: [negativeProgress],
      robotFeatures: [{ id: "telemetry", actionIds: [negativeProgress.metadata.id] }],
    }, robot({ selectedFeatureIds: ["telemetry"] }));
    negativeProgressSimulation.queueActions([
      { actionId: negativeProgress.metadata.id, parameters: {} },
    ]);
    assert.deepEqual(negativeProgressSimulation.runUntilDecision().metrics.rankingPoints.bonus, {
      progress: 0,
      earned: false,
    });

    const invalidPoints = telemetryAction("telemetry-invalid-points", { pointsDelta: Number.NaN });
    const invalidSimulation = createSimulation({
      gameObjectTypes: [], zones: [], actions: [invalidPoints],
      robotFeatures: [{ id: "telemetry", actionIds: [invalidPoints.metadata.id] }],
    }, robot({ selectedFeatureIds: ["telemetry"] }));
    invalidSimulation.queueActions([{ actionId: invalidPoints.metadata.id, parameters: {} }]);
    assert.throws(() => invalidSimulation.runUntilDecision(), /non-finite points delta/);

    const unknownRankingPoint = telemetryAction("telemetry-unknown-ranking-point", { rankingPointProgressDelta: { missing: 0.5 } });
    const unknownSimulation = createSimulation({
      gameObjectTypes: [], zones: [], actions: [unknownRankingPoint],
      robotFeatures: [{ id: "telemetry", actionIds: [unknownRankingPoint.metadata.id] }],
    }, robot({ selectedFeatureIds: ["telemetry"] }));
    unknownSimulation.queueActions([{ actionId: unknownRankingPoint.metadata.id, parameters: {} }]);
    assert.throws(() => unknownSimulation.runUntilDecision(), /unknown ranking-point ID/);
  });
});

test("optional playback is detached and deeply immutable", () => {
  const disabled = createSimulation(EMPTY_GAME, robot());
  assert.equal(disabled.exportPlayback(), null);

  const enabled = createSimulation(EMPTY_GAME, robot(), { recordPlayback: true });
  enabled.queueActions([drive(3, 0)]);
  enabled.runUntilDecision();
  const playback = enabled.exportPlayback()!;
  assert.equal(Object.isFrozen(playback), true);
  assert.equal(Object.isFrozen(playback.frames), true);
  assert.equal(Object.isFrozen(playback.frames[0]!.robot.pose), true);

  const metricsPlayback = createSimulation({
    ...EMPTY_GAME,
    rankingPoints: [{ id: "bonus", label: "Bonus" }],
  }, robot(), { recordPlayback: true }).exportPlayback()!;
  assert.equal(Object.isFrozen(metricsPlayback.rankingPointDefinitions), true);
  assert.equal(Object.isFrozen(metricsPlayback.rankingPointDefinitions[0]), true);
  assert.equal(Object.isFrozen(metricsPlayback.frames[0]!.metrics), true);
  assert.equal(Object.isFrozen(metricsPlayback.frames[0]!.metrics.rankingPoints), true);
  assert.equal(Object.isFrozen(metricsPlayback.frames[0]!.metrics.rankingPoints.bonus), true);
});

describe("definition validation", () => {
  const minimalAction: ActionDefinition<Record<string, never>, null> = {
    metadata: { id: "action", description: "An action" },
    validate: () => ({ valid: true, value: {} }),
    start: () => ({ ready: true, state: null }),
    advance: (_context, _request, state, availableSeconds) => ({
      state,
      consumedSeconds: availableSeconds,
      complete: true,
    }),
  };

  test("rejects a non-finite endgame duration", () => {
    assert.throws(() => createSimulation({
      gameObjectTypes: [],
      zones: [],
      timing: { durationSeconds: 135, endgameDurationSeconds: Number.NaN },
    }, robot()), /Endgame duration must be finite/);
  });

  test("rejects invalid zone-interaction probabilities and inventory records at definition creation", () => {
    const configuration = {
      id: "collect",
      description: "Collect",
      zone: { kind: "pickup" as const },
      durationSeconds: 1,
      successProbability: 1,
    };
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      successProbability: Number.NaN,
    }), /probability must be finite/);
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      requiredInventory: { ball: 0.5 },
    }), /required ball inventory must be a non-negative integer/);
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      requiredInventory: { ball: Number.POSITIVE_INFINITY },
    }), /required ball inventory must be a non-negative integer/);
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      inventoryDeltaOnSuccess: { ball: Number.NaN },
    }), /ball inventory delta must be an integer/);
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      inventoryDeltaOnSuccess: { ball: 1.25 },
    }), /ball inventory delta must be an integer/);
    assert.throws(() => createZoneInteractionAction({
      ...configuration,
      gameObjectCountOnSuccess: 0,
    }), /game-object count must be a positive integer/);
  });

  test("rejects invalid zone counts and recycling rules", () => {
    const shape = { type: "circle" as const, center: { xFeet: 0, yFeet: 0 }, radiusFeet: 1 };
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [{ id: "source", kind: "pickup", initialGameObjectCount: -1, shape }],
    }, robot()), /initial game-object count must be a non-negative integer/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [{ id: "goal", kind: "score", gameObjectCapacity: 0.5, shape }],
    }, robot()), /game-object capacity must be a non-negative integer/);

    const zones: GameDefinition["zones"] = [
      { id: "source", kind: "pickup", initialGameObjectCount: 0, shape },
      { id: "unlimited-source", kind: "pickup", shape },
      { id: "goal", kind: "score", shape },
    ];
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones,
      zoneRecyclingRules: [{ scoreZoneId: "missing", sourceZoneId: "source", delaySeconds: 1 }],
    }, robot()), /unknown score zone/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones,
      zoneRecyclingRules: [{ scoreZoneId: "source", sourceZoneId: "goal", delaySeconds: 1 }],
    }, robot()), /must be a score zone/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones,
      zoneRecyclingRules: [{ scoreZoneId: "goal", sourceZoneId: "unlimited-source", delaySeconds: 1 }],
    }, robot()), /must have finite initial inventory/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones,
      zoneRecyclingRules: [{ scoreZoneId: "goal", sourceZoneId: "source", delaySeconds: Number.NaN }],
    }, robot()), /delay must be finite and non-negative/);
  });

  test("rejects empty or duplicate game-object, action, and feature IDs", () => {
    assert.throws(() => createSimulation({ gameObjectTypes: [""], zones: [] }, robot()), /type IDs cannot be empty/);
    assert.throws(() => createSimulation({ gameObjectTypes: ["ball", "ball"], zones: [] }, robot()), /type IDs must be unique/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], actions: [{ ...minimalAction, metadata: { ...minimalAction.metadata, id: "" } }],
    }, robot()), /Action IDs cannot be empty/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], actions: [minimalAction, { ...minimalAction }],
    }, robot()), /Duplicate action ID/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], robotFeatures: [{ id: "", actionIds: [] }],
    }, robot()), /feature IDs cannot be empty/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [],
      robotFeatures: [{ id: "feature", actionIds: [] }, { id: "feature", actionIds: [] }],
    }, robot()), /feature IDs must be unique/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], rankingPoints: [{ id: "", label: "Empty" }],
    }, robot()), /Ranking-point IDs cannot be empty/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], rankingPoints: [
        { id: "bonus", label: "Bonus" }, { id: "bonus", label: "Duplicate" },
      ],
    }, robot()), /Duplicate ranking-point ID/);
    assert.throws(() => createSimulation({
      gameObjectTypes: [], zones: [], rankingPoints: [{ id: "bonus", label: "Bonus", value: Number.NaN }],
    }, robot()), /value must be finite/);
  });

  test("validates action references for unselected features", () => {
    assert.throws(() => createSimulation({
      gameObjectTypes: [],
      zones: [],
      robotFeatures: [{ id: "unselected", actionIds: ["missing-action"] }],
    }, robot()), /references unknown action/);
  });
});
