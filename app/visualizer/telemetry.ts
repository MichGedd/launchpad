import type {
  MatchMetrics,
  RankingPointDefinition,
} from "../engine/types.ts";

export function calculateEarnedRankingPoints(
  definitions: readonly RankingPointDefinition[],
  metrics: MatchMetrics,
): number {
  return definitions.reduce((total, definition) => {
    const state = metrics.rankingPoints[definition.id];
    return state?.earned ? total + (definition.value ?? 1) : total;
  }, 0);
}
