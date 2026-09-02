import { interpolatePose } from "../engine/geometry.ts";
import type { PlaybackFrame, RobotState, SimulationPlayback } from "../engine/types.ts";

const TIME_EPSILON = 1e-9;

/** Clamp a requested playback time to the match timeline. Non-finite values reset to the start. */
export function clampPlaybackTime(playback: SimulationPlayback, timeSeconds: number): number {
  const duration = Number.isFinite(playback.timing.durationSeconds)
    ? Math.max(0, playback.timing.durationSeconds)
    : 0;
  const requested = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  return Math.min(duration, Math.max(0, requested));
}

/** Return the frame at or immediately before a time, with bounds clamped to the match. */
export function getPlaybackFrameAtTime(
  playback: SimulationPlayback,
  timeSeconds: number,
): PlaybackFrame | null {
  if (playback.frames.length === 0) return null;
  const time = clampPlaybackTime(playback, timeSeconds);
  let low = 0;
  let high = playback.frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (playback.frames[middle]!.timeSeconds <= time) low = middle;
    else high = middle - 1;
  }
  return playback.frames[low]!;
}

function findNextFrame(playback: SimulationPlayback, lowerIndex: number): PlaybackFrame | null {
  const lowerTime = playback.frames[lowerIndex]!.timeSeconds;
  for (let index = lowerIndex + 1; index < playback.frames.length; index += 1) {
    const frame = playback.frames[index]!;
    if (frame.timeSeconds > lowerTime + TIME_EPSILON) return frame;
  }
  return null;
}

function copyInterpolatedRobot(lower: RobotState, upper: RobotState, progress: number): RobotState {
  return {
    ...lower,
    pose: interpolatePose(lower.pose, upper.pose, progress, progress),
    // Inventory and action status are discrete values; keep the state active until the next frame.
    inventory: lower.inventory,
    perObjectCapacity: lower.perObjectCapacity,
  };
}

/** Select or interpolate a replay frame, using the engine's shortest-heading convention. */
export function interpolatePlaybackFrame(
  playback: SimulationPlayback,
  timeSeconds: number,
): PlaybackFrame | null {
  if (playback.frames.length === 0) return null;
  const time = clampPlaybackTime(playback, timeSeconds);
  const lower = getPlaybackFrameAtTime(playback, time);
  if (lower === null) return null;
  const lowerIndex = playback.frames.indexOf(lower);
  const upper = findNextFrame(playback, lowerIndex);
  if (upper === null || time <= lower.timeSeconds + TIME_EPSILON) return lower;
  const progress = Math.min(1, Math.max(0, (time - lower.timeSeconds) / (upper.timeSeconds - lower.timeSeconds)));
  return {
    timeSeconds: time,
    robot: copyInterpolatedRobot(lower.robot, upper.robot, progress),
    metrics: lower.metrics,
    zoneStates: lower.zoneStates,
    status: lower.status,
  };
}

/** True once the requested time reaches the end of the configured match. */
export function isPlaybackComplete(playback: SimulationPlayback, timeSeconds: number): boolean {
  return clampPlaybackTime(playback, timeSeconds) >= Math.max(0, playback.timing.durationSeconds) - TIME_EPSILON;
}
