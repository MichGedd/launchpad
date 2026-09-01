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
import type { ReplayGenerationRequest, VisualizerScene } from "./types.ts";

const DEMO_FIELD = Object.freeze({ widthFeet: 54, heightFeet: 27 });
const DEMO_DURATION_SECONDS = 12;
const DEMO_RANKING_POINTS: readonly Required<RankingPointDefinition>[] = Object.freeze([
  { id: "collection", label: "Collection RP", value: 1 },
  { id: "scoring", label: "Scoring RP", value: 1 },
]);
const DEMO_ROBOT_STATE: Omit<RobotState, "pose"> = Object.freeze({
  inventory: Object.freeze({}),
  totalGameObjectCapacity: 3,
  perObjectCapacity: Object.freeze({}),
  widthFeet: 2.375,
  lengthFeet: 2.375,
  translationSpeedFeetPerSecond: 15,
  spinSpeedRotationsPerSecond: 1,
});

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

const DEMO_EVENTS = events(
  { type: "strategy-started", actionId: "strategy", timeSeconds: 0 },
  {
    type: "object-collected",
    actionId: "collect-object",
    timeSeconds: 5.5,
    details: { objectType: "game-object", count: 1 },
  },
  {
    type: "points-changed",
    actionId: "collect-object",
    timeSeconds: 5.5,
    details: { delta: 3, points: 3 },
  },
  {
    type: "ranking-point-progress-changed",
    actionId: "collect-object",
    timeSeconds: 5.5,
    details: { rankingPointId: "collection", delta: 1, progress: 1, earned: true },
  },
  { type: "goal-reached", actionId: "score-object", timeSeconds: 8.5 },
  {
    type: "points-changed",
    actionId: "score-object",
    timeSeconds: 8.5,
    details: { delta: 9, points: 12 },
  },
  {
    type: "ranking-point-progress-changed",
    actionId: "score-object",
    timeSeconds: 8.5,
    details: { rankingPointId: "scoring", delta: 0.75, progress: 1, earned: true },
  },
  { type: "simulation-complete", actionId: "simulation", timeSeconds: DEMO_DURATION_SECONDS },
);

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
  inventory: Readonly<Record<string, number>> = DEMO_ROBOT_STATE.inventory,
): PlaybackFrame {
  return {
    timeSeconds,
    robot: { ...DEMO_ROBOT_STATE, inventory, pose: robotPose },
    metrics: matchMetrics,
    status,
  };
}

/** Generate a deterministic, season-neutral route for the visualizer UI. */
export async function createDemoReplay(request: ReplayGenerationRequest): Promise<VisualizerScene> {
  if (request.strategy.trim().length === 0) {
    throw new Error("Enter a strategy before generating a replay.");
  }

  const frames: readonly PlaybackFrame[] = Object.freeze([
    robotFrame(0, pose(5, 5, 0), "running", metrics(0, 0, 0)),
    robotFrame(2.5, pose(18, 5, 0), "running", metrics(0, 0.5, 0)),
    robotFrame(5.5, pose(18, 18, 0.25), "running", metrics(3, 1, 0.25), { "game-object": 1 }),
    robotFrame(8.5, pose(38, 18, 0.25), "running", metrics(12, 1, 1)),
    robotFrame(DEMO_DURATION_SECONDS, pose(48, 8, 0.875), "complete", metrics(12, 1, 1)),
  ]);
  const playback: SimulationPlayback = Object.freeze({
    timing: Object.freeze({ durationSeconds: DEMO_DURATION_SECONDS, endgameDurationSeconds: 3 }),
    zones: DEMO_ZONES,
    rankingPointDefinitions: DEMO_RANKING_POINTS,
    frames,
    events: DEMO_EVENTS,
  });
  return {
    field: DEMO_FIELD,
    playback,
  };
}
