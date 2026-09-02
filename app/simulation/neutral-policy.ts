import { robotDistanceToZone } from "../engine/geometry.ts";
import type {
  ActionMetadata,
  Point,
  Pose,
  Zone,
} from "../engine/types.ts";
import {
  PolicyCatalog,
  type GoalPlan,
  type PolicyConditionDefinition,
  type PolicyDefinition,
  type PolicyEvaluationContext,
  type PolicyGoalDefinition,
  type PolicyParameters,
  type ValidationResult,
} from "../policy/index.ts";
import { ENDGAME_PARKING_ACTION_ID } from "./neutral.ts";

export const COLLECT_NEAREST_OBJECT_GOAL_ID = "collect-nearest-object";
export const SCORE_NEAREST_OBJECT_GOAL_ID = "score-nearest-object";
export const PARK_FOR_ENDGAME_GOAL_ID = "park-for-endgame";
export const WAIT_UNTIL_MATCH_END_GOAL_ID = "wait-until-match-end";

interface EmptyRequest { readonly kind?: never }
interface InventoryAtLeastRequest { readonly objectType: string; readonly count: number }
interface InventoryTotalAtMostRequest { readonly count: number }
interface TimeRemainingAtMostRequest { readonly seconds: number }
interface PointsAtLeastRequest { readonly points: number }

type NeutralPolicyRequest = EmptyRequest
  | InventoryAtLeastRequest
  | InventoryTotalAtMostRequest
  | TimeRemainingAtMostRequest
  | PointsAtLeastRequest;

export type NeutralPolicyContext = PolicyEvaluationContext;

const emptyRequest: EmptyRequest = {};

function objectParameters(parameters: unknown): PolicyParameters | null {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) return null;
  return parameters as PolicyParameters;
}

