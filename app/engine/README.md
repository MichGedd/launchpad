# Simulation Engine

The Launchpad simulation engine is a synchronous, headless TypeScript library. It advances robot actions using simulated game time, so a simulation runs as quickly as the computer can calculate it rather than in real time.

The engine has no React, browser, visualization, or LLM dependency. A controller supplies action queues, and a future visualizer can consume the optional playback data.

## Conventions and defaults

- Positions and distances are measured in feet.
- Headings are measured in rotations. `0` points along positive X, and positive values rotate counterclockwise.
- Durations are measured in seconds.
- Headings are normalized to the range `[0, 1)`.
- The default update duration is `0.2` seconds of game time.
- A default match lasts `135` seconds, with endgame active during the final `30` seconds.
- The default robot is `28.5 × 28.5` inches, translates at `15 ft/s`, and spins at `1 rotation/s`.
- Translation and rotation occur concurrently. A drive finishes when both have reached their targets.

## Run a simulation

Launchpad requires Node.js 24.20 and npm 11.19. Install the checked-in dependencies from the repository root:

```powershell
npm ci
```

The engine is an API rather than a standalone command. Create `app/run-simulation.ts` with the following example:

```ts
import {
  DRIVE_ACTION_ID,
  createSimulation,
  type GameDefinition,
  type RobotConfiguration,
} from "./engine/index.ts";

const game: GameDefinition = {
  gameObjectTypes: [],
  zones: [],
};

const robot: RobotConfiguration = {
  initialPose: { xFeet: 0, yFeet: 0, headingRotations: 0 },
  totalGameObjectCapacity: 1,
};

const simulation = createSimulation(game, robot, {
  seed: 2026,
  recordPlayback: true,
});

const queueResult = simulation.queueActions([
  {
    actionId: DRIVE_ACTION_ID,
    parameters: { xFeet: 15, yFeet: 0, headingRotations: 0 },
  },
  {
    actionId: DRIVE_ACTION_ID,
    parameters: { xFeet: 15, yFeet: 15, headingRotations: 0 },
  },
]);

if (!queueResult.accepted) {
  throw new Error(queueResult.errors.map((error) => error.message).join("\n"));
}

const state = simulation.runUntilDecision();

console.log(state.status); // "awaiting-actions"
console.log(state.elapsedSeconds); // approximately 2
console.log(state.robot.pose); // { xFeet: 15, yFeet: 15, headingRotations: 0 }
console.log(simulation.exportPlayback()?.events);
```

Simulation time is represented by JavaScript numbers. Use a small tolerance instead of strict equality when asserting fractional durations.

Run it from the repository root:

```powershell
node --experimental-strip-types app/run-simulation.ts
```

Delete the example file afterward if it is not part of the application you are building. The same API can be imported by application routes, batch runners, or tests.

Run the engine test suite with:

```powershell
npm run test
```

## Simulation lifecycle

1. Create a `GameDefinition` and `RobotConfiguration`.
2. Call `createSimulation`.
3. Submit a batch with `queueActions`.
4. Call `runUntilDecision` to execute actions until the queue is empty, an action blocks, or match time expires.
5. Inspect the returned `DecisionState`.
6. When the status is `awaiting-actions`, queue another batch. When it is `blocked`, inspect `state.block` and call `replaceActions` to replace the active and remaining actions.
7. Continue until the status is `complete`.

LLM computation and other controller work do not consume simulation time. If a queue ends partway through a 200 ms update, the unused portion is preserved and applied when the next queue arrives.

`queueActions` validates the entire batch before adding anything. If any request is unknown, disabled, or malformed, the result is rejected and none of the requests are queued.

## Core API

Import the public API through `app/engine/index.ts`.

### Creating an engine

```ts
const simulation = createSimulation(game, robot, options);
```

`createSimulation` returns a `SimulationEngine`. Calling `new SimulationEngine(...)` directly is also supported.

#### `GameDefinition`

| Field | Type | Description |
| --- | --- | --- |
| `gameObjectTypes` | `readonly string[]` | Unique object-type IDs that inventory actions may use. |
| `zones` | `readonly Zone[]` | Pickup, scoring, and non-traversal areas for the game. |
| `timing` | `MatchTiming` | Optional match and endgame durations. Defaults to 135 and 30 seconds. |
| `actions` | `readonly ActionDefinition[]` | Optional registered game-specific actions. |
| `robotFeatures` | `readonly RobotFeature[]` | Optional features mapping selectable feature IDs to action IDs. |

Game definitions belong on season branches. The engine on `master` remains season-independent.

#### `RobotConfiguration`

| Field | Required | Description |
| --- | --- | --- |
| `initialPose` | Yes | Starting `xFeet`, `yFeet`, and `headingRotations`. |
| `totalGameObjectCapacity` | Yes | Maximum total number of objects the robot can hold. |
| `selectedFeatureIds` | No | Features that enable registered game actions. |
| `inventory` | No | Initial counts keyed by game-object type. |
| `perObjectCapacity` | No | Optional capacity limit for each object type. |
| `widthFeet`, `lengthFeet` | No | Robot footprint dimensions. Both default to 2.375 feet. |
| `translationSpeedFeetPerSecond` | No | Defaults to 15. |
| `spinSpeedRotationsPerSecond` | No | Defaults to 1. |

