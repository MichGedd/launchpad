import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  llmConfigurationRequestSchema,
} from "../app/llm/schemas.ts";
import {
  createDevelopmentMockStrategyRunner,
  createVercelStrategyRunner,
  StrategyPlanner,
  StrategyPlanningError,
} from "../app/llm/service.ts";
import { SessionStore } from "../app/llm/session.ts";
import {
  runSimulationWithLlm,
  SimulationControllerError,
  simulationGenerationRequestSchema,
  type SimulationGenerationResponse,
} from "../app/simulation/index.ts";

const SESSION_COOKIE = "launchpad_session";
const BODY_LIMIT = "64kb";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export interface LaunchpadServerOptions {
  readonly sessionStore?: SessionStore;
  readonly planner?: StrategyPlanner;
  readonly mode?: "api-only" | "production";
  /** Exact model exchanges are exposed only by an explicitly development server. */
  readonly exposeDebugTraces?: boolean;
}

export async function createLaunchpadServer(
  options: LaunchpadServerOptions = {},
): Promise<{ readonly app: Express }> {
  const app = express();
  const sessions = options.sessionStore ?? new SessionStore();
  const planner = options.planner ?? new StrategyPlanner({
    runnerFactory: createVercelStrategyRunner,
  });
  const mode = options.mode ?? "api-only";

  app.disable("x-powered-by");
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/llm/configuration", (request, response) => {
    const sessionId = getOrCreateSessionId(request, response, sessions);
    response.json(sessions.getConfiguration(sessionId));
  });

  app.put("/api/llm/configuration", requireSameOrigin, (request, response) => {
    const sessionId = getOrCreateSessionId(request, response, sessions);
    const parsed = llmConfigurationRequestSchema.safeParse(normalizeConfigurationBody(request.body));
    if (!parsed.success) {
      response.status(400).json({ error: "Configuration is invalid." });
      return;
    }
    if (parsed.data.provider !== "openai") {
      response.status(422).json({ error: "Only ChatGPT configuration is available right now." });
      return;
    }
    const current = sessions.withConfiguration(sessionId);
    const apiKey = parsed.data.apiKey ?? current?.apiKey;
    if (!apiKey) {
      response.status(400).json({ error: "Enter an API key to configure ChatGPT." });
      return;
    }
    response.json(sessions.setConfiguration(sessionId, {
      provider: "openai",
      model: parsed.data.model,
      reasoningEffort: parsed.data.reasoningEffort,
      apiKey,
    }));
  });

  app.delete("/api/llm/configuration", requireSameOrigin, (request, response) => {
    const sessionId = getOrCreateSessionId(request, response, sessions);
    sessions.delete(sessionId);
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecureRequest(request),
      path: "/",
    });
    response.json({ provider: null, model: null, reasoningEffort: null, configured: false });
  });

  app.get("/api/llm/statistics", (request, response) => {
    const sessionId = getOrCreateSessionId(request, response, sessions);
    response.json(sessions.getStatistics(sessionId) ?? {
      latestGeneration: null,
      sessionTotal: {
        decisions: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        averageTokensPerDecision: null,
        cachedInputTokens: 0,
      },
    });
  });

  app.post("/api/simulation", requireSameOrigin, async (request, response) => {
    const sessionId = getOrCreateSessionId(request, response, sessions);
    const configuration = sessions.withConfiguration(sessionId);
    if (!configuration) {
      response.status(409).json({ error: "Please configure your LLM before generating a simulation." });
      return;
    }
    const parsed = simulationGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Simulation request is invalid." });
      return;
    }
    if (!sessions.beginGeneration(sessionId)) {
      response.status(429).json({ error: "A simulation is already being generated." });
      return;
    }
    try {
      const result = await runSimulationWithLlm({
        planner,
        configuration,
        input: parsed.data,
        includeDebugTraces: options.exposeDebugTraces === true,
      });
      for (const usage of result.usages) sessions.recordUsage(sessionId, usage);
      const statistics = sessions.getStatistics(sessionId);
      const payload = {
        scene: result.scene,
        ...(statistics ? { statistics } : {}),
        ...(options.exposeDebugTraces === true && result.debugTrace
          ? { debugTrace: result.debugTrace }
          : {}),
      } satisfies SimulationGenerationResponse;
      response.json(payload);
    } catch (error) {
      if (error instanceof StrategyPlanningError && error.usage) {
        sessions.recordUsage(sessionId, error.usage);
      }
      response.status(502).json({
        error: error instanceof StrategyPlanningError || error instanceof SimulationControllerError
          ? error.message
          : "The simulation could not be generated.",
      });
    } finally {
      sessions.endGeneration(sessionId);
    }
  });

  if (mode === "production") {
    app.use(express.static(join(projectRoot, "build/client")));
    app.use((_request, response) => {
      response.sendFile(join(projectRoot, "build/client/index.html"));
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    // Never return parser/provider details: they can contain request material or credentials.
    response.status(400).json({ error: "Request could not be processed." });
  });
  return { app };
}

