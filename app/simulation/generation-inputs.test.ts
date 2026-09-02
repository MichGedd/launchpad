import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ROBOT_CUSTOMIZATION } from "../visualizer/types.ts";
import { NEUTRAL_NAV_GRID } from "./neutral-presentation.ts";
import {
  simulationGenerationInputFingerprint,
  type SimulationGenerationInputs,
} from "./generation-inputs.ts";

const inputs: SimulationGenerationInputs = {
  request: {
    policy: {
      version: 1,
      name: "Fingerprint policy",
      match: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
      endgame: { rules: [], fallback: { goalId: "wait-until-match-end", parameters: {} } },
    },
    selectedFeatureIds: ["drive-planning"],
    robotCustomization: DEFAULT_ROBOT_CUSTOMIZATION,
    navGrid: NEUTRAL_NAV_GRID,
  },
};

test("fingerprints identical simulation inputs identically", () => {
  assert.equal(
    simulationGenerationInputFingerprint(inputs),
    simulationGenerationInputFingerprint(structuredClone(inputs)),
  );
});

test("fingerprint changes when any simulation input changes", () => {
  const changes: readonly SimulationGenerationInputs[] = [
    {
      ...inputs,
      request: { ...inputs.request, policy: { ...inputs.request.policy!, name: "Score first" } },
    },
    { ...inputs, request: { ...inputs.request, selectedFeatureIds: [] } },
    {
      ...inputs,
      request: {
        ...inputs.request,
        robotCustomization: { ...DEFAULT_ROBOT_CUSTOMIZATION, widthFeet: 3 },
      },
    },
    {
      ...inputs,
      request: {
        ...inputs.request,
        navGrid: { ...NEUTRAL_NAV_GRID, zones: [] },
      },
    },
  ];
  const originalFingerprint = simulationGenerationInputFingerprint(inputs);

  for (const changedInputs of changes) {
    assert.notEqual(simulationGenerationInputFingerprint(changedInputs), originalFingerprint);
  }
});

test("fingerprint includes policy edits and only policy-affecting inputs", () => {
  const originalFingerprint = simulationGenerationInputFingerprint(inputs);
  assert.notEqual(
    simulationGenerationInputFingerprint({
      ...inputs,
      request: { ...inputs.request, policy: { ...inputs.request.policy!, name: "Changed" } },
    }),
    originalFingerprint,
  );
});
