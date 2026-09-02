import { z } from "zod";
import { NAV_GRID_CELL_SIZE_INCHES, type NavGridDefinition } from "../engine/types.ts";
import type { RobotCustomization } from "../visualizer/types.ts";
import type { PolicyDefinition, JsonValue } from "../policy/index.ts";

const finitePositiveNumber = z.number().finite().positive();

export interface SimulationGenerationRequest {
  readonly policy: PolicyDefinition;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
  readonly navGrid: NavGridDefinition;
}

export type PolicySimulationGenerationRequest = SimulationGenerationRequest;

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

const jsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const policyParametersSchema = z.record(z.string(), jsonValueSchema);
const policyConditionSchema = z.object({
  conditionId: z.string().trim().min(1).max(128),
  parameters: policyParametersSchema,
}).strict();
const policyGoalSchema = z.object({
  goalId: z.string().trim().min(1).max(128),
  parameters: policyParametersSchema,
}).strict();
const policyRuleSchema = z.object({
  id: z.string().min(1).max(128),
  conditions: z.array(policyConditionSchema).max(8),
  goal: policyGoalSchema,
}).strict();
const policyPhaseSchema = z.object({
  rules: z.array(policyRuleSchema).max(32),
  fallback: policyGoalSchema,
}).strict();
export const policyDefinitionSchema: z.ZodType<PolicyDefinition> = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(100),
  match: policyPhaseSchema,
  endgame: policyPhaseSchema,
}).strict();

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

export const simulationGenerationRequestSchema: z.ZodType<PolicySimulationGenerationRequest> = z.object({
  policy: policyDefinitionSchema,
  selectedFeatureIds: z.array(z.string().trim().min(1).max(128)).max(100),
  robotCustomization: z.object({
    widthFeet: finitePositiveNumber,
    lengthFeet: finitePositiveNumber,
    translationSpeedFeetPerSecond: finitePositiveNumber,
    spinSpeedRotationsPerSecond: finitePositiveNumber,
  }).strict(),
  navGrid: navGridDefinitionSchema,
}).strict();
