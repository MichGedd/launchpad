import type { SimulationGenerationRequest } from "./schemas.ts";
import type { SimulationGenerationResponse } from "./api.ts";

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

export function generateSimulation(
  requestBody: SimulationGenerationRequest,
): Promise<SimulationGenerationResponse> {
  return request<SimulationGenerationResponse>("/api/simulation", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}
