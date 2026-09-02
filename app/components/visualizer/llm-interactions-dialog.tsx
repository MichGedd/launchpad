import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { SimulationDebugTrace } from "~/simulation";

interface LlmInteractionsDialogProps {
  readonly traces: readonly SimulationDebugTrace[];
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function LlmInteractionsDialog({ traces }: LlmInteractionsDialogProps) {
  return (
    <DialogContent closeLabel="Close LLM interactions" className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>LLM interactions</DialogTitle>
        <DialogDescription>
          Development-only trace of every completed model decision used by this simulation.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-7 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {traces.length > 0 ? traces.map((trace, index) => (
          <details className="rounded-2xl border border-white/10 bg-black/10 dark:bg-black/15" key={`${trace.decisionNumber}-${index}`} open={index === traces.length - 1}>
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
              Decision {trace.decisionNumber} · {trace.model} · {trace.reasoningEffort}
            </summary>
            <div className="space-y-4 border-t border-white/10 p-4">
              <TraceSection heading="System instructions" value={trace.system} />
              <TraceSection heading="Query" value={trace.prompt} />
              <TraceSection heading="Response" value={formatJson(trace.response)} />
              <TraceSection heading="Usage" value={formatJson(trace.usage)} />
            </div>
          </details>
        )) : (
          <p className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-muted-foreground dark:bg-black/15">
            No completed LLM interactions are available for this simulation.
          </p>
        )}
      </div>
    </DialogContent>
  );
}

function TraceSection({ heading, value }: { readonly heading: string; readonly value: string }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{heading}</h2>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 px-3 py-2 text-xs leading-5 text-foreground">
        <code>{value}</code>
      </pre>
    </section>
  );
}

export { LlmInteractionsDialog };
