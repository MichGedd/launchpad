import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { NavGridDefinition, Zone } from "../engine/types.ts";
import { NAV_GRID_CELL_SIZE_INCHES } from "../engine/types.ts";
import { analyzeNavGridReachability, parseNavGridJson, serializeNavGrid, validateNavGrid } from "./navgrid.ts";

function grid(zones: NavGridDefinition["zones"] = []): NavGridDefinition {
  return { version: 1, seasonId: "test", fieldWidthFeet: 8, fieldHeightFeet: 8, cellSizeInches: NAV_GRID_CELL_SIZE_INCHES, zones };
}

describe("NavGrid persistence and validation", () => {
  test("round trips versioned navigation data", () => {
    const value = grid([{ id: "wall", shape: { type: "circle", center: { xFeet: 4, yFeet: 4 }, radiusFeet: 1 }, traversalRule: { kind: "feature-specific", requiredFeatureId: "arm" } }]);
    const parsed = parseNavGridJson(serializeNavGrid(value), { seasonId: "test", fieldWidthFeet: 8, fieldHeightFeet: 8, featureIds: ["arm"] });
    assert.deepEqual(parsed, value);
  });

  test("rejects wrong fidelity, duplicate IDs, and unknown required features", () => {
    const value = { ...grid([{ id: "wall", shape: { type: "circle", center: { xFeet: 4, yFeet: 4 }, radiusFeet: 1 }, traversalRule: { kind: "feature-specific", requiredFeatureId: "missing" } }, { id: "wall", shape: { type: "rectangle", center: { xFeet: 2, yFeet: 2 }, widthFeet: 1, heightFeet: 1 }, traversalRule: { kind: "general" } }]), cellSizeInches: 1 };
    const result = validateNavGrid(value, { featureIds: ["arm"] });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 3);
  });
});

describe("NavGrid reachability", () => {
  const robot = { widthFeet: 0.5, lengthFeet: 0.5 } as const;
  const score: Zone = { id: "score", kind: "score", shape: { type: "circle", center: { xFeet: 7, yFeet: 7 }, radiusFeet: 0.5 } };

  test("finds a reachable meaningful zone and reports an enclosed one", () => {
    const barrier = { id: "barrier", shape: { type: "rectangle", center: { xFeet: 4, yFeet: 4 }, widthFeet: 7, heightFeet: 0.5 }, traversalRule: { kind: "general" } } as const;
    const reachable = analyzeNavGridReachability(grid(), { xFeet: 1, yFeet: 1, headingRotations: 0 }, robot, [], [score]);
    assert.equal(reachable.startValid, true);
    assert.deepEqual(reachable.unreachableZoneIds, []);
    const blocked = analyzeNavGridReachability(grid([barrier]), { xFeet: 1, yFeet: 1, headingRotations: 0 }, robot, [], [score]);
    assert.deepEqual(blocked.unreachableZoneIds, ["score"]);
  });

  test("feature-specific zones are traversable only with the required feature", () => {
    const gate = { id: "gate", shape: { type: "rectangle", center: { xFeet: 4, yFeet: 4 }, widthFeet: 7, heightFeet: 0.5 }, traversalRule: { kind: "feature-specific", requiredFeatureId: "climb" } } as const;
    const noFeature = analyzeNavGridReachability(grid([gate]), { xFeet: 1, yFeet: 1, headingRotations: 0 }, robot, [], [score]);
    const withFeature = analyzeNavGridReachability(grid([gate]), { xFeet: 1, yFeet: 1, headingRotations: 0 }, robot, ["climb"], [score]);
    assert.deepEqual(noFeature.unreachableZoneIds, ["score"]);
    assert.deepEqual(withFeature.unreachableZoneIds, []);
  });
});
