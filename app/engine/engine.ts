import { zoneMatchesSelector } from "./actions.ts";
import {
  interpolatePose,
  normalizeHeading,
  robotContactsZone,
  robotDistanceToZone,
  shortestHeadingDelta,
  zoneCharacteristicSize,
} from "./geometry.ts";
import { createSeededRandom } from "./random.ts";
import { NavGridNavigator } from "./navigation.ts";
import {
  DEFAULT_MATCH_TIMING,
  DEFAULT_ROBOT_DIMENSION_FEET,
  DEFAULT_TICK_SECONDS,
  DRIVE_ACTION_ID,
  type ActionContext,
  type ActionDefinition,
  type ActionEvent,
  type ActionMetadata,
  type ActionRequest,
  type ActionSummary,
  type DecisionState,
  type GameDefinition,
  type MatchTiming,
  type MatchMetrics,
  type PlaybackFrame,
  type Pose,
  type QueueResult,
  type RobotConfiguration,
  type RobotState,
  type RankingPointDefinition,
  type RankingPointState,
  type SimulationBlock,
  type SimulationOptions,
  type SimulationPlayback,
  type SimulationStatus,
  type Zone,
} from "./types.ts";

const TIME_EPSILON = 1e-9;

interface ValidatedAction {
  readonly actionId: string;
  readonly parameters: unknown;
  readonly definition: ActionDefinition<unknown, unknown> | null;
}

interface ActiveCustomAction extends ValidatedAction {
  readonly definition: ActionDefinition<unknown, unknown>;
  runtimeState: unknown;
}

interface ActiveDriveAction extends ValidatedAction {
  readonly definition: null;
  readonly parameters: Pose;
  readonly startPose: Pose;
  readonly path: readonly Pose[];
  readonly pathDistanceFeet: number;
  readonly translationDurationSeconds: number;
  readonly rotationDurationSeconds: number;
  readonly totalDurationSeconds: number;
  elapsedSeconds: number;
}

type ActiveAction = ActiveCustomAction | ActiveDriveAction;

