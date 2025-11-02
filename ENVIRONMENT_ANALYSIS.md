# DJ Codebase: Runtime Environment Analysis

## Summary

This is a well-structured pnpm monorepo with clear separation between Browser, Cloudflare Workers,
and shared layers. The architecture has excellent environment isolation with minimal
cross-environment concerns.

---

## 1. Directory Structure and Runtime Environments

### Apps/

```
apps/web/                           # BROWSER (React 19.1)
├── src/
│   ├── app/                        # App-level components (React)
│   ├── components/                 # UI components (React)
│   ├── features/                   # Feature modules (React hooks, components)
│   ├── hooks/                      # React custom hooks
│   ├── lib/                        # API clients, streaming clients (browser-safe)
│   ├── pages/                      # Page components (React)
│   ├── styles/                     # CSS modules + global styles
│   ├── types/                      # Browser-specific types
│   └── App.tsx, main.tsx           # React entry points
```

### Workers/

```
workers/api/                        # CLOUDFLARE WORKERS (Hono + Langchain)
├── src/
│   ├── routes/                     # API endpoints (Hono routers)
│   ├── services/                   # Business logic (AudioEnrichment, LastFm)
│   ├── lib/                        # Spotify tools, progress narrator
│   ├── utils/                      # RateLimitedQueue, shared utilities
│   └── index.ts                    # Hono app setup
├── wrangler.jsonc                  # Cloudflare Workers config

workers/webhooks/                   # CLOUDFLARE WORKERS (Hono)
├── src/
│   ├── routes/                     # Webhook endpoints
│   ├── services/                   # Business logic
│   └── index.ts                    # Hono app setup
```

### Packages/

```
packages/shared-types/              # ENVIRONMENT-AGNOSTIC (Pure TypeScript interfaces)
├── src/index.ts                    # Types only, zero dependencies
│   ├── Playlist, Track
│   ├── ChatMessage, ChatRequest/Response
│   ├── SpotifyTrack, SpotifyPlaylist, SpotifyAudioFeatures
│   ├── StreamToolData, StreamToolResult
│   └── WebhookEvent, SpotifyWebhookPayload

packages/api-client/                # BROWSER + WORKERS (Fetch-based HTTP client)
├── src/index.ts                    # DJApiClient class
│   ├── Uses localStorage (browser only in practice)
│   ├── Uses fetch API (available in both)
│   ├── Depends on @dj/shared-types
```

---

## 2. Detailed Environment Analysis

### A. Browser Application (@dj/web)

**Target:** React 19.1 in browser via Vite

**Dependencies:**

- `react`, `react-dom`
- `@ark-ui/react` (UI components)
- `@dj/api-client` (custom HTTP client)
- `@dj/shared-types` (types)
- `zod` (validation)

**Key Characteristics:**

- TypeScript config includes: `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`
- Uses `localStorage` for Spotify token storage (lines in streaming-client.ts, api-client.ts)
- Uses `fetch` API for HTTP requests
- Uses `import.meta.env` for environment detection (Vite)
- Uses `document`, `window`, `AbortController` (browser APIs)

**Restricted - Does NOT Import:**

- No `@langchain/*` dependencies (worker-specific)
- No `hono` (worker framework)
- No `wrangler` (worker CLI)
- No `@cloudflare/workers-types`

---

### B. Cloudflare API Worker (@dj/api-worker)

**Target:** Cloudflare Workers runtime (V8 + nodejs_compat flag)

**Dependencies:**

- `hono` (web framework)
- `@langchain/anthropic`, `@langchain/core`, `langchain`
- `@langchain/mcp-adapters` (MCP server integration)
- `@dj/shared-types` (types)
- `nanoid`, `zod`

**Key Characteristics:**

- TypeScript config includes: `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`
- Uses Hono for routing
- Uses Langchain for Claude AI integration and tool execution
- Uses KVNamespace (Cloudflare KV) for session/cache storage
- Custom services for data enrichment (Deezer, Last.fm, MusicBrainz)
- Rate-limited queue for API throttling