export async function startLaunchpadServer(port = Number(process.env.PORT ?? 5173)) {
  const host = process.env.HOST ?? "127.0.0.1";
  if (process.env.NODE_ENV === "production") {
    const { app } = await createLaunchpadServer({ mode: "production" });
    return app.listen(port, host, () => {
      console.log(`Launchpad listening on http://${host}:${port}`);
    });
  }

  const apiPort = Number(process.env.API_PORT ?? port + 1);
  const useDevelopmentMock = process.env.LAUNCHPAD_MOCK_LLM === "1";
  const { app } = await createLaunchpadServer({
    mode: "api-only",
    exposeDebugTraces: true,
    ...(useDevelopmentMock
      ? {
          planner: new StrategyPlanner({
            runnerFactory: createDevelopmentMockStrategyRunner,
          }),
        }
      : {}),
  });
  const apiServer = app.listen(apiPort, host);
  await new Promise<void>((resolve, reject) => {
    apiServer.once("listening", resolve);
    apiServer.once("error", reject);
  });
  const frontendProcess = spawn(process.execPath, [
    join(projectRoot, "node_modules/@react-router/dev/bin.js"),
    "dev",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      LAUNCHPAD_API_TARGET: `http://${host}:${apiPort}`,
    },
    stdio: "inherit",
  });
  const stop = () => {
    if (!frontendProcess.killed) frontendProcess.kill();
    apiServer.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  frontendProcess.once("exit", () => apiServer.close());
  return { apiServer, frontendProcess };
}

function normalizeConfigurationBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const candidate = { ...(body as Record<string, unknown>) };
  if (candidate.apiKey === "") delete candidate.apiKey;
  return candidate;
}

function getOrCreateSessionId(request: Request, response: Response, sessions: SessionStore): string {
  const existing = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (existing && sessions.get(existing)) return existing;
  const sessionId = sessions.createSession();
  const secure = isSecureRequest(request);
  response.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: 60 * 60 * 1000,
    path: "/",
  });
  return sessionId;
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function requireSameOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get("origin");
  const host = request.get("host");
  if (!origin || !host) {
    response.status(403).json({ error: "This request must come from the Launchpad application." });
    return;
  }
  try {
    const expectedProtocol = isSecureRequest(request)
      ? "https:"
      : "http:";
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== expectedProtocol || parsedOrigin.host !== host) {
      response.status(403).json({ error: "This request must come from the Launchpad application." });
      return;
    }
  } catch {
    response.status(403).json({ error: "This request must come from the Launchpad application." });
    return;
  }
  next();
}

function isSecureRequest(request: Request): boolean {
  return request.secure || request.headers["x-forwarded-proto"] === "https";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startLaunchpadServer();
}
