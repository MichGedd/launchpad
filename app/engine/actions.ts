import type {
  ActionDefinition,
  ActionMetadata,
  ActionStartResult,
  RobotState,
  ValidationResult,
  Zone,
} from "./types.ts";

export interface ZoneSelector {
  readonly kind: "pickup" | "score";
  readonly tags?: readonly string[];
  readonly zoneIds?: readonly string[];
}

export interface ZoneInteractionActionConfiguration {
  readonly id: string;
  readonly description: string;
  readonly zone: ZoneSelector;
  readonly durationSeconds: number;
  readonly successProbability: number;
  readonly requiredInventory?: Readonly<Record<string, number>>;
  readonly inventoryDeltaOnSuccess?: Readonly<Record<string, number>>;
  readonly pointsOnSuccess?: number;
  readonly rankingPointProgressDeltaOnSuccess?: Readonly<Record<string, number>>;
  readonly successEventType?: string;
}

interface ZoneInteractionRuntimeState {
  readonly elapsedSeconds: number;
  readonly zoneId: string;
}

function validateEmptyParameters(parameters: unknown): ValidationResult<Record<string, never>> {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)
      || Object.keys(parameters).length > 0) {
    return { valid: false, message: "This action requires an empty parameter object." };
  }
  return { valid: true, value: {} };
}

export function zoneMatchesSelector(zone: Zone, selector: ZoneSelector): boolean {
  if (zone.kind !== selector.kind) return false;
  if (selector.zoneIds && !selector.zoneIds.includes(zone.id)) return false;
  return !selector.tags || selector.tags.every((tag) => zone.tags?.includes(tag));
}

function inventoryRequirementFailure(
  robot: RobotState,
  requiredInventory: Readonly<Record<string, number>>,
): string | null {
  for (const [objectType, requiredCount] of Object.entries(requiredInventory)) {
    if ((robot.inventory[objectType] ?? 0) < requiredCount) {
      return `Requires ${requiredCount} ${objectType}; robot holds ${robot.inventory[objectType] ?? 0}.`;
    }
  }
  return null;
}

function inventoryCapacityFailure(
  robot: RobotState,
  delta: Readonly<Record<string, number>>,
): string | null {
  const resultingInventory = { ...robot.inventory };
  for (const [objectType, change] of Object.entries(delta)) {
    const result = (resultingInventory[objectType] ?? 0) + change;
    if (result < 0) return `Action would reduce ${objectType} inventory below zero.`;
    const objectCapacity = robot.perObjectCapacity[objectType];
    if (objectCapacity !== undefined && result > objectCapacity) {
      return `Action would exceed the ${objectType} capacity of ${objectCapacity}.`;
    }
    resultingInventory[objectType] = result;
  }
  const total = Object.values(resultingInventory).reduce((sum, count) => sum + count, 0);
  return total > robot.totalGameObjectCapacity
    ? `Action would exceed the total game-object capacity of ${robot.totalGameObjectCapacity}.`
    : null;
}

export function createZoneInteractionAction(
  configuration: ZoneInteractionActionConfiguration,
): ActionDefinition<Record<string, never>, ZoneInteractionRuntimeState> {
  if (configuration.id.length === 0) throw new Error("Zone-interaction action IDs cannot be empty.");
  if (configuration.durationSeconds < 0 || !Number.isFinite(configuration.durationSeconds)) {
    throw new Error(`Action "${configuration.id}" must have a finite, non-negative duration.`);
  }
  if (!Number.isFinite(configuration.successProbability)
      || configuration.successProbability < 0 || configuration.successProbability > 1) {
    throw new Error(`Action "${configuration.id}" success probability must be finite and between zero and one.`);
  }
  for (const [objectType, count] of Object.entries(configuration.requiredInventory ?? {})) {
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
      throw new Error(`Action "${configuration.id}" required ${objectType} inventory must be a non-negative integer.`);
    }
  }
  for (const [objectType, change] of Object.entries(configuration.inventoryDeltaOnSuccess ?? {})) {
    if (!Number.isFinite(change) || !Number.isInteger(change)) {
      throw new Error(`Action "${configuration.id}" ${objectType} inventory delta must be an integer.`);
    }
  }
  if (configuration.pointsOnSuccess !== undefined && !Number.isFinite(configuration.pointsOnSuccess)) {
    throw new Error(`Action "${configuration.id}" points on success must be finite.`);
  }
  for (const [rankingPointId, change] of Object.entries(configuration.rankingPointProgressDeltaOnSuccess ?? {})) {
    if (!Number.isFinite(change)) {
      throw new Error(`Action "${configuration.id}" ${rankingPointId} ranking-point progress delta must be finite.`);
    }
  }

  const metadata: ActionMetadata = {
    id: configuration.id,
    description: configuration.description,
    zoneKind: configuration.zone.kind,
    zoneTags: configuration.zone.tags,
    zoneIds: configuration.zone.zoneIds,
  };

  return {
    metadata,
    validate: validateEmptyParameters,
    start(context): ActionStartResult<ZoneInteractionRuntimeState> {
      const zone = context.zones.find((candidate) =>
        zoneMatchesSelector(candidate, configuration.zone) && context.robotContactsZone(candidate));
      if (!zone) return { ready: false, reason: `Robot is not contacting an eligible ${configuration.zone.kind} zone.` };

      const inventoryFailure = inventoryRequirementFailure(context.robot, configuration.requiredInventory ?? {});
      if (inventoryFailure) return { ready: false, reason: inventoryFailure };
      const capacityFailure = inventoryCapacityFailure(context.robot, configuration.inventoryDeltaOnSuccess ?? {});
      if (capacityFailure) return { ready: false, reason: capacityFailure };
      return { ready: true, state: { elapsedSeconds: 0, zoneId: zone.id } };
    },
    advance(context, _request, state, availableSeconds) {
      const remainingSeconds = Math.max(0, configuration.durationSeconds - state.elapsedSeconds);
      const consumedSeconds = Math.min(availableSeconds, remainingSeconds);
      const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
      const complete = elapsedSeconds >= configuration.durationSeconds;
      const nextState = { ...state, elapsedSeconds };
      if (!complete) return { state: nextState, consumedSeconds, complete: false };

      const successful = context.random() < configuration.successProbability;
      return {
        state: nextState,
        consumedSeconds,
        complete: true,
        inventoryDelta: successful ? configuration.inventoryDeltaOnSuccess : undefined,
        pointsDelta: successful ? configuration.pointsOnSuccess : undefined,
        rankingPointProgressDelta: successful ? configuration.rankingPointProgressDeltaOnSuccess : undefined,
        events: [{
          type: successful ? (configuration.successEventType ?? "zone-interaction-succeeded") : "zone-interaction-failed",
          details: { zoneId: state.zoneId, successful },
        }],
      };
    },
  };
}
