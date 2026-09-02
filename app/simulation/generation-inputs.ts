import type { LlmConfigurationStatus } from "../llm/schemas.ts";
import type { SimulationGenerationRequest } from "./schemas.ts";

/** The configuration values that can change how a simulation is generated. */
export type SimulationLlmConfiguration = Pick<
  LlmConfigurationStatus,
  "configured" | "model" | "provider" | "reasoningEffort"
>;

/** All current values that can affect a generated simulation. */
export interface SimulationGenerationInputs {
  readonly request: SimulationGenerationRequest;
  readonly llmConfiguration: SimulationLlmConfiguration | null;
}

/** Create a stable value for comparing the current inputs with a generated run. */
export function simulationGenerationInputFingerprint(
  inputs: SimulationGenerationInputs,
): string {
  return JSON.stringify(inputs);
}
