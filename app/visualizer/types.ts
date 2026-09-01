import type { PlaybackFrame, SimulationPlayback } from "../engine/types.ts";

/** Presentation metadata for the field shown by the visualizer. */
export interface FieldPresentation {
  readonly widthFeet: number;
  readonly heightFeet: number;
  readonly backgroundImage?: FieldBackgroundImage;
}

/** An optional season-provided image. Geometry and rules remain in the engine. */
export interface FieldBackgroundImage {
  readonly source: string;
  readonly altText?: string;
}

/** A selectable, typed capability presented to a strategy author. */
export interface RobotFeatureOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** All data needed to render one replay in the visualizer. */
export interface VisualizerScene {
  readonly playback: SimulationPlayback;
  readonly field: FieldPresentation;
}

/** Input supplied to a replay generator. */
export interface ReplayGenerationRequest {
  readonly strategy: string;
  readonly selectedFeatureIds: readonly string[];
}

/** Async boundary between the UI and an LLM or another replay-producing controller. */
export type ReplayGenerator = (request: ReplayGenerationRequest) => Promise<VisualizerScene>;

/** A small set of season-neutral capabilities suitable for the demo visualizer. */
export const DEFAULT_ROBOT_FEATURE_OPTIONS: readonly RobotFeatureOption[] = Object.freeze([
  {
    id: "drive-planning",
    label: "Drive planning",
    description: "Plan efficient paths between points on the field.",
  },
  {
    id: "object-intake",
    label: "Object intake",
    description: "Collect game objects during the route.",
  },
  {
    id: "goal-scoring",
    label: "Goal scoring",
    description: "Deliver collected objects to a scoring area.",
  },
]);

export type { PlaybackFrame };