**Restricted - Does NOT Import:**

- No React or JSX
- No browser-specific code
- No localStorage (uses KV instead)

---

### C. Cloudflare Webhook Worker (@dj/webhook-worker)

**Target:** Cloudflare Workers runtime

**Dependencies:**

- `hono` (web framework)
- `@dj/shared-types` (types)
- `zod` (validation)

**Key Characteristics:**

- Minimal implementation compared to API worker
- Only webhook verification and basic routing
- No AI/ML dependencies
- Uses `@cloudflare/workers-types`

---

### D. Shared Types Package (@dj/shared-types)

**Target:** Environment-agnostic (used by both web and workers)

**Dependencies:** None (zero dependencies)

**Content (Pure TypeScript Interfaces):**

- `Playlist`, `Track`
- `ChatMessage`, `ChatRequest`, `ChatResponse`
- `SpotifyTrack`, `SpotifyPlaylist`, `SpotifyAudioFeatures`, `SpotifyUser`
- `StreamToolData`, `StreamToolResult`, `StreamDebugData`, `StreamLogData`
- `WebhookEvent`, `SpotifyWebhookPayload`
- `ApiError`

**Key Characteristic:** No runtime code, only type definitions and interfaces

---

### E. API Client Package (@dj/api-client)

**Target:** Browser (with potential for server-side usage via fetch polyfill)

**Dependencies:**

- `@dj/shared-types`

**Exports:**

```typescript
DJApiClient class:
  - constructor(baseUrl: string)
  - setToken(token: string)
  - clearToken()
  - private request<T>(endpoint, options)
  - getSpotifyAuthUrl()
  - generatePlaylist(prompt)
  - savePlaylistToSpotify(playlist)
  - searchSpotify(query, type)
  - sendChatMessage(chatRequest)

apiClient singleton:
  - Auto-detects: localhost:3000 → http://localhost:8787/api
  - Production: /api
```

**Key Characteristics:**

- Uses `localStorage.getItem('spotify_token')`
- Uses `fetch` API
- Detection: `typeof window !== 'undefined' && window.location.hostname`
- Could technically work in Workers with polyfills, but not currently used

---

## 3. Dependency Graph

```
Shared Layer:
┌─────────────────────────────────┐
│   @dj/shared-types              │
│   (Zero dependencies)           │
│   Pure TypeScript interfaces    │
└─────────────────────────────────┘
         ↑           ↑
    ┌────┴───┐    ┌──┴────┐
    │         │    │       │

Browser Layer:
┌─────────────────────────────────┐     └─────────────────────────────────┐
│   @dj/api-client                │     │   @dj/web (React app)           │
│ ↓ @dj/shared-types              │     │ ↓ @dj/shared-types              │
│ ↓ fetch API (browser)           │     │ ↓ @dj/api-client                │
│ ↓ localStorage (browser)        │     │ ↓ react, react-dom              │
│ ↓ HTTP client wrapper           │     │ ↓ @ark-ui/react                 │
└─────────────────────────────────┘     │ ↓ Vite, TypeScript              │
         ↑                              └─────────────────────────────────┘
         └──────────────────────────────────────────────────────┐
                                                                 │
Worker Layer (Cloudflare):
┌────────────────────────────────┐      ┌─────────────────────────────────┐
│   @dj/api-worker               │      │   @dj/webhook-worker           │
│ ↓ @dj/shared-types             │      │ ↓ @dj/shared-types              │
│ ↓ hono (web framework)         │      │ ↓ hono                          │
│ ↓ @langchain/* (AI/tools)      │      │ ↓ zod (validation)              │
│ ↓ Custom services              │      │ ↓ Minimal                       │
│ ↓ KVNamespace (Cloudflare)     │      └─────────────────────────────────┘
└────────────────────────────────┘
```

---

## 4. Cross-Environment Import Analysis

### ✅ Verified Safe Imports

