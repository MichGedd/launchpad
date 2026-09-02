import type {
  LlmActionRequest,
  LlmConfigurationRequest,
  LlmConfigurationStatus,
  LlmProvider,
  LlmStatistics,
  ReasoningEffort,
  StrategyPlan,
  TokenUsage,
} from "./schemas";
import type {
  SimulationDebugTrace,
  SimulationGenerationRequest,
  SimulationGenerationResponse,
} from "~/simulation";

export type {
  LlmConfigurationRequest,
  LlmConfigurationStatus,
  LlmStatistics,
  LlmProvider,
  ReasoningEffort,
  StrategyPlan,
  TokenUsage,
};
export type { LlmActionRequest };
export type { SimulationDebugTrace };

const DEFAULT_CONFIGURATION: LlmConfigurationStatus = {
  provider: "openai",
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
  configured: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string") return value.message;
  if (isRecord(value) && typeof value.error === "string") return value.error;
  return "The request could not be completed. Try again.";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload));
  return payload as T;
}

export async function getLlmConfiguration(): Promise<LlmConfigurationStatus> {
  try {
    return await request<LlmConfigurationStatus>("/api/llm/configuration");
  } catch {
    return DEFAULT_CONFIGURATION;
  }
}

export function saveLlmConfiguration(
  configuration: LlmConfigurationRequest,
): Promise<LlmConfigurationStatus> {
  return request<LlmConfigurationStatus>("/api/llm/configuration", {
    method: "PUT",
    body: JSON.stringify(configuration),
  });
}

export function disconnectLlm(): Promise<void> {
  return request<void>("/api/llm/configuration", { method: "DELETE" });
}

export function generateSimulation(
  requestBody: SimulationGenerationRequest,
): Promise<SimulationGenerationResponse> {
  return request<SimulationGenerationResponse>("/api/simulation", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export function getLlmStatistics(): Promise<LlmStatistics> {
  return request<LlmStatistics>("/api/llm/statistics");
}
