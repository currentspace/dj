# DJ Monorepo

pnpm monorepo conventions, build order, workspace dependencies, deployment pipeline, and shared package patterns.

## Package Manager (Critical)

- ALWAYS use pnpm; NEVER use npm, yarn, or npx
- Use `uv run python` for Python scripts; never call `python`, `python3`, `pip`, or `pip3` directly
- Use `uvx <tool>` for Python CLI tools
- Run all commands from the monorepo root unless filtering to a specific package
- Use `pnpm --filter @dj/package-name` to target specific workspace packages

## Workspace Dependencies

- Use `workspace:*` protocol for ALL internal package references
- Dependency graph: `@dj/shared-types` → `@dj/api-client` → `@dj/web` / `@dj/api-worker`
- `@dj/api-contracts` depends on `@dj/shared-types`; both `@dj/web` and `@dj/api-worker` depend on it
- Shared types and Zod schemas go in `@dj/shared-types`
- API route contracts (OpenAPI) go in `@dj/api-contracts`
- Never create circular dependencies between workspace packages

## Build Order (Critical)

The build must follow the dependency graph:

1. `@dj/shared-types` (no dependencies)
2. `@dj/api-contracts` (depends on shared-types)
3. `@dj/api-client` (depends on shared-types + api-contracts)
4. `@dj/web` (depends on shared-types + api-client + api-contracts)
5. `@dj/api-worker` (depends on shared-types + api-contracts)

- The `pnpm build:worker` script handles this automatically
- `scripts/build-info.js` runs first to generate git commit hash, timestamp, and version info
- Build info is injected into both `apps/web/src/build-info.json` and `workers/api/src/build-info.json`

## Deployment (Critical)

- NEVER run `pnpm run deploy` or manual deployment commands
- Deployment is automatic via git push to the `main` branch (GitHub Actions)
- Workflow: commit → push → GitHub Actions builds and deploys to Cloudflare Workers
- Production URL: `https://dj.current.space`
- For secrets not in GitHub Actions (like optional keys): use `wrangler secret put KEY_NAME`

## TypeScript Configuration

- Target: ES2022 across all packages
- Strict mode enabled everywhere; no `any` types
- Frontend: `jsx: react-jsx`, `moduleResolution: bundler`
- Worker: `moduleResolution: node`, types include `@cloudflare/workers-types`
- Shared types: `allowImportingTsExtensions: true` for workspace imports
- Path aliases: `@/*` maps to `./src/*` in frontend; workspace packages resolve via Vite aliases

## tsup Build Configuration

- Shared types and API client: ESM + CJS output with `.d.ts` declarations, tree-shake enabled
- Worker: platform `browser` (V8 isolate), minified, Node stdlib modules externalized
- Mark workspace packages as external in library builds (shared-types, api-client)
- Always generate source maps

## Testing

- Vitest 4.x with workspace projects configuration
- Coverage threshold: 80% (lines, functions, branches, statements)
- Test environments: `jsdom` for web, `node` for API/shared packages
- Naming: `*.test.ts` / `*.spec.ts` alongside source files
- Run all tests: `pnpm test`; run specific: `pnpm test:web`, `pnpm test:api`
- Contract tests validate external API response schemas: `pnpm test:contracts`

## Code Quality

- ESLint 9 flat config with per-environment rules (browser, workers, tests)
- Prettier: 120 char width, single quotes, no semicolons, trailing commas
- Security plugin enabled for all TypeScript; stricter rules for Workers code
- Import sorting via perfectionist plugin
- Run `pnpm typecheck` before committing; `pnpm lint` for style issues

## File Organization

- `apps/web/` — React 19.2 frontend with feature-based organization
- `packages/` — shared libraries (types, client, contracts)
- `workers/` — Cloudflare Workers (api, webhooks)
- `scripts/` — build utilities
- `.claude/` — Claude Code guidelines and Marvel configuration
- Never create duplicate directory structures; prefer editing existing files
