# DJ Monorepo Architecture

## Overview

This project follows a modern monorepo structure using pnpm workspaces, organizing code by architectural layers and deployment targets.

## Directory Structure

```
dj/
├── apps/                    # Deployable applications
│   └── web/                # React web application
│       ├── src/
│       │   ├── app/        # App-level components (ErrorBoundary, providers)
│       │   ├── components/ # Shared UI components
│       │   ├── features/   # Feature-based modules
│       │   │   ├── auth/   # Authentication features
│       │   │   ├── chat/   # Chat interface with SSE streaming
│       │   │   ├── playlist/ # Playlist management
│       │   │   └── test/   # Test/debug features
│       │   ├── hooks/      # Custom React hooks
│       │   ├── lib/        # Utilities and API clients
│       │   ├── pages/      # Page components
│       │   ├── styles/     # Global styles and CSS modules
│       │   └── types/      # TypeScript type definitions
│       ├── package.json    # @dj/web package
│       └── vite.config.ts  # Vite bundler configuration
│
├── packages/               # Shared packages
│   ├── api-client/        # Shared API client (@dj/api-client)
│   └── shared-types/      # Shared TypeScript types (@dj/shared-types)
│
├── workers/               # Cloudflare Workers
│   ├── api/              # Main API worker (@dj/api-worker)
│   │   └── src/
│   │       ├── routes/   # API route handlers
│   │       └── lib/      # Worker utilities
│   └── webhooks/         # Webhook handler worker (@dj/webhook-worker)
│
├── scripts/              # Build and utility scripts
│   └── build-info.js    # Generates build metadata
│
├── pnpm-workspace.yaml   # Workspace configuration
├── package.json         # Root package scripts
└── CLAUDE.md           # AI assistant instructions
```

## Package Structure

### Applications (`apps/`)
- **Purpose**: Deployable applications with their own build processes
- **Naming**: `@dj/{app-name}`
- **Dependencies**: Can import from `packages/` but not other `apps/`

### Packages (`packages/`)
- **Purpose**: Shared code used across multiple apps/workers
- **Naming**: `@dj/{package-name}`
- **Dependencies**: Should not depend on `apps/` or `workers/`

### Workers (`workers/`)
- **Purpose**: Cloudflare Workers for serverless functions
- **Naming**: `@dj/{worker-name}-worker`
- **Dependencies**: Can import from `packages/`

## Best Practices

### 1. Feature-Based Organization
Within apps, organize code by feature rather than file type:
```
features/
├── chat/
│   ├── ChatInterface.tsx
│   ├── ChatStreaming.tsx
│   └── chat.types.ts
```

### 2. Dependency Management
- Use `workspace:*` for internal dependencies
- Keep shared code in `packages/`
- Avoid circular dependencies

### 3. Build Process
- Each app/worker has its own build configuration
- Shared build scripts in root `scripts/`
- Build metadata generated automatically

### 4. Type Safety
- Shared types in `@dj/shared-types`
- Feature-specific types co-located with features
- Strict TypeScript configuration

### 5. Styling
- Global styles in `src/styles/`
- Component-specific styles co-located
- Use CSS modules for component isolation

## Development Workflow

```bash
# Install dependencies
pnpm install

# Development (all services in parallel)
pnpm dev              # Both frontend and API worker
pnpm dev:web          # Only frontend (port 3000)
pnpm dev:api          # Only API worker (port 8787)

# Development (specific package filter)
pnpm --filter @dj/web dev

# Build everything
pnpm build            # All packages
pnpm build:worker     # Worker with dependencies in correct order

# Type checking
pnpm typecheck        # All packages
pnpm --filter @dj/web typecheck  # Specific package

# Deploy
pnpm deploy           # Build and deploy to Cloudflare
```

## Key Decisions

### Why Monorepo?
- **Code Sharing**: Easy sharing of types, utilities, and components
- **Atomic Changes**: Single commits can update multiple packages
- **Consistent Tooling**: Shared ESLint, TypeScript, and build configs
- **Simplified Dependencies**: Single lockfile, deduped dependencies

### Why pnpm?
- **Efficient Storage**: Hard links save disk space
- **Strict Dependencies**: Prevents phantom dependencies
- **Fast**: Parallel installation and caching
- **Workspace Support**: First-class monorepo support

### Why Feature-Based Structure?
- **Scalability**: Easy to add/remove features
- **Maintainability**: Related code stays together
- **Team Collaboration**: Clear ownership boundaries
- **Code Discovery**: Intuitive navigation

## Adding New Features

1. **New App**: Create in `apps/` with its own package.json
2. **New Package**: Create in `packages/` for shared code
3. **New Worker**: Create in `workers/` with wrangler.toml
4. **New Feature**: Create folder in `apps/{app}/src/features/`

## Common Pitfalls to Avoid

❌ **Don't** create duplicate directories (e.g., `/web/` outside of `/apps/`)
❌ **Don't** import from other apps directly
❌ **Don't** put app-specific code in packages
❌ **Don't** use relative imports across package boundaries
❌ **Don't** bypass the workspace protocol for internal deps

✅ **Do** use the canonical `/apps/web/` location
✅ **Do** extract shared code to `/packages/`
✅ **Do** use `workspace:*` for internal dependencies
✅ **Do** co-locate related code in features
✅ **Do** maintain clear package boundaries