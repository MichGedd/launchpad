# AGENTS.md

## Project purpose

`launchpad` is a low-fidelity FIRST Robotics Competition (FRC) strategy simulator. It helps students evaluate strategies and robot features during the first few days after kickoff so they can make informed architectural decisions quickly.

This project is deliberately not a full physics simulator. Favor fast, understandable models over physical realism. For example:

- Model movement as traveling at a specified velocity.
- Model scoring or collecting a game piece as contacting a defined area for a specified duration.
- Simulate one robot at a time.

Do not add physical complexity unless it is necessary to compare strategies and the user explicitly requests it.

## Product architecture

The product has two primary parts:

1. A headless simulation engine that can execute many runs and report aggregate results such as average points and ranking points earned.
2. A graphical visualizer that displays one simulation of a robot moving around the field and executing a strategy.

An LLM makes in-simulation decisions. Students describe a strategy and select predefined robot features; they do not make real-time gameplay decisions during a run.

Design robot features, game rules, field definitions, and game interactions so they are easy to generate and change. An LLM working with mentor guidance should be able to port a new FRC game to `launchpad` within a few hours.

## Branch and season boundaries

- `master` is the core engine-development branch. It must support the simulation engine and graphical visualizer without containing season-specific rules, assets, field geometry, scoring, or robot features.
- Each season lives on a branch named `<YEAR>-<GAME_NAME>`.
- Add new-season robot features to the season branch first unless they are genuinely season-independent.
- Back-port reusable engine or visualizer improvements to `master` through a pull request.
- Before changing shared code, separate generic engine behavior from season-specific configuration.

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

## Workflow

- For non-trivial changes, begin in read-only plan mode (`/plan`) and present the implementation plan for user review before editing files.
- Inspect the relevant existing code and conventions before proposing or implementing changes.
- After modifying code, run `npm run test` and resolve failures caused by the change.
- Keep terminal output and file modifications cleanly separated and easy to review.
- If a task stalls and no safe progress remains, stop and provide a structured handoff containing:
  - the requested outcome;
  - work completed;
  - files changed;
  - verification performed and its result;
  - the exact blocker;
  - the recommended next action.