interface MutableRobotState {
  pose: Pose;
  inventory: Record<string, number>;
  readonly totalGameObjectCapacity: number;
  readonly perObjectCapacity: Readonly<Record<string, number>>;
  readonly widthFeet: number;
  readonly lengthFeet: number;
  readonly translationSpeedFeetPerSecond: number;
  readonly spinSpeedRotationsPerSecond: number;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and greater than zero.`);
  return value;
}

function validateGame(game: GameDefinition): void {
  if (game.gameObjectTypes.some((objectType) => objectType.length === 0)) {
    throw new Error("Game-object type IDs cannot be empty.");
  }
  if (new Set(game.gameObjectTypes).size !== game.gameObjectTypes.length) {
    throw new Error("Game-object type IDs must be unique.");
  }
  const rankingPointIds = new Set<string>();
  for (const rankingPoint of game.rankingPoints ?? []) {
    if (rankingPoint.id.length === 0) throw new Error("Ranking-point IDs cannot be empty.");
    if (rankingPointIds.has(rankingPoint.id)) {
      throw new Error(`Duplicate ranking-point ID "${rankingPoint.id}".`);
    }
    rankingPointIds.add(rankingPoint.id);
    if (rankingPoint.label.length === 0) throw new Error(`Ranking point "${rankingPoint.id}" labels cannot be empty.`);
    if (rankingPoint.value !== undefined && (!Number.isFinite(rankingPoint.value) || rankingPoint.value < 0)) {
      throw new Error(`Ranking point "${rankingPoint.id}" value must be finite and non-negative.`);
    }
  }
  const validatePoint = (point: { readonly xFeet: number; readonly yFeet: number }, label: string): void => {
    if (!Number.isFinite(point.xFeet) || !Number.isFinite(point.yFeet)) {
      throw new Error(`${label} coordinates must be finite.`);
    }
  };
  const zoneIds = new Set<string>();
  for (const zone of game.zones) {
    if (zone.id.length === 0) throw new Error("Zone IDs cannot be empty.");
    if (zoneIds.has(zone.id)) throw new Error(`Duplicate zone ID "${zone.id}".`);
    zoneIds.add(zone.id);
    if (zone.shape.type === "circle") {
      validatePoint(zone.shape.center, `Zone "${zone.id}" center`);
      finitePositive(zone.shape.radiusFeet, `Zone "${zone.id}" radius`);
    }
    if (zone.shape.type === "rectangle") {
      validatePoint(zone.shape.center, `Zone "${zone.id}" center`);
      finitePositive(zone.shape.widthFeet, `Zone "${zone.id}" width`);
      finitePositive(zone.shape.heightFeet, `Zone "${zone.id}" height`);
      if (zone.shape.headingRotations !== undefined && !Number.isFinite(zone.shape.headingRotations)) {
        throw new Error(`Zone "${zone.id}" heading must be finite.`);
      }
    }
    if (zone.shape.type === "polygon" && zone.shape.vertices.length < 3) {
      throw new Error(`Zone "${zone.id}" polygon must contain at least three vertices.`);
    }
    if (zone.shape.type === "polygon") {
      zone.shape.vertices.forEach((point) => validatePoint(point, `Zone "${zone.id}" vertex`));
    }
  }
}

function validateRobot(configuration: RobotConfiguration, game: GameDefinition): MutableRobotState {
  if (![configuration.initialPose.xFeet, configuration.initialPose.yFeet, configuration.initialPose.headingRotations]
      .every(Number.isFinite)) {
    throw new Error("Robot initial pose values must be finite.");
  }
  if (!Number.isInteger(configuration.totalGameObjectCapacity) || configuration.totalGameObjectCapacity < 0) {
    throw new Error("Robot total game-object capacity must be a non-negative integer.");
  }
  const inventory: Record<string, number> = {};
  for (const [objectType, count] of Object.entries(configuration.inventory ?? {})) {
    if (!game.gameObjectTypes.includes(objectType)) throw new Error(`Unknown game-object type "${objectType}".`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Inventory count for "${objectType}" must be a non-negative integer.`);
    inventory[objectType] = count;
  }
  if (Object.values(inventory).reduce((sum, count) => sum + count, 0) > configuration.totalGameObjectCapacity) {
    throw new Error("Initial inventory exceeds the robot's total game-object capacity.");
  }
  for (const [objectType, capacity] of Object.entries(configuration.perObjectCapacity ?? {})) {
    if (!game.gameObjectTypes.includes(objectType)) throw new Error(`Capacity uses unknown game-object type "${objectType}".`);
    if (!Number.isInteger(capacity) || capacity < 0) throw new Error(`Capacity for "${objectType}" must be a non-negative integer.`);
    if ((inventory[objectType] ?? 0) > capacity) throw new Error(`Initial ${objectType} inventory exceeds its capacity.`);
  }
  return {
    pose: { ...configuration.initialPose, headingRotations: normalizeHeading(configuration.initialPose.headingRotations) },
    inventory,
    totalGameObjectCapacity: configuration.totalGameObjectCapacity,
    perObjectCapacity: { ...configuration.perObjectCapacity },
    widthFeet: finitePositive(configuration.widthFeet ?? DEFAULT_ROBOT_DIMENSION_FEET, "Robot width"),
    lengthFeet: finitePositive(configuration.lengthFeet ?? DEFAULT_ROBOT_DIMENSION_FEET, "Robot length"),
    translationSpeedFeetPerSecond: finitePositive(configuration.translationSpeedFeetPerSecond ?? 15, "Translation speed"),
    spinSpeedRotationsPerSecond: finitePositive(configuration.spinSpeedRotationsPerSecond ?? 1, "Spin speed"),
  };
}

function driveMetadata(): ActionMetadata {
  return { id: DRIVE_ACTION_ID, description: "Drive to an X, Y, and heading pose." };
}

function validateDriveParameters(parameters: unknown): { valid: true; value: Pose } | { valid: false; message: string } {
  if (typeof parameters !== "object" || parameters === null) {
    return { valid: false, message: "Drive parameters must be an object with xFeet, yFeet, and headingRotations." };
  }
  const candidate = parameters as Partial<Record<keyof Pose, unknown>>;
  if (![candidate.xFeet, candidate.yFeet, candidate.headingRotations].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  )) return { valid: false, message: "Drive xFeet, yFeet, and headingRotations must be finite numbers." };
  return {
    valid: true,
    value: {
      xFeet: candidate.xFeet as number,
      yFeet: candidate.yFeet as number,
      headingRotations: normalizeHeading(candidate.headingRotations as number),
    },
  };
}

function cloneRobot(robot: MutableRobotState): RobotState {
  return Object.freeze({
    ...robot,
    pose: Object.freeze({ ...robot.pose }),
    inventory: Object.freeze({ ...robot.inventory }),
    perObjectCapacity: Object.freeze({ ...robot.perObjectCapacity }),
  });
}

interface MutableMatchMetrics {
  points: number;
  rankingPoints: Record<string, RankingPointState>;
}

