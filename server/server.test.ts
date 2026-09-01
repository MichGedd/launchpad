import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { StrategyPlanner, type StrategyModelRequest } from "../app/llm/service.ts";
import { SessionStore } from "../app/llm/session.ts";
import { createLaunchpadServer } from "./index.ts";

const SECRET = "sk-sentinel-never-return-this";
let baseUrl = "";
let closeServer: (() => Promise<void>) | null = null;
let capturedRequest: StrategyModelRequest | null = null;

before(async () => {
  const planner = new StrategyPlanner({
    runnerFactory(apiKey) {
      assert.equal(apiKey, SECRET);
      return {
        async generate(request) {
          capturedRequest = request;
          return {
            output: {
              summary: "Drive to the target.",
              actions: [{
                actionId: "drive-to",
                parameters: { xFeet: 10, yFeet: 4, headingRotations: 0 },
              }],
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

  const generated = await fetch(`${baseUrl}/api/strategy-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie!,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      strategy: "Drive to the target.",
      selectedFeatureIds: ["drive-planning"],
      robotCustomization: { widthFeet: 2, lengthFeet: 2 },
      decisionContext: { status: "awaiting-actions" },
      enabledActions: [{ id: "drive-to", description: "Drive to a pose." }],
    }),
  });
  const generationText = await generated.text();
  assert.equal(generated.status, 200);
  assert.doesNotMatch(generationText, /sentinel|apiKey|sk-/i);
  const generation = JSON.parse(generationText);
  assert.equal(generation.statistics.latestGeneration.decisions, 1);
  assert.equal(generation.statistics.latestGeneration.cachedInputTokens, 25);
  assert.equal(generation.statistics.sessionTotal.totalTokens, 120);
  assert.doesNotMatch(capturedRequest?.system ?? "", /sentinel|apiKey|sk-/i);
  assert.doesNotMatch(capturedRequest?.prompt ?? "", /sentinel|apiKey|sk-/i);

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
