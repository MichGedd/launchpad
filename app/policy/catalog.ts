import type {
  PolicyCondition,
  PolicyConditionDefinition,
  PolicyDefinition,
  PolicyGoal,
  PolicyGoalDefinition,
  PolicyParameters,
  PolicyRule,
  PolicyPhaseDefinition,
  ValidationResult,
} from "./types.ts";
import {
  MAX_POLICY_CONDITIONS_PER_RULE,
  MAX_POLICY_RULES_PER_PHASE,
  POLICY_ID_MAX_LENGTH,
  POLICY_NAME_MAX_LENGTH,
} from "./types.ts";

export interface PolicyCatalogDefinitions<Request, Context = import("./types.ts").PolicyEvaluationContext> {
  readonly conditions: readonly PolicyConditionDefinition<Request, Context>[];
  readonly goals: readonly PolicyGoalDefinition<Request, Context>[];
}

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

function isJsonValue(value: unknown): value is import("./types.ts").JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(([key, item]) => key.length > 0 && isJsonValue(item));
}

export function isJsonObject(value: unknown): value is PolicyParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return isJsonValue(value);
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > POLICY_ID_MAX_LENGTH) {
    throw new PolicyValidationError(`${label} must be 1-${POLICY_ID_MAX_LENGTH} characters.`);
  }
}

function requireParameters(value: unknown, label: string): asserts value is PolicyParameters {
  if (!isJsonObject(value)) {
    throw new PolicyValidationError(`${label} must be a JSON-compatible object.`);
  }
}

function validateCondition<Request, Context>(
  condition: PolicyCondition,
  index: number,
  catalog: PolicyCatalog<Request, Context>,
): void {
  if (typeof condition !== "object" || condition === null) {
    throw new PolicyValidationError(`Condition ${index + 1} must be an object.`);
  }
  requireIdentifier(condition.conditionId, `Condition ${index + 1} ID`);
  requireParameters(condition.parameters, `Condition "${condition.conditionId}" parameters`);
  const definition = catalog.condition(condition.conditionId);
  if (!definition) throw new PolicyValidationError(`Unknown policy condition "${condition.conditionId}".`);
  const result = definition.validate(condition.parameters);
  if (!result.valid) {
    throw new PolicyValidationError(`Invalid parameters for condition "${condition.conditionId}": ${result.message}`);
  }
}

function validateGoal<Request, Context>(
  goal: PolicyGoal,
  label: string,
  catalog: PolicyCatalog<Request, Context>,
): void {
  if (typeof goal !== "object" || goal === null) throw new PolicyValidationError(`${label} must be an object.`);
  requireIdentifier(goal.goalId, `${label} ID`);
  requireParameters(goal.parameters, `${label} "${goal.goalId}" parameters`);
  const definition = catalog.goal(goal.goalId);
  if (!definition) throw new PolicyValidationError(`Unknown policy goal "${goal.goalId}".`);
  const result = definition.validate(goal.parameters);
  if (!result.valid) {
    throw new PolicyValidationError(`Invalid parameters for goal "${goal.goalId}": ${result.message}`);
  }
}

function validatePhase<Request, Context>(
  phase: PolicyPhaseDefinition,
  label: string,
  catalog: PolicyCatalog<Request, Context>,
  ruleIds: Set<string>,
): void {
  if (typeof phase !== "object" || phase === null) throw new PolicyValidationError(`${label} phase must be an object.`);
  if (!Array.isArray(phase.rules) || phase.rules.length > MAX_POLICY_RULES_PER_PHASE) {
    throw new PolicyValidationError(`${label} phase must contain at most ${MAX_POLICY_RULES_PER_PHASE} rules.`);
  }
  if (!phase.fallback || typeof phase.fallback !== "object") {
    throw new PolicyValidationError(`${label} phase requires a fallback goal.`);
  }
  phase.rules.forEach((rule: PolicyRule, index) => {
    if (typeof rule !== "object" || rule === null) throw new PolicyValidationError(`${label} rule ${index + 1} must be an object.`);
    requireIdentifier(rule.id, `${label} rule ${index + 1} ID`);
    if (ruleIds.has(rule.id)) throw new PolicyValidationError(`Duplicate policy rule ID "${rule.id}".`);
    ruleIds.add(rule.id);
    if (!Array.isArray(rule.conditions) || rule.conditions.length > MAX_POLICY_CONDITIONS_PER_RULE) {
      throw new PolicyValidationError(`Rule "${rule.id}" must contain at most ${MAX_POLICY_CONDITIONS_PER_RULE} conditions.`);
    }
    rule.conditions.forEach((condition, conditionIndex) => validateCondition(condition, conditionIndex, catalog));
    validateGoal(rule.goal, `Rule "${rule.id}" goal`, catalog);
  });
  validateGoal(phase.fallback, `${label} fallback`, catalog);
}

