# Repository Guidelines

## Project Structure & Modules
- Monorepo managed by `pnpm` + `turbo`.
- Apps:
  - `apps/web` (React + Vite, TypeScript)
  - `apps/convex-backend` (Convex TypeScript backend)
  - `apps/langgraph-worker` (Python FastAPI + LangGraph)
- Shared packages: `packages/*` (e.g., `shared-types`, `convex-types`).
- Docs in `docs/`; scripts in `scripts/`.

## Build, Test, and Development
- Install: `pnpm install`
- Dev (all): `pnpm dev`
  - Web only: `pnpm dev:web`
  - Convex only: `pnpm dev:convex`
  - Worker only: `pnpm dev:worker`
- Build: `pnpm build` (per app: run in app dir or use turbo filters)
- Start: `pnpm start`, or `pnpm start:web` / `start:convex` / `start:worker`
- Lint: `pnpm lint` • Type-check: `pnpm type-check` • Format: `pnpm format`
- Python worker deps: `pnpm -C apps/langgraph-worker install-deps` (pip install)
- Python tests (manual scripts):
  - `python3 apps/langgraph-worker/test_langgraph.py`
  - Requires `OPENAI_API_KEY`.

## Coding Style & Naming
- TypeScript/React: ESLint (`apps/web/eslint.config.js`) + Prettier.
  - 2-space indent, semver imports, PascalCase components (`MyComponent.tsx`), camelCase functions/vars.
- Packages: export types from `packages/shared-types/src/*.ts`; avoid default exports.
- Python: PEP 8; modules in `snake_case.py`; avoid global state in FastAPI/LangGraph.

## Testing Guidelines
- Frontend: rely on type-check + lint; add Vitest tests colocated as `*.test.ts(x)` when contributing.
- Convex: validate with local `convex dev`; add minimal integration tests if adding mutations/queries.
- Worker: run provided scripts (`test_langgraph.py`, `test_integration_comprehensive.py`).
- Aim for meaningful coverage of new code; keep tests deterministic (mock network/AI where possible).

## Commit & PR Guidelines
- Commits: imperative, concise summary (e.g., "Fix Convex proxy for Railway"). Prefer prefixes: Fix, Add, Update, Refactor, Docs.
- PRs: clear description, scope, linked issues, and testing notes.
  - UI changes: include screenshots.
  - Worker/backend: include logs or sample payloads.
  - Note required env vars (e.g., `OPENAI_API_KEY`, Clerk keys) and migration steps.

## Security & Config Tips
- Use `.env.*local` (turbo watches these). Never commit secrets.
- See `docs/*` for deployment and integration steps (Clerk, Resend, Railway, LangGraph Studio).
