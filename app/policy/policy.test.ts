import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluatePolicy,
  PolicyCatalog,
  PolicyEvaluationError,
  PolicyValidationError,
  type PolicyConditionDefinition,
  type PolicyDefinition,
  type PolicyGoalDefinition,
} from "./index.ts";

interface TestContext {
  readonly value: number;
}

interface TestRequest {
  readonly threshold?: number;
}

const condition: PolicyConditionDefinition<TestRequest, TestContext> = {
  id: "at-least",
  label: "At least",
  description: "Matches when the context value reaches a threshold.",
  validate(parameters) {
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      return { valid: false, message: "parameters must be an object" };
    }
    const threshold = (parameters as { readonly threshold?: unknown }).threshold;
    if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
      return { valid: false, message: "threshold must be finite" };
    }
    return { valid: true, value: { threshold } };
  },
  evaluate(context, request) {
    const matched = context.value >= (request.threshold ?? 0);
    return { matched, explanation: matched ? "Value reached the threshold." : "Value is below the threshold." };
  },
};

function goal(id: string, available = true): PolicyGoalDefinition<TestRequest, TestContext> {
  return {
    id,
    label: id,
    description: `Test goal ${id}.`,
    validate: () => ({ valid: true, value: {} }),
    isAvailable: () => ({ available, explanation: available ? "Goal is available." : "Goal is unavailable." }),
    expand: () => ({
      goalId: id,
      actions: [{ actionId: `action-${id}`, parameters: {} }],
      explanation: `Expanded ${id}.`,
    }),
  };
}

function policy(overrides: Partial<PolicyDefinition> = {}): PolicyDefinition {
  return {
    version: 1,
    name: "Test policy",
    match: {
      rules: [{
        id: "rule-1",
        conditions: [],
        goal: { goalId: "first", parameters: {} },
      }],
      fallback: { goalId: "fallback", parameters: {} },
    },
    endgame: {
      rules: [],
      fallback: { goalId: "fallback", parameters: {} },
    },
    ...overrides,
  };
}

function catalog(...goals: readonly PolicyGoalDefinition<TestRequest, TestContext>[]): PolicyCatalog<TestRequest, TestContext> {
  return new PolicyCatalog({ conditions: [condition], goals });
}

test("validates policy limits, JSON parameters, and duplicate rule IDs", () => {
  const validCatalog = catalog(goal("first"), goal("fallback"));
  assert.equal(validCatalog.validatePolicy({ ...policy(), name: "  Test policy  " }).name, "Test policy");

  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    name: " ",
  }), PolicyValidationError);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    match: {
      ...policy().match,
      rules: Array.from({ length: 33 }, (_, index) => ({
        id: `rule-${index}`,
        conditions: [],
        goal: { goalId: "first", parameters: {} },
      })),
    },
  }), /at most 32 rules/);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    match: {
      ...policy().match,
      rules: [{
        ...policy().match.rules[0]!,
        conditions: Array.from({ length: 9 }, () => ({ conditionId: "at-least", parameters: { threshold: 1 } })),
      }],
    },
  }), /at most 8 conditions/);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    endgame: policy().match,
  }), /Duplicate policy rule ID/);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    match: {
      ...policy().match,
      rules: [{ ...policy().match.rules[0]!, goal: { goalId: "missing", parameters: {} } }],
    },
  }), /Unknown policy goal/);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    match: {
      ...policy().match,
      rules: [{ ...policy().match.rules[0]!, conditions: [{ conditionId: "at-least", parameters: { threshold: Number.NaN } }] }],
    },
  }), /JSON-compatible object/);
  assert.throws(() => validCatalog.validatePolicy({
    ...policy(),
    match: {
      ...policy().match,
      rules: [{ ...policy().match.rules[0]!, conditions: [{ conditionId: "at-least", parameters: {} }] }],
    },
  }), /Invalid parameters/);
});

test("evaluates ordered rules with AND semantics and records the selected rule", () => {
  const testCatalog = catalog(goal("first"), goal("second"), goal("fallback"));
  const testPolicy = policy({
    match: {
      rules: [
        {
          id: "too-high",
          conditions: [
            { conditionId: "at-least", parameters: { threshold: 10 } },
            { conditionId: "at-least", parameters: { threshold: 1 } },
          ],
          goal: { goalId: "first", parameters: {} },
        },
        {
          id: "matching-rule",
          conditions: [{ conditionId: "at-least", parameters: { threshold: 1 } }],
          goal: { goalId: "second", parameters: {} },
        },
      ],
      fallback: { goalId: "fallback", parameters: {} },
    },
  });
  const result = evaluatePolicy(testPolicy, "match", { value: 2 }, testCatalog, {
    decisionNumber: 4,
    elapsedSeconds: 12,
  });

  assert.equal(result.plan.goalId, "second");
  assert.equal(result.trace.selectedRuleId, "matching-rule");
  assert.equal(result.trace.usedFallback, false);
  assert.equal(result.trace.evaluations[0]?.conditionsMatched, false);
  assert.equal(result.trace.evaluations[0]?.conditionEvaluations.length, 2);
  assert.equal(result.trace.evaluations[1]?.goalAvailable, true);
});

test("continues after an unavailable goal and uses fallback when no rule matches", () => {
  const testCatalog = catalog(goal("unavailable", false), goal("later"), goal("fallback"));
  const testPolicy = policy({
    match: {
      rules: [
        { id: "unavailable-rule", conditions: [], goal: { goalId: "unavailable", parameters: {} } },
        { id: "later-rule", conditions: [], goal: { goalId: "later", parameters: {} } },
      ],
      fallback: { goalId: "fallback", parameters: {} },
    },
  });
  const selectedLater = evaluatePolicy(testPolicy, "match", { value: 0 }, testCatalog, {
    decisionNumber: 1,
    elapsedSeconds: 0,
  });
  assert.equal(selectedLater.plan.goalId, "later");
  assert.equal(selectedLater.trace.evaluations[0]?.goalAvailable, false);
  assert.equal(selectedLater.trace.evaluations[1]?.selected, true);

  const fallbackPolicy = policy({
    match: {
      rules: [{ id: "condition-rule", conditions: [{ conditionId: "at-least", parameters: { threshold: 10 } }], goal: { goalId: "later", parameters: {} } }],
      fallback: { goalId: "fallback", parameters: {} },
    },
  });
  const selectedFallback = evaluatePolicy(fallbackPolicy, "match", { value: 0 }, testCatalog, {
    decisionNumber: 2,
    elapsedSeconds: 3,
  });
  assert.equal(selectedFallback.plan.goalId, "fallback");
  assert.equal(selectedFallback.trace.usedFallback, true);
  assert.equal(selectedFallback.trace.selectedRuleId, null);
});

test("fails with an actionable error when the fallback is unavailable", () => {
  const testCatalog = catalog(goal("unavailable", false));
  assert.throws(() => evaluatePolicy(
    policy({
      match: { rules: [], fallback: { goalId: "unavailable", parameters: {} } },
      endgame: { rules: [], fallback: { goalId: "unavailable", parameters: {} } },
    }),
    "match",
    { value: 0 },
    testCatalog,
    { decisionNumber: 1, elapsedSeconds: 0 },
  ), PolicyEvaluationError);
});
