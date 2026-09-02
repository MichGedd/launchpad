import { createWaitAction, createZoneInteractionAction } from "../engine/actions.ts";
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
export const ENDGAME_PARKING_ACTION_ID = "park";

/** Backward-compatible name used by the simulation controller. */
export const NEUTRAL_SIMULATION_FIELD = NEUTRAL_FIELD_PRESENTATION;

/**
 * A small, deterministic game used by the master branch until a season adapter
 * supplies its own definition. It intentionally contains only generic pickup,
 * scoring, and movement interactions.
 */
export function createNeutralGameDefinition(): GameDefinition {
  const waitAction = createWaitAction();
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
  const parkAction: ActionDefinition<Record<string, never>, { readonly elapsedSeconds: number }> = {
    metadata: {
      id: ENDGAME_PARKING_ACTION_ID,
      description: "Park in an endgame parking area.",
      zoneIds: ["endgame-parking-area"],
    },
    validate(parameters) {
      if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)
          || Object.keys(parameters).length > 0) {
        return { valid: false, message: "Park parameters must be an empty object." };
      }
      return { valid: true, value: {} };
    },
    start(context) {
      if (!context.endgameActive) {
        return { ready: false, reason: "Parking is available only after endgame starts." };
      }
      const parkingZone = context.zones.find((zone) => zone.tags?.includes("endgame-parking")
        && context.robotContactsZone(zone));
      if (!parkingZone) {
        return { ready: false, reason: "Robot is not contacting an endgame parking area." };
      }
      return { ready: true, state: { elapsedSeconds: 0 } };
    },
    advance(_context, _request, state, availableSeconds) {
      const durationSeconds = 0.5;
      const consumedSeconds = Math.min(availableSeconds, Math.max(0, durationSeconds - state.elapsedSeconds));
      const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
      const complete = elapsedSeconds >= durationSeconds;
      return {
        state: { elapsedSeconds },
        consumedSeconds,
        complete,
        pointsDelta: complete ? 2 : undefined,
        rankingPointProgressDelta: complete ? { endgame: 1 } : undefined,
        events: complete ? [{ type: "parked" }] : undefined,
      };
    },
  };

  return {
    timing: { durationSeconds: 135, endgameDurationSeconds: 30 },
    gameObjectTypes: ["game-object"],
    navGrid: NEUTRAL_NAV_GRID,
    zones: NEUTRAL_ZONES,
    actions: [waitAction, collectObject, scoreObject, parkAction],
    robotFeatures: [
      { id: CONTROLLER_FEATURE_ID, actionIds: [waitAction.metadata.id] },
      { id: "drive-planning", actionIds: [] },
      { id: "object-intake", actionIds: [collectObject.metadata.id] },
      { id: "goal-scoring", actionIds: [scoreObject.metadata.id] },
      { id: "endgame-parking", actionIds: [parkAction.metadata.id] },
    ],
    rankingPoints: NEUTRAL_RANKING_POINT_DEFINITIONS,
  };
}

/** Policy proof fixture with enough neutral targets for a full deterministic match. */
export function createNeutralPolicyGameDefinition(): GameDefinition {
  const game = createNeutralGameDefinition();
  return {
    ...game,
    zones: game.zones.map((zone) => zone.id === "collection-area"
      ? { ...zone, initialGameObjectCount: undefined }
      : zone.id === "scoring-area"
        ? { ...zone, gameObjectCapacity: undefined }
        : zone),
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
