import type {
  DecisionState,
  GameDefinition,
  RobotConfiguration,
} from "../engine/types.ts";
import { createSimulation } from "../engine/index.ts";
import {
  actionMetadataFromEngine,
  decisionContextFromEngine,
  robotConfigurationForPrompt,
} from "../llm/prompt.ts";
import {
  type StrategyGenerationOptions,
  type StrategyModelTrace,
  StrategyPlanner,
  type StrategyPlanningConfiguration,
} from "../llm/service.ts";
import type {
  StrategyGenerationRequest,
  StrategyPlan,
  TokenUsage,
} from "../llm/schemas.ts";
import {
  createNeutralPolicyCatalog,
  type NeutralPolicyContext,
} from "./neutral-policy.ts";
import {
  evaluatePolicy,
  type PolicyDefinition,
  type PolicyDecisionTrace,
  type PolicyEvaluationResult,
} from "../policy/index.ts";
import type { FieldPresentation, RobotCustomization, VisualizerScene } from "../visualizer/types.ts";
import {
  createNeutralGameDefinition,
  createNeutralPolicyGameDefinition,
  neutralRobotConfiguration,
  NEUTRAL_SIMULATION_FIELD,
} from "./neutral.ts";

export const MAX_SIMULATION_DECISIONS = 24;
export const MAX_POLICY_DECISIONS = 256;
const MAX_NO_PROGRESS_DECISIONS = 3;

export interface SimulationControllerInput {
  readonly strategy: string;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
  readonly navGrid: import("../engine/types.ts").NavGridDefinition;
}

export interface SimulationDebugTrace {
  readonly decisionNumber: number;
  readonly model: string;
  readonly reasoningEffort: StrategyPlanningConfiguration["reasoningEffort"];
  readonly system: string;
  readonly prompt: string;
  /** The validated response actually submitted to the simulator. */
  readonly response: StrategyPlan;
  readonly usage: TokenUsage;
}

export interface SimulationControllerOptions {
  readonly planner: StrategyPlanner;
  readonly configuration: StrategyPlanningConfiguration;
  readonly input: SimulationControllerInput;
  readonly game?: GameDefinition;
  readonly field?: FieldPresentation;
  /** Optional season adapter. Defaults to the neutral master-branch adapter. */
  readonly createRobotConfiguration?: (input: SimulationControllerInput) => RobotConfiguration;
  readonly seed?: number;
  readonly maxDecisions?: number;
  /** Diagnostics are intentionally absent unless explicitly enabled. */
  readonly includeDebugTraces?: boolean;
}

export interface SimulationControllerResult {
  readonly scene: VisualizerScene;
  readonly usages: readonly TokenUsage[];
  readonly decisionCount: number;
  readonly debugTrace?: readonly SimulationDebugTrace[];
}

export interface PolicySimulationControllerInput {
  readonly policy: PolicyDefinition;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
  readonly navGrid: import("../engine/types.ts").NavGridDefinition;
}

export interface PolicySimulationControllerOptions {
  readonly input: PolicySimulationControllerInput;
  readonly game?: GameDefinition;
  readonly field?: FieldPresentation;
  readonly createRobotConfiguration?: (input: PolicySimulationControllerInput) => RobotConfiguration;
  readonly seed?: number;
  readonly maxDecisions?: number;
}

export interface PolicySimulationControllerResult {
  readonly scene: VisualizerScene;
  readonly policy: PolicyDefinition;
  readonly decisionCount: number;
  readonly policyTrace: readonly PolicyDecisionTrace[];
}

export class SimulationControllerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationControllerError";
  }
}

/**
 * Run one complete match, asking the planner for a new action queue whenever
 * the engine reaches a decision point. LLM calls happen outside simulation
 * time; the engine remains the sole owner of robot and match state.
 */