function exactKeys(parameters: PolicyParameters, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(parameters).length === expected.size && Object.keys(parameters).every((key) => expected.has(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateEmpty(parameters: unknown): ValidationResult<NeutralPolicyRequest> {
  const object = objectParameters(parameters);
  return object && Object.keys(object).length === 0
    ? { valid: true, value: emptyRequest }
    : { valid: false, message: "Parameters must be an empty object." };
}

function validateInventoryAtLeast(parameters: unknown): ValidationResult<NeutralPolicyRequest> {
  const object = objectParameters(parameters);
  if (!object || !exactKeys(object, ["objectType", "count"])) {
    return { valid: false, message: "Parameters must include objectType and count." };
  }
  if (typeof object.objectType !== "string" || object.objectType.length < 1 || object.objectType.length > 128) {
    return { valid: false, message: "objectType must be a 1-128 character string." };
  }
  if (!nonNegativeInteger(object.count)) return { valid: false, message: "count must be a non-negative integer." };
  return { valid: true, value: { objectType: object.objectType, count: object.count } };
}

function validateInventoryTotalAtMost(parameters: unknown): ValidationResult<NeutralPolicyRequest> {
  const object = objectParameters(parameters);
  if (!object || !exactKeys(object, ["count"])) return { valid: false, message: "Parameters must include count." };
  if (!nonNegativeInteger(object.count)) return { valid: false, message: "count must be a non-negative integer." };
  return { valid: true, value: { count: object.count } };
}

function validateTimeRemainingAtMost(parameters: unknown): ValidationResult<NeutralPolicyRequest> {
  const object = objectParameters(parameters);
  if (!object || !exactKeys(object, ["seconds"])) return { valid: false, message: "Parameters must include seconds." };
  if (!finiteNumber(object.seconds) || object.seconds < 0) return { valid: false, message: "seconds must be non-negative." };
  return { valid: true, value: { seconds: object.seconds } };
}

function validatePointsAtLeast(parameters: unknown): ValidationResult<NeutralPolicyRequest> {
  const object = objectParameters(parameters);
  if (!object || !exactKeys(object, ["points"])) return { valid: false, message: "Parameters must include points." };
  if (!finiteNumber(object.points)) return { valid: false, message: "points must be finite." };
  return { valid: true, value: { points: object.points } };
}

const alwaysCondition: PolicyConditionDefinition<NeutralPolicyRequest> = {
  id: "always",
  label: "Always",
  description: "Always matches.",
  validate: validateEmpty,
  evaluate: () => ({ matched: true, explanation: "Always matches." }),
};

const inventoryAtLeastCondition: PolicyConditionDefinition<NeutralPolicyRequest> = {
  id: "inventory-at-least",
  label: "Inventory at least",
  description: "Matches when the robot holds at least the requested number of objects.",
  validate: validateInventoryAtLeast,
  evaluate(context, request) {
    const candidate = request as InventoryAtLeastRequest;
    const count = context.decision.robot.inventory[candidate.objectType] ?? 0;
    const matched = count >= candidate.count;
    return { matched, explanation: matched
      ? `Robot holds ${count} ${candidate.objectType}; required ${candidate.count}.`
      : `Robot holds ${count} ${candidate.objectType}; required ${candidate.count}.` };
  },
};

const inventoryTotalAtMostCondition: PolicyConditionDefinition<NeutralPolicyRequest> = {
  id: "inventory-total-at-most",
  label: "Inventory total at most",
  description: "Matches when total carried objects do not exceed a limit.",
  validate: validateInventoryTotalAtMost,
  evaluate(context, request) {
    const candidate = request as InventoryTotalAtMostRequest;
    const total = Object.values(context.decision.robot.inventory).reduce((sum, count) => sum + count, 0);
    const matched = total <= candidate.count;
    return { matched, explanation: `Robot carries ${total} objects; maximum is ${candidate.count}.` };
  },
};

const timeRemainingAtMostCondition: PolicyConditionDefinition<NeutralPolicyRequest> = {
  id: "time-remaining-at-most",
  label: "Time remaining at most",
  description: "Matches during the final requested number of seconds.",
  validate: validateTimeRemainingAtMost,
  evaluate(context, request) {
    const candidate = request as TimeRemainingAtMostRequest;
    const remaining = context.decision.timeRemainingSeconds;
    const matched = remaining <= candidate.seconds;
    return { matched, explanation: `${remaining} seconds remain; threshold is ${candidate.seconds}.` };
  },
};

const pointsAtLeastCondition: PolicyConditionDefinition<NeutralPolicyRequest> = {
  id: "points-at-least",
  label: "Points at least",
  description: "Matches when the robot has reached a point threshold.",
  validate: validatePointsAtLeast,
  evaluate(context, request) {
    const candidate = request as PointsAtLeastRequest;
    const points = context.decision.metrics.points;
    const matched = points >= candidate.points;
    return { matched, explanation: `${points} points scored; threshold is ${candidate.points}.` };
  },
};

const conditions: readonly PolicyConditionDefinition<NeutralPolicyRequest>[] = [
  alwaysCondition,
  inventoryAtLeastCondition,
  inventoryTotalAtMostCondition,
  timeRemainingAtMostCondition,
  pointsAtLeastCondition,
];

function zoneCenter(zone: Zone): Point {
  if (zone.shape.type === "polygon") {
    const totals = zone.shape.vertices.reduce((total, vertex) => ({
      xFeet: total.xFeet + vertex.xFeet,
      yFeet: total.yFeet + vertex.yFeet,
    }), { xFeet: 0, yFeet: 0 });
    return { xFeet: totals.xFeet / zone.shape.vertices.length, yFeet: totals.yFeet / zone.shape.vertices.length };
  }
  return zone.shape.center;
}

function zoneInteractionPose(context: NeutralPolicyContext, zone: Zone): Pose {
  return { ...zoneCenter(zone), headingRotations: context.decision.robot.pose.headingRotations };
}

function actionFor(context: NeutralPolicyContext, actionId: string): ActionMetadata | null {
  return context.decision.enabledActions.find((action) => action.id === actionId) ?? null;
}

function legalZones(context: NeutralPolicyContext, actionId: string, kind: "pickup" | "score", tags: readonly string[]): readonly Zone[] {
  const action = actionFor(context, actionId);
  if (!action || action.zoneKind !== kind) return [];
  const allowedIds = action.zoneIds ? new Set(action.zoneIds) : null;
  return context.decision[`${kind}Zones`].filter((zone) =>
    (!allowedIds || allowedIds.has(zone.id)) && tags.every((tag) => zone.tags?.includes(tag)),
  );
}

function selectNearest(context: NeutralPolicyContext, actionId: string, kind: "pickup" | "score", tags: readonly string[]): Zone | null {
  const rejected = context.rejectedTargetIds ?? new Set<string>();
  const candidates = legalZones(context, actionId, kind, tags).filter((zone) => !rejected.has(zone.id));
  return selectNearestFrom(context, candidates);
}

function selectNearestFrom(context: NeutralPolicyContext, candidates: readonly Zone[]): Zone | null {
  return [...candidates].sort((first, second) => {
    const distanceDelta = robotDistanceToZone(context.decision.robot, first)
      - robotDistanceToZone(context.decision.robot, second);
    if (distanceDelta !== 0) return distanceDelta;
    return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
  })[0] ?? null;
}

function selectNearestParking(context: NeutralPolicyContext): Zone | null {
  const action = actionFor(context, ENDGAME_PARKING_ACTION_ID);
  if (!action) return null;
  const allowedIds = action.zoneIds ? new Set(action.zoneIds) : null;
  const rejected = context.rejectedTargetIds ?? new Set<string>();
  const candidates = context.game.zones.filter((zone) => zone.tags?.includes("endgame-parking")
    && (!allowedIds || allowedIds.has(zone.id)) && !rejected.has(zone.id));
  return selectNearestFrom(context, candidates);
}

function unavailable(explanation: string): { available: false; explanation: string } {
  return { available: false, explanation };
}

function targetGoal(
  id: string,
  actionId: string,
  kind: "pickup" | "score",
  tags: readonly string[],
  verb: string,
): PolicyGoalDefinition<NeutralPolicyRequest> {
  return {
    id,
    label: verb,
    description: `Choose the nearest legal ${verb.toLowerCase()} target.`,
    validate: validateEmpty,
    isAvailable(context) {
      const target = selectNearest(context, actionId, kind, tags);
      return target
        ? { available: true, explanation: `Nearest eligible target is "${target.id}".` }
        : unavailable(`No eligible ${kind} target is advertised by the engine.`);
    },
    expand(context) {
      const target = selectNearest(context, actionId, kind, tags);
      if (!target) throw new Error(`Goal "${id}" has no eligible target to expand.`);
      return {
        goalId: id,
        targetId: target.id,
        actions: [
          { actionId: "drive-to", parameters: zoneInteractionPose(context, target) },
          { actionId, parameters: {} },
        ],
        explanation: `${verb} target "${target.id}" because it is nearest by robot-footprint distance.`,
      };
    },
  };
}

const collectGoal = targetGoal(COLLECT_NEAREST_OBJECT_GOAL_ID, "collect-object", "pickup", ["game-object"], "Collect nearest object");
const scoreGoal = targetGoal(SCORE_NEAREST_OBJECT_GOAL_ID, "score-object", "score", ["game-object"], "Score nearest object");

const parkGoal: PolicyGoalDefinition<NeutralPolicyRequest> = {
  id: PARK_FOR_ENDGAME_GOAL_ID,
  label: "Park for endgame",
  description: "Drive to the nearest legal endgame parking area, park, and wait.",
  validate: validateEmpty,
  isAvailable(context) {
    if (!context.decision.endgameActive) return unavailable("Endgame has not started.");
    const target = selectNearestParking(context);
    return target ? { available: true, explanation: `Nearest endgame parking area is "${target.id}".` }
      : unavailable("No endgame parking area is advertised by the engine.");
  },
  expand(context): GoalPlan {
    const target = selectNearestParking(context);
    if (!target) throw new Error("Endgame parking has no eligible target to expand.");
    return {
      goalId: PARK_FOR_ENDGAME_GOAL_ID,
      targetId: target.id,
      actions: [
        { actionId: "drive-to", parameters: zoneInteractionPose(context, target) },
        { actionId: ENDGAME_PARKING_ACTION_ID, parameters: {} },
        { actionId: "wait", parameters: { durationSeconds: context.decision.timeRemainingSeconds } },
      ],
      explanation: `Park in "${target.id}" and wait until match end.`,
    };
  },
};

const waitGoal: PolicyGoalDefinition<NeutralPolicyRequest> = {
  id: WAIT_UNTIL_MATCH_END_GOAL_ID,
  label: "Wait until match end",
  description: "Wait for the remaining match duration.",
  validate: validateEmpty,
  isAvailable: (context) => actionFor(context, "wait")
    ? { available: true, explanation: "The neutral wait action is enabled." }
    : unavailable("The neutral wait action is not enabled."),
  expand: (context) => ({
    goalId: WAIT_UNTIL_MATCH_END_GOAL_ID,
    actions: [{ actionId: "wait", parameters: { durationSeconds: context.decision.timeRemainingSeconds } }],
    explanation: "Wait until the match reaches its configured end.",
  }),
};

const goals: readonly PolicyGoalDefinition<NeutralPolicyRequest>[] = [collectGoal, scoreGoal, parkGoal, waitGoal];

/** Catalog entries used by the guided policy editor. */
export const NEUTRAL_POLICY_CONDITIONS = conditions;
export const NEUTRAL_POLICY_GOALS = goals;

export function createNeutralPolicyCatalog(): PolicyCatalog<NeutralPolicyRequest> {
  return new PolicyCatalog({ conditions, goals });
}

export const DEFAULT_NEUTRAL_POLICY: PolicyDefinition = Object.freeze({
  version: 1,
  name: "Default neutral policy",
  match: {
    rules: [{
      id: "score-held-object",
      conditions: [{ conditionId: "inventory-at-least", parameters: { objectType: "game-object", count: 1 } }],
      goal: { goalId: SCORE_NEAREST_OBJECT_GOAL_ID, parameters: {} },
    }],
    fallback: { goalId: COLLECT_NEAREST_OBJECT_GOAL_ID, parameters: {} },
  },
  endgame: {
    rules: [{ id: "park-at-endgame", conditions: [], goal: { goalId: PARK_FOR_ENDGAME_GOAL_ID, parameters: {} } }],
    fallback: { goalId: WAIT_UNTIL_MATCH_END_GOAL_ID, parameters: {} },
  },
});

export const NEUTRAL_POLICY_ACTION_IDS = Object.freeze({
  collect: "collect-object",
  score: "score-object",
  park: ENDGAME_PARKING_ACTION_ID,
  wait: "wait",
});
