import type { PolicyCatalog, PolicyDefinition, PolicyPhase } from "../../policy/index.ts";
import type { RobotFeatureOption } from "../../visualizer/types.ts";

export type PolicyGoalUseKind = "rule" | "fallback";

export interface PolicyGoalUse {
  readonly phase: PolicyPhase;
  readonly kind: PolicyGoalUseKind;
  readonly ruleId?: string;
}

export interface PolicyGoalCapability {
  readonly goalId: string;
  readonly label: string;
  readonly requiredFeatureIds: readonly string[];
  readonly enabled: boolean;
  readonly ruleUseCount: number;
  readonly fallbackUseCount: number;
  readonly missingUses: readonly PolicyGoalUse[];
}

export interface PolicyFeatureCapability {
  readonly featureId: string;
  readonly label: string;
  readonly selected: boolean;
  readonly policyImpact?: RobotFeatureOption["policyImpact"];
  readonly relatedGoals: readonly PolicyGoalCapability[];
  readonly enabledGoals: readonly PolicyGoalCapability[];
  readonly ruleUseCount: number;
  readonly fallbackUseCount: number;
  readonly missingUses: readonly PolicyGoalUse[];
}

export interface PolicyCapabilityViewModel {
  readonly goals: readonly PolicyGoalCapability[];
  readonly features: readonly PolicyFeatureCapability[];
  readonly missingUseCount: number;
}

export interface PolicyGoalSelectionState {
  readonly disabled: boolean;
  readonly requiredFeatureLabels: readonly string[];
  readonly missingFeatureLabels: readonly string[];
}

interface GoalUseRecord {
  readonly goalId: string;
  readonly use: PolicyGoalUse;
}

export function createPolicyCapabilityViewModel<Request, Context>(
  policy: PolicyDefinition,
  catalog: PolicyCatalog<Request, Context>,
  featureOptions: readonly RobotFeatureOption[],
  selectedFeatureIds: readonly string[],
): PolicyCapabilityViewModel {
  const selected = new Set(selectedFeatureIds);
  const uses: GoalUseRecord[] = [];
  for (const phase of ["match", "endgame"] as const) {
    for (const rule of policy[phase].rules) {
      uses.push({ goalId: rule.goal.goalId, use: { phase, kind: "rule", ruleId: rule.id } });
    }
    uses.push({ goalId: policy[phase].fallback.goalId, use: { phase, kind: "fallback" } });
  }

  const goalIds = uniqueGoalIds([
    ...uses,
    ...catalog.goals().map((definition) => ({ goalId: definition.id, use: { phase: "match" as const, kind: "rule" as const } })),
  ]);
  const goals = goalIds.map((goalId): PolicyGoalCapability => {
    const definition = catalog.goal(goalId);
    const requiredFeatureIds = definition?.requiredFeatureIds ?? [];
    const missingFeatureIds = requiredFeatureIds.filter((featureId) => !selected.has(featureId));
    const goalUses = uses.filter((entry) => entry.goalId === goalId);
    return {
      goalId,
      label: definition?.label ?? goalId,
      requiredFeatureIds,
      enabled: missingFeatureIds.length === 0,
      ruleUseCount: goalUses.filter((entry) => entry.use.kind === "rule").length,
      fallbackUseCount: goalUses.filter((entry) => entry.use.kind === "fallback").length,
      missingUses: missingFeatureIds.length === 0
        ? []
        : goalUses.map((entry) => entry.use),
    };
  });
  const goalById = new Map(goals.map((goal) => [goal.goalId, goal]));

  const features = featureOptions.map((feature): PolicyFeatureCapability => {
    const relatedGoals = goals.filter((goal) => goal.requiredFeatureIds.includes(feature.id));
    const featureMissingUses = uses
      .filter((entry) => {
        const goal = goalById.get(entry.goalId);
        return goal?.requiredFeatureIds.includes(feature.id) && !selected.has(feature.id);
      })
      .map((entry) => entry.use);
    return {
      featureId: feature.id,
      label: feature.label,
      selected: selected.has(feature.id),
      ...(feature.policyImpact ? { policyImpact: feature.policyImpact } : {}),
      relatedGoals,
      enabledGoals: relatedGoals.filter((goal) => goal.enabled),
      ruleUseCount: relatedGoals.reduce((count, goal) => count + goal.ruleUseCount, 0),
      fallbackUseCount: relatedGoals.reduce((count, goal) => count + goal.fallbackUseCount, 0),
      missingUses: featureMissingUses,
    };
  });

  return {
    goals,
    features,
    missingUseCount: goals.reduce((count, goal) => count + goal.missingUses.length, 0),
  };
}

export function getPolicyGoalSelectionState<Request, Context>(
  goalId: string,
  currentGoalId: string,
  catalog: PolicyCatalog<Request, Context>,
  featureOptions: readonly RobotFeatureOption[],
  selectedFeatureIds: readonly string[],
): PolicyGoalSelectionState {
  const goal = catalog.goal(goalId);
  if (!goal) return { disabled: goalId !== currentGoalId, requiredFeatureLabels: [], missingFeatureLabels: [] };
  const selected = new Set(selectedFeatureIds);
  const labels = goal.requiredFeatureIds
    .map((featureId) => featureOptions.find((feature) => feature.id === featureId)?.label ?? featureId);
  const missingFeatureLabels = goal.requiredFeatureIds
    .filter((featureId) => !selected.has(featureId))
    .map((featureId) => featureOptions.find((feature) => feature.id === featureId)?.label ?? featureId);
  return {
    disabled: missingFeatureLabels.length > 0 && goalId !== currentGoalId,
    requiredFeatureLabels: labels,
    missingFeatureLabels,
  };
}

function uniqueGoalIds(uses: readonly GoalUseRecord[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const use of uses) {
    if (!seen.has(use.goalId)) {
      seen.add(use.goalId);
      result.push(use.goalId);
    }
  }
  return result;
}
