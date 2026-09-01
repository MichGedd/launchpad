import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PlaybackFrame, RobotState, SimulationPlayback } from "../engine/types.ts";
import {
  calculateEarnedRankingPoints,
  clampPlaybackTime,
  createDemoReplay,
  getPlaybackFrameAtTime,
  interpolatePlaybackFrame,
  isPlaybackComplete,
  type ReplayGenerationRequest,
} from "./index.ts";

function robot(xFeet: number, yFeet: number, headingRotations: number): RobotState {
  return {
    pose: { xFeet, yFeet, headingRotations },
    inventory: {},
    totalGameObjectCapacity: 1,
    perObjectCapacity: {},
    widthFeet: 2,
    lengthFeet: 2,
    translationSpeedFeetPerSecond: 1,
    spinSpeedRotationsPerSecond: 1,
  };
}

function playback(frames: readonly PlaybackFrame[]): SimulationPlayback {
  return {
    timing: { durationSeconds: 10, endgameDurationSeconds: 2 },
    zones: [],
    rankingPointDefinitions: [
      { id: "collection", label: "Collection RP", value: 1 },
      { id: "scoring", label: "Scoring RP", value: 2 },
    ],
    frames,
    events: [],
  };
}

function metrics(points = 0, collectionProgress = 0) {
  return {
    points,
    rankingPoints: {
      collection: {
        progress: collectionProgress,
        earned: collectionProgress >= 1,
      },
      scoring: { progress: 0, earned: false },
    },
  };
}

const FRAMES: readonly PlaybackFrame[] = [
  { timeSeconds: 2, robot: robot(0, 0, 0), metrics: metrics(), status: "running" },
  { timeSeconds: 6, robot: robot(8, 4, 0.5), metrics: metrics(5, 0.5), status: "running" },
  { timeSeconds: 10, robot: robot(10, 10, 0.75), metrics: metrics(12, 1), status: "complete" },
];

describe("visualizer playback utilities", () => {
  test("clamps playback time and selects surrounding frames", () => {
    const simulation = playback(FRAMES);
    assert.equal(clampPlaybackTime(simulation, -2), 0);
    assert.equal(clampPlaybackTime(simulation, 14), 10);
    assert.equal(clampPlaybackTime(simulation, Number.NaN), 0);
    assert.equal(getPlaybackFrameAtTime(simulation, 1), FRAMES[0]);
    assert.equal(getPlaybackFrameAtTime(simulation, 6), FRAMES[1]);
    assert.equal(getPlaybackFrameAtTime(simulation, 9), FRAMES[1]);
    assert.equal(getPlaybackFrameAtTime(simulation, 20), FRAMES[2]);
  });

  test("interpolates position and preserves the active discrete state", () => {
    const frame = interpolatePlaybackFrame(playback(FRAMES), 4)!;
    assert.equal(frame.timeSeconds, 4);
    assert.equal(frame.robot.pose.xFeet, 4);
    assert.equal(frame.robot.pose.yFeet, 2);
    assert.equal(frame.robot.pose.headingRotations, 0.25);
    assert.deepEqual(frame.metrics, metrics());
    assert.equal(frame.status, "running");
  });

  test("interpolates heading across the zero rotation boundary using the shortest path", () => {
    const simulation = playback([
      { timeSeconds: 0, robot: robot(0, 0, 0.99), metrics: metrics(), status: "running" },
      { timeSeconds: 1, robot: robot(0, 0, 0.01), metrics: metrics(), status: "complete" },
    ]);
    const frame = interpolatePlaybackFrame(simulation, 0.5)!;
    assert.ok(Math.abs(frame.robot.pose.headingRotations - 0) < 1e-9
      || Math.abs(frame.robot.pose.headingRotations - 1) < 1e-9);
  });

  test("calculates total earned ranking-point value", () => {
    const simulation = playback(FRAMES);
    assert.equal(
      calculateEarnedRankingPoints(
        simulation.rankingPointDefinitions,
        metrics(12, 1),
      ),
      1,
    );
    assert.equal(
      calculateEarnedRankingPoints(
        simulation.rankingPointDefinitions,
        {
          points: 12,
          rankingPoints: {
            collection: { progress: 1, earned: true },
            scoring: { progress: 1, earned: true },
          },
        },
      ),
      3,
    );
  });

  test("reports completion at the configured duration and handles empty playback", () => {
    const simulation = playback(FRAMES);
    assert.equal(isPlaybackComplete(simulation, 9.999), false);
    assert.equal(isPlaybackComplete(simulation, 10), true);
    assert.equal(isPlaybackComplete(simulation, 100), true);
    const empty = playback([]);
    assert.equal(getPlaybackFrameAtTime(empty, 1), null);
    assert.equal(interpolatePlaybackFrame(empty, 1), null);
  });
});

describe("deterministic demo replay generator", () => {
  const request: ReplayGenerationRequest = {
    strategy: "Drive to the far side, then return to the start zone.",
    selectedFeatureIds: ["drive-planning"],
  };

  test("rejects an empty strategy with an actionable error", async () => {
    await assert.rejects(
      createDemoReplay({ strategy: "  ", selectedFeatureIds: [] }),
      /Enter a strategy before generating a replay/,
    );
  });

  test("returns deterministic season-neutral field and playback data", async () => {
    const first = await createDemoReplay(request);
    const second = await createDemoReplay(request);
    assert.deepEqual(first, second);
    assert.deepEqual(first.field, { widthFeet: 54, heightFeet: 27 });
    assert.deepEqual(first.playback.zones.map((zone) => zone.id), ["collection-area", "scoring-area"]);
    assert.deepEqual(first.playback.rankingPointDefinitions.map((definition) => definition.id), [
      "collection", "scoring",
    ]);
    assert.deepEqual(first.playback.events.map((event) => event.type), [
      "strategy-started",
      "object-collected",
      "points-changed",
      "ranking-point-progress-changed",
      "goal-reached",
      "points-changed",
      "ranking-point-progress-changed",
      "simulation-complete",
    ]);
    assert.equal(first.playback.frames.at(-1)!.metrics.points, 12);
    assert.equal(first.playback.frames.at(-1)!.status, "complete");
    assert.equal(first.playback.frames.at(-1)!.timeSeconds, first.playback.timing.durationSeconds);
  });
});
