# Launchpad

A local-first FRC strategy simulator with a React visualizer and a secure, same-origin LLM gateway.

## What is included

- Node.js 24.20 and npm 11.19 project metadata
- React 19 with strict TypeScript
- React Router 7 in Framework Mode with SPA output
- Vite and Tailwind CSS v4
- shadcn/ui components backed by Base UI (not Radix)
- CSS-variable light, dark, and system themes
- Lucide icons

## Start the app

From the repository root, run:

```powershell
npm run setup
```

This installs the exact dependencies from `package-lock.json` and starts the development server. Open the local address printed in the terminal. Stop it with `Ctrl+C`.

In the Codex desktop app, the checked-in local environment also installs dependencies for new worktrees and adds a **Run** action to the top bar.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Clean-install dependencies and start the development server |
| `npm run dev` | Start the visualizer and same-origin API development server |
| `npm start` | Stable development-server command used by Codex |
| `npm run test` | Run the headless simulation engine tests |
| `npm run typecheck` | Generate route types and check strict TypeScript |
| `npm run build` | Build the production SPA into `build/client` |
| `npm run check` | Run type checking and the production build |

## Project map

- `app/root.tsx` defines the HTML document, application boundary, and error screen.
- `app/routes.ts` lists the application's routes.
- `app/routes/home.tsx` is the `/` route.
- `app/theme.tsx` owns system, light, and dark theme behavior.
- `app/app.css` contains Tailwind and the shared CSS theme variables.
- `app/components/ui` contains shadcn/ui source owned by this project.
- `app/engine` contains the headless simulation engine. See its [usage and API documentation](app/engine/README.md).
- `app/llm` contains the shared LLM contracts, compact prompt adapter, session statistics, and strategy-planning service.
- `server/index.ts` keeps user-supplied API keys in process memory and exposes the same-origin LLM API.
- `components.json` controls how future shadcn components are generated.

## Add a route

Create a route component under `app/routes`, then register it in `app/routes.ts`. React Router generates its TypeScript types the next time the development server or `npm run typecheck` runs.

## Add a shadcn/ui component

Run the shadcn CLI from the repository root. For example:

```powershell
npx shadcn@latest add input
```

The CLI reads `components.json`, so new components continue to use Base UI, Lucide, and the existing CSS-variable theme.

## Change the theme

Edit the semantic values under `:root` and `.dark` in `app/app.css`. Components use names such as `background`, `foreground`, `primary`, and `border`, so changing those variables updates the application consistently.

## Deploying later

Run `npm run build`, set `NODE_ENV=production`, and start the Node server. The server serves `build/client`, falls back to the SPA entry point, and keeps LLM credentials out of browser bundles. Any remotely accessible deployment must terminate HTTPS before accepting API keys.

## Test the LLM flow without API charges

The automated LLM tests inject a deterministic mock runner and never read an OpenAI API key or make a provider request. Run `npm run test` for schemas, prompt construction, session statistics, model-service behavior, the engine, and visualizer utilities. A real provider call occurs only after a user enters a key in Configure and explicitly selects Generate.

For a manual visual check, start the development server with its local mock runner:

```powershell
$env:LAUNCHPAD_MOCK_LLM="1"
npm run dev
```

Open Launchpad, choose **Configure**, and enter a clearly fake value such as `local-mock-only` in the API-key field. Saving, generating, and opening **Report Statistics** then exercise the full browser-to-server flow with deterministic output and token counts, without contacting OpenAI. Stop the server and remove the environment variable with `Remove-Item Env:LAUNCHPAD_MOCK_LLM` before testing the real provider. Mock mode is ignored in production.
