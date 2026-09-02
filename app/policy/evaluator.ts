import type {
  GoalPlan,
  PolicyDecisionTrace,
  PolicyDefinition,
  PolicyEvaluationContext,
  PolicyPhase,
  PolicyRule,
  PolicyRuleEvaluation,
} from "./types.ts";
import { PolicyCatalog, PolicyValidationError } from "./catalog.ts";

export interface PolicyEvaluationOptions {
  readonly decisionNumber: number;
  readonly elapsedSeconds: number;
}

export interface PolicyEvaluationResult {
  readonly plan: GoalPlan;
  readonly trace: PolicyDecisionTrace;
}

export class PolicyEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyEvaluationError";
  }
}

export function evaluatePolicy<Request, Context = PolicyEvaluationContext>(
  policy: PolicyDefinition,
  phase: PolicyPhase,
  context: Context,
  catalog: PolicyCatalog<Request, Context>,
  options: PolicyEvaluationOptions,
): PolicyEvaluationResult {
  const validatedPolicy = catalog.validatePolicy(policy);
  const phaseDefinition = validatedPolicy[phase];
  const evaluations: PolicyRuleEvaluation[] = [];

  for (const rule of phaseDefinition.rules) {
    const conditionDefinitionTraces = [];
    let conditionsMatched = true;
    for (const condition of rule.conditions) {
      const definition = catalog.condition(condition.conditionId);
      if (!definition) throw new PolicyEvaluationError(`Unknown policy condition "${condition.conditionId}".`);
      const parameters = definition.validate(condition.parameters);
      if (!parameters.valid) throw new PolicyEvaluationError(`Invalid parameters for condition "${condition.conditionId}": ${parameters.message}`);
      const result = definition.evaluate(context, parameters.value);
      conditionDefinitionTraces.push({
        conditionId: condition.conditionId,
        matched: result.matched,
        explanation: result.explanation,
      });
      if (!result.matched) conditionsMatched = false;
    }

    const goalDefinition = catalog.goal(rule.goal.goalId);
    if (!goalDefinition) throw new PolicyEvaluationError(`Unknown policy goal "${rule.goal.goalId}".`);
    const goalParameters = goalDefinition.validate(rule.goal.parameters);
    if (!goalParameters.valid) throw new PolicyEvaluationError(`Invalid parameters for goal "${rule.goal.goalId}": ${goalParameters.message}`);
    const availability = conditionsMatched
      ? goalDefinition.isAvailable(context, goalParameters.value)
      : { available: false, explanation: "Skipped because one or more conditions did not match." };
    const selected = conditionsMatched && availability.available;
    const explanation = selected
      ? `Selected rule "${rule.id}". ${availability.explanation}`
      : conditionsMatched
        ? `Skipped rule "${rule.id}" because its goal is unavailable: ${availability.explanation}`
        : `Skipped rule "${rule.id}" because its conditions did not match.`;
    evaluations.push({
      ruleId: rule.id,
      conditionEvaluations: Object.freeze(conditionDefinitionTraces),
      conditionsMatched,
      goalAvailable: availability.available,
      selected,
      explanation,
    });
    if (selected) {
      return finishSelection(
        goalDefinition.expand(context, goalParameters.value),
        evaluations,
        options,
        phase,
        rule.id,
        false,
      );
    }
  }

  const fallback = phaseDefinition.fallback;
  const fallbackDefinition = catalog.goal(fallback.goalId);
  if (!fallbackDefinition) throw new PolicyEvaluationError(`Unknown policy goal "${fallback.goalId}".`);
  const fallbackParameters = fallbackDefinition.validate(fallback.parameters);
  if (!fallbackParameters.valid) throw new PolicyEvaluationError(`Invalid parameters for goal "${fallback.goalId}": ${fallbackParameters.message}`);
  const availability = fallbackDefinition.isAvailable(context, fallbackParameters.value);
  if (!availability.available) {
    throw new PolicyEvaluationError(
      `${phase} phase could not resolve a rule or fallback goal. Fallback "${fallback.goalId}" is unavailable: ${availability.explanation}`,
    );
  }
  return finishSelection(
    fallbackDefinition.expand(context, fallbackParameters.value),
    evaluations,
    options,
    phase,
    null,
    true,
  );
}

function finishSelection(
  plan: GoalPlan,
  evaluations: readonly PolicyRuleEvaluation[],
  options: PolicyEvaluationOptions,
  phase: PolicyPhase,
  selectedRuleId: string | null,
  usedFallback: boolean,
): PolicyEvaluationResult {
  const trace: PolicyDecisionTrace = {
    decisionNumber: options.decisionNumber,
    elapsedSeconds: options.elapsedSeconds,
    phase,
    evaluations: Object.freeze([...evaluations]),
    selectedRuleId,
    usedFallback,
    goalId: plan.goalId,
    ...(plan.targetId === undefined ? {} : { targetId: plan.targetId }),
    actions: Object.freeze([...plan.actions]),
    explanation: plan.explanation,
  };
  return { plan, trace };
}
