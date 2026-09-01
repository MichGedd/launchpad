import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { StrategyPlan } from "~/llm/client";

interface StrategyPlanDialogProps {
  readonly plan: StrategyPlan | null;
}

function formatParameters(parameters: Readonly<Record<string, unknown>>) {
  if (Object.keys(parameters).length === 0) return "No parameters";
  return JSON.stringify(parameters);
}

function StrategyPlanDialog({ plan }: StrategyPlanDialogProps) {
  return (
    <DialogContent closeLabel="Close strategy plan" className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Strategy plan</DialogTitle>
        <DialogDescription>
          This is a suggested action plan. It has not been sent to the simulator or executed.
        </DialogDescription>
      </DialogHeader>

      {plan ? (
        <div className="mt-7 space-y-6">
          <section className="rounded-2xl border border-[#6e8ce1]/30 bg-[#21409a]/12 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#aebfff]">Summary</h2>
            <p className="mt-2 text-sm leading-6">{plan.summary}</p>
          </section>

          <section aria-labelledby="strategy-plan-actions">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold" id="strategy-plan-actions">Ordered actions</h2>
              <span className="text-xs text-muted-foreground">{plan.actions.length} {plan.actions.length === 1 ? "action" : "actions"}</span>
            </div>
            {plan.actions.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {plan.actions.map((action, index) => {
                  const actionName = action.actionId;
                  return (
                    <li className="rounded-2xl border border-white/10 bg-black/10 p-4 dark:bg-black/15" key={`${actionName}-${index}`}>
                      <div className="flex items-start gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#f7931e] text-xs font-semibold text-[#201407]">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{actionName}</p>
                          <code className="mt-2 block overflow-x-auto rounded-xl bg-black/15 px-3 py-2 text-xs text-muted-foreground">{formatParameters(action.parameters)}</code>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-muted-foreground">No actions were suggested.</p>
            )}
          </section>
        </div>
      ) : null}
    </DialogContent>
  );
}

export { StrategyPlanDialog };