The total capacity is enforced in addition to every configured per-object capacity.

#### `SimulationOptions`

| Field | Default | Description |
| --- | --- | --- |
| `seed` | `1` | Seed for deterministic action probabilities. Use different seeds for different aggregate runs. |
| `recordPlayback` | `false` | Retains immutable frames and events when enabled. |
| `tickSeconds` | `0.2` | Simulation update duration. Production games should normally keep the 200 ms default. |

### Engine methods

| Method | Behavior |
| --- | --- |
| `queueActions(requests)` | Atomically validates and appends a batch. Returns a `QueueResult`. |
| `replaceActions(requests)` | Atomically validates a batch, then replaces the active and queued actions and clears a block. |
| `advanceOneTick()` | Advances by at most one update budget, or until the engine needs a decision. |
| `runUntilDecision()` | Repeatedly advances until status is `awaiting-actions`, `blocked`, or `complete`. |
| `getDecisionState()` | Returns the current state without advancing simulated time. |
| `exportPlayback()` | Returns a deeply frozen `SimulationPlayback`, or `null` when recording is disabled. |

### Status values

| Status | Meaning |
| --- | --- |
| `running` | An active or queued action can continue. |
| `awaiting-actions` | The queue is empty; a controller may submit another batch. |
| `blocked` | The active action cannot proceed. Inspect `DecisionState.block`. |
| `complete` | Match time reached zero. No more actions will execute. |

At match expiration, the engine records an `action-interrupted` event for an unfinished action and a `simulation-complete` event.

## Actions and robot features

Every robot can use `DRIVE_ACTION_ID`, whose value is `"drive-to"`. Its parameters must contain finite `xFeet`, `yFeet`, and `headingRotations` values:

```ts
{
  actionId: DRIVE_ACTION_ID,
  parameters: { xFeet: 10, yFeet: 4, headingRotations: 0.25 },
}
```

Drive actions follow a straight translation path while independently taking the shortest rotation to the requested heading. They clamp to the exact target without overshooting.

Game actions must be registered in `GameDefinition.actions` and enabled by a selected robot feature:

```ts
const game = {
  gameObjectTypes: ["ball"],
  zones: [],
  actions: [collectBall],
  robotFeatures: [
    { id: "floor-intake", actionIds: ["collect-ball"] },
  ],
} satisfies GameDefinition;

const robot = {
  initialPose: { xFeet: 0, yFeet: 0, headingRotations: 0 },
  totalGameObjectCapacity: 2,
  selectedFeatureIds: ["floor-intake"],
} satisfies RobotConfiguration;
```

An action that exists but is not enabled by a selected feature is rejected just like an unknown action. This prevents a controller from inventing robot capabilities.

### Declarative zone interactions

Use `createZoneInteractionAction` for common pickup and scoring behavior:

```ts
const collectBall = createZoneInteractionAction({
  id: "collect-ball",
  description: "Collect one ball from the floor",
  zone: { kind: "pickup", tags: ["ball"] },
  durationSeconds: 0.5,
  successProbability: 0.9,
  inventoryDeltaOnSuccess: { ball: 1 },
  successEventType: "ball-collected",
});
```

The zone selector may use `zoneIds`, `tags`, or both. Every configured tag must be present. The robot footprint must contact an eligible zone when the action starts.

`requiredInventory` defines minimum held counts. `inventoryDeltaOnSuccess` uses positive counts for collection and negative counts for scoring. Capacity and non-negative inventory constraints are checked before execution and again when a change is applied.

Zone-interaction requests use an empty parameter object:

```ts
simulation.queueActions([
  { actionId: "collect-ball", parameters: {} },
]);
```

The action consumes its configured dwell time, then samples the seeded random source once. A success applies its inventory delta and emits `successEventType` or `zone-interaction-succeeded`. A failure changes no inventory and emits `zone-interaction-failed`. Either outcome completes the action and allows the queue to continue.

### Custom actions

Implement `ActionDefinition<Request, RuntimeState>` when an action does not fit the zone-interaction preset:

```ts
interface WaitRequest {
  readonly durationSeconds: number;
}

interface WaitState {
  readonly elapsedSeconds: number;
}

const waitAction: ActionDefinition<WaitRequest, WaitState> = {
  metadata: { id: "wait", description: "Remain stationary" },
  validate(parameters) {
    if (
      typeof parameters === "object"
      && parameters !== null
      && "durationSeconds" in parameters
      && typeof parameters.durationSeconds === "number"
      && Number.isFinite(parameters.durationSeconds)
      && parameters.durationSeconds >= 0
    ) {
      return { valid: true, value: { durationSeconds: parameters.durationSeconds } };
    }
    return { valid: false, message: "durationSeconds must be a non-negative number" };
  },
  start: () => ({ ready: true, state: { elapsedSeconds: 0 } }),
  advance(_context, request, state, availableSeconds) {
    const consumedSeconds = Math.min(
      availableSeconds,
      request.durationSeconds - state.elapsedSeconds,
    );
    const elapsedSeconds = state.elapsedSeconds + consumedSeconds;
    return {
      state: { elapsedSeconds },
      consumedSeconds,
      complete: elapsedSeconds >= request.durationSeconds,
    };
  },
};
```

