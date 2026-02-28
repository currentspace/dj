# DJ Monorepo (February 2026)

pnpm workspace with catalogs, hoisted dependencies, Tailwind 4, and modern build targets.

## Package Manager (Critical)

- ALWAYS use pnpm; NEVER use npm, yarn, or npx
- Use `uv run python` for Python scripts; never call python/python3/pip directly
- Use `uvx <tool>` for Python CLI tools
- Run all commands from monorepo root unless filtering to a specific package

## pnpm Catalogs (Critical)

- **ALL shared dependencies MUST be defined in `pnpm-workspace.yaml` catalogs**
- **Package.json files reference via `catalog:` protocol**, not version ranges
- Set `catalogMode: strict` to prevent drift
- When adding a dependency used by multiple packages: add to catalog FIRST, then reference

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'workers/*'

catalog:
  react: ^19.2.4
  react-dom: ^19.2.4
  zod: ^4.3.6
  hono: ^4.12.3
  typescript: ^5.9.3
  vitest: ^4.0.18
  tsup: ^8.5.1
  '@anthropic-ai/sdk': ^0.78.0
  '@hono/zod-openapi': ^1.2.2
  tailwindcss: ^4.1.0
  '@tailwindcss/vite': ^4.1.0

catalogs:
  cloudflare:
    wrangler: ^4.69.0
    '@cloudflare/workers-types': ^4.20260226.1
```

```json
// package.json — reference catalogs
{
  "dependencies": {
    "react": "catalog:",
    "zod": "catalog:",
    "hono": "catalog:"
  },
  "devDependencies": {
    "wrangler": "catalog:cloudflare"
  }
}
```

- To upgrade a dependency: edit `pnpm-workspace.yaml` → `pnpm install` → all packages update

## Dependency Hoisting

- **Hoist ALL shared devDependencies to the workspace root**: typescript, vitest, eslint, prettier, tsup
- Individual packages should NOT duplicate devDependencies that exist at root
- Only package-specific dependencies stay in individual package.json files
- Use `workspace:*` protocol for internal packages

## Build Targets (February 2026)

- TypeScript target: `ES2024` — enables `using`, `Promise.withResolvers()`, `Array.groupBy()`
- Module: `ESNext` with bundler module resolution
- Node.js runtime: 24+ (LTS)
- Browser target: `esnext` (Vite build)
- Cloudflare Workers: `es2024` platform `browser` (V8 isolate)

## Workspace Dependencies

- Dependency graph: `@dj/shared-types` → `@dj/api-contracts` → `@dj/api-client` → `@dj/web` / `@dj/api-worker`
- Never create circular dependencies
- Shared Zod schemas in `@dj/shared-types`
- API route contracts in `@dj/api-contracts`

## Build Order

1. `@dj/shared-types` (no dependencies)
2. `@dj/api-contracts` (depends on shared-types)
3. `@dj/api-client` (depends on shared-types + api-contracts)
4. `@dj/web` (depends on all packages)
5. `@dj/api-worker` (depends on shared-types + api-contracts)

## Tailwind 4 Integration

- Install `tailwindcss` and `@tailwindcss/vite` via catalog
- Root CSS file: `apps/web/src/styles/theme.css` with `@import "tailwindcss"` and `@theme` block
- Vite plugin: `@tailwindcss/vite` in `vite.config.ts`
- NO `tailwind.config.js` — configuration is CSS-first via `@theme`
- NO CSS Modules — all styling via Tailwind utility classes

## Deployment

- NEVER run `pnpm run deploy` or manual deployment commands
- Deployment is automatic via git push to main (Cloudflare watches the repo)
- Build command: `pnpm run build:worker`
- For secrets: `wrangler secret put KEY_NAME`

## Code Quality

- ESLint 9 flat config (ESLint 10 upgrade deferred)
- Prettier: 120 char width, single quotes, no semicolons, trailing commas
- Import sorting via perfectionist plugin
- Run `pnpm typecheck` before committing; `pnpm lint` for style
