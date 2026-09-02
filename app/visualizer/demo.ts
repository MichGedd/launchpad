import type {
  ActionEvent,
  MatchMetrics,
  PlaybackFrame,
  Pose,
  RankingPointDefinition,
  RobotState,
  SimulationPlayback,
  Zone,
} from "../engine/types.ts";
import { NAV_GRID_CELL_SIZE_INCHES } from "../engine/types.ts";
import { shortestHeadingDelta } from "../engine/geometry.ts";
import type {
  ReplayGenerationRequest,
  RobotCustomization,
  VisualizerScene,
} from "./types.ts";

const DEMO_FIELD = Object.freeze({ widthFeet: 54, heightFeet: 27 });
const DEMO_NAV_GRID = Object.freeze({
  version: 1 as const,
  seasonId: "neutral",
  fieldWidthFeet: DEMO_FIELD.widthFeet,
  fieldHeightFeet: DEMO_FIELD.heightFeet,
  cellSizeInches: NAV_GRID_CELL_SIZE_INCHES,
  zones: Object.freeze([]),
});
const DEMO_RANKING_POINTS: readonly Required<RankingPointDefinition>[] = Object.freeze([
  { id: "collection", label: "Collection RP", value: 1 },
  { id: "scoring", label: "Scoring RP", value: 1 },
]);
const DEMO_ROBOT_CAPABILITIES: Omit<RobotState, "pose" | "widthFeet" | "lengthFeet" | "translationSpeedFeetPerSecond" | "spinSpeedRotationsPerSecond"> = Object.freeze({
  inventory: Object.freeze({}),
  totalGameObjectCapacity: 3,
  perObjectCapacity: Object.freeze({}),
});

const DEMO_WAYPOINTS: readonly { readonly pose: Pose; readonly metrics: MatchMetrics; readonly inventory?: Readonly<Record<string, number>> }[] = Object.freeze([
  { pose: pose(5, 5, 0), metrics: metrics(0, 0, 0) },
  { pose: pose(18, 5, 0), metrics: metrics(0, 0.5, 0) },
  { pose: pose(18, 18, 0.25), metrics: metrics(3, 1, 0.25), inventory: { "game-object": 1 } },
  { pose: pose(38, 18, 0.25), metrics: metrics(12, 1, 1) },
  { pose: pose(48, 8, 0.875), metrics: metrics(12, 1, 1) },
]);

const DEMO_ZONES: readonly Zone[] = Object.freeze([
  {
    id: "collection-area",
    kind: "pickup",
    tags: ["game-object"],
    shape: { type: "circle", center: { xFeet: 18, yFeet: 5 }, radiusFeet: 2 },
  },
  {
    id: "scoring-area",
    kind: "score",
    tags: ["game-object"],
    shape: { type: "rectangle", center: { xFeet: 38, yFeet: 18 }, widthFeet: 6, heightFeet: 4 },
  },
]);

function events(...values: ActionEvent[]): readonly ActionEvent[] {
  return Object.freeze(values);
}

function metrics(
  points: number,
  collectionProgress: number,
  scoringProgress: number,
): MatchMetrics {
  return {
    points,
    rankingPoints: {
      collection: {
        progress: collectionProgress,
        earned: collectionProgress >= 1,
      },
      scoring: {
        progress: scoringProgress,
        earned: scoringProgress >= 1,
      },
    },
  };
}

function pose(xFeet: number, yFeet: number, headingRotations: number): Pose {
  return { xFeet, yFeet, headingRotations };
}

function robotFrame(
  timeSeconds: number,
  robotPose: Pose,
  status: PlaybackFrame["status"],
  matchMetrics: MatchMetrics,
  customization: RobotCustomization,
  inventory: Readonly<Record<string, number>> = DEMO_ROBOT_CAPABILITIES.inventory,
): PlaybackFrame {
  return {
    timeSeconds,
    robot: { ...DEMO_ROBOT_CAPABILITIES, ...customization, inventory, pose: robotPose },
    metrics: matchMetrics,
    status,
  };
}

function getWaypointTimes(customization: RobotCustomization): readonly number[] {
  const times = [0];
  for (let index = 1; index < DEMO_WAYPOINTS.length; index += 1) {
    const previous = DEMO_WAYPOINTS[index - 1].pose;
    const current = DEMO_WAYPOINTS[index].pose;
    const distanceFeet = Math.hypot(
      current.xFeet - previous.xFeet,
      current.yFeet - previous.yFeet,
    );
    const translationDuration = distanceFeet / customization.translationSpeedFeetPerSecond;
    const rotationDuration = Math.abs(shortestHeadingDelta(
      previous.headingRotations,
      current.headingRotations,
    )) / customization.spinSpeedRotationsPerSecond;
    times.push(times[index - 1] + Math.max(translationDuration, rotationDuration));
  }
  return Object.freeze(times);
}

function createDemoEvents(times: readonly number[]): readonly ActionEvent[] {
  return events(
    { type: "strategy-started", actionId: "strategy", timeSeconds: times[0] },
    {
      type: "object-collected",
      actionId: "collect-object",
      timeSeconds: times[2],
      details: { objectType: "game-object", count: 1 },
    },
    {
      type: "points-changed",
      actionId: "collect-object",
      timeSeconds: times[2],
      details: { delta: 3, points: 3 },
    },
    {
      type: "ranking-point-progress-changed",
      actionId: "collect-object",
      timeSeconds: times[2],
      details: { rankingPointId: "collection", delta: 1, progress: 1, earned: true },
    },
    { type: "goal-reached", actionId: "score-object", timeSeconds: times[3] },
    {
      type: "points-changed",
      actionId: "score-object",
      timeSeconds: times[3],
      details: { delta: 9, points: 12 },
    },
    {
      type: "ranking-point-progress-changed",
      actionId: "score-object",
      timeSeconds: times[3],
      details: { rankingPointId: "scoring", delta: 0.75, progress: 1, earned: true },
    },
    { type: "simulation-complete", actionId: "simulation", timeSeconds: times.at(-1)! },
  );
}

/** Generate a deterministic, season-neutral route for the visualizer UI. */
export async function createDemoReplay(request: ReplayGenerationRequest): Promise<VisualizerScene> {
  if (request.strategy.trim().length === 0) {
    throw new Error("Enter a strategy before generating a replay.");
  }

  const times = getWaypointTimes(request.robotCustomization);
  const frames: readonly PlaybackFrame[] = Object.freeze(
    DEMO_WAYPOINTS.map((waypoint, index) => robotFrame(
      times[index],
      waypoint.pose,
      index === DEMO_WAYPOINTS.length - 1 ? "complete" : "running",
      waypoint.metrics,
      request.robotCustomization,
      waypoint.inventory,
    )),
  );
  const durationSeconds = times.at(-1)!;
  const playback: SimulationPlayback = Object.freeze({
    timing: Object.freeze({
      durationSeconds,
      endgameDurationSeconds: Math.min(3, durationSeconds),
    }),
    zones: DEMO_ZONES,
    rankingPointDefinitions: DEMO_RANKING_POINTS,
    frames,
    events: createDemoEvents(times),
  });
  return {
    field: DEMO_FIELD,
    navGrid: request.navGrid ?? DEMO_NAV_GRID,
    playback,
  };
}