- `validate` converts untrusted parameters into the action's request type.
- `start` checks preconditions. Returning `ready: false` blocks the queue without consuming time.
- `advance` receives an immutable robot snapshot, zones, current simulation time, seeded random function, contact helper, and the remaining time budget.
- `consumedSeconds` must be finite, non-negative, and no greater than `availableSeconds`.
- An incomplete action must consume time; otherwise the engine throws to prevent an infinite loop.
- `inventoryDelta` and custom `events` may be returned from `advance`.

## Zones and collision behavior

`Zone.kind` is `pickup`, `score`, or `non-traversal`. Supported shapes are:

```ts
type ZoneShape =
  | { type: "circle"; center: Point; radiusFeet: number }
  | {
      type: "rectangle";
      center: Point;
      widthFeet: number;
      heightFeet: number;
      headingRotations?: number;
    }
  | { type: "polygon"; vertices: readonly Point[] };
```

Pickup and score contact uses the robot's oriented rectangular footprint. Decision-state distances are measured from that footprint to the closest relevant zone boundary and become zero on contact.

Drive movement uses swept collision checks, so a thin non-traversal zone cannot be skipped between updates. On first contact the engine:

1. Stops the robot at the contact pose.
2. Sets status to `blocked` with code `non-traversal-zone`.
3. Preserves the active drive and remaining queue for inspection.
4. Records an `action-blocked` event when playback is enabled.

Pathfinding around obstacles is planned as a future engine improvement. For now, the controller must replace the blocked queue with a route away from the obstacle.

## Decision state

`getDecisionState`, `advanceOneTick`, and `runUntilDecision` return a `DecisionState` containing:

- Simulation status, elapsed time, remaining time, and endgame state.
- Robot pose, footprint configuration, speeds, capacities, and inventory.
- Active and queued action summaries.
- Enabled action metadata.
- Feature-relevant pickup and score zones.
- All non-traversal zones.
- Footprint-to-zone distance for the nearest relevant pickup and score zone, or `null` when none is available.
- Structured block information when status is `blocked`.

Pickup and score zones are considered relevant only when an enabled action selects them. This keeps future controller input limited to interactions the configured robot can actually perform.

## Playback and events

Enable playback with `{ recordPlayback: true }`, execute the simulation, then call `exportPlayback()`:

```ts
const playback = simulation.exportPlayback();
if (playback) {
  console.log(playback.frames);
  console.log(playback.events);
}
```

The returned structure is a detached, deeply frozen snapshot containing match timing, zones, robot frames, and timestamped action events. Recording is disabled by default to avoid retaining every frame during large aggregate runs.

Engine-generated events include:

- `action-started`
- `action-completed`
- `action-blocked`
- `action-interrupted`
- `inventory-changed`
- `simulation-complete`
- Zone-interaction success or failure events

Event timestamps may fall between playback frame boundaries because actions can complete partway through an update.

## Geometry utilities

The public entrypoint also exports reusable pure geometry helpers:

| Function | Purpose |
| --- | --- |
| `normalizeHeading` | Normalizes rotations into `[0, 1)`. |
| `shortestHeadingDelta` | Returns the signed shortest turn between headings. |
| `interpolatePose` | Interpolates translation and rotation progress independently. |
| `rectangleVertices` | Converts a rotated rectangle into polygon vertices. |
| `shapesIntersect` | Tests circle, rectangle, or polygon contact. |
| `distanceBetweenShapes` | Returns boundary-to-boundary distance. |
| `robotFootprint` | Returns the robot's oriented polygon footprint. |
| `robotContactsZone` | Tests footprint contact with a zone. |
| `robotDistanceToZone` | Measures footprint-to-zone distance. |

`createSeededRandom(seed)` is also exported for consumers that need the same deterministic pseudorandom behavior outside an action context.

## Validation and failure behavior

Invalid static configuration throws during `createSimulation` or action-definition creation. This includes duplicate or empty IDs, unknown feature action references, invalid geometry, non-finite timing, impossible capacities, and invalid initial inventory.

Invalid queued parameters return a rejected `QueueResult` rather than throwing:

```ts
const result = simulation.queueActions(requests);
if (!result.accepted) {
  for (const error of result.errors) {
    console.error(`Request ${error.index}: ${error.message}`);
  }
}
```

Runtime precondition failures use status `blocked` with code `action-precondition`. They preserve the active and pending actions and consume no time. Use `replaceActions` after choosing a recovery plan.
