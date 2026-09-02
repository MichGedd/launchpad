import type { SimulationGenerationRequest } from "./schemas.ts";

/** The configuration values that can change how a simulation is generated. */
/** All current values that can affect a generated simulation. */
export interface SimulationGenerationInputs {
  readonly request: SimulationGenerationRequest;
}

/** Create a stable value for comparing the current inputs with a generated run. */
export function simulationGenerationInputFingerprint(
  inputs: SimulationGenerationInputs,
): string {
  const request = inputs.request;
  return JSON.stringify({
    policy: request.policy,
    selectedFeatureIds: request.selectedFeatureIds,
    robotCustomization: request.robotCustomization,
    navGrid: request.navGrid,
  });
}
