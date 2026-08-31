# Launchpad

A small, local-first foundation for building a React single-page application.

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
| `npm run dev` | Start the development server when dependencies are already installed |
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

The production build is static. Configure a future host to serve `build/client/index.html` for every application URL so client-side routes can load directly.
