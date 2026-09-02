import { DEFAULT_NEUTRAL_POLICY } from "../../simulation/index.ts";
import type {
  PolicyCondition,
  PolicyDefinition,
  PolicyGoal,
  PolicyPhase,
  PolicyRule,
} from "../../policy/index.ts";

export function addPolicyRule(policy: PolicyDefinition, phase: PolicyPhase): PolicyDefinition {
  const rules = policy[phase].rules;
  const existingIds = new Set(rules.map((rule) => rule.id));
  let suffix = rules.length + 1;
  let id = `${phase}-rule-${suffix}`;
  while (existingIds.has(id)) {
    suffix += 1;
    id = `${phase}-rule-${suffix}`;
  }
  const rule: PolicyRule = {
    id,
    conditions: [],
    goal: {
      goalId: phase === "endgame" ? "park-for-endgame" : "collect-nearest-object",
      parameters: {},
    },
  };
  return { ...policy, [phase]: { ...policy[phase], rules: [...rules, rule] } };
}

export function updatePolicyRule(
  policy: PolicyDefinition,
  phase: PolicyPhase,
  index: number,
  update: (rule: PolicyRule) => PolicyRule,
): PolicyDefinition {
  return {
    ...policy,
    [phase]: {
      ...policy[phase],
      rules: policy[phase].rules.map((rule, ruleIndex) => ruleIndex === index ? update(rule) : rule),
    },
  };
}

export function updatePolicyCondition(
  policy: PolicyDefinition,
  phase: PolicyPhase,
  ruleIndex: number,
  conditionIndex: number,
  update: (condition: PolicyCondition) => PolicyCondition,
): PolicyDefinition {
  return updatePolicyRule(policy, phase, ruleIndex, (rule) => ({
    ...rule,
    conditions: rule.conditions.map((condition, index) => index === conditionIndex ? update(condition) : condition),
  }));
}

export function updatePolicyGoal(
  policy: PolicyDefinition,
  phase: PolicyPhase,
  ruleIndex: number,
  goal: PolicyGoal,
): PolicyDefinition {
  return updatePolicyRule(policy, phase, ruleIndex, (rule) => ({ ...rule, goal }));
}

export function deletePolicyRule(policy: PolicyDefinition, phase: PolicyPhase, index: number): PolicyDefinition {
  return {
    ...policy,
    [phase]: {
      ...policy[phase],
      rules: policy[phase].rules.filter((_rule, ruleIndex) => ruleIndex !== index),
    },
  };
}

export function movePolicyRule(policy: PolicyDefinition, phase: PolicyPhase, from: number, to: number): PolicyDefinition {
  const rules = policy[phase].rules;
  if (to < 0 || to >= rules.length) return policy;
  const nextRules = [...rules];
  const [rule] = nextRules.splice(from, 1);
  nextRules.splice(to, 0, rule!);
  return { ...policy, [phase]: { ...policy[phase], rules: nextRules } };
}

export function resetPolicy(): PolicyDefinition {
  return structuredClone(DEFAULT_NEUTRAL_POLICY);
}
