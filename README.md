# Launchpad

A local-first FRC strategy simulator with a deterministic policy builder, a headless engine, and an interactive React visualizer.

Launchpad is intended for the first days after kickoff. Students select robot capabilities, build an ordered policy, and compare how that robot behaves without waiting for real-time physics or making decisions during a run. The primary simulation workflow is deterministic and makes no model-provider calls.

## What is included

- A synchronous, season-independent simulation engine with deterministic playback
- A versioned policy contract, extensible condition/goal catalog, and decision traces
- A guided Match/Endgame policy editor with ordered rules and fallbacks
- Robot-feature controls that show which policy goals they enable and where the policy uses them
- Exact endgame-boundary reevaluation and deterministic blocked-target recovery
- A neutral field, scoring loop, and parking proof used to exercise the architecture
- React 19, React Router 7, strict TypeScript, Vite, Tailwind CSS v4, Base UI, Lucide, and Geist
- Retained LLM controller/configuration code for regression comparison and a possible separately approved policy compiler experiment

This is deliberately not a full physics simulator. Movement uses configured velocities, and game interactions use zone contact plus deterministic durations.

## Start the app

Launchpad requires Node.js 24.20 and npm 11.19. From the repository root, run:

```powershell
npm run setup
```

This installs the exact dependencies from `package-lock.json` and starts the development server. Open the local address printed in the terminal and stop it with `Ctrl+C`.

In the Codex desktop app, the checked-in local environment also installs dependencies for new worktrees and adds a **Run** action to the top bar.

## Use the simulator

1. Select **Robot features**. Each expanded feature card names the policy goals it enables and how many current rules or fallbacks use it. Drive planning is an indirect capability that expands legal routes rather than unlocking a goal.
2. Choose **Edit policy**. Match and Endgame each contain ordered rules plus a fallback. All conditions in a rule use AND semantics.
3. Select goals from the catalog. A goal names its required feature. Goals whose features are off cannot be newly selected; existing references remain visible with an explanation of how evaluation will skip or fall back.
4. Choose **Generate**. The browser sends the policy, selected features, robot customization, and NavGrid to the deterministic simulation endpoint. No LLM configuration is required.
5. Open **Policy decisions** after generation to inspect the selected rule, skipped rules, goal, target, action queue, and explanation for every decision.

The default neutral policy scores when carrying a `game-object`, otherwise collects the nearest eligible object, then parks during endgame. Target selection uses footprint-to-zone distance with a lexicographic zone-ID tie-break, so identical inputs and seeds produce identical traces and playback.

## Policy model

Policies are versioned JSON-compatible documents, but students normally edit them through the guided builder:

```ts
interface PolicyDefinition {
  readonly version: 1;
  readonly name: string;
  readonly match: PolicyPhaseDefinition;
  readonly endgame: PolicyPhaseDefinition;
}

interface PolicyPhaseDefinition {
  readonly rules: readonly PolicyRule[];
  readonly fallback: PolicyGoal;
}
```

Rules are evaluated from top to bottom. An empty condition list means “always.” When every condition matches but the goal is unavailable, evaluation continues to the next rule. If no rule resolves, the phase fallback is evaluated; an unavailable fallback produces an actionable error rather than a retry loop.

The neutral catalog currently provides:

| Kind | IDs |
| --- | --- |
| Conditions | `always`, `inventory-at-least`, `inventory-total-at-most`, `time-remaining-at-most`, `points-at-least` |
| Goals | `collect-nearest-object`, `score-nearest-object`, `park-for-endgame`, `wait-until-match-end` |

Goal definitions declare presentation-only `requiredFeatureIds`. Runtime availability still depends on live engine state, targets, inventory, phase, and action preconditions.

## Simulation API

`POST /api/simulation` is same-origin protected and accepts:

```ts
interface SimulationGenerationRequest {
  readonly policy: PolicyDefinition;
  readonly selectedFeatureIds: readonly string[];
  readonly robotCustomization: RobotCustomization;
  readonly navGrid: NavGridDefinition;
}
```

The response contains `scene`, the validated `policy`, `decisionCount`, and the complete `policyTrace`. The endpoint validates bounded request schemas and does not require an LLM session, API key, or generation lock.

Legacy `/api/llm/*` configuration/statistics endpoints and `runSimulationWithLlm` remain in the repository for regression coverage. They are not part of the primary workspace or `/api/simulation` flow.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Clean-install dependencies and start the development server |
| `npm run dev` | Start the visualizer and same-origin API development server |
| `npm start` | Stable development-server command used by Codex |
| `npm run test` | Run engine, policy, simulation, visualizer, LLM-regression, and server tests |
| `npm run typecheck` | Generate route types and check strict TypeScript |
| `npm run build` | Build the production SPA into `build/client` |
| `npm run check` | Run type checking and the production build |

## Project map

- `app/engine` contains the headless simulation engine. See its [usage and API documentation](app/engine/README.md).
- `app/policy` contains policy contracts, catalog validation, ordered evaluation, and trace types.
- `app/simulation` contains the deterministic policy controller, neutral catalog/adapter, request schemas, and browser client. The retained LLM controller is also isolated here.
- `app/components/visualizer` contains the field workspace, policy editor, decision trace, and feature-capability presentation.
- `app/visualizer` contains visualizer types, playback utilities, NavGrid persistence, and default feature presentation.
- `app/llm` contains retained model contracts, prompt adapters, session statistics, and strategy-planning service; deterministic simulation does not use them through the primary endpoint.
- `server/index.ts` exposes the same-origin API and serves the production SPA.
- `app/routes/home.tsx` is the single-page `/` route; `app/root.tsx`, `app/routes.ts`, and `app/app.css` own the document, route registration, and shared theme.
- `app/components/ui` contains project-owned shadcn/Base UI primitives, and `components.json` controls future generation.

## Add a season

Keep engine and generic policy evaluation season-independent. A season adapter should provide typed game definitions, field presentation/NavGrid, robot features, policy condition/goal definitions, and any presentation metadata that connects features to goals. Goals expand semantic intent into ordinary engine `ActionRequest`s; they must not mutate engine state while checking availability or choosing targets.

Season branches use `<YEAR>-<GAME_NAME>`. Add season rules, geometry, assets, scoring, and feature IDs there first. Back-port only genuinely reusable engine, policy, or visualizer improvements to `master`.

## Development notes

- New routes belong under `app/routes` and must be registered in `app/routes.ts`.
- New shadcn components should be generated with `npx shadcn@latest add <component>` so they continue to use Base UI, Lucide, and the existing CSS-variable theme.
- Theme changes belong in the semantic values under `:root` and `.dark` in `app/app.css`.
- Automated LLM tests use an injected deterministic mock runner and never read an API key or make a provider request. Deterministic policy simulations make zero provider calls by design.

## Deployment

Run `npm run build`, set `NODE_ENV=production`, and start the Node server. The server serves `build/client` and falls back to the SPA entry point. The deterministic endpoint needs no external provider credentials. If retained LLM configuration endpoints are exposed remotely, terminate HTTPS before accepting API keys.
