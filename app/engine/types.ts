export const DEFAULT_TICK_SECONDS = 0.2;
export const DRIVE_ACTION_ID = "drive-to";
export const NAV_GRID_CELL_SIZE_INCHES = 0.5;

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

interface ZoneBase {
  readonly id: string;
  readonly shape: ZoneShape;
  readonly tags?: readonly string[];
}

export interface PickupZone extends ZoneBase {
  readonly kind: "pickup";
  /** Initial source inventory. Omit for an unlimited source. */
  readonly initialGameObjectCount?: number;
}

export interface ScoreZone extends ZoneBase {
  readonly kind: "score";
  /** Maximum objects accepted by this zone. Omit for unlimited scoring. */
  readonly gameObjectCapacity?: number;
}

export interface NonTraversalZone extends ZoneBase {
  readonly kind: "non-traversal";
}

export type Zone = PickupZone | ScoreZone | NonTraversalZone;

export interface PickupZoneState {
  readonly kind: "pickup";
  /** Remaining objects, or null when the source is unlimited. */
  readonly availableGameObjectCount: number | null;
}

export interface ScoreZoneState {
  readonly kind: "score";
  readonly scoredGameObjectCount: number;
}

export type ZoneGameObjectState = PickupZoneState | ScoreZoneState;
export type ZoneGameObjectStates = Readonly<Record<string, ZoneGameObjectState>>;
export type PickupZoneSnapshot = PickupZone & PickupZoneState;
export type ScoreZoneSnapshot = ScoreZone & ScoreZoneState;

export type NavGridTraversalRule =
  | { readonly kind: "general" }
  | { readonly kind: "feature-specific"; readonly requiredFeatureId: string };

export interface NavGridNonTraversalZone {
  readonly id: string;
  readonly shape: CircleShape | RectangleShape;
  readonly traversalRule: NavGridTraversalRule;
}

export interface NavGridDefinition {
  readonly version: 1;
  readonly seasonId: string;
  readonly fieldWidthFeet: number;
  readonly fieldHeightFeet: number;
  readonly cellSizeInches: number;
  readonly zones: readonly NavGridNonTraversalZone[];
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

/** A ranking point that can be earned by satisfying a season-defined condition. */
export interface RankingPointDefinition {
  readonly id: string;
  readonly label: string;
  /** Point value used when this ranking point is earned. Defaults to one. */
  readonly value?: number;
}

/** Runtime progress for one ranking point. Progress is normalized to [0, 1]. */
export interface RankingPointState {
  readonly progress: number;
  readonly earned: boolean;
}

/** Cumulative scoring state at a simulation timestamp. */
export interface MatchMetrics {
  readonly points: number;
  readonly rankingPoints: Readonly<Record<string, RankingPointState>>;
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
  /** Objects consumed from or accepted by the selected zone. Defaults to one. */
  readonly zoneGameObjectCount?: number;
}

export interface ActionEvent {
  readonly type: string;
  readonly actionId: string;
  readonly timeSeconds: number;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ActionContext {
  readonly robot: RobotState;
  readonly metrics: MatchMetrics;
  readonly zones: readonly Zone[];
  readonly zoneStates: ZoneGameObjectStates;
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
  /** Signed game-object count changes keyed by pickup or score zone ID. */
  readonly zoneGameObjectDeltas?: Readonly<Record<string, number>>;
  readonly pointsDelta?: number;
  readonly rankingPointProgressDelta?: Readonly<Record<string, number>>;
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
  readonly zoneRecyclingRules?: readonly ZoneRecyclingRule[];
  readonly actions?: readonly ActionDefinition[];
  readonly robotFeatures?: readonly RobotFeature[];
  readonly rankingPoints?: readonly RankingPointDefinition[];
  readonly navGrid?: NavGridDefinition;
}

export interface ZoneRecyclingRule {
  readonly scoreZoneId: string;
  readonly sourceZoneId: string;
  readonly delaySeconds: number;
}

export type SimulationStatus = "running" | "awaiting-actions" | "blocked" | "complete";

export interface SimulationBlock {
  readonly code: "action-precondition" | "non-traversal-zone" | "path-not-found";
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
  readonly metrics: MatchMetrics;
  readonly activeAction: ActionSummary | null;
  readonly queuedActions: readonly ActionSummary[];
  readonly enabledActions: readonly ActionMetadata[];
  readonly pickupZones: readonly PickupZoneSnapshot[];
  readonly scoreZones: readonly ScoreZoneSnapshot[];
  readonly nonTraversalZones: readonly NonTraversalZone[];
  readonly distanceToNearestPickupZoneFeet: number | null;
  readonly distanceToNearestScoreZoneFeet: number | null;
  readonly block: SimulationBlock | null;
}

export interface PlaybackFrame {
  readonly timeSeconds: number;
  readonly robot: RobotState;
  readonly metrics: MatchMetrics;
  readonly zoneStates: ZoneGameObjectStates;
  readonly status: SimulationStatus;
}

export interface SimulationPlayback {
  readonly timing: MatchTiming;
  readonly zones: readonly Zone[];
  readonly rankingPointDefinitions: readonly Required<RankingPointDefinition>[];
  readonly frames: readonly PlaybackFrame[];
  readonly events: readonly ActionEvent[];
  readonly navGrid?: NavGridDefinition;
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
