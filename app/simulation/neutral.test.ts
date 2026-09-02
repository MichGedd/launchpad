import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createNeutralGameDefinition,
  createNeutralVisualizerPreview,
  NEUTRAL_FIELD_PRESENTATION,
  NEUTRAL_INITIAL_POSE,
  NEUTRAL_NAV_GRID,
  NEUTRAL_RANKING_POINT_DEFINITIONS,
  NEUTRAL_ZONES,
  neutralRobotConfiguration,
} from "./index.ts";
import { DEFAULT_ROBOT_CUSTOMIZATION } from "../visualizer/index.ts";

test("neutral preview shares field geometry and ranking data with its engine definition", () => {
  const game = createNeutralGameDefinition();
  const preview = createNeutralVisualizerPreview();

  assert.strictEqual(preview.field, NEUTRAL_FIELD_PRESENTATION);
  assert.strictEqual(preview.zones, NEUTRAL_ZONES);
  assert.strictEqual(preview.zones, game.zones);
  assert.strictEqual(preview.navGrid, NEUTRAL_NAV_GRID);
  assert.strictEqual(preview.navGrid, game.navGrid);
  assert.strictEqual(preview.rankingPointDefinitions, NEUTRAL_RANKING_POINT_DEFINITIONS);
  assert.strictEqual(preview.rankingPointDefinitions, game.rankingPoints);
});

test("neutral preview starts at the default pose with zero metrics and empty inventory", () => {
  const preview = createNeutralVisualizerPreview();
  const robot = preview.initialFrame.robot;

  assert.deepEqual(robot.pose, NEUTRAL_INITIAL_POSE);
  assert.deepEqual(robot.inventory, {});
  assert.deepEqual(robot.perObjectCapacity, { "game-object": 3 });
  assert.equal(robot.totalGameObjectCapacity, 3);
  assert.deepEqual(robot, {
    pose: NEUTRAL_INITIAL_POSE,
    inventory: {},
    totalGameObjectCapacity: 3,
    perObjectCapacity: { "game-object": 3 },
    ...DEFAULT_ROBOT_CUSTOMIZATION,
  });
  assert.deepEqual(preview.initialFrame.metrics, {
    points: 0,
    rankingPoints: {
      collection: { progress: 0, earned: false },
      scoring: { progress: 0, earned: false },
    },
  });
  assert.equal(preview.initialFrame.timeSeconds, 0);
  assert.equal(preview.initialFrame.status, "awaiting-actions");
});

test("neutral robot adapter keeps the shared starting pose", () => {
  assert.deepEqual(neutralRobotConfiguration([]).initialPose, NEUTRAL_INITIAL_POSE);
});
