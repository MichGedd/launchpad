import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { StrategyPlanner, type StrategyModelRequest } from "../app/llm/service.ts";
import { SessionStore } from "../app/llm/session.ts";
import { createLaunchpadServer } from "./index.ts";

const SECRET = "sk-sentinel-never-return-this";
let baseUrl = "";
let closeServer: (() => Promise<void>) | null = null;
const capturedRequests: StrategyModelRequest[] = [];

function planForDecision(request: StrategyModelRequest) {
  const elapsedMatch = request.prompt.match(/"elapsedSeconds":([0-9]+(?:\.[0-9]+)?)/);
  const elapsedSeconds = elapsedMatch ? Number(elapsedMatch[1]) : 0;
  if (elapsedSeconds < 0.5) {
    return [
      { actionId: "drive-to", parameters: { xFeet: 18, yFeet: 5, headingRotations: 0 } },
      { actionId: "collect-object", parameters: {} },
    ];
  }
  if (elapsedSeconds < 3) {
    return [
      { actionId: "drive-to", parameters: { xFeet: 38, yFeet: 18, headingRotations: 0.25 } },
      { actionId: "score-object", parameters: {} },
      { actionId: "drive-to", parameters: { xFeet: 48, yFeet: 8, headingRotations: 0.875 } },
    ];
  }
  if (elapsedSeconds < 8) {
    return [
      { actionId: "drive-to", parameters: { xFeet: 18, yFeet: 5, headingRotations: 0 } },
      { actionId: "collect-object", parameters: {} },
      { actionId: "drive-to", parameters: { xFeet: 38, yFeet: 18, headingRotations: 0.25 } },
      { actionId: "score-object", parameters: {} },
    ];
  }
  return [{ actionId: "wait", parameters: { durationSeconds: 135 } }];
}

