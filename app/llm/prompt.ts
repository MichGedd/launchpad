import type { ActionMetadata, DecisionState, RobotConfiguration } from "../engine/index.ts";

import type {
  LlmActionMetadata,
  StrategyGenerationRequest,
} from "./schemas.ts";

export interface SeasonGameContext {
  readonly name: string;
  readonly instructions: string;
}

/** The neutral adapter used by master; season branches can provide their own adapter. */
export const NEUTRAL_GAME_CONTEXT: SeasonGameContext = {
  name: "Neutral Launchpad demo",
  instructions:
    "This is a season-neutral planning example. Treat pickup zones as sources, score zones as destinations, and obey the supplied match state. Do not invent season rules or unavailable actions.",
};

export const LAUNCHPAD_API_INSTRUCTIONS =
  "## Trusted Launchpad API instructions\nReturn only a strategy plan for the simulator to execute. Each action must use an actionId from the enabled action metadata and a JSON object for parameters. Advance the match toward completion while respecting the robot state, action preconditions, match time, and inventory.";

export function buildGameInstructionSection(gameContext: SeasonGameContext = NEUTRAL_GAME_CONTEXT): string {
  return `## Trusted game instructions: ${gameContext.name}\n${gameContext.instructions}`;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function selectActionMetadata(actions: readonly LlmActionMetadata[]): readonly LlmActionMetadata[] {
  return actions.map((action) => ({
    id: action.id,
    description: action.description,
    ...(action.zoneKind ? { zoneKind: action.zoneKind } : {}),
    ...(action.zoneTags ? { zoneTags: action.zoneTags } : {}),
    ...(action.zoneIds ? { zoneIds: action.zoneIds } : {}),
    ...(action.zoneGameObjectCount ? { zoneGameObjectCount: action.zoneGameObjectCount } : {}),
  }));
}

export interface StrategyPrompt {
  readonly system: string;
  readonly prompt: string;
}

export function buildStrategyPrompt(
  request: StrategyGenerationRequest,
  gameContext: SeasonGameContext = NEUTRAL_GAME_CONTEXT,
): StrategyPrompt {
  const actionMetadata = selectActionMetadata(request.enabledActions);
  const dynamicContext = [
    "## Enabled actions",
    compactJson(actionMetadata),
    "## Selected robot features",
    compactJson(request.selectedFeatureIds),
    "## Robot customization",
    compactJson(request.robotCustomization),
    "## Current decision context",
    compactJson(request.decisionContext),
  ].join("\n");

  return {
    // Keep exactly two trusted instruction sections in the system message.
    system: `${LAUNCHPAD_API_INSTRUCTIONS}\n\n${buildGameInstructionSection(gameContext)}`,
    prompt: `${dynamicContext}\n\n## User strategy\n${request.strategy}`,
  };
}

/** Converts engine metadata without importing season rules into the master branch. */
export function actionMetadataFromEngine(
  actions: readonly ActionMetadata[],
): readonly LlmActionMetadata[] {
  return actions.map((action) => ({
    id: action.id,
    description: action.description,
    ...(action.zoneKind ? { zoneKind: action.zoneKind } : {}),
    ...(action.zoneTags ? { zoneTags: [...action.zoneTags] } : {}),
    ...(action.zoneIds ? { zoneIds: [...action.zoneIds] } : {}),
    ...(action.zoneGameObjectCount ? { zoneGameObjectCount: action.zoneGameObjectCount } : {}),
  }));
}

export function decisionContextFromEngine(decision: DecisionState): Record<string, unknown> {
  return {
    status: decision.status,
    elapsedSeconds: decision.elapsedSeconds,
    timeRemainingSeconds: decision.timeRemainingSeconds,
    endgameActive: decision.endgameActive,
    robot: decision.robot,
    metrics: decision.metrics,
    activeAction: decision.activeAction,
    queuedActions: decision.queuedActions,
    pickupZones: decision.pickupZones,
    scoreZones: decision.scoreZones,
    nonTraversalZones: decision.nonTraversalZones,
    distanceToNearestPickupZoneFeet: decision.distanceToNearestPickupZoneFeet,
    distanceToNearestScoreZoneFeet: decision.distanceToNearestScoreZoneFeet,
    block: decision.block,
  };
}

export function robotConfigurationForPrompt(configuration: RobotConfiguration): Record<string, unknown> {
  return {
    initialPose: configuration.initialPose,
    selectedFeatureIds: configuration.selectedFeatureIds ?? [],
    inventory: configuration.inventory ?? {},
    totalGameObjectCapacity: configuration.totalGameObjectCapacity,
    perObjectCapacity: configuration.perObjectCapacity ?? {},
    widthFeet: configuration.widthFeet,
    lengthFeet: configuration.lengthFeet,
    translationSpeedFeetPerSecond: configuration.translationSpeedFeetPerSecond,
    spinSpeedRotationsPerSecond: configuration.spinSpeedRotationsPerSecond,
  };
}