function normalizeRankingPointDefinitions(
  definitions: readonly RankingPointDefinition[] | undefined,
): readonly Required<RankingPointDefinition>[] {
  return (definitions ?? []).map((definition) => ({
    id: definition.id,
    label: definition.label,
    value: definition.value ?? 1,
  }));
}

function cloneMetrics(metrics: MutableMatchMetrics): MatchMetrics {
  const rankingPoints: Record<string, RankingPointState> = {};
  for (const [id, state] of Object.entries(metrics.rankingPoints)) {
    rankingPoints[id] = Object.freeze({ ...state });
  }
  return Object.freeze({
    points: metrics.points,
    rankingPoints: Object.freeze(rankingPoints),
  });
}

function metricsEqual(first: MatchMetrics, second: MutableMatchMetrics): boolean {
  if (first.points !== second.points) return false;
  const firstIds = Object.keys(first.rankingPoints);
  const secondIds = Object.keys(second.rankingPoints);
  if (firstIds.length !== secondIds.length) return false;
  return firstIds.every((id) => {
    const firstState = first.rankingPoints[id];
    const secondState = second.rankingPoints[id];
    return firstState?.progress === secondState?.progress && firstState?.earned === secondState?.earned;
  });
}

function cloneSummary(action: ValidatedAction): ActionSummary {
  return Object.freeze({ actionId: action.actionId, parameters: structuredClone(action.parameters) });
}

export class SimulationEngine {
  readonly #game: GameDefinition;
  readonly #rankingPointDefinitions: readonly Required<RankingPointDefinition>[];
  readonly #timing: MatchTiming;
  readonly #tickSeconds: number;
  readonly #random: () => number;
  readonly #definitions = new Map<string, ActionDefinition<unknown, unknown>>();
  readonly #enabledActionIds = new Set<string>([DRIVE_ACTION_ID]);
  readonly #robot: MutableRobotState;
  readonly #navGridNavigator: NavGridNavigator | null;
  readonly #metrics: MutableMatchMetrics;
  readonly #recordPlayback: boolean;
  readonly #frames: PlaybackFrame[] = [];
  readonly #events: ActionEvent[] = [];
  #queue: ValidatedAction[] = [];
  #active: ActiveAction | null = null;
  #elapsedSeconds = 0;
  #remainingTickSeconds = 0;
  #status: SimulationStatus = "awaiting-actions";
  #block: SimulationBlock | null = null;

