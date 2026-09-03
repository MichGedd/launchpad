# AGENTS.md

## Project purpose

`launchpad` is a low-fidelity FIRST Robotics Competition (FRC) strategy simulator. It helps students evaluate strategies and robot features during the first few days after kickoff so they can make informed architectural decisions quickly.

This project is deliberately not a full physics simulator. Favor fast, understandable models over physical realism. For example:

- Model movement as traveling at a specified velocity.
- Model scoring or collecting a game piece as contacting a defined area for a specified duration.
- Simulate one robot at a time.

Do not add physical complexity unless it is necessary to compare strategies and the user explicitly requests it.

## Product architecture

The product has three primary parts:

1. A headless simulation engine that can execute many runs and report aggregate results such as average points and ranking points earned.
2. A deterministic policy subsystem that validates student-authored rules, resolves semantic goals into engine action queues, and explains every decision.
3. A graphical visualizer that displays one simulation of a robot moving around the field and executing a policy.

Students construct ordered Match and Endgame policies and select predefined robot features; they do not make real-time gameplay decisions during a run. The primary UI and `/api/simulation` path must execute deterministically with zero model-provider calls. The retained LLM controller exists for regression comparison and a possible separately approved natural-language policy compiler, not as the primary runtime controller.

Design robot features, game rules, field definitions, policy catalogs, and game interactions so they are easy to generate and change. An LLM working with mentor guidance should be able to port a new FRC game to `launchpad` within a few hours.

## Branch and season boundaries

- `master` is the core engine-development branch. It must support the simulation engine and graphical visualizer without containing season-specific rules, assets, field geometry, scoring, or robot features.
- Each season lives on a branch named `<YEAR>-<GAME_NAME>`.
- Add new-season robot features to the season branch first unless they are genuinely season-independent.
- Back-port reusable engine or visualizer improvements to `master` through a pull request.
- Before changing shared code, separate generic engine behavior from season-specific configuration.

## Deterministic policy architecture

- Keep `PolicyDefinition`, catalog registration, ordered evaluation, trace contracts, and controller orchestration season-independent.
- Put season or neutral condition/goal IDs, object types, target semantics, scoring, and action expansion in the season adapter.
- Match and Endgame are structural policy phases. AUTO, arbitrary boolean-expression trees, scripting languages, and season-state systems require separate product approval.
- Evaluate rules from top to bottom with AND semantics. An empty condition list means always. Continue past a matching rule when its goal is unavailable, then use the phase fallback. Fail actionably if no configured goal resolves.
- Condition evaluation, goal availability, and goal expansion are pure. Catalog definitions may inspect immutable engine and season state but must not mutate it.
- Goal plans contain a semantic goal ID, optional target ID, ordered `ActionRequest`s, and a human-readable explanation. Every evaluation must produce a production-safe `PolicyDecisionTrace`.
- Deterministic target selection must use engine-advertised legal targets, exclude targets rejected in the current unchanged state, sort by robot-footprint-to-zone distance, and break ties by ordinal zone ID.
- Preserve exact endgame reevaluation by using the engine's opt-in `interruptAtEndgameStart` behavior. Do not change the default-disabled engine semantics used by other controllers.
- `PolicyGoalDefinition.requiredFeatureIds` is presentation metadata for static prerequisites. Runtime availability still depends on live phase, engine state, targets, inventory, and action preconditions.
- Derive feature-to-goal UI relationships from catalog metadata. Do not duplicate mappings in components. Preserve existing unavailable policy references with warnings, disable unavailable new goal selections, and never silently rewrite student policies when features change.
- Deterministic simulation requests contain policy, selected features, robot customization, and NavGrid. Do not add an LLM session, provider configuration, token accounting, or generation lock to the primary endpoint.

## Engineering guidelines

Write production-quality web application code with strong awareness of FRC strategy and gameplay.

- Optimize for human readability, not cleverness.
- Prefer extreme simplicity, explicit typing, and minimal dependencies.
- Keep files small and cohesive. Keep related behavior together; do not fragment a simple feature across unnecessary abstractions.
- Do not use acronyms or unclear abbreviations in variable, function, type, or file names.
- Prefer functional composition and native Node.js capabilities over external dependencies unless the user explicitly requests a dependency or the existing stack already provides the needed capability.
- Enforce strict typing. Do not introduce `any` or weaken compiler checks to bypass a type error.
- Handle expected failure cases explicitly and return actionable errors.
- Make the smallest diff that completely solves the request. Preserve unrelated user changes.
- Do not add placeholders, `TODO` comments, speculative fallbacks, or unused abstractions.

## Visualizer UI style guide

The visualizer should feel simple, elegant, and sleek. Treat the field as the
primary workspace and keep every supporting control visually quiet until it is
needed.

### Color and typography

- Use Geist for all interface text. Prefer medium weights for controls and
  semibold weights for short headings; avoid decorative typography.
- Use `#808588` as the neutral foundation color. Dark and light surfaces may use
  derived tints, but the foundation color should remain recognizable in the
  field and page atmosphere.
- Use `#F7931E` for primary actions, active transport controls, and intentional
  emphasis. Do not use orange as general decoration.
- Use `#21409A` for robot state, replay data, informational focus, and selected
  data. Destructive and warning states must keep their conventional semantics.
- Maintain WCAG AA contrast for text and controls. Never place low-opacity text
  directly over a detailed field image without a glass or solid backing.

### Shape, depth, and spacing

- Prefer rounded rectangles throughout: 12px for compact controls, 16px for
  inputs, 20px for panels, and 24-28px for major workspace surfaces.
- Glass panels use a translucent neutral fill, a subtle one-pixel light border,
  20-24px backdrop blur, and one soft shadow. Avoid stacked borders, heavy glow,
  or multiple competing shadow styles.
