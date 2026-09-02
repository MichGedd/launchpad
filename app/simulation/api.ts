import type { LlmStatistics } from "../llm/schemas.ts";
import type { VisualizerScene } from "../visualizer/types.ts";
import type { SimulationDebugTrace } from "./controller.ts";

/** Browser/server contract for one complete generated simulation. */
export interface SimulationGenerationResponse {
  readonly scene: VisualizerScene;
  readonly statistics?: LlmStatistics;
  /** Present only when the server explicitly enables development diagnostics. */
  readonly debugTrace?: readonly SimulationDebugTrace[];
}
