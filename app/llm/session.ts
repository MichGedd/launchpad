import { randomBytes } from "node:crypto";

import {
  llmConfigurationStatusSchema,
  type LlmConfigurationStatus,
  tokenStatisticsSchema,
  type LlmStatistics,
  type ReasoningEffort,
  type TokenUsage,
} from "./schemas.ts";

export interface StoredLlmConfiguration {
  readonly provider: "openai";
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly apiKey: string;
}

interface MutableStatistics {
  decisions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
}

interface SessionRecord {
  configuration: StoredLlmConfiguration | null;
  latestGeneration: MutableStatistics | null;
  sessionTotal: MutableStatistics;
  lastAccessedAt: number;
  generationInProgress: boolean;
}

export interface SessionStoreOptions {
  readonly now?: () => number;
  readonly inactivityMs?: number;
}

const emptyStatistics = (): MutableStatistics => ({
  decisions: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
});

export class SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #now: () => number;
  readonly #inactivityMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#inactivityMs = options.inactivityMs ?? 60 * 60 * 1000;
  }

  createSession(): string {
    const sessionId = randomBytes(32).toString("base64url");
    this.#sessions.set(sessionId, {
      configuration: null,
      latestGeneration: null,
      sessionTotal: emptyStatistics(),
      lastAccessedAt: this.#now(),
      generationInProgress: false,
    });
    return sessionId;
  }

  get(sessionId: string): SessionRecord | null {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;
    if (this.#now() - session.lastAccessedAt >= this.#inactivityMs) {
      this.#sessions.delete(sessionId);
      return null;
    }
    session.lastAccessedAt = this.#now();
    return session;
  }

  delete(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  getConfiguration(sessionId: string): LlmConfigurationStatus {
    const session = this.get(sessionId);
    if (!session?.configuration) {
      return { provider: null, model: null, reasoningEffort: null, configured: false };
    }
    return llmConfigurationStatusSchema.parse({
      provider: session.configuration.provider,
      model: session.configuration.model,
      reasoningEffort: session.configuration.reasoningEffort,
      configured: true,
    });
  }

  setConfiguration(sessionId: string, configuration: StoredLlmConfiguration): LlmConfigurationStatus {
    const session = this.get(sessionId);
    if (!session) throw new Error("Session expired.");
    session.configuration = { ...configuration };
    return this.getConfiguration(sessionId);
  }

  clearConfiguration(sessionId: string): void {
    const session = this.get(sessionId);
    if (!session) return;
    session.configuration = null;
    session.latestGeneration = null;
    session.sessionTotal = emptyStatistics();
  }

  withConfiguration(sessionId: string): StoredLlmConfiguration | null {
    return this.get(sessionId)?.configuration ?? null;
  }

  beginGeneration(sessionId: string): boolean {
    const session = this.get(sessionId);
    if (!session || session.generationInProgress) return false;
    session.generationInProgress = true;
    session.latestGeneration = emptyStatistics();
    return true;
  }

  endGeneration(sessionId: string): void {
    const session = this.get(sessionId);
    if (session) session.generationInProgress = false;
  }

  recordUsage(sessionId: string, usage: TokenUsage): LlmStatistics | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const increment = {
      decisions: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedInputTokens: usage.cachedInputTokens,
    };
    session.latestGeneration = session.generationInProgress
      ? addStatistics(session.latestGeneration ?? emptyStatistics(), increment)
      : increment;
    session.sessionTotal = addStatistics(session.sessionTotal, increment);
    return this.getStatistics(sessionId);
  }

  getStatistics(sessionId: string): LlmStatistics | null {
    const session = this.get(sessionId);
    if (!session) return null;
    return {
      latestGeneration: session.latestGeneration ? toPublicStatistics(session.latestGeneration) : null,
      sessionTotal: toPublicStatistics(session.sessionTotal),
    };
  }
}

function addStatistics(left: MutableStatistics, right: MutableStatistics): MutableStatistics {
  return {
    decisions: left.decisions + right.decisions,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  };
}

function toPublicStatistics(statistics: MutableStatistics) {
  return tokenStatisticsSchema.parse({
    ...statistics,
    averageTokensPerDecision: statistics.decisions === 0
      ? null
      : statistics.totalTokens / statistics.decisions,
  });
}