**Web App (@dj/web) Imports:**

- ✅ `@dj/shared-types` - Pure types, no runtime concerns
- ✅ `@dj/api-client` - Browser HTTP client, uses fetch + localStorage
- ✅ `react`, `react-dom` - React 19.1
- ✅ `@ark-ui/react` - UI component library
- ✅ `zod` - Validation (environment-agnostic)
- ✅ `vite`, `vitest`, TypeScript - Build tools only

**API Worker (@dj/api-worker) Imports:**

- ✅ `@dj/shared-types` - Pure types, no runtime concerns
- ✅ `hono` - Worker web framework
- ✅ `@langchain/*` - AI/LLM libraries (Node.js-compatible)
- ✅ `zod` - Validation (environment-agnostic)

**Webhook Worker (@dj/webhook-worker) Imports:**

- ✅ `@dj/shared-types` - Pure types
- ✅ `hono` - Worker web framework
- ✅ `zod` - Validation

### ✅ No Cross-Environment Pollution Detected

**Web does NOT import:**

- ❌ No `hono` (worker framework)
- ❌ No `@langchain/*` (worker AI libraries)
- ❌ No `wrangler` (worker CLI)
- ❌ No `@cloudflare/workers-types`
- ❌ No worker-specific code

**Workers do NOT import:**

- ❌ No React or JSX
- ❌ No `@ark-ui/react` or other UI libraries
- ❌ No `vite`, `vitest` (browser dev tools)
- ❌ No browser-specific code

**Shared Packages contain:**

- ✅ Pure TypeScript interfaces only
- ✅ Zero external dependencies
- ✅ No environment-specific code

---

## 5. ESLint Configuration Analysis

**File:** `/Users/brianmeek/scratch/dj/eslint.config.js`

**Current Approach:** Single monorepo-wide ESLint config

**Features:**

- Single config file in root
- Defines globals for ALL environments simultaneously:
  - Browser: `window`, `document`, `localStorage`, `fetch`, DOM APIs
  - Node.js: `process`, `Buffer`, `__dirname`, `__filename`
  - Cloudflare Workers: `KVNamespace`, `Fetcher`, `TransformStream`, `crypto`
  - React: React globals, JSX
- Applies to all `**/*.{ts,tsx}` files
- Universal plugins:
  - `@typescript-eslint`
  - `eslint-plugin-react*` (applies to non-React files too)
  - `eslint-plugin-react-hooks` (warns even in worker code)

**Potential Issues:**

1. **React Hooks Rules Applied Everywhere** (line 113-114):

   ```javascript
   'react-hooks/rules-of-hooks': 'error',
   'react-hooks/exhaustive-deps': 'warn',
   ```

   These error/warn in worker code where hooks don't apply

2. **React Plugin Active Everywhere** (line 128-130):

   ```javascript
   settings: {
     react: {
       version: 'detect'
     }
   }
   ```

   Runs React detection/analysis in all files

3. **React Refresh Warning** (line 117-120): Applied even to non-React code in workers

4. **All Globals Defined** (lines 32-87): Makes it hard to catch accidental use of browser-specific
   globals in worker code

---

## 6. Recommendations

### Current State: HEALTHY ✅

The codebase has **excellent environment isolation**:

- Sharp boundaries between web and workers
- Shared types have zero dependencies
- API client is focused and browser-safe
- No cross-environment pollution detected

### Recommendation: SEPARATE ESLint CONFIGS

Despite healthy architecture, **YES, separate ESLint configs make sense** for:

1. **Developer Experience:**
   - React developers in `/apps/web` get React-specific rules + warnings
   - Worker developers in `/workers` don't see irrelevant React warnings
   - Type developers in `/packages` get minimal, focused rules

2. **Lint Accuracy:**
   - Catch misuse of globals (e.g., `localStorage` in worker code)
   - React hooks rules only in React files
   - Cloudflare Workers types only in worker files

