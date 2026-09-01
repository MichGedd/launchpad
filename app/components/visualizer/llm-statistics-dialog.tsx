import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { LlmStatistics } from "~/llm/client";
import type { TokenStatistics } from "~/llm/schemas";

interface LlmStatisticsDialogProps {
  readonly statistics: LlmStatistics | null;
}

function formatAverage(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

function StatisticsSection({ heading, statistics }: { readonly heading: string; readonly statistics: TokenStatistics | null }) {
  if (!statistics || statistics.decisions === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-black/10 p-4 dark:bg-black/15">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <p className="mt-2 text-sm text-muted-foreground">No model decisions have been recorded yet.</p>
      </section>
    );
  }

  const metrics = [
    ["Decisions", statistics.decisions.toLocaleString()],
    ["Input tokens", statistics.inputTokens.toLocaleString()],
    ["Output tokens", statistics.outputTokens.toLocaleString()],
    ["Total tokens", statistics.totalTokens.toLocaleString()],
    ["Cached input tokens", statistics.cachedInputTokens.toLocaleString()],
    ["Average per decision", formatAverage(statistics.averageTokensPerDecision)],
  ] as const;

  return (
    <section className="rounded-2xl border border-white/10 bg-black/10 p-4 dark:bg-black/15">
      <h2 className="text-sm font-semibold">{heading}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div className="rounded-xl bg-white/5 p-3" key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LlmStatisticsDialog({ statistics }: LlmStatisticsDialogProps) {
  return (
    <DialogContent closeLabel="Close report statistics" className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Report statistics</DialogTitle>
        <DialogDescription>
          Token usage is held in this server session and is reset when you disconnect.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-7 space-y-4">
        <StatisticsSection heading="Latest generation" statistics={statistics?.latestGeneration ?? null} />
        <StatisticsSection heading="Session total" statistics={statistics?.sessionTotal ?? null} />
      </div>
    </DialogContent>
  );
}

export { LlmStatisticsDialog };
