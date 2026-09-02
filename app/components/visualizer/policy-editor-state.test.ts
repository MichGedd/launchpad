import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_NEUTRAL_POLICY } from "../../simulation/index.ts";

import {
  addPolicyRule,
  deletePolicyRule,
  movePolicyRule,
  resetPolicy,
  updatePolicyCondition,
  updatePolicyGoal,
  updatePolicyRule,
} from "./policy-editor-state.ts";

test("policy editor state supports add, delete, and reorder", () => {
  const withRule = addPolicyRule(DEFAULT_NEUTRAL_POLICY, "match");
  assert.equal(withRule.match.rules.length, DEFAULT_NEUTRAL_POLICY.match.rules.length + 1);

  const moved = movePolicyRule(withRule, "match", 0, 1);
  assert.equal(moved.match.rules[1]?.id, withRule.match.rules[0]?.id);

  const deleted = deletePolicyRule(moved, "match", 1);
  assert.equal(deleted.match.rules.length, DEFAULT_NEUTRAL_POLICY.match.rules.length);
});

test("policy editor reset returns an independent default policy", () => {
  const reset = resetPolicy();
  assert.deepEqual(reset, DEFAULT_NEUTRAL_POLICY);
  assert.notEqual(reset, DEFAULT_NEUTRAL_POLICY);
});

test("policy editor keeps generated rule IDs unique after delete and reorder cycles", () => {
  const seeded = {
    ...DEFAULT_NEUTRAL_POLICY,
    match: {
      ...DEFAULT_NEUTRAL_POLICY.match,
      rules: [{ ...DEFAULT_NEUTRAL_POLICY.match.rules[0]!, id: "match-rule-2" }],
    },
  };
  const first = addPolicyRule(seeded, "match");
  assert.equal(first.match.rules.at(-1)?.id, "match-rule-3");
  const reordered = movePolicyRule(first, "match", 1, 0);
  const deleted = deletePolicyRule(reordered, "match", 0);
  const second = addPolicyRule(deleted, "match");
  const ids = second.match.rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 128));
});

test("policy editor immutably edits rule, condition, and goal state", () => {
  const editedRule = updatePolicyRule(DEFAULT_NEUTRAL_POLICY, "match", 0, (rule) => ({ ...rule, id: "edited-rule" }));
  const editedCondition = updatePolicyCondition(editedRule, "match", 0, 0, (condition) => ({
    ...condition,
    parameters: { ...condition.parameters, count: 2 },
  }));
  const editedGoal = updatePolicyGoal(editedCondition, "match", 0, {
    goalId: "wait-until-match-end",
    parameters: {},
  });

  assert.equal(editedGoal.match.rules[0]?.id, "edited-rule");
  assert.equal(editedGoal.match.rules[0]?.conditions[0]?.parameters.count, 2);
  assert.equal(editedGoal.match.rules[0]?.goal.goalId, "wait-until-match-end");
  assert.equal(DEFAULT_NEUTRAL_POLICY.match.rules[0]?.id, "score-held-object");
  assert.equal(DEFAULT_NEUTRAL_POLICY.match.rules[0]?.conditions[0]?.parameters.count, 1);
});

test("policy editor controls expose keyboard labels in the source contract", async () => {
  const source = await import("node:fs/promises");
  const component = await source.readFile(new URL("./policy-editor-dialog.tsx", import.meta.url), "utf8");
  assert.match(component, /aria-label=\{`Move rule/);
  assert.match(component, /aria-label=\{`Delete rule/);
  assert.match(component, /aria-label=\{`Add condition/);
});
