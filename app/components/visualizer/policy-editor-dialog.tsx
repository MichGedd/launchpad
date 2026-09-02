import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import {
  createNeutralPolicyCatalog,
  NEUTRAL_POLICY_CONDITIONS,
  NEUTRAL_POLICY_GOALS,
} from "~/simulation";
import type {
  JsonValue,
  PolicyDefinition,
  PolicyPhase,
  PolicyRule,
} from "~/policy";
import {
  addPolicyRule,
  deletePolicyRule,
  movePolicyRule,
  resetPolicy,
  updatePolicyRule,
} from "./policy-editor-state";

interface PolicyEditorDialogProps {
  readonly open: boolean;
  readonly policy: PolicyDefinition;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (policy: PolicyDefinition) => void;
}

const catalog = createNeutralPolicyCatalog();

function goalLabel(goalId: string): string {
  return NEUTRAL_POLICY_GOALS.find((goal) => goal.id === goalId)?.label ?? goalId;
}

export function PolicyEditorDialog({ open, policy, onOpenChange, onSave }: PolicyEditorDialogProps) {
  const [draft, setDraft] = useState<PolicyDefinition>(policy);
  const [phase, setPhase] = useState<PolicyPhase>("match");

  useEffect(() => {
    if (open) setDraft(structuredClone(policy));
  }, [open, policy]);

  const validationMessage = useMemo(() => {
    try {
      catalog.validatePolicy(draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Policy is invalid.";
    }
  }, [draft]);

  function updatePhase(update: (current: PolicyDefinition[PolicyPhase]) => PolicyDefinition[PolicyPhase]) {
    setDraft((current) => ({ ...current, [phase]: update(current[phase]) }));
  }

  function updateRule(index: number, update: (rule: PolicyRule) => PolicyRule) {
    setDraft((current) => updatePolicyRule(current, phase, index, update));
  }

  function save() {
    if (validationMessage) return;
    onSave(catalog.validatePolicy(draft));
    onOpenChange(false);
  }

  function reset() {
    setDraft(resetPolicy());
  }

  const currentPhase = draft[phase];

  return (
    <DialogContent className="max-h-[88svh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Edit policy</DialogTitle>
        <DialogDescription>Build ordered rules that resolve to deterministic goals.</DialogDescription>
      </DialogHeader>

      <div className="mt-6 space-y-5">
        <div>
          <label className="text-xs font-medium" htmlFor="policy-editor-name">Policy name</label>
          <input
            className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background/60 px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/45"
            id="policy-editor-name"
            maxLength={100}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            value={draft.name}
          />
        </div>

        <div aria-label="Policy phase" className="grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist">
          {(["match", "endgame"] as const).map((option) => (
            <button
              aria-selected={phase === option}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${phase === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              key={option}
              onClick={() => setPhase(option)}
              role="tab"
              type="button"
            >
              {option === "match" ? "Match" : "Endgame"}
            </button>
          ))}
        </div>

        <div className="space-y-3" aria-label={`${phase} rules`}>
          {currentPhase.rules.map((rule, index) => (
            <RuleCard
              index={index}
              key={index}
              rule={rule}
              total={currentPhase.rules.length}
              onDelete={() => setDraft((current) => deletePolicyRule(current, phase, index))}
              onDown={() => setDraft((current) => movePolicyRule(current, phase, index, index + 1))}
              onRuleChange={(next) => updateRule(index, () => next)}
              onUp={() => setDraft((current) => movePolicyRule(current, phase, index, index - 1))}
            />
          ))}
          <Button
            aria-label={`Add ${phase} rule`}
            className="w-full rounded-xl border-dashed"
            disabled={currentPhase.rules.length >= 32}
            onClick={() => setDraft((current) => addPolicyRule(current, phase))}
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" /> Add rule
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <label className="text-xs font-medium" htmlFor="policy-editor-fallback">Phase fallback</label>
          <select
            className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            id="policy-editor-fallback"
            onChange={(event) => updatePhase((current) => ({ ...current, fallback: { goalId: event.target.value, parameters: {} } }))}
            value={currentPhase.fallback.goalId}
          >
            {NEUTRAL_POLICY_GOALS.map((goal) => <option key={goal.id} value={goal.id}>{goal.label}</option>)}
          </select>
        </div>

        <p aria-live="polite" className={validationMessage ? "text-sm text-red-400" : "text-sm text-muted-foreground"}>
          {validationMessage ?? "Policy is ready to use."}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button aria-label="Reset policy to default" onClick={reset} type="button" variant="ghost">Reset to default</Button>
          <div className="flex gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={Boolean(validationMessage)} onClick={save} type="button">Save policy</Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

interface RuleCardProps {
  readonly rule: PolicyRule;
  readonly index: number;
  readonly total: number;
  readonly onRuleChange: (rule: PolicyRule) => void;
  readonly onDelete: () => void;
  readonly onUp: () => void;
  readonly onDown: () => void;
}

function RuleCard({ rule, index, total, onRuleChange, onDelete, onUp, onDown }: RuleCardProps) {
  function updateCondition(conditionIndex: number, update: (condition: PolicyRule["conditions"][number]) => PolicyRule["conditions"][number]) {
    onRuleChange({ ...rule, conditions: rule.conditions.map((condition, itemIndex) => itemIndex === conditionIndex ? update(condition) : condition) });
  }

  return (
    <article className="rounded-2xl border border-border bg-background/45 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="text-xs font-medium" htmlFor={`rule-id-${index}`}>Rule ID</label>
          <input
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
            id={`rule-id-${index}`}
            maxLength={128}
            onChange={(event) => onRuleChange({ ...rule, id: event.target.value })}
            value={rule.id}
          />
        </div>
        <div className="flex gap-1 pt-5">
          <Button aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={onUp} size="icon" type="button" variant="ghost"><ChevronUpIcon aria-hidden="true" /></Button>
          <Button aria-label={`Move rule ${index + 1} down`} disabled={index === total - 1} onClick={onDown} size="icon" type="button" variant="ghost"><ChevronDownIcon aria-hidden="true" /></Button>
          <Button aria-label={`Delete rule ${index + 1}`} onClick={onDelete} size="icon" type="button" variant="ghost"><Trash2Icon aria-hidden="true" /></Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conditions (AND)</h3><Button aria-label={`Add condition to rule ${index + 1}`} disabled={rule.conditions.length >= 8} onClick={() => onRuleChange({ ...rule, conditions: [...rule.conditions, { conditionId: "always", parameters: {} }] })} size="sm" type="button" variant="ghost"><PlusIcon aria-hidden="true" /> Add</Button></div>
        {rule.conditions.map((condition, conditionIndex) => (
          <div className="rounded-xl bg-muted/45 p-3" key={`${condition.conditionId}-${conditionIndex}`}>
            <label className="text-xs font-medium" htmlFor={`condition-${index}-${conditionIndex}`}>Condition {conditionIndex + 1}</label>
            <select
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
              id={`condition-${index}-${conditionIndex}`}
              onChange={(event) => updateCondition(conditionIndex, () => ({ conditionId: event.target.value, parameters: {} }))}
              value={condition.conditionId}
            >
              {NEUTRAL_POLICY_CONDITIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <ConditionParameters conditionId={condition.conditionId} fieldPrefix={`rule-${index}-condition-${conditionIndex}`} parameters={condition.parameters} onChange={(parameters) => updateCondition(conditionIndex, (current) => ({ ...current, parameters }))} />
            <Button aria-label={`Remove condition ${conditionIndex + 1} from rule ${index + 1}`} className="mt-2" onClick={() => onRuleChange({ ...rule, conditions: rule.conditions.filter((_item, itemIndex) => itemIndex !== conditionIndex) })} size="sm" type="button" variant="ghost">Remove condition</Button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium" htmlFor={`goal-${index}`}>Goal</label>
        <select className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm" id={`goal-${index}`} onChange={(event) => onRuleChange({ ...rule, goal: { goalId: event.target.value, parameters: {} } })} value={rule.goal.goalId}>
          {NEUTRAL_POLICY_GOALS.map((goal) => <option key={goal.id} value={goal.id}>{goal.label}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">{goalLabel(rule.goal.goalId)}</p>
      </div>
    </article>
  );
}

function ConditionParameters({ conditionId, fieldPrefix, parameters, onChange }: { readonly conditionId: string; readonly fieldPrefix: string; readonly parameters: Readonly<Record<string, JsonValue>>; readonly onChange: (parameters: Readonly<Record<string, JsonValue>>) => void }) {
  if (conditionId === "always") return null;
  const fields: readonly [string, string, "text" | "number"][] = conditionId === "inventory-at-least"
    ? [["objectType", "Object type", "text"], ["count", "Count", "number"]]
    : conditionId === "inventory-total-at-most"
      ? [["count", "Maximum count", "number"]]
      : conditionId === "time-remaining-at-most"
        ? [["seconds", "Seconds", "number"]]
        : [["points", "Points", "number"]];
  return <div className="mt-2 grid gap-2 sm:grid-cols-2">{fields.map(([key, label, type]) => <label className="text-xs text-muted-foreground" htmlFor={`${fieldPrefix}-${key}`} key={key}>{label}<input className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground" id={`${fieldPrefix}-${key}`} min={type === "number" && conditionId !== "points-at-least" ? 0 : undefined} onChange={(event) => onChange({ ...parameters, [key]: type === "number" ? Number(event.target.value) : event.target.value })} type={type} value={String(parameters[key] ?? "")} /></label>)}</div>;
}