export async function runSimulationWithLlm(
  options: SimulationControllerOptions,
): Promise<SimulationControllerResult> {
  if (options.input.strategy.trim().length === 0) {
    throw new SimulationControllerError("Enter a strategy before generating a simulation.");
  }
  const maxDecisions = options.maxDecisions ?? MAX_SIMULATION_DECISIONS;
  if (!Number.isInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > MAX_SIMULATION_DECISIONS) {
    throw new SimulationControllerError(`maxDecisions must be an integer from 1 to ${MAX_SIMULATION_DECISIONS}.`);
  }

  const game = {
    ...(options.game ?? createNeutralGameDefinition()),
    navGrid: options.input.navGrid,
  };
  const robotConfiguration = options.createRobotConfiguration?.(options.input)
    ?? neutralRobotConfiguration(options.input.selectedFeatureIds, options.input.robotCustomization);
  const simulation = createSimulation(
    game,
    robotConfiguration,
    { seed: options.seed, recordPlayback: true },
  );
  const traces: SimulationDebugTrace[] = [];
  const usages: TokenUsage[] = [];
  let decision = simulation.getDecisionState();
  let feedback: Readonly<Record<string, unknown>> | null = null;
  let noProgressDecisions = 0;

  for (let decisionIndex = 0; decisionIndex < maxDecisions && decision.status !== "complete"; decisionIndex += 1) {
    const stateBefore = decision;
    const generationRequest = createGenerationRequest(options.input, robotConfiguration, stateBefore, feedback);
    let capturedTrace: StrategyModelTrace | null = null;
    const plannerOptions: StrategyGenerationOptions = options.includeDebugTraces
      ? {
          onTrace: (trace) => {
            capturedTrace = trace;
          },
        }
      : {};

    let plan: StrategyPlan;
    const result = await options.planner.generate(options.configuration, generationRequest, plannerOptions);
    plan = result.plan;
    usages.push(result.usage);
    if (options.includeDebugTraces) {
      const trace = requireModelTrace(capturedTrace);
      traces.push({
        decisionNumber: decisionIndex + 1,
        model: trace.request.model,
        reasoningEffort: trace.request.reasoningEffort,
        system: trace.request.system,
        prompt: trace.request.prompt,
        response: plan,
        usage: result.usage,
      });
    }

    if (plan.actions.length === 0) {
      throw new SimulationControllerError(
        `The LLM returned an empty action queue at decision ${decisionIndex + 1}.`,
      );
    }

    const queueResult = stateBefore.status === "blocked"
      ? simulation.replaceActions(plan.actions)
      : simulation.queueActions(plan.actions);
    if (!queueResult.accepted) {
      feedback = {
        type: "action-queue-validation",
        errors: queueResult.errors,
        rejectedActions: plan.actions,
      };
      continue;
    }

    feedback = null;
    decision = simulation.runUntilDecision();
    if (decision.status !== "complete" && !madeProgress(stateBefore, decision)) {
      noProgressDecisions += 1;
      if (noProgressDecisions >= MAX_NO_PROGRESS_DECISIONS) {
        throw new SimulationControllerError(
          `The simulation made no progress for ${MAX_NO_PROGRESS_DECISIONS} consecutive decisions.`,
        );
      }
    } else {
      noProgressDecisions = 0;
    }
  }

  if (decision.status !== "complete") {
    throw new SimulationControllerError(
      `The simulation did not complete within ${maxDecisions} LLM decisions (status: ${decision.status}).`,
    );
  }
  const playback = simulation.exportPlayback();
  if (playback === null) throw new SimulationControllerError("Simulation playback was not recorded.");
  return {
    scene: { field: options.field ?? NEUTRAL_SIMULATION_FIELD, navGrid: options.input.navGrid, playback },
    usages: Object.freeze([...usages]),
    decisionCount: traces.length > 0 ? traces.length : usages.length,
    ...(options.includeDebugTraces ? { debugTrace: Object.freeze([...traces]) } : {}),
  };
}

