import type {
  ActionRequest,
  DecisionState,
  GameDefinition,
} from "../engine/types.ts";

/** Values that can be represented in a policy document or sent over JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export type PolicyParameters = Readonly<Record<string, JsonValue>>;
export type PolicyPhase = "match" | "endgame";

export interface PolicyDefinition {
  readonly version: 1;
  readonly name: string;
  readonly match: PolicyPhaseDefinition;
  readonly endgame: PolicyPhaseDefinition;
}

export interface PolicyPhaseDefinition {
  readonly rules: readonly PolicyRule[];
  readonly fallback: PolicyGoal;
}

export interface PolicyRule {
  readonly id: string;
  readonly conditions: readonly PolicyCondition[];
  readonly goal: PolicyGoal;
}

export interface PolicyCondition {
  readonly conditionId: string;
  readonly parameters: PolicyParameters;
}

export interface PolicyGoal {
  readonly goalId: string;
  readonly parameters: PolicyParameters;
}

export interface PolicyEvaluationContext {
  readonly decision: DecisionState;
  readonly game: GameDefinition;
  /** Targets rejected without measurable progress in the current state. */
  readonly rejectedTargetIds?: ReadonlySet<string>;
}

export interface PolicyConditionEvaluation {
  readonly matched: boolean;
  readonly explanation: string;
}

export interface PolicyGoalAvailability {
  readonly available: boolean;
  readonly explanation: string;
}

export interface PolicyConditionDefinition<Request, Context = PolicyEvaluationContext> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  validate(parameters: unknown): ValidationResult<Request>;
  evaluate(context: Context, request: Request): PolicyConditionEvaluation;
}

export interface PolicyGoalDefinition<Request, Context = PolicyEvaluationContext> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  validate(parameters: unknown): ValidationResult<Request>;
  isAvailable(context: Context, request: Request): PolicyGoalAvailability;
  expand(context: Context, request: Request): GoalPlan;
}

export interface GoalPlan {
  readonly goalId: string;
  readonly targetId?: string;
  readonly actions: readonly ActionRequest[];
  readonly explanation: string;
}

export interface PolicyConditionEvaluationTrace {
  readonly conditionId: string;
  readonly matched: boolean;
  readonly explanation: string;
}

export interface PolicyRuleEvaluation {
  readonly ruleId: string;
  readonly conditionEvaluations: readonly PolicyConditionEvaluationTrace[];
  readonly conditionsMatched: boolean;
  readonly goalAvailable: boolean;
  readonly selected: boolean;
  readonly explanation: string;
}

export interface PolicyDecisionTrace {
  readonly decisionNumber: number;
  readonly elapsedSeconds: number;
  readonly phase: PolicyPhase;
  readonly evaluations: readonly PolicyRuleEvaluation[];
  readonly selectedRuleId: string | null;
  readonly usedFallback: boolean;
  readonly goalId: string;
  readonly targetId?: string;
  readonly actions: readonly ActionRequest[];
  readonly explanation: string;
}

export type ValidationResult<Request> =
  | { readonly valid: true; readonly value: Request }
  | { readonly valid: false; readonly message: string };

export const POLICY_NAME_MAX_LENGTH = 100;
export const POLICY_ID_MAX_LENGTH = 128;
export const MAX_POLICY_RULES_PER_PHASE = 32;
export const MAX_POLICY_CONDITIONS_PER_RULE = 8;