- Use an 8px spacing rhythm. Keep dense transport controls compact while giving
  policy inputs and the field generous breathing room.
- The desktop visualizer targets viewports at least 1024px wide. Preserve a
  field-first hierarchy rather than shrinking the field to accommodate panels.

### Components and interaction

- Use Tailwind utilities for layout and local styling, shadcn/Base UI primitives
  for accessible interaction behavior, and Lucide icons for interface symbols.
  Extend existing primitives before introducing one-off control patterns.
- Keep the product single-page. Dialogs, sheets, menus, settings, replay details,
  and future tabs must overlay the visualizer rather than navigate away or open
  a separate browser window.
- Motion should explain state changes and normally complete in 160-240ms. Honor
  `prefers-reduced-motion`, keep focus rings visible, and provide text labels or
  accessible names for every icon-only control.
- Orange communicates actions; blue communicates data. Do not mix their roles
  merely to add color.
- Show robot-feature and policy-goal relationships on both surfaces. Expanded
  feature cards should identify enabled goals and current policy use; the policy
  editor should show static requirements and explain missing capabilities.
  Warning states use conventional warning colors and must not block generation
  when runtime fallbacks can still resolve the policy.

### Field and season boundaries

- Keep the visualizer on `master` season-independent. Receive field dimensions,
  optional background presentation, features, and playback through typed data
  instead of importing season assets or rules.
- Map visualizer coordinates from a bottom-left origin with positive Y upward,
  and document any season adapter that uses a different source convention.
- When the user supplies reference images, use the available Playwright
  interactive browser workflow to compare the implementation at the requested
  viewport. Treat rough sketches as hierarchy guidance, not exact measurements.

## Workflow

- For non-trivial changes, begin in read-only plan mode (`/plan`) and present the implementation plan for user review before editing files.
- Inspect the relevant existing code and conventions before proposing or implementing changes.
- After modifying code, run `npm run test`, `npm run typecheck`, and `npm run build`; resolve failures caused by the change.
- Keep terminal output and file modifications cleanly separated and easy to review.
- If a task stalls and no safe progress remains, stop and provide a structured handoff containing:
  - the requested outcome;
  - work completed;
  - files changed;
  - verification performed and its result;
  - the exact blocker;
  - the recommended next action.

## Model Routing and Subagent Strategy

Use the cheapest model that can reliably perform each part of the task. Prefer separating high-judgment planning from well-specified execution. When generating sub-agents, append the model and reasoning to the agent name.

### Default Workflow

For non-trivial implementation tasks:

1. **Plan with Sol Medium**
   - Understand the user request and repository context.
   - Inspect relevant code before proposing changes.
   - Resolve architectural ambiguity.
   - Identify affected files, interfaces, constraints, and tests.
   - Produce a concrete implementation plan before delegating work.

2. **Execute well-specified work with Luna High**
   - Delegate implementation tasks only after their expected behavior and boundaries are clear.
   - Luna subagents may:
     - Implement localized code changes.
     - Write or update tests.
     - Run tests, linters, formatters, and builds.
     - Fix straightforward failures.
     - Perform mechanical refactors.
     - Inspect or summarize clearly scoped portions of the repository.

3. **Use Luna XHigh when execution requires substantial local reasoning**
   - Prefer Luna High by default.
   - Escalate a delegated task to Luna XHigh when it is still well-scoped but requires significant debugging, algorithmic reasoning, or interpretation of unfamiliar code.

4. **Escalate back to Sol when judgment is required**
   - A Luna subagent should not independently make major architectural or product decisions that were not covered by the plan.
   - Return the problem to Sol when execution reveals:
     - An architectural decision not anticipated by the plan.
     - Conflicting requirements or repository conventions.
     - Uncertainty about public APIs or data models.
     - Changes that substantially expand task scope.
     - Multiple reasonable implementations with meaningful tradeoffs.
     - Repeated failed implementation attempts.
     - Evidence that the original plan is incorrect.

### Delegation Requirements

Before spawning an execution subagent, give it enough context to work independently. Include:

- The specific objective.
- Relevant files or components.
- Expected behavior.
- Constraints and invariants.
- Interfaces that must not change.
- Tests or validation criteria.
- Explicit non-goals where useful.

Avoid delegating vague tasks such as:

> "Implement the feature."

Prefer:

> "Implement plan step 3: add `FooController` using the interface defined in `FooService`. Do not modify the public API. Add unit tests covering X, Y, and Z. Run the affected test suite and report any failures."

### Review

For substantial changes, Sol should review the resulting implementation after delegated work completes.

The review should verify:

- The implementation still satisfies the original goal.
- Architectural decisions match the approved plan.
- Public interfaces and invariants were preserved.
- Tests adequately cover the change.
- Unnecessary complexity or scope creep was not introduced.

Minor, mechanical tasks do not require a separate Sol review unless something unexpected occurred.

### Tasks That Should Remain With Sol

Do not delegate the core work to Luna when the task primarily involves:

- Architecture or system design.
- Ambiguous requirements.
- Repository-wide design decisions.
- Synthesizing large amounts of conflicting information.
- Writing or substantially restructuring `AGENTS.md`.
- Deciding conventions or policy.
- Evaluating major technical tradeoffs.

Luna may still assist with repository inspection or other bounded supporting work.

### Efficiency Principle

Do not use a more expensive model merely because it is available. Likewise, do not delegate work when the cost of explaining and reviewing the task exceeds the expected savings.

Prefer:

**Sol Medium → plan and resolve ambiguity**  
**Luna High → execute clear work**  
**Luna XHigh → execute difficult but bounded work**  
**Sol Medium → review or resolve newly discovered ambiguity**
