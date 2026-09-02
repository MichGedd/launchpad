import type {
  MatchMetrics,
  PlaybackFrame,
  Pose,
  RankingPointDefinition,
  Zone,
} from "../engine/types.ts";
import {
  DEFAULT_ROBOT_CUSTOMIZATION,
  type FieldPresentation,
  type RobotCustomization,
  type VisualizerPreview,
} from "../visualizer/types.ts";

/** Shared presentation metadata for the season-neutral controller scenario. */
export const NEUTRAL_FIELD_PRESENTATION: FieldPresentation = Object.freeze({
  widthFeet: 54,
  heightFeet: 27,
});

/** Shared field geometry consumed by both the engine adapter and preview. */
export const NEUTRAL_ZONES: readonly Zone[] = Object.freeze([
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
  {
    id: "field-divider",
    kind: "non-traversal",
    shape: { type: "rectangle", center: { xFeet: 27, yFeet: 25.5 }, widthFeet: 0.25, heightFeet: 1 },
  },
]);

/** Shared ranking-point definitions consumed by the engine and preview. */
export const NEUTRAL_RANKING_POINT_DEFINITIONS: readonly Required<RankingPointDefinition>[] = Object.freeze([
  { id: "collection", label: "Collection RP", value: 1 },
  { id: "scoring", label: "Scoring RP", value: 1 },
]);

/** Shared starting pose for the neutral scenario. */
export const NEUTRAL_INITIAL_POSE: Pose = Object.freeze({
  xFeet: 5,
  yFeet: 5,
  headingRotations: 0,
});

/** Build the zero-time neutral field state shown before a run is generated. */
export function createNeutralVisualizerPreview(
  customization: RobotCustomization = DEFAULT_ROBOT_CUSTOMIZATION,
): VisualizerPreview {
  const metrics: MatchMetrics = Object.freeze({
    points: 0,
    rankingPoints: Object.freeze(Object.fromEntries(
      NEUTRAL_RANKING_POINT_DEFINITIONS.map((definition) => [
        definition.id,
        Object.freeze({ progress: 0, earned: false }),
      ]),
    )),
  });
  const initialFrame: PlaybackFrame = Object.freeze({
    timeSeconds: 0,
    robot: Object.freeze({
      pose: NEUTRAL_INITIAL_POSE,
      inventory: Object.freeze({}),
      totalGameObjectCapacity: 3,
      perObjectCapacity: Object.freeze({ "game-object": 3 }),
      ...customization,
    }),
    metrics,
    status: "awaiting-actions",
  });
  return Object.freeze({
    field: NEUTRAL_FIELD_PRESENTATION,
    zones: NEUTRAL_ZONES,
    rankingPointDefinitions: NEUTRAL_RANKING_POINT_DEFINITIONS,
    initialFrame,
  });
}
