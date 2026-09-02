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
    strategy: "Drive to the scoring zone.",
    selectedFeatureIds: ["drive-planning"],
    robotCustomization: DEFAULT_ROBOT_CUSTOMIZATION,
    navGrid: NEUTRAL_NAV_GRID,
  },
  llmConfiguration: {
    configured: true,
    model: "gpt-5.6-luna",
    provider: "openai",
    reasoningEffort: "low",
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
    { ...inputs, request: { ...inputs.request, strategy: "Score first." } },
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
    {
      ...inputs,
      llmConfiguration: { ...inputs.llmConfiguration!, model: "gpt-5.5" },
    },
  ];
  const originalFingerprint = simulationGenerationInputFingerprint(inputs);

  for (const changedInputs of changes) {
    assert.notEqual(simulationGenerationInputFingerprint(changedInputs), originalFingerprint);
  }
});
