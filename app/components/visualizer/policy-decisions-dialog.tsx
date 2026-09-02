import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { PolicyDecisionTrace } from "~/policy";

interface PolicyDecisionsDialogProps {
  readonly traces: readonly PolicyDecisionTrace[];
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

export function PolicyDecisionsDialog({ traces }: PolicyDecisionsDialogProps) {
  return (
    <DialogContent className="max-h-[88svh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Policy decisions</DialogTitle>
        <DialogDescription>
          Deterministic rule evaluations recorded while the replay was generated.
        </DialogDescription>
      </DialogHeader>

      <div aria-label="Policy decision trace" className="mt-6 space-y-3">
        {traces.length === 0 ? (
          <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Generate a simulation to inspect its policy decisions.
          </p>
        ) : traces.map((trace) => (
          <article className="rounded-2xl border border-border bg-background/45 p-4" key={`${trace.decisionNumber}-${trace.elapsedSeconds}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold">
                Decision {trace.decisionNumber} · {trace.phase === "match" ? "Match" : "Endgame"}
              </h3>
              <span className="font-mono text-xs text-muted-foreground">{formatTime(trace.elapsedSeconds)}</span>
            </div>
            <p className="mt-2 text-sm text-foreground">{trace.explanation}</p>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Rule</dt>
                <dd className="font-medium">{trace.usedFallback ? "Fallback" : trace.selectedRuleId ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Goal</dt>
                <dd className="font-medium">{trace.goalId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Target</dt>
                <dd className="font-medium">{trace.targetId ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-border/70 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evaluated rules</p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {trace.evaluations.map((evaluation) => (
                  <li className="flex flex-wrap gap-x-2 gap-y-0.5" key={evaluation.ruleId}>
                    <span className={evaluation.selected ? "font-semibold text-[#21409a]" : "font-medium"}>{evaluation.ruleId}</span>
                    <span className="text-muted-foreground">{evaluation.explanation}</span>
                  </li>
                ))}
              </ul>
            </div>
            {trace.actions.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Actions: {trace.actions.map((action) => action.actionId).join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </DialogContent>
  );
}
