import { z } from "zod";
import { NAV_GRID_CELL_SIZE_INCHES, type NavGridDefinition } from "../engine/types.ts";
import type { RobotCustomization } from "../visualizer/types.ts";

const finitePositiveNumber = z.number().finite().positive();

export interface SimulationGenerationRequest {
  readonly strategy: string;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
  readonly navGrid: NavGridDefinition;
}

const pointSchema = z.object({
  xFeet: z.number().finite(),
  yFeet: z.number().finite(),
}).strict();

const navGridShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    center: pointSchema,
    radiusFeet: finitePositiveNumber,
  }).strict(),
  z.object({
    type: z.literal("rectangle"),
    center: pointSchema,
    widthFeet: finitePositiveNumber,
    heightFeet: finitePositiveNumber,
    headingRotations: z.number().finite().optional(),
  }).strict(),
]);

const traversalRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("general") }).strict(),
  z.object({
    kind: z.literal("feature-specific"),
    requiredFeatureId: z.string().trim().min(1).max(128),
  }).strict(),
]);

export const navGridDefinitionSchema: z.ZodType<NavGridDefinition> = z.object({
  version: z.literal(1),
  seasonId: z.string().trim().min(1).max(128),
  fieldWidthFeet: finitePositiveNumber.max(100),
  fieldHeightFeet: finitePositiveNumber.max(100),
  cellSizeInches: z.literal(NAV_GRID_CELL_SIZE_INCHES),
  zones: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    shape: navGridShapeSchema,
    traversalRule: traversalRuleSchema,
  }).strict()).max(1000),
}).strict();

export const simulationGenerationRequestSchema: z.ZodType<SimulationGenerationRequest> = z.object({
  strategy: z.string().trim().min(1).max(4000),
  selectedFeatureIds: z.array(z.string().trim().min(1).max(128)).max(100),
  robotCustomization: z.object({
    widthFeet: finitePositiveNumber,
    lengthFeet: finitePositiveNumber,
    translationSpeedFeetPerSecond: finitePositiveNumber,
    spinSpeedRotationsPerSecond: finitePositiveNumber,
  }).strict(),
  navGrid: navGridDefinitionSchema,
}).strict();
