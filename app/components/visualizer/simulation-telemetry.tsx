import { BoxIcon, ChartNoAxesCombinedIcon, TrophyIcon } from "lucide-react";

import type {
  MatchMetrics,
  RankingPointDefinition,
  RobotState,
} from "~/engine";
import { calculateEarnedRankingPoints } from "~/visualizer";

interface SimulationTelemetryProps {
  readonly definitions: readonly RankingPointDefinition[];
  readonly metrics: MatchMetrics | null;
  readonly robot: RobotState | null;
}

function formatIdentifier(identifier: string) {
  return identifier
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? points.toString() : points.toFixed(1);
}

function SimulationTelemetry({
  definitions,
  metrics,
  robot,
}: SimulationTelemetryProps) {
  const emptyMetrics: MatchMetrics = { points: 0, rankingPoints: {} };
  const currentMetrics = metrics ?? emptyMetrics;
  const inventory = Object.entries(robot?.inventory ?? {}).filter(
    ([, count]) => count > 0,
  );
  const earnedRankingPoints = calculateEarnedRankingPoints(
    definitions,
    currentMetrics,
  );

  return (
    <aside
      aria-label="Simulation telemetry"
      className="glass-panel pointer-events-none absolute right-5 top-5 w-60 rounded-[20px] border-white/14 bg-[#202527]/78 p-3 text-white shadow-xl shadow-black/20 [@media(max-height:560px)]:right-3 [@media(max-height:560px)]:top-3 [@media(max-height:560px)]:w-56 [@media(max-height:560px)]:p-2.5"
    >
      <div className="mb-2 flex items-center gap-2 [@media(max-height:560px)]:mb-1.5">
        <ChartNoAxesCombinedIcon
          aria-hidden="true"
          className="size-3.5 text-[#8da5ee]"
        />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/72">
          Simulation
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/9 bg-white/7 px-3 py-2 [@media(max-height:560px)]:py-1.5">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/48">
            Points scored
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums leading-none">
            {formatPoints(currentMetrics.points)}
          </p>
        </div>
        <div className="rounded-xl border border-[#6e8ce1]/25 bg-[#21409a]/28 px-3 py-2 [@media(max-height:560px)]:py-1.5">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-[#c8d3f6]/62">
            Total RP
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xl font-semibold tabular-nums leading-none">
            {earnedRankingPoints}
            <TrophyIcon aria-hidden="true" className="size-3.5 text-[#8da5ee]" />
          </p>
        </div>
      </div>

      <section className="mt-2 rounded-xl border border-white/9 bg-white/6 px-3 py-2 [@media(max-height:560px)]:mt-1.5 [@media(max-height:560px)]:py-1.5" aria-label="Game objects held">
        <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/48">
          <BoxIcon aria-hidden="true" className="size-3 text-[#8da5ee]" />
          Game objects
        </div>
        <div className="mt-1 flex min-h-4 flex-wrap gap-1 text-[10px] font-medium">
          {inventory.length > 0 ? (
            inventory.map(([objectType, count]) => (
              <span
                className="rounded-md bg-[#21409a]/38 px-1.5 py-0.5 text-[#e6ebff]"
                key={objectType}
              >
                {formatIdentifier(objectType)} · {count}
              </span>
            ))
          ) : (
            <span className="text-white/48">Empty</span>
          )}
        </div>
      </section>

      <section className="mt-2 space-y-1.5 [@media(max-height:560px)]:mt-1.5 [@media(max-height:560px)]:space-y-1" aria-label="Ranking point progress">
        {definitions.length > 0 ? (
          definitions.map((definition) => {
            const state = currentMetrics.rankingPoints[definition.id] ?? {
              earned: false,
              progress: 0,
            };
            const percentage = Math.round(state.progress * 100);

            return (
              <div key={definition.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate font-medium text-white/78">
                    {definition.label}
                  </span>
                  <span className={state.earned ? "font-semibold text-[#aebfff]" : "tabular-nums text-white/52"}>
                    {state.earned ? "Earned" : `${percentage}%`}
                  </span>
                </div>
                <div
                  aria-label={`${definition.label} progress`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={percentage}
                  className="h-1 overflow-hidden rounded-full bg-white/12"
                  role="progressbar"
                >
                  <div
                    className="h-full rounded-full bg-[#6e8ce1] transition-[width] duration-200"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-[10px] text-white/45">No ranking points configured</p>
        )}
      </section>
    </aside>
  );
}

export { SimulationTelemetry };