/** Run a match using only the validated, deterministic policy catalog. */
export async function runSimulationWithPolicy(
  options: PolicySimulationControllerOptions,
): Promise<PolicySimulationControllerResult> {
  const maxDecisions = options.maxDecisions ?? MAX_POLICY_DECISIONS;
  if (!Number.isInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > MAX_POLICY_DECISIONS) {
    throw new SimulationControllerError(`maxDecisions must be an integer from 1 to ${MAX_POLICY_DECISIONS}.`);
  }

  const catalog = createNeutralPolicyCatalog();
  let policy: PolicyDefinition;
  try {
    policy = catalog.validatePolicy(options.input.policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The policy could not be validated.";
    throw new SimulationControllerError(`Invalid policy: ${message}`);
  }

  const game = {
    ...(options.game ?? createNeutralPolicyGameDefinition()),
    navGrid: options.input.navGrid,
  };
  const robotConfiguration = options.createRobotConfiguration?.(options.input)
    ?? neutralRobotConfiguration(options.input.selectedFeatureIds, options.input.robotCustomization);
  const simulation = createSimulation(game, robotConfiguration, {
    seed: options.seed,
    recordPlayback: true,
    interruptAtEndgameStart: true,
  });
  const policyTrace: PolicyDecisionTrace[] = [];
  const rejectedTargetIds = new Set<string>();
  let decision = simulation.getDecisionState();
  let noProgressDecisions = 0;

  for (let decisionIndex = 0; decisionIndex < maxDecisions && decision.status !== "complete"; decisionIndex += 1) {
    const stateBefore = decision;
    const context: NeutralPolicyContext = {
      decision: stateBefore,
      game,
      rejectedTargetIds,
    };
    const phase = stateBefore.endgameActive ? "endgame" : "match";
    const evaluated = evaluateNeutralPolicy(policy, phase, context, catalog, decisionIndex + 1);
    policyTrace.push(evaluated.trace);
    if (evaluated.plan.actions.length === 0) {
      throw new SimulationControllerError(
        `Policy goal "${evaluated.plan.goalId}" returned an empty action queue at decision ${decisionIndex + 1}.`,
      );
    }

    const queueResult = stateBefore.status === "blocked"
      ? simulation.replaceActions(evaluated.plan.actions)
      : simulation.queueActions(evaluated.plan.actions);
    if (!queueResult.accepted) {
      const errors = queueResult.errors.map((error) => error.message).join(" ");
      throw new SimulationControllerError(`Policy goal "${evaluated.plan.goalId}" produced invalid actions: ${errors}`);
    }

    decision = simulation.runUntilDecision();
    if (decision.status === "blocked" && evaluated.plan.targetId !== undefined) {
      rejectedTargetIds.add(evaluated.plan.targetId);
    }
    const progressed = madeProgress(stateBefore, decision);
    if (progressed) {
      rejectedTargetIds.clear();
      noProgressDecisions = 0;
    } else if (decision.status !== "complete") {
      noProgressDecisions += 1;
      if (noProgressDecisions >= MAX_NO_PROGRESS_DECISIONS) {
        throw new SimulationControllerError(
          `The simulation made no progress for ${MAX_NO_PROGRESS_DECISIONS} consecutive policy decisions.`,
        );
      }
    }
  }

  if (decision.status !== "complete") {
    throw new SimulationControllerError(
      `The simulation did not complete within ${maxDecisions} policy decisions (status: ${decision.status}).`,
    );
  }
  const playback = simulation.exportPlayback();
  if (playback === null) throw new SimulationControllerError("Simulation playback was not recorded.");
  return {
    scene: { field: options.field ?? NEUTRAL_SIMULATION_FIELD, navGrid: options.input.navGrid, playback },
    policy,
    decisionCount: policyTrace.length,
    policyTrace: Object.freeze([...policyTrace]),
  };
}

function evaluateNeutralPolicy(
  policy: PolicyDefinition,
  phase: "match" | "endgame",
  context: NeutralPolicyContext,
  catalog: ReturnType<typeof createNeutralPolicyCatalog>,
  decisionNumber: number,
): PolicyEvaluationResult {
  // Keep the neutral IDs and their season data in this adapter; the evaluator is generic.
  return evaluatePolicy(policy, phase, context, catalog, {
    decisionNumber,
    elapsedSeconds: context.decision.elapsedSeconds,
  });
}

function createGenerationRequest(
  input: SimulationControllerInput,
  robotConfiguration: RobotConfiguration,
  decision: DecisionState,
  feedback: Readonly<Record<string, unknown>> | null,
): StrategyGenerationRequest {
  return {
    strategy: input.strategy,
    selectedFeatureIds: [...input.selectedFeatureIds],
    robotCustomization: robotConfigurationForPrompt(robotConfiguration),
    decisionContext: {
      ...decisionContextFromEngine(decision),
      ...(feedback ? { controllerFeedback: feedback } : {}),
    },
    enabledActions: [...actionMetadataFromEngine(decision.enabledActions)],
  };
}

function requireModelTrace(trace: StrategyModelTrace | null): StrategyModelTrace {
  if (trace === null) {
    throw new SimulationControllerError("The planner did not provide a trace for a debug generation.");
  }
  return trace;
}

function madeProgress(before: DecisionState, after: DecisionState): boolean {
  return before.elapsedSeconds !== after.elapsedSeconds
    || before.metrics.points !== after.metrics.points
    || JSON.stringify(before.metrics.rankingPoints) !== JSON.stringify(after.metrics.rankingPoints)
    || before.robot.pose.xFeet !== after.robot.pose.xFeet
    || before.robot.pose.yFeet !== after.robot.pose.yFeet
    || before.robot.pose.headingRotations !== after.robot.pose.headingRotations
    || JSON.stringify(before.robot.inventory) !== JSON.stringify(after.robot.inventory)
    || JSON.stringify(before.pickupZones) !== JSON.stringify(after.pickupZones)
    || JSON.stringify(before.scoreZones) !== JSON.stringify(after.scoreZones);
}
