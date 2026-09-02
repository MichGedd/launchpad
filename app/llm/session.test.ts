import assert from "node:assert/strict";
import { test } from "node:test";

import { SessionStore } from "./session.ts";

const configuration = {
  provider: "openai" as const,
  model: "gpt-5.6-luna",
  reasoningEffort: "low" as const,
  apiKey: "sentinel-session-secret",
};

test("isolates sessions and never returns an API key in status or statistics", () => {
  const store = new SessionStore();
  const first = store.createSession();
  const second = store.createSession();
  store.setConfiguration(first, configuration);
  assert.equal(store.getConfiguration(first).configured, true);
  assert.equal(store.getConfiguration(second).configured, false);
  assert.doesNotMatch(JSON.stringify(store.getConfiguration(first)), /sentinel-session-secret/);
  assert.equal(store.getStatistics(second)?.sessionTotal.totalTokens, 0);
});

test("aggregates usage and calculates latest and cumulative averages", () => {
  const store = new SessionStore();
  const session = store.createSession();
  store.setConfiguration(session, configuration);
  store.recordUsage(session, { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2 });
  store.recordUsage(session, { inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 4 });
  const statistics = store.getStatistics(session);
  assert.equal(statistics?.latestGeneration?.decisions, 1);
  assert.equal(statistics?.latestGeneration?.averageTokensPerDecision, 30);
  assert.equal(statistics?.sessionTotal.decisions, 2);
  assert.equal(statistics?.sessionTotal.totalTokens, 45);
  assert.equal(statistics?.sessionTotal.averageTokensPerDecision, 22.5);
  assert.equal(statistics?.sessionTotal.cachedInputTokens, 6);
});

test("aggregates every decision in one generation and resets the latest generation", () => {
  const store = new SessionStore();
  const session = store.createSession();
  store.setConfiguration(session, configuration);
  store.recordUsage(session, { inputTokens: 2, outputTokens: 1, totalTokens: 3, cachedInputTokens: 0 });

  assert.equal(store.beginGeneration(session), true);
  store.recordUsage(session, { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 2 });
  store.recordUsage(session, { inputTokens: 20, outputTokens: 8, totalTokens: 28, cachedInputTokens: 5 });
  store.endGeneration(session);

  const firstGeneration = store.getStatistics(session);
  assert.equal(firstGeneration?.latestGeneration?.decisions, 2);
  assert.equal(firstGeneration?.latestGeneration?.inputTokens, 30);
  assert.equal(firstGeneration?.latestGeneration?.outputTokens, 12);
  assert.equal(firstGeneration?.latestGeneration?.totalTokens, 42);
  assert.equal(firstGeneration?.latestGeneration?.cachedInputTokens, 7);
  assert.equal(firstGeneration?.latestGeneration?.averageTokensPerDecision, 21);
  assert.equal(firstGeneration?.sessionTotal.decisions, 3);
  assert.equal(firstGeneration?.sessionTotal.totalTokens, 45);

  assert.equal(store.beginGeneration(session), true);
  const emptyGeneration = store.getStatistics(session);
  assert.equal(emptyGeneration?.latestGeneration?.decisions, 0);
  assert.equal(emptyGeneration?.latestGeneration?.averageTokensPerDecision, null);
  store.recordUsage(session, { inputTokens: 6, outputTokens: 3, totalTokens: 9, cachedInputTokens: 1 });
  store.endGeneration(session);

  const secondGeneration = store.getStatistics(session);
  assert.equal(secondGeneration?.latestGeneration?.decisions, 1);
  assert.equal(secondGeneration?.latestGeneration?.totalTokens, 9);
  assert.equal(secondGeneration?.sessionTotal.decisions, 4);
  assert.equal(secondGeneration?.sessionTotal.totalTokens, 54);
});

test("disconnect clears configuration and statistics; expired sessions are removed", () => {
  let now = 1000;
  const store = new SessionStore({ now: () => now, inactivityMs: 100 });
  const session = store.createSession();
  store.setConfiguration(session, configuration);
  store.recordUsage(session, { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 });
  store.clearConfiguration(session);
  assert.equal(store.getConfiguration(session).configured, false);
  assert.equal(store.getStatistics(session)?.sessionTotal.totalTokens, 0);
  now += 101;
  assert.equal(store.getStatistics(session), null);
  assert.equal(store.beginGeneration(session), false);
});

test("prevents concurrent generation locks", () => {
  const store = new SessionStore();
  const session = store.createSession();
  assert.equal(store.beginGeneration(session), true);
  assert.equal(store.beginGeneration(session), false);
  store.endGeneration(session);
  assert.equal(store.beginGeneration(session), true);
});
