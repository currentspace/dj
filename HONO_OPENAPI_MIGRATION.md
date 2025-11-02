# Hono OpenAPI Migration Guide

## Overview

This guide documents the migration from manual Zod validation to a contract-first API architecture using **@hono/zod-openapi**. This provides:

- ✅ **Single source of truth** - Routes, schemas, and types defined once
- ✅ **End-to-end type safety** - From server to client with zero codegen
- ✅ **Automatic validation** - Zod validation built into route definitions
- ✅ **OpenAPI spec generation** - Auto-generated API documentation
- ✅ **Swagger UI** - Interactive API explorer at `/api/docs`
- ✅ **Type-safe client** - Using `hc<AppType>()` for fully typed fetch

## What's Been Completed

### 1. Package Structure ✅

Created `packages/api-contracts` with contract definitions:

```
packages/api-contracts/
├── src/
│   ├── routes/
│   │   ├── auth.ts          # Spotify OAuth contracts
│   │   ├── playlists.ts     # Playlist CRUD contracts
│   │   └── chat.ts          # AI chat streaming contracts
│   └── index.ts             # App builder + exports
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

**Key Files:**
- `src/index.ts` - Exports `buildApiApp()` and `AppType`
- `src/routes/*.ts` - Route contracts using `createRoute()`

### 2. Type-Safe Client ✅

Updated `packages/api-client/src/client.ts`:

```typescript
import { hc } from 'hono/client';
import type { AppType } from '@dj/api-contracts';

export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl);
}

export const apiClient = createApiClient(window.location.origin);
```

**Usage Example:**
```typescript
// Fully typed request/response!
const res = await apiClient.api.spotify.auth.$get();
const data = await res.json(); // Type: { url: string }
```

### 3. Route Contracts Defined ✅

**Auth Routes (`/api/spotify/*`):**
- `GET /api/spotify/auth` - Get OAuth URL
- `POST /api/spotify/token` - Exchange code for token
- `GET /api/spotify/me` - Get user profile

**Playlist Routes (`/api/spotify/playlists/*`):**
- `GET /api/spotify/playlists` - List user playlists
- `GET /api/spotify/playlists/{id}` - Get playlist details
- `POST /api/spotify/playlists` - Create playlist
- `POST /api/spotify/playlists/{id}/tracks` - Add tracks

**Chat Routes (`/api/chat-stream/*`):**
- `POST /api/chat-stream/message` - Stream AI responses
- `POST /api/chat/message` - Non-streaming chat

### 4. OpenAPI Documentation ✅

**Auto-generated:**
- OpenAPI spec at `/api/openapi.json`
- Swagger UI at `/api/docs`

## Migration Strategy

### Phase 1: Auth Routes (NEXT)

**Current file:** `workers/api/src/routes/spotify.ts`

**Migration steps:**
1. Import route contracts from `@dj/api-contracts`
2. Replace Hono() with buildApiApp() from contracts
3. Use `app.openapi()` instead of `app.get/post()`
4. Remove manual Zod validation (handled by contract)
5. Keep implementation logic unchanged

**Before:**
```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/spotify/auth', async (c) => {
  // Manual validation
  const authUrl = `...`;
  return c.json({ url: authUrl });
});
```

**After:**
```typescript
import { buildApiApp, getSpotifyAuthUrl } from '@dj/api-contracts';

const app = buildApiApp();

app.openapi(getSpotifyAuthUrl, async (c) => {
  // Validation automatic from contract
  const authUrl = `...`;
  return c.json({ url: authUrl }); // Type-checked against schema!
});
```

**Benefits:**
- Request/response automatically validated
- TypeScript ensures response matches contract
- OpenAPI docs auto-generated
- Client gets full type safety

### Phase 2: Playlist Routes

**Files to migrate:**
- `workers/api/src/routes/playlist.ts`
- Use contracts from `@dj/api-contracts/routes/playlists`

### Phase 3: Chat/Streaming Routes

**Files to migrate:**
- `workers/api/src/routes/chat-stream.ts`
- `workers/api/src/routes/chat-simple.ts`
- Use contracts from `@dj/api-contracts/routes/chat`

**Special consideration:** SSE streaming
- Contract defines `text/event-stream` content type
- Keep streaming logic, contract validates request/initiates stream

### Phase 4: Worker Index

**File:** `workers/api/src/index.ts`

**Changes:**
1. Import `buildApiApp()` from `@dj/api-contracts`
2. Replace manual route registration with contract-based app
3. Merge routes from contracts with existing routes

**Before:**
```typescript
import { Hono } from 'hono';
import { spotifyRoutes } from './routes/spotify';

const app = new Hono();
app.route('/api/spotify', spotifyRoutes);
```

**After:**
```typescript
import { buildApiApp } from '@dj/api-contracts';
import { spotifyRoutes } from './routes/spotify';

const app = buildApiApp(); // Already has contracts
// Add remaining non-contract routes if needed
app.route('/health', healthRoutes);
```

### Phase 5: Frontend Migration

**File:** `apps/web/src/lib/api.ts` (new file)

**Replace:**
```typescript
// OLD: Manual fetch with no type safety
const response = await fetch('/api/spotify/playlists', {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json() as any; // ❌ No validation
```

**With:**
```typescript
// NEW: Typed client with automatic validation
import { apiClient, parseResponse } from '@dj/api-client';

const res = await apiClient.api.spotify.playlists.$get({
  header: { authorization: `Bearer ${token}` }
});
const data = await parseResponse(res); // ✅ Fully typed!
```

## Complete Example: Auth Route Migration

### Current Implementation
```typescript
// workers/api/src/routes/spotify.ts (BEFORE)
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/spotify/auth', async (c) => {
  const env = c.env as Env;

  if (!env.SPOTIFY_CLIENT_ID) {
    return c.json({ error: 'Spotify not configured' }, 500);
  }

  const scopes = [
    'playlist-modify-public',
    'playlist-modify-private',
    // ...
  ];

  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: `${env.FRONTEND_URL}/callback`,
    response_type: 'token',
    scope: scopes.join(' '),
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;

  return c.json({ url: authUrl });
});

export default app;
```

### Migrated Implementation
```typescript
// workers/api/src/routes/spotify.ts (AFTER)
import { buildApiApp, getSpotifyAuthUrl } from '@dj/api-contracts';

const app = buildApiApp();

// Route contract defined in @dj/api-contracts/routes/auth.ts
app.openapi(getSpotifyAuthUrl, async (c) => {
  const env = c.env as Env;

  // Same logic, but response is type-checked!
  if (!env.SPOTIFY_CLIENT_ID) {
    return c.json({ error: 'Spotify not configured' }, 500);
  }

  const scopes = [
    'playlist-modify-public',
    'playlist-modify-private',
    // ...
  ];

  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: `${env.FRONTEND_URL}/callback`,
    response_type: 'token',
    scope: scopes.join(' '),
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;

  // TypeScript enforces this matches SpotifyAuthResponseSchema!
  return c.json({ url: authUrl });
});

export default app;
```

**What Changed:**
1. Import `buildApiApp()` and route contract
2. Use `app.openapi(contract, handler)` instead of `app.get(path, handler)`
3. Response automatically validated against schema
4. **Implementation logic stays the same!**

## Frontend Usage Example

### Before (No Type Safety)
```typescript
// apps/web/src/hooks/useSpotifyAuth.ts (BEFORE)
const response = await fetch('/api/spotify/auth');
const data = await response.json() as { url?: string }; // ❌ Manual typing

if (data.url) {
  window.location.href = data.url;
}
```

### After (Full Type Safety)
```typescript
// apps/web/src/hooks/useSpotifyAuth.ts (AFTER)
import { apiClient, parseResponse } from '@dj/api-client';

const res = await apiClient.api.spotify.auth.$get();
const data = await parseResponse(res); // ✅ Type: { url: string }

// TypeScript knows data.url exists and is a string!
window.location.href = data.url;
```

## Benefits Realized

### Developer Experience
- **No manual validation code** - Contracts handle it
- **Autocomplete everywhere** - IDE knows all routes and types
- **Catch errors at compile time** - Not runtime
- **Self-documenting** - OpenAPI spec always up-to-date

### Type Safety
- **Request validation** - Zod validates incoming data
- **Response validation** - TypeScript ensures correct shape
- **End-to-end types** - Server → Client with no codegen
- **No `any` types needed** - Everything inferred

### Maintenance
- **Single source of truth** - Change contract, everything updates
- **Easier refactoring** - TypeScript guides you
- **Better testing** - Contracts make mocking easier
- **API documentation** - Generated automatically

## Next Steps

1. **Migrate Auth Routes** - Start with `/api/spotify/auth` route family
2. **Test OpenAPI Docs** - Verify `/api/docs` works
3. **Migrate Playlist Routes** - Implement playlist contract handlers
4. **Update Frontend** - Switch to typed client for auth
5. **Migrate Chat Routes** - Handle SSE streaming with contracts
6. **Add More Contracts** - Cover remaining routes (MCP, webhooks, etc.)

## Commands

```bash
# Build contracts package
pnpm --filter @dj/api-contracts build

# Build client package
pnpm --filter @dj/api-client build

# Build everything
pnpm build

# View OpenAPI docs (after worker running)
open http://localhost:8787/api/docs
```

## Resources

- [Hono Zod OpenAPI Guide](https://hono.dev/guides/zod-openapi)
- [Hono RPC Client](https://hono.dev/guides/rpc)
- [OpenAPI 3.0 Spec](https://swagger.io/specification/)
- [Zod Documentation](https://zod.dev)