3. **Scalability:**
   - Easy to add new environments (e.g., CLI tool, mobile app)
   - Each environment gets optimized rules
   - Reduces "this warning doesn't apply to me" frustration

4. **Prevents Subtle Bugs:**
   - Single config doesn't prevent developers from:
     - Accidentally using React hooks in shared utilities
     - Using browser APIs in shared code
     - Using localStorage in packages meant for workers

### Proposed ESLint Structure

```
dj/
├── eslint.config.js                    (root - base rules only)
├── eslint.config.browser.js            (browser-specific: react, dom)
├── eslint.config.worker.js             (worker-specific: cloudflare, node)
├── eslint.config.shared.js             (shared packages: minimal)
│
├── apps/
│   └── web/
│       └── .eslintrc.js → extends browser config
│
├── workers/
│   ├── api/
│   │   └── .eslintrc.js → extends worker config
│   └── webhooks/
│       └── .eslintrc.js → extends worker config
│
└── packages/
    ├── shared-types/
    │   └── .eslintrc.js → extends shared config
    └── api-client/
        └── .eslintrc.js → extends shared config
```

### Implementation Priority

**Low Priority** (works fine as-is):

- Current config successfully prevents cross-environment pollution
- No major architectural issues
- Developers are likely aware of environment boundaries

**High Priority if:**

- Team is growing and onboarding needs to be clearer
- Developers frequently build wrong code in wrong environment
- Want to enforce environment boundaries at lint-time
- Setting up pre-commit hooks with environment-specific rules

---

## 7. TypeScript Configuration Summary

### Web (apps/web/tsconfig.json)

```
lib: [ES2022, DOM, DOM.Iterable]     ← Browser globals
jsx: react-jsx                        ← React JSX
moduleResolution: bundler             ← Vite bundler
```

### Workers (workers/api/tsconfig.json)

```
lib: [ES2022]                         ← No DOM
types: @cloudflare/workers-types      ← Worker types
moduleResolution: bundler             ← Standard resolution
```

### Shared (packages/shared-types/tsconfig.json)

```
lib: [ES2022]                         ← Minimal
No DOM, no react, no worker types     ← Pure TS
```

Each TypeScript config correctly reflects its environment.

---

## 8. Build Tool Configuration

### Web (Vite)

- Entry: `apps/web/vite.config.ts`
- Output: SPA bundle served from root
- Dev: port 3000

### Workers (Wrangler + tsup)

- Entry: `workers/api/src/index.ts`
- Output: Single file for Cloudflare Workers
- Dev: port 8787 (wrangler dev)

### Shared Packages (tsup)

- No special configuration
- Output: ESM modules for consumption by web/workers

---

## 9. Package Exports Summary

| Package            | Target  | Exports                      | Key Files                      |
| ------------------ | ------- | ---------------------------- | ------------------------------ |
| @dj/shared-types   | Both    | Types only                   | interfaces, enums              |
| @dj/api-client     | Browser | DJApiClient class, singleton | fetch-based HTTP client        |
| @dj/web            | Browser | React app                    | React 19.1 components          |
| @dj/api-worker     | Workers | Hono app, routes             | Langchain + Claude integration |
| @dj/webhook-worker | Workers | Hono app, webhook routes     | Minimal webhook handling       |

---

## 10. Conclusion

This is a **well-architected monorepo** with:

✅ **Excellent Environment Isolation**

- No cross-environment imports
- Clear shared layer
- Type-safe boundaries

✅ **Good TypeScript Configuration**

- Each environment has appropriate types
- DOM types in browser, Worker types in workers
- Shared has minimal, pure TS

✅ **Current ESLint Works**

- Prevents major mistakes
- Applies globally safely

⚠️ **ESLint Could Be Improved**

- Separate configs would catch more subtle issues
- Current approach doesn't prevent all cross-environment mistakes
- Worth doing if scaling team or strictness requirements increase

**Recommendation: SEPARATE ESLint CONFIGS for better developer experience and bug prevention, but
current setup is functionally adequate.**
