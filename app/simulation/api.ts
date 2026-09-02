import type { VisualizerScene } from "../visualizer/types.ts";
import type { PolicyDefinition, PolicyDecisionTrace } from "../policy/index.ts";

/** Browser/server contract for one complete generated simulation. */
export interface SimulationGenerationResponse {
  readonly scene: VisualizerScene;
  readonly policy: PolicyDefinition;
  readonly decisionCount: number;
  readonly policyTrace: readonly PolicyDecisionTrace[];
}
