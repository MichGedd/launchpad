import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NavGridNavigator, createSimulation, type GameDefinition, type NavGridDefinition } from "./index.ts";

function grid(zones: NavGridDefinition["zones"] = []): NavGridDefinition {
  return {
    version: 1,
    seasonId: "test",
    fieldWidthFeet: 10,
    fieldHeightFeet: 10,
    cellSizeInches: 0.5,
    zones,
  };
}

const smallRobot = { widthFeet: 0.5, lengthFeet: 0.5 };

describe("NavGrid A* navigation", () => {
  test("returns a direct route when unobstructed", () => {
    const navigator = new NavGridNavigator(grid(), smallRobot, [], new Set());
    assert.deepEqual(navigator.findPath({ xFeet: 2, yFeet: 2, headingRotations: 0 }, { xFeet: 8, yFeet: 8, headingRotations: 0 }), [
      { xFeet: 2, yFeet: 2 }, { xFeet: 8, yFeet: 8 },
    ]);
  });

  test("routes around an obstacle and prevents diagonal corner cutting", () => {
    const navigator = new NavGridNavigator(grid([{
      id: "wall",
      shape: { type: "rectangle", center: { xFeet: 5, yFeet: 5 }, widthFeet: 1, heightFeet: 6 },
      traversalRule: { kind: "general" },
    }]), smallRobot, [], new Set());
    const path = navigator.findPath({ xFeet: 2, yFeet: 2, headingRotations: 0 }, { xFeet: 8, yFeet: 2, headingRotations: 0 });
    assert.ok(path);
    assert.ok(path.some((point) => point.yFeet > 8 || point.yFeet < 2));
    assert.equal(path.some((point) => point.xFeet > 4 && point.xFeet < 6 && point.yFeet > 2 && point.yFeet < 8), false);
  });

  test("applies feature-specific traversal rules", () => {
    const navGrid = grid([{
      id: "gate",
      shape: { type: "rectangle", center: { xFeet: 5, yFeet: 5 }, widthFeet: 1, heightFeet: 10 },
      traversalRule: { kind: "feature-specific", requiredFeatureId: "climber" },
    }]);
    const blocked = new NavGridNavigator(navGrid, smallRobot, [], new Set(["climber"]));
    assert.equal(blocked.findPath({ xFeet: 2, yFeet: 5, headingRotations: 0 }, { xFeet: 8, yFeet: 5, headingRotations: 0 }), null);
    const open = new NavGridNavigator(navGrid, smallRobot, ["climber"], new Set(["other", "climber"]));
    assert.deepEqual(open.findPath({ xFeet: 2, yFeet: 5, headingRotations: 0 }, { xFeet: 8, yFeet: 5, headingRotations: 0 }), [
      { xFeet: 2, yFeet: 5 }, { xFeet: 8, yFeet: 5 },
    ]);
  });

  test("blocks before moving and preserves the remaining queue when no route exists", () => {
    const game: GameDefinition = {
      gameObjectTypes: [],
      zones: [],
      navGrid: grid([{
        id: "wall",
        shape: { type: "rectangle", center: { xFeet: 5, yFeet: 5 }, widthFeet: 0.5, heightFeet: 10 },
        traversalRule: { kind: "general" },
      }]),
    };
    const simulation = createSimulation(game, {
      initialPose: { xFeet: 2, yFeet: 5, headingRotations: 0 },
      totalGameObjectCapacity: 0,
      widthFeet: 0.5,
      lengthFeet: 0.5,
    });
    simulation.queueActions([
      { actionId: "drive-to", parameters: { xFeet: 8, yFeet: 5, headingRotations: 0 } },
      { actionId: "drive-to", parameters: { xFeet: 2, yFeet: 2, headingRotations: 0 } },
    ]);
    const state = simulation.runUntilDecision();
    assert.equal(state.block?.code, "path-not-found");
    assert.deepEqual(state.robot.pose, { xFeet: 2, yFeet: 5, headingRotations: 0 });
    assert.equal(state.activeAction?.actionId, "drive-to");
    assert.equal(state.queuedActions.length, 1);
  });
});