  constructor(game: GameDefinition, robotConfiguration: RobotConfiguration, options: SimulationOptions = {}) {
    validateGame(game);
    this.#game = game;
    this.#rankingPointDefinitions = normalizeRankingPointDefinitions(game.rankingPoints);
    this.#timing = game.timing ?? DEFAULT_MATCH_TIMING;
    finitePositive(this.#timing.durationSeconds, "Match duration");
    if (!Number.isFinite(this.#timing.endgameDurationSeconds)
        || this.#timing.endgameDurationSeconds < 0
        || this.#timing.endgameDurationSeconds > this.#timing.durationSeconds) {
      throw new Error("Endgame duration must be finite and between zero and the match duration.");
    }
    this.#tickSeconds = finitePositive(options.tickSeconds ?? DEFAULT_TICK_SECONDS, "Tick duration");
    this.#random = createSeededRandom(options.seed ?? 1);
    this.#recordPlayback = options.recordPlayback ?? false;
    this.#robot = validateRobot(robotConfiguration, game);
    this.#metrics = {
      points: 0,
      rankingPoints: Object.fromEntries(
        this.#rankingPointDefinitions.map((definition) => [definition.id, { progress: 0, earned: false }]),
      ),
    };

    for (const definition of game.actions ?? []) {
      if (definition.metadata.id.length === 0) throw new Error("Action IDs cannot be empty.");
      if (definition.metadata.id === DRIVE_ACTION_ID) throw new Error(`"${DRIVE_ACTION_ID}" is reserved by the engine.`);
      if (this.#definitions.has(definition.metadata.id)) throw new Error(`Duplicate action ID "${definition.metadata.id}".`);
      this.#definitions.set(definition.metadata.id, definition as ActionDefinition<unknown, unknown>);
    }
    const features = game.robotFeatures ?? [];
    if (features.some((feature) => feature.id.length === 0)) throw new Error("Robot feature IDs cannot be empty.");
    const knownFeatures = new Set(features.map((feature) => feature.id));
    if (knownFeatures.size !== features.length) throw new Error("Robot feature IDs must be unique.");
    for (const feature of features) {
      for (const actionId of feature.actionIds) {
        if (!this.#definitions.has(actionId)) throw new Error(`Feature "${feature.id}" references unknown action "${actionId}".`);
      }
    }
    const selectedFeatures = new Set(robotConfiguration.selectedFeatureIds ?? []);
    for (const featureId of selectedFeatures) {
      if (!knownFeatures.has(featureId)) throw new Error(`Unknown robot feature "${featureId}".`);
    }
    for (const feature of features) {
      if (!selectedFeatures.has(feature.id)) continue;
      for (const actionId of feature.actionIds) {
        this.#enabledActionIds.add(actionId);
      }
    }
    this.#navGridNavigator = game.navGrid
      ? new NavGridNavigator(game.navGrid, this.#robot, [...selectedFeatures], knownFeatures)
      : null;
    if (this.#recordPlayback) this.#recordFrame();
  }

  queueActions(requests: readonly ActionRequest[]): QueueResult {
    return this.#submitActions(requests, false);
  }

  replaceActions(requests: readonly ActionRequest[]): QueueResult {
    return this.#submitActions(requests, true);
  }

  #submitActions(requests: readonly ActionRequest[], replace: boolean): QueueResult {
    const validated: ValidatedAction[] = [];
    const errors: { index: number; message: string }[] = [];
    requests.forEach((request, index) => {
      if (!this.#enabledActionIds.has(request.actionId)) {
        errors.push({ index, message: `Action "${request.actionId}" is unknown or not enabled by a selected robot feature.` });
        return;
      }
      if (request.actionId === DRIVE_ACTION_ID) {
        const result = validateDriveParameters(request.parameters);
        if (!result.valid) errors.push({ index, message: result.message });
        else validated.push({ actionId: request.actionId, parameters: result.value, definition: null });
        return;
      }
      const definition = this.#definitions.get(request.actionId)!;
      const result = definition.validate(request.parameters);
      if (!result.valid) errors.push({ index, message: result.message });
      else validated.push({ actionId: request.actionId, parameters: result.value, definition });
    });
    if (errors.length > 0) return { accepted: false, errors };
    if (replace) {
      this.#active = null;
      this.#queue = validated;
      this.#block = null;
    } else {
      this.#queue.push(...validated);
    }
    if (this.#elapsedSeconds >= this.#timing.durationSeconds) this.#status = "complete";
    else if (this.#block) this.#status = "blocked";
    else this.#status = this.#active || this.#queue.length > 0 ? "running" : "awaiting-actions";
    return { accepted: true, errors: [] };
  }

  advanceOneTick(): DecisionState {
    if (this.#status === "complete" || this.#status === "blocked") return this.getDecisionState();
    if (this.#remainingTickSeconds <= TIME_EPSILON) {
      this.#remainingTickSeconds = Math.min(this.#tickSeconds, this.#timing.durationSeconds - this.#elapsedSeconds);
    }
    this.#status = "running";

    while (this.#remainingTickSeconds > TIME_EPSILON && this.#elapsedSeconds < this.#timing.durationSeconds) {
      if (!this.#active && !this.#startNextAction()) break;
      if (this.#block !== null) break;
      if (!this.#active) continue;
      const consumed = this.#active?.definition === null
        ? this.#advanceDrive(this.#active, this.#remainingTickSeconds)
        : this.#advanceCustom(this.#active!, this.#remainingTickSeconds);
      this.#consumeTime(consumed);
      if (this.#block !== null) break;
      if (consumed <= TIME_EPSILON && this.#active) {
        throw new Error(`Action "${this.#active.actionId}" made no progress.`);
      }
    }

    if (this.#elapsedSeconds >= this.#timing.durationSeconds - TIME_EPSILON) {
      this.#elapsedSeconds = this.#timing.durationSeconds;
      this.#remainingTickSeconds = 0;
      if (this.#active) {
        this.#events.push({
          type: "action-interrupted",
          actionId: this.#active.actionId,
          timeSeconds: this.#elapsedSeconds,
          details: { reason: "match-time-expired" },
        });
      }
      this.#active = null;
      this.#queue = [];
      this.#status = "complete";
      this.#events.push({ type: "simulation-complete", actionId: "engine", timeSeconds: this.#elapsedSeconds });
      if (this.#recordPlayback) this.#recordFrame();
    } else if (this.#block === null && !this.#active && this.#queue.length === 0) {
      this.#status = "awaiting-actions";
    }
    if (this.#remainingTickSeconds <= TIME_EPSILON) {
      this.#remainingTickSeconds = 0;
      if (this.#recordPlayback && this.#status !== "complete") this.#recordFrame();
    }
    return this.getDecisionState();
  }

  runUntilDecision(): DecisionState {
    while (this.#status === "running") this.advanceOneTick();
    return this.getDecisionState();
  }

  #startNextAction(): boolean {
    const next = this.#queue.shift();
    if (!next) return false;
    if (next.definition === null) {
      const target = next.parameters as Pose;
      const startPose = { ...this.#robot.pose };
      const pathPoints = this.#navGridNavigator?.findPath(startPose, target);
      if (this.#navGridNavigator && !pathPoints) {
        this.#active = {
          ...next,
          definition: null,
          parameters: target,
          startPose,
          path: [],
          pathDistanceFeet: 0,
          translationDurationSeconds: 0,
          rotationDurationSeconds: 0,
          totalDurationSeconds: 0,
          elapsedSeconds: 0,
        };
        this.#block = {
          code: "path-not-found",
          actionId: next.actionId,
          message: "No traversable path exists between the robot and the requested drive destination.",
        };
        this.#status = "blocked";
        this.#events.push({ type: "action-blocked", actionId: next.actionId, timeSeconds: this.#elapsedSeconds });
        return false;
      }
      const path = (pathPoints ?? [startPose, target]).map((point) => ({
        xFeet: point.xFeet,
        yFeet: point.yFeet,
        headingRotations: 0,
      }));
      const translationDistance = path.reduce((total, point, index) => index === 0 ? total : total + Math.hypot(
        point.xFeet - path[index - 1]!.xFeet,
        point.yFeet - path[index - 1]!.yFeet,
      ), 0);
      const rotationDistance = Math.abs(shortestHeadingDelta(this.#robot.pose.headingRotations, target.headingRotations));
      this.#active = {
        ...next,
        definition: null,
        parameters: target,
        startPose,
        path,
        pathDistanceFeet: translationDistance,
        translationDurationSeconds: translationDistance / this.#robot.translationSpeedFeetPerSecond,
        rotationDurationSeconds: rotationDistance / this.#robot.spinSpeedRotationsPerSecond,
        totalDurationSeconds: Math.max(
          translationDistance / this.#robot.translationSpeedFeetPerSecond,
          rotationDistance / this.#robot.spinSpeedRotationsPerSecond,
        ),
        elapsedSeconds: 0,
      };
      this.#events.push({ type: "action-started", actionId: next.actionId, timeSeconds: this.#elapsedSeconds });
      if (this.#active.totalDurationSeconds <= TIME_EPSILON) {
        this.#robot.pose = target;
        this.#completeActiveAction(0);
      }
      return true;
    }

    const start = next.definition.start(this.#actionContext(), next.parameters);
    if (!start.ready) {
      this.#active = { ...next, definition: next.definition, runtimeState: undefined };
      this.#block = {
        code: "action-precondition",
        actionId: next.actionId,
        message: start.reason,
      };
      this.#status = "blocked";
      this.#events.push({ type: "action-blocked", actionId: next.actionId, timeSeconds: this.#elapsedSeconds });
      return false;
    }
    this.#active = { ...next, definition: next.definition, runtimeState: start.state };
    this.#events.push({ type: "action-started", actionId: next.actionId, timeSeconds: this.#elapsedSeconds });
    return true;
  }

  #advanceDrive(action: ActiveDriveAction, availableSeconds: number): number {
    const remaining = action.totalDurationSeconds - action.elapsedSeconds;
    const intended = Math.min(availableSeconds, remaining);
    const nextElapsed = action.elapsedSeconds + intended;
    const targetPose = this.#drivePoseAt(action, nextElapsed);
    const collision = this.#firstCollision(action, action.elapsedSeconds, nextElapsed);
    if (collision) {
      const consumed = collision.elapsedSeconds - action.elapsedSeconds;
      action.elapsedSeconds = collision.elapsedSeconds;
      this.#robot.pose = collision.pose;
      this.#block = {
        code: "non-traversal-zone",
        actionId: action.actionId,
        zoneId: collision.zone.id,
        message: `Drive contacted non-traversal zone "${collision.zone.id}". Pathfinding is not enabled.`,
      };
      this.#status = "blocked";
      this.#events.push({
        type: "action-blocked",
        actionId: action.actionId,
        timeSeconds: this.#elapsedSeconds + consumed,
        details: { zoneId: collision.zone.id },
      });
      return consumed;
    }
    action.elapsedSeconds = nextElapsed;
    this.#robot.pose = targetPose;
    if (remaining - intended <= TIME_EPSILON) {
      this.#robot.pose = action.parameters;
      this.#completeActiveAction(intended);
    }
    return intended;
  }

  #drivePoseAt(action: ActiveDriveAction, elapsedSeconds: number): Pose {
    const translationProgress = action.translationDurationSeconds <= TIME_EPSILON
      ? 1 : Math.min(1, elapsedSeconds / action.translationDurationSeconds);
    const rotationProgress = action.rotationDurationSeconds <= TIME_EPSILON
      ? 1 : Math.min(1, elapsedSeconds / action.rotationDurationSeconds);
    const position = this.#drivePositionAt(action, translationProgress);
    const heading = interpolatePose(action.startPose, action.parameters, 0, rotationProgress).headingRotations;
    return { ...position, headingRotations: heading };
  }

  #drivePositionAt(action: ActiveDriveAction, progress: number): { xFeet: number; yFeet: number } {
    if (action.path.length < 2 || action.pathDistanceFeet <= TIME_EPSILON) {
      return { xFeet: action.parameters.xFeet, yFeet: action.parameters.yFeet };
    }
    let distance = action.pathDistanceFeet * Math.max(0, Math.min(1, progress));
    for (let index = 1; index < action.path.length; index += 1) {
      const previous = action.path[index - 1]!;
      const current = action.path[index]!;
      const segment = Math.hypot(current.xFeet - previous.xFeet, current.yFeet - previous.yFeet);
      if (distance <= segment || index === action.path.length - 1) {
        const segmentProgress = segment <= TIME_EPSILON ? 1 : distance / segment;
        return {
          xFeet: previous.xFeet + (current.xFeet - previous.xFeet) * segmentProgress,
          yFeet: previous.yFeet + (current.yFeet - previous.yFeet) * segmentProgress,
        };
      }
      distance -= segment;
    }
    return { xFeet: action.parameters.xFeet, yFeet: action.parameters.yFeet };
  }

  #firstCollision(
    action: ActiveDriveAction,
    startElapsed: number,
    endElapsed: number,
  ): { elapsedSeconds: number; pose: Pose; zone: Zone } | null {
    if (this.#navGridNavigator) return null;
    const obstacles = this.#game.zones.filter((zone) => zone.kind === "non-traversal");
    if (obstacles.length === 0 || endElapsed <= startElapsed) return null;
    const distance = Math.hypot(
      this.#drivePoseAt(action, endElapsed).xFeet - this.#drivePoseAt(action, startElapsed).xFeet,
      this.#drivePoseAt(action, endElapsed).yFeet - this.#drivePoseAt(action, startElapsed).yFeet,
    );
    const cornerRadius = Math.hypot(this.#robot.widthFeet, this.#robot.lengthFeet) / 2;
    const headingChangeRadians = Math.abs(shortestHeadingDelta(
      this.#drivePoseAt(action, startElapsed).headingRotations,
      this.#drivePoseAt(action, endElapsed).headingRotations,
    )) * Math.PI * 2;
    const minimumObstacleSize = Math.min(...obstacles.map(zoneCharacteristicSize));
    const maximumMotionPerSample = Math.max(0.0001, Math.min(0.02, minimumObstacleSize / 4));
    const sampleCount = Math.max(1, Math.ceil((distance + cornerRadius * headingChangeRadians) / maximumMotionPerSample));
    const startingZoneIds = new Set(obstacles
      .filter((zone) => robotContactsZone(this.#robot, zone))
      .map((zone) => zone.id));
    let previousElapsed = startElapsed;
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const elapsed = startElapsed + (endElapsed - startElapsed) * (sample / sampleCount);
      const pose = this.#drivePoseAt(action, elapsed);
      this.#robot.pose = pose;
      for (const zoneId of startingZoneIds) {
        const startingZone = obstacles.find((candidate) => candidate.id === zoneId)!;
        if (!robotContactsZone(this.#robot, startingZone)) startingZoneIds.delete(zoneId);
      }
      const zone = obstacles.find((candidate) => robotContactsZone(this.#robot, candidate));
      if (zone) {
        let low = previousElapsed;
        let high = elapsed;
        for (let iteration = 0; iteration < 30; iteration += 1) {
          const middle = (low + high) / 2;
          this.#robot.pose = this.#drivePoseAt(action, middle);
          if (robotContactsZone(this.#robot, zone)) high = middle;
          else low = middle;
        }
        const collisionPose = this.#drivePoseAt(action, high);
        this.#robot.pose = collisionPose;
        return { elapsedSeconds: high, pose: collisionPose, zone };
      }
      previousElapsed = elapsed;
    }
    return null;
  }

  #advanceCustom(action: ActiveCustomAction, availableSeconds: number): number {
    const result = action.definition.advance(
      this.#actionContext(), action.parameters, action.runtimeState, availableSeconds,
    );
    if (!Number.isFinite(result.consumedSeconds) || result.consumedSeconds < 0
        || result.consumedSeconds > availableSeconds + TIME_EPSILON) {
      throw new Error(`Action "${action.actionId}" returned an invalid consumed duration.`);
    }
    action.runtimeState = result.state;
    this.#validateMetricsDelta(result, action.actionId);
    const nextInventory = result.inventoryDelta
      ? this.#inventoryAfterDelta(result.inventoryDelta, action.actionId)
      : null;
    this.#applyMetricsDelta(result, action.actionId, this.#elapsedSeconds + result.consumedSeconds);
    if (result.inventoryDelta) {
      this.#robot.inventory = nextInventory!;
      this.#events.push({
        type: "inventory-changed",
        actionId: action.actionId,
        timeSeconds: this.#elapsedSeconds + result.consumedSeconds,
        details: { ...result.inventoryDelta },
      });
    }
    for (const event of result.events ?? []) {
      this.#events.push({
        ...event,
        actionId: action.actionId,
        timeSeconds: this.#elapsedSeconds + result.consumedSeconds,
      });
    }
    if (result.complete) this.#completeActiveAction(result.consumedSeconds);
    return result.consumedSeconds;
  }

  #inventoryAfterDelta(delta: Readonly<Record<string, number>>, actionId: string): Record<string, number> {
    const result = { ...this.#robot.inventory };
    for (const [objectType, change] of Object.entries(delta)) {
      if (!this.#game.gameObjectTypes.includes(objectType)) {
        throw new Error(`Action "${actionId}" changed unknown game-object type "${objectType}".`);
      }
      const count = (result[objectType] ?? 0) + change;
      if (!Number.isInteger(count) || count < 0) throw new Error(`Action "${actionId}" produced invalid ${objectType} inventory.`);
      const capacity = this.#robot.perObjectCapacity[objectType];
      if (capacity !== undefined && count > capacity) throw new Error(`Action "${actionId}" exceeded ${objectType} capacity.`);
      result[objectType] = count;
    }
    if (Object.values(result).reduce((sum, count) => sum + count, 0) > this.#robot.totalGameObjectCapacity) {
      throw new Error(`Action "${actionId}" exceeded total game-object capacity.`);
    }
    return result;
  }

  #validateMetricsDelta(
    result: { readonly pointsDelta?: number; readonly rankingPointProgressDelta?: Readonly<Record<string, number>> },
    actionId: string,
  ): void {
    if (result.pointsDelta !== undefined) {
      if (!Number.isFinite(result.pointsDelta)) {
        throw new Error(`Action "${actionId}" returned a non-finite points delta.`);
      }
      if (!Number.isFinite(this.#metrics.points + result.pointsDelta)) {
        throw new Error(`Action "${actionId}" produced invalid cumulative points.`);
      }
    }
    for (const [rankingPointId, change] of Object.entries(result.rankingPointProgressDelta ?? {})) {
      if (!Object.hasOwn(this.#metrics.rankingPoints, rankingPointId)) {
        throw new Error(`Action "${actionId}" changed unknown ranking-point ID "${rankingPointId}".`);
      }
      if (!Number.isFinite(change)) {
        throw new Error(`Action "${actionId}" returned a non-finite ranking-point progress delta for "${rankingPointId}".`);
      }
    }
  }

  #applyMetricsDelta(
    result: { readonly pointsDelta?: number; readonly rankingPointProgressDelta?: Readonly<Record<string, number>> },
    actionId: string,
    timeSeconds: number,
  ): void {
    const rankingPointDeltas = Object.entries(result.rankingPointProgressDelta ?? {});

    if (result.pointsDelta !== undefined) {
      this.#metrics.points += result.pointsDelta;
      if (result.pointsDelta !== 0) {
        this.#events.push({
          type: "points-changed",
          actionId,
          timeSeconds,
          details: { delta: result.pointsDelta, points: this.#metrics.points },
        });
      }
    }
    for (const [rankingPointId, change] of rankingPointDeltas) {
      const previous = this.#metrics.rankingPoints[rankingPointId]!;
      const progress = Math.min(1, Math.max(0, previous.progress + change));
      const earned = progress >= 1;
      if (progress === previous.progress && earned === previous.earned) continue;
      this.#metrics.rankingPoints[rankingPointId] = { progress, earned };
      this.#events.push({
        type: "ranking-point-progress-changed",
        actionId,
        timeSeconds,
        details: { rankingPointId, delta: change, progress, earned },
      });
    }
  }

  #completeActiveAction(consumedSeconds: number): void {
    if (!this.#active) return;
    this.#events.push({
      type: "action-completed",
      actionId: this.#active.actionId,
      timeSeconds: this.#elapsedSeconds + consumedSeconds,
    });
    this.#active = null;
  }

  #consumeTime(seconds: number): void {
    this.#elapsedSeconds += seconds;
    this.#remainingTickSeconds = Math.max(0, this.#remainingTickSeconds - seconds);
  }

  #actionContext(): ActionContext {
    const robot = cloneRobot(this.#robot);
    return {
      robot,
      metrics: cloneMetrics(this.#metrics),
      zones: this.#game.zones,
      elapsedSeconds: this.#elapsedSeconds,
      random: this.#random,
      robotContactsZone: (zone) => robotContactsZone(robot, zone),
    };
  }

  getDecisionState(): DecisionState {
    const enabledActions = [
      driveMetadata(),
      ...[...this.#enabledActionIds]
        .filter((id) => id !== DRIVE_ACTION_ID)
        .map((id) => this.#definitions.get(id)!.metadata),
    ];
    const relevantZones = (kind: "pickup" | "score"): readonly Zone[] => {
      const metadata = enabledActions.filter((action) => action.zoneKind === kind);
      return this.#game.zones.filter((zone) => metadata.some((action) => zoneMatchesSelector(zone, {
        kind,
        tags: action.zoneTags,
        zoneIds: action.zoneIds,
      })));
    };
    const pickupZones = relevantZones("pickup");
    const scoreZones = relevantZones("score");
    const distanceToNearest = (zones: readonly Zone[]): number | null => zones.length === 0
      ? null : Math.min(...zones.map((zone) => robotDistanceToZone(this.#robot, zone)));
    return Object.freeze({
      status: this.#status,
      elapsedSeconds: this.#elapsedSeconds,
      timeRemainingSeconds: Math.max(0, this.#timing.durationSeconds - this.#elapsedSeconds),
      endgameActive: this.#elapsedSeconds >= this.#timing.durationSeconds - this.#timing.endgameDurationSeconds,
      robot: cloneRobot(this.#robot),
      metrics: cloneMetrics(this.#metrics),
      activeAction: this.#active ? cloneSummary(this.#active) : null,
      queuedActions: Object.freeze(this.#queue.map(cloneSummary)),
      enabledActions: Object.freeze(enabledActions.map((metadata) => Object.freeze({ ...metadata }))),
      pickupZones: Object.freeze([...pickupZones]),
      scoreZones: Object.freeze([...scoreZones]),
      nonTraversalZones: Object.freeze(this.#game.zones.filter((zone) => zone.kind === "non-traversal")),
      distanceToNearestPickupZoneFeet: distanceToNearest(pickupZones),
      distanceToNearestScoreZoneFeet: distanceToNearest(scoreZones),
      block: this.#block ? Object.freeze({ ...this.#block }) : null,
    });
  }

  exportPlayback(): SimulationPlayback | null {
    if (!this.#recordPlayback) return null;
    const frames = structuredClone(this.#frames);
    const lastFrame = frames.at(-1);
    if (lastFrame?.timeSeconds !== this.#elapsedSeconds || lastFrame.status !== this.#status
        || !metricsEqual(lastFrame.metrics, this.#metrics)) {
      frames.push({
        timeSeconds: this.#elapsedSeconds,
        robot: cloneRobot(this.#robot),
        metrics: cloneMetrics(this.#metrics),
        status: this.#status,
      });
    }
    return deepFreeze({
      timing: structuredClone(this.#timing),
      zones: structuredClone(this.#game.zones),
      rankingPointDefinitions: structuredClone(this.#rankingPointDefinitions),
      frames,
      events: structuredClone(this.#events),
      ...(this.#game.navGrid ? { navGrid: structuredClone(this.#game.navGrid) } : {}),
    });
  }

  #recordFrame(): void {
    const previous = this.#frames.at(-1);
    if (previous?.timeSeconds === this.#elapsedSeconds && previous.status === this.#status
        && metricsEqual(previous.metrics, this.#metrics)) return;
    this.#frames.push({
      timeSeconds: this.#elapsedSeconds,
      robot: cloneRobot(this.#robot),
      metrics: cloneMetrics(this.#metrics),
      status: this.#status,
    });
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createSimulation(
  game: GameDefinition,
  robot: RobotConfiguration,
  options?: SimulationOptions,
): SimulationEngine {
  return new SimulationEngine(game, robot, options);
}