before(async () => {
  const planner = new StrategyPlanner({
    runnerFactory(apiKey) {
      assert.equal(apiKey, SECRET);
      return {
        async generate(request) {
          capturedRequests.push(request);
          return {
            output: {
              summary: "Continue the scripted simulation.",
              actions: planForDecision(request),
            },
            usage: {
              inputTokens: 100,
              inputTokenDetails: { cacheReadTokens: 25 },
              outputTokens: 20,
              totalTokens: 120,
            },
          };
        },
      };
    },
  });
  const { app } = await createLaunchpadServer({
    mode: "production",
    planner,
    sessionStore: new SessionStore(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

after(async () => {
  await closeServer?.();
});

test("configuration is isolated by an HttpOnly session and never echoed", async () => {
  const initial = await fetch(`${baseUrl}/api/llm/configuration`);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get("set-cookie");
  assert.match(cookie ?? "", /HttpOnly/i);
  assert.match(cookie ?? "", /SameSite=Strict/i);

  const saved = await fetch(`${baseUrl}/api/llm/configuration`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie!,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      provider: "openai",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      apiKey: SECRET,
    }),
  });
  const savedText = await saved.text();
  assert.equal(saved.status, 200);
  assert.doesNotMatch(savedText, /sentinel|apiKey|sk-/i);
  assert.equal(JSON.parse(savedText).configured, true);

  const separateBrowser = await fetch(`${baseUrl}/api/llm/configuration`);
  assert.equal((await separateBrowser.json()).configured, false);

  const generated = await fetch(`${baseUrl}/api/simulation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie!,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      strategy: "Drive to the target.",
      selectedFeatureIds: ["drive-planning", "object-intake", "goal-scoring"],
      robotCustomization: {
        widthFeet: 2,
        lengthFeet: 2,
        translationSpeedFeetPerSecond: 15,
        spinSpeedRotationsPerSecond: 1,
      },
    }),
  });
  const generationText = await generated.text();
  assert.equal(generated.status, 200);
  assert.doesNotMatch(generationText, /sentinel|apiKey|sk-/i);
  const generation = JSON.parse(generationText);
  assert.equal(generation.scene.playback.frames.at(-1).status, "complete");
  assert.equal(generation.scene.playback.timing.durationSeconds, 135);
  assert.equal(generation.scene.playback.frames.at(-1).metrics.points, 24);
  assert.deepEqual(generation.scene.playback.frames.at(-1).robot.inventory, { "game-object": 0 });
  assert.equal(generation.statistics.latestGeneration.decisions, capturedRequests.length);
  assert.ok(capturedRequests.length >= 3);
  assert.equal(generation.statistics.latestGeneration.cachedInputTokens, 25 * capturedRequests.length);
  assert.equal(generation.statistics.sessionTotal.totalTokens, 120 * capturedRequests.length);
  assert.equal("debugTrace" in generation, false);
  for (const capturedRequest of capturedRequests) {
    assert.doesNotMatch(capturedRequest.system, /sentinel|apiKey|sk-/i);
    assert.doesNotMatch(capturedRequest.prompt, /sentinel|apiKey|sk-/i);
  }

  const disconnected = await fetch(`${baseUrl}/api/llm/configuration`, {
    method: "DELETE",
    headers: { Cookie: cookie!, Origin: baseUrl },
  });
  assert.equal(disconnected.status, 200);
  assert.match(
    disconnected.headers.get("set-cookie") ?? "",
    /(?:Max-Age=0|Expires=Thu, 01 Jan 1970 00:00:00 GMT)/,
  );
  const afterDisconnect = await fetch(`${baseUrl}/api/llm/configuration`, {
    headers: { Cookie: cookie! },
  });
  assert.equal((await afterDisconnect.json()).configured, false);
});

test("development simulations return exact ordered LLM traces", async () => {
  const requests: StrategyModelRequest[] = [];
  const planner = new StrategyPlanner({
    runnerFactory: () => ({
      async generate(request) {
        requests.push(request);
        return {
          output: {
            summary: "Continue the development simulation.",
            actions: planForDecision(request),
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2 },
        };
      },
    }),
  });
  const { app } = await createLaunchpadServer({
    planner,
    sessionStore: new SessionStore(),
    exposeDebugTraces: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  const developmentUrl = `http://127.0.0.1:${address.port}`;

  try {
    const initial = await fetch(`${developmentUrl}/api/llm/configuration`);
    const cookie = initial.headers.get("set-cookie")!;
    await fetch(`${developmentUrl}/api/llm/configuration`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: developmentUrl },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        apiKey: SECRET,
      }),
    });
    const generated = await fetch(`${developmentUrl}/api/simulation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: developmentUrl },
      body: JSON.stringify({
        strategy: "Exercise multiple decisions.",
        selectedFeatureIds: ["drive-planning", "object-intake", "goal-scoring"],
        robotCustomization: {
          widthFeet: 2,
          lengthFeet: 2,
          translationSpeedFeetPerSecond: 15,
          spinSpeedRotationsPerSecond: 1,
        },
      }),
    });
    assert.equal(generated.status, 200);
    const payload = await generated.json();
    assert.equal(payload.debugTrace.length, requests.length);
    assert.ok(payload.debugTrace.length >= 3);
    assert.deepEqual(
      payload.debugTrace.map((trace: { response: { actions: readonly unknown[] } }) => trace.response.actions.length),
      [2, 3, 4, 1],
    );
    payload.debugTrace.forEach((trace: Record<string, unknown>, index: number) => {
      assert.equal(trace.decisionNumber, index + 1);
      assert.equal(trace.system, requests[index].system);
      assert.equal(trace.prompt, requests[index].prompt);
      assert.doesNotMatch(JSON.stringify(trace), /sentinel|apiKey|sk-/i);
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("mutation endpoints reject missing and cross-origin requests", async () => {
  const body = JSON.stringify({
    provider: "openai",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    apiKey: SECRET,
  });
  const missingOrigin = await fetch(`${baseUrl}/api/llm/configuration`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.equal(missingOrigin.status, 403);

  const wrongOrigin = await fetch(`${baseUrl}/api/llm/configuration`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://example.com" },
    body,
  });
  assert.equal(wrongOrigin.status, 403);
});
