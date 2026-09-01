import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStrategyPrompt } from "./prompt.ts";
import type { StrategyGenerationRequest } from "./schemas.ts";

const request: StrategyGenerationRequest = {
  strategy: "Prioritize scoring, then stop safely.",
  selectedFeatureIds: ["collector"],
  robotCustomization: { translationSpeedFeetPerSecond: 7 },
  decisionContext: { timeRemainingSeconds: 40 },
  enabledActions: [{ id: "score", description: "Score in an eligible zone.", zoneKind: "score" }],
};

test("builds exactly two trusted instruction sections before dynamic context", () => {
  const result = buildStrategyPrompt(request);
  assert.equal((result.system.match(/## Trusted/g) ?? []).length, 2);
  assert.ok(result.system.indexOf("## Trusted Launchpad API instructions") < result.system.indexOf("## Trusted game instructions"));
  assert.ok(result.prompt.indexOf("## Enabled actions") < result.prompt.indexOf("## User strategy"));
  assert.ok(result.prompt.endsWith(request.strategy));
  assert.match(result.prompt, /"score"/);
  assert.doesNotMatch(result.prompt, /"id":"collect"/);
});

test("does not place a sentinel API key into prompt material", () => {
  const prompt = buildStrategyPrompt({ ...request, strategy: "Use key sentinel-should-never-appear." });
  assert.doesNotMatch(prompt.system, /sentinel-should-never-appear/);
  assert.match(prompt.prompt, /sentinel-should-never-appear/);
});
