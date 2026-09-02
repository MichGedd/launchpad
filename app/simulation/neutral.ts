import { createZoneInteractionAction } from "../engine/actions.ts";
import type {
  ActionDefinition,
  GameDefinition,
  RobotConfiguration,
} from "../engine/types.ts";
import {
  DEFAULT_ROBOT_CUSTOMIZATION,
  type RobotCustomization,
} from "../visualizer/types.ts";
import {
  NEUTRAL_FIELD_PRESENTATION,
  NEUTRAL_INITIAL_POSE,
  NEUTRAL_NAV_GRID,
  NEUTRAL_RANKING_POINT_DEFINITIONS,
  NEUTRAL_ZONES,
} from "./neutral-presentation.ts";

const CONTROLLER_FEATURE_ID = "__launchpad-controller-basics";

/** Backward-compatible name used by the simulation controller. */
export const NEUTRAL_SIMULATION_FIELD = NEUTRAL_FIELD_PRESENTATION;

/**
 * A small, deterministic game used by the master branch until a season adapter
 * supplies its own definition. It intentionally contains only generic pickup,
 * scoring, and movement interactions.
 */
export function createNeutralGameDefinition(): GameDefinition {
  const waitAction: ActionDefinition<{ readonly durationSeconds: number }, { readonly elapsedSeconds: number }> = {
    metadata: { id: "wait", description: "Wait without moving for a specified duration." },
    validate(parameters) {
      if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
        return { valid: false, message: "Wait parameters must include durationSeconds." };
      }
      const durationSeconds = (parameters as { readonly durationSeconds?: unknown }).durationSeconds;
      if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
        return { valid: false, message: "durationSeconds must be a finite, non-negative number." };
      }
      return { valid: true, value: { durationSeconds } };
    },
    start: () => ({ ready: true, state: { elapsedSeconds: 0 } }),
    advance(_context, request, state, availableSeconds) {
      const consumedSeconds = Math.min(availableSeconds, Math.max(0, request.durationSeconds - state.elapsedSeconds));
      const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
      return {
        state: { elapsedSeconds },
        consumedSeconds,
        complete: elapsedSeconds >= request.durationSeconds,
      };
    },
  };
  const collectObject = createZoneInteractionAction({
    id: "collect-object",
    description: "Collect one game object while contacting the pickup area.",
    zone: { kind: "pickup", tags: ["game-object"] },
    durationSeconds: 0.5,
    successProbability: 1,
    inventoryDeltaOnSuccess: { "game-object": 1 },
    pointsOnSuccess: 3,
    rankingPointProgressDeltaOnSuccess: { collection: 1 },
    successEventType: "object-collected",
  });
  const scoreObject = createZoneInteractionAction({
    id: "score-object",
    description: "Score one carried game object while contacting the scoring area.",
    zone: { kind: "score", tags: ["game-object"] },
    durationSeconds: 0.5,
    successProbability: 1,
    requiredInventory: { "game-object": 1 },
    inventoryDeltaOnSuccess: { "game-object": -1 },
    pointsOnSuccess: 9,
    rankingPointProgressDeltaOnSuccess: { scoring: 1 },
    successEventType: "object-scored",
  });

  return {
    timing: { durationSeconds: 135, endgameDurationSeconds: 30 },
    gameObjectTypes: ["game-object"],
    navGrid: NEUTRAL_NAV_GRID,
    zones: NEUTRAL_ZONES,
    actions: [waitAction, collectObject, scoreObject],
    robotFeatures: [
      { id: CONTROLLER_FEATURE_ID, actionIds: [waitAction.metadata.id] },
      { id: "drive-planning", actionIds: [] },
      { id: "object-intake", actionIds: [collectObject.metadata.id] },
      { id: "goal-scoring", actionIds: [scoreObject.metadata.id] },
    ],
    rankingPoints: NEUTRAL_RANKING_POINT_DEFINITIONS,
  };
}

export function neutralRobotConfiguration(
  selectedFeatureIds: readonly string[],
  customization: RobotCustomization = DEFAULT_ROBOT_CUSTOMIZATION,
): RobotConfiguration {
  return {
    initialPose: NEUTRAL_INITIAL_POSE,
    selectedFeatureIds: [...new Set([...selectedFeatureIds, CONTROLLER_FEATURE_ID])],
    totalGameObjectCapacity: 3,
    perObjectCapacity: { "game-object": 3 },
    widthFeet: customization.widthFeet,
    lengthFeet: customization.lengthFeet,
    translationSpeedFeetPerSecond: customization.translationSpeedFeetPerSecond,
    spinSpeedRotationsPerSecond: customization.spinSpeedRotationsPerSecond,
  };
}
