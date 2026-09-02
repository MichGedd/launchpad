import { z } from "zod";
import type { RobotCustomization } from "../visualizer/types.ts";

const finitePositiveNumber = z.number().finite().positive();

export interface SimulationGenerationRequest {
  readonly strategy: string;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
}

export const simulationGenerationRequestSchema: z.ZodType<SimulationGenerationRequest> = z.object({
  strategy: z.string().trim().min(1).max(4000),
  selectedFeatureIds: z.array(z.string().trim().min(1).max(128)).max(100),
  robotCustomization: z.object({
    widthFeet: finitePositiveNumber,
    lengthFeet: finitePositiveNumber,
    translationSpeedFeetPerSecond: finitePositiveNumber,
    spinSpeedRotationsPerSecond: finitePositiveNumber,
  }).strict(),
}).strict();
