export const DEFAULT_TICK_SECONDS = 0.2;
export const DRIVE_ACTION_ID = "drive-to";

export interface Point {
  readonly xFeet: number;
  readonly yFeet: number;
}

export interface Pose extends Point {
  readonly headingRotations: number;
}

export interface CircleShape {
  readonly type: "circle";
  readonly center: Point;
  readonly radiusFeet: number;
}

export interface RectangleShape {
  readonly type: "rectangle";
  readonly center: Point;
  readonly widthFeet: number;
  readonly heightFeet: number;
  readonly headingRotations?: number;
}

export interface PolygonShape {
  readonly type: "polygon";
  readonly vertices: readonly Point[];
}

export type ZoneShape = CircleShape | RectangleShape | PolygonShape;
export type ZoneKind = "pickup" | "score" | "non-traversal";

export interface Zone {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly shape: ZoneShape;
  readonly tags?: readonly string[];
}

export interface MatchTiming {
  readonly durationSeconds: number;
  readonly endgameDurationSeconds: number;
}

export interface RobotFeature {
  readonly id: string;
  readonly actionIds: readonly string[];
}

export interface RobotConfiguration {
  readonly initialPose: Pose;
  readonly selectedFeatureIds?: readonly string[];
  readonly inventory?: Readonly<Record<string, number>>;
  readonly totalGameObjectCapacity: number;
  readonly perObjectCapacity?: Readonly<Record<string, number>>;
  readonly widthFeet?: number;
  readonly lengthFeet?: number;
  readonly translationSpeedFeetPerSecond?: number;
  readonly spinSpeedRotationsPerSecond?: number;
}

export interface RobotState {
  readonly pose: Pose;
  readonly inventory: Readonly<Record<string, number>>;
  readonly totalGameObjectCapacity: number;
  readonly perObjectCapacity: Readonly<Record<string, number>>;
  readonly widthFeet: number;
  readonly lengthFeet: number;
  readonly translationSpeedFeetPerSecond: number;
  readonly spinSpeedRotationsPerSecond: number;
}

export interface ActionRequest {
  readonly actionId: string;
  readonly parameters: unknown;
}

export interface ActionSummary {
  readonly actionId: string;
  readonly parameters: unknown;
}

export interface ActionMetadata {
  readonly id: string;
  readonly description: string;
  readonly zoneKind?: "pickup" | "score";
  readonly zoneTags?: readonly string[];
  readonly zoneIds?: readonly string[];
}

export interface ActionEvent {
  readonly type: string;
  readonly actionId: string;
  readonly timeSeconds: number;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ActionContext {
  readonly robot: RobotState;
  readonly zones: readonly Zone[];
  readonly elapsedSeconds: number;
  readonly random: () => number;
  readonly robotContactsZone: (zone: Zone) => boolean;
}

export type ValidationResult<Request> =
  | { readonly valid: true; readonly value: Request }
  | { readonly valid: false; readonly message: string };

export type ActionStartResult<RuntimeState> =
  | { readonly ready: true; readonly state: RuntimeState }
  | { readonly ready: false; readonly reason: string };

export interface ActionAdvanceResult<RuntimeState> {
  readonly state: RuntimeState;
  readonly consumedSeconds: number;
  readonly complete: boolean;
  readonly inventoryDelta?: Readonly<Record<string, number>>;
  readonly events?: readonly Omit<ActionEvent, "actionId" | "timeSeconds">[];
}

export interface ActionDefinition<Request = unknown, RuntimeState = unknown> {
  readonly metadata: ActionMetadata;
  validate(parameters: unknown): ValidationResult<Request>;
  start(context: ActionContext, request: Request): ActionStartResult<RuntimeState>;
  advance(
    context: ActionContext,
    request: Request,
    state: RuntimeState,
    availableSeconds: number,
  ): ActionAdvanceResult<RuntimeState>;
}

export interface GameDefinition {
  readonly timing?: MatchTiming;
  readonly gameObjectTypes: readonly string[];
  readonly zones: readonly Zone[];
  readonly actions?: readonly ActionDefinition[];
  readonly robotFeatures?: readonly RobotFeature[];
}

export type SimulationStatus = "running" | "awaiting-actions" | "blocked" | "complete";

export interface SimulationBlock {
  readonly code: "action-precondition" | "non-traversal-zone";
  readonly message: string;
  readonly actionId: string;
  readonly zoneId?: string;
}

export interface QueueResult {
  readonly accepted: boolean;
  readonly errors: readonly { readonly index: number; readonly message: string }[];
}

export interface DecisionState {
  readonly status: SimulationStatus;
  readonly elapsedSeconds: number;
  readonly timeRemainingSeconds: number;
  readonly endgameActive: boolean;
  readonly robot: RobotState;
  readonly activeAction: ActionSummary | null;
  readonly queuedActions: readonly ActionSummary[];
  readonly enabledActions: readonly ActionMetadata[];
  readonly pickupZones: readonly Zone[];
  readonly scoreZones: readonly Zone[];
  readonly nonTraversalZones: readonly Zone[];
  readonly distanceToNearestPickupZoneFeet: number | null;
  readonly distanceToNearestScoreZoneFeet: number | null;
  readonly block: SimulationBlock | null;
}

export interface PlaybackFrame {
  readonly timeSeconds: number;
  readonly robot: RobotState;
  readonly status: SimulationStatus;
}

export interface SimulationPlayback {
  readonly timing: MatchTiming;
  readonly zones: readonly Zone[];
  readonly frames: readonly PlaybackFrame[];
  readonly events: readonly ActionEvent[];
}

export interface SimulationOptions {
  readonly seed?: number;
  readonly recordPlayback?: boolean;
  readonly tickSeconds?: number;
}

export const DEFAULT_MATCH_TIMING: MatchTiming = {
  durationSeconds: 135,
  endgameDurationSeconds: 30,
};

export const DEFAULT_ROBOT_DIMENSION_FEET = 28.5 / 12;