function normalizedPolicy(policy: PolicyDefinition): PolicyDefinition {
  return policy.name === policy.name.trim() ? policy : { ...policy, name: policy.name.trim() };
}

export class PolicyCatalog<Request, Context = import("./types.ts").PolicyEvaluationContext> {
  readonly #conditions: ReadonlyMap<string, PolicyConditionDefinition<Request, Context>>;
  readonly #goals: ReadonlyMap<string, PolicyGoalDefinition<Request, Context>>;

  constructor(definitions: PolicyCatalogDefinitions<Request, Context>) {
    this.#conditions = registerDefinitions("condition", definitions.conditions);
    this.#goals = registerDefinitions("goal", definitions.goals);
  }

  condition(id: string): PolicyConditionDefinition<Request, Context> | undefined {
    return this.#conditions.get(id);
  }

  goal(id: string): PolicyGoalDefinition<Request, Context> | undefined {
    return this.#goals.get(id);
  }

  /** Return the registered goals for presentation and editor consumers. */
  goals(): readonly PolicyGoalDefinition<Request, Context>[] {
    return [...this.#goals.values()];
  }

  validatePolicy(policy: unknown): PolicyDefinition {
    if (typeof policy !== "object" || policy === null) throw new PolicyValidationError("Policy must be an object.");
    const candidate = policy as PolicyDefinition;
    if (candidate.version !== 1) throw new PolicyValidationError("Policy version must be 1.");
    if (typeof candidate.name !== "string") throw new PolicyValidationError("Policy name must be a string.");
    const name = candidate.name.trim();
    if (name.length < 1 || name.length > POLICY_NAME_MAX_LENGTH) {
      throw new PolicyValidationError(`Policy name must be 1-${POLICY_NAME_MAX_LENGTH} trimmed characters.`);
    }
    const ruleIds = new Set<string>();
    validatePhase(candidate.match, "Match", this, ruleIds);
    validatePhase(candidate.endgame, "Endgame", this, ruleIds);
    return normalizedPolicy(candidate);
  }

  /** Alias kept short for callers validating a document at an API boundary. */
  validate(policy: unknown): PolicyDefinition {
    return this.validatePolicy(policy);
  }
}

function registerDefinitions<Request, Context, Definition extends PolicyConditionDefinition<Request, Context> | PolicyGoalDefinition<Request, Context>>(
  kind: "condition" | "goal",
  definitions: readonly Definition[],
): ReadonlyMap<string, Definition> {
  const result = new Map<string, Definition>();
  for (const definition of definitions) {
    if (typeof definition.id !== "string" || definition.id.length < 1 || definition.id.length > POLICY_ID_MAX_LENGTH) {
      throw new Error(`${kind} definition IDs must be 1-${POLICY_ID_MAX_LENGTH} characters.`);
    }
    if (kind === "goal") validateRequiredFeatureIds(definition as PolicyGoalDefinition<Request, Context>);
    if (result.has(definition.id)) throw new Error(`Duplicate policy ${kind} definition ID "${definition.id}".`);
    result.set(definition.id, definition);
  }
  return result;
}

function validateRequiredFeatureIds<Request, Context>(definition: PolicyGoalDefinition<Request, Context>): void {
  const featureIds = definition.requiredFeatureIds;
  if (!Array.isArray(featureIds)) throw new Error(`Policy goal "${definition.id}" requiredFeatureIds must be an array.`);
  const seen = new Set<string>();
  for (const featureId of featureIds) {
    if (typeof featureId !== "string" || featureId.trim().length < 1 || featureId.length > POLICY_ID_MAX_LENGTH) {
      throw new Error(`Policy goal "${definition.id}" required feature IDs must be 1-${POLICY_ID_MAX_LENGTH} characters.`);
    }
    if (seen.has(featureId)) throw new Error(`Policy goal "${definition.id}" has duplicate required feature ID "${featureId}".`);
    seen.add(featureId);
  }
}

export function validationFailure(message: string): ValidationResult<never> {
  return { valid: false, message };
}
