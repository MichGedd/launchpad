import assert from "node:assert/strict";
import test from "node:test";

import { createNeutralPolicyCatalog, DEFAULT_NEUTRAL_POLICY } from "../../simulation/index.ts";
import { PolicyCatalog, type PolicyGoalDefinition } from "../../policy/index.ts";
import { DEFAULT_ROBOT_FEATURE_OPTIONS } from "../../visualizer/types.ts";

import { createPolicyCapabilityViewModel, getPolicyGoalSelectionState } from "./policy-capabilities.ts";

test("neutral goal metadata maps collect, score, park, and wait capabilities", () => {
  const catalog = createNeutralPolicyCatalog();
  assert.deepEqual(catalog.goal("collect-nearest-object")?.requiredFeatureIds, ["object-intake"]);
  assert.deepEqual(catalog.goal("score-nearest-object")?.requiredFeatureIds, ["goal-scoring"]);
  assert.deepEqual(catalog.goal("park-for-endgame")?.requiredFeatureIds, ["endgame-parking"]);
  assert.deepEqual(catalog.goal("wait-until-match-end")?.requiredFeatureIds, []);
  assert.equal(DEFAULT_ROBOT_FEATURE_OPTIONS.find((feature) => feature.id === "drive-planning")?.policyImpact?.kind, "indirect");
});

test("capability view model reports rule/fallback counts and missing uses", () => {
  const catalog = createNeutralPolicyCatalog();
  const view = createPolicyCapabilityViewModel(
    DEFAULT_NEUTRAL_POLICY,
    catalog,
    DEFAULT_ROBOT_FEATURE_OPTIONS,
    ["drive-planning", "object-intake"],
  );
  const intake = view.features.find((feature) => feature.featureId === "object-intake")!;
  const scoring = view.features.find((feature) => feature.featureId === "goal-scoring")!;
  const parking = view.features.find((feature) => feature.featureId === "endgame-parking")!;
  assert.equal(intake.ruleUseCount, 0);
  assert.equal(intake.fallbackUseCount, 1);
  assert.equal(scoring.ruleUseCount, 1);
  assert.equal(scoring.fallbackUseCount, 0);
  assert.equal(scoring.missingUses[0]?.kind, "rule");
  assert.equal(parking.missingUses[0]?.kind, "rule");
  assert.equal(view.missingUseCount, 2);
});

test("wait remains enabled and selected-feature toggles do not mutate policy", () => {
  const catalog = createNeutralPolicyCatalog();
  const before = structuredClone(DEFAULT_NEUTRAL_POLICY);
  const view = createPolicyCapabilityViewModel(DEFAULT_NEUTRAL_POLICY, catalog, DEFAULT_ROBOT_FEATURE_OPTIONS, []);
  assert.equal(view.goals.find((goal) => goal.goalId === "wait-until-match-end")?.enabled, true);
  assert.deepEqual(DEFAULT_NEUTRAL_POLICY, before);
});

test("unavailable new goal selections are disabled while existing goals remain selectable", () => {
  const catalog = createNeutralPolicyCatalog();
  const unavailable = getPolicyGoalSelectionState("score-nearest-object", "wait-until-match-end", catalog, DEFAULT_ROBOT_FEATURE_OPTIONS, []);
  const preserved = getPolicyGoalSelectionState("score-nearest-object", "score-nearest-object", catalog, DEFAULT_ROBOT_FEATURE_OPTIONS, []);
  assert.equal(unavailable.disabled, true);
  assert.deepEqual(unavailable.requiredFeatureLabels, ["Goal scoring"]);
  assert.deepEqual(unavailable.missingFeatureLabels, ["Goal scoring"]);
  assert.equal(preserved.disabled, false);
  assert.deepEqual(preserved.requiredFeatureLabels, ["Goal scoring"]);
  assert.deepEqual(preserved.missingFeatureLabels, ["Goal scoring"]);
  const enabled = getPolicyGoalSelectionState("score-nearest-object", "wait-until-match-end", catalog, DEFAULT_ROBOT_FEATURE_OPTIONS, ["goal-scoring"]);
  assert.equal(enabled.disabled, false);
  assert.deepEqual(enabled.requiredFeatureLabels, ["Goal scoring"]);
  assert.deepEqual(enabled.missingFeatureLabels, []);
});

test("missing use count counts a multi-feature goal use once", () => {
  const goal: PolicyGoalDefinition<Record<string, never>> = {
    id: "multi-feature-goal",
    label: "Multi-feature goal",
    description: "Requires two capabilities.",
    requiredFeatureIds: ["first", "second"],
    validate: () => ({ valid: true, value: {} }),
    isAvailable: () => ({ available: true, explanation: "Available." }),
    expand: () => ({ goalId: "multi-feature-goal", actions: [], explanation: "Expanded." }),
  };
  const catalog = new PolicyCatalog({ conditions: [], goals: [goal] });
  const policy = {
    version: 1 as const,
    name: "Multiple requirements",
    match: { rules: [], fallback: { goalId: goal.id, parameters: {} } },
    endgame: { rules: [], fallback: { goalId: goal.id, parameters: {} } },
  };
  const features = [{ id: "first", label: "First", description: "" }, { id: "second", label: "Second", description: "" }];
  const view = createPolicyCapabilityViewModel(policy, catalog, features, []);
  assert.equal(view.missingUseCount, 2);
  assert.equal(view.features[0]?.missingUses.length, 2);
  assert.equal(view.features[1]?.missingUses.length, 2);
});

test("capability source keeps readable labels for missing rule and fallback uses", async () => {
  const source = await import("node:fs/promises");
  const component = await source.readFile(new URL("./policy-capabilities.ts", import.meta.url), "utf8");
  assert.match(component, /ruleUseCount/);
  assert.match(component, /fallbackUseCount/);
  assert.match(component, /missingUses/);
  const editor = await source.readFile(new URL("./policy-editor-dialog.tsx", import.meta.url), "utf8");
  assert.match(editor, /Rule goal unavailable/);
  assert.match(editor, /Fallback goal unavailable/);
  assert.match(editor, /This rule will be skipped if evaluated/);
  assert.match(editor, /This phase may fail if no earlier rule resolves/);
  assert.match(editor, /disabled=\{selection\.disabled\}/);
});
