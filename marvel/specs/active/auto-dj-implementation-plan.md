# Implementation Plan: Auto DJ Modernization

## Overview

Modernize the DJ app into an autonomous DJ through 5 steps: dependency/model upgrades, unified DJ experience, batch set planning, playback guarantee, and feedback adaptation. Shipped as a single mega PR.

## Decisions (from interactive review)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ESLint upgrade | **Pin to ESLint 9**, upgrade later | Avoid config churn; defer major lint migration |
| Model strategy | **Sonnet 4.6 everywhere** | Maximum capability; Haiku 4.5 is already latest Haiku |
| Arc selection | **User picks from menu** | Visual cards with energy curves at session start |
| Fallback pool | **Aggressive (10 tracks)** | Belt and suspenders; Spotify queue API unreliable |
| MCP documentation | **Remove entirely** | No MCP code exists; clean break |
| Chat-only mode | **Remove entirely** | All interaction through DJ page |
| "Surprise me" | **User's top tracks + recent listens** | Personalized via Spotify /me/top/tracks + /me/player/recently-played |
| Debug page | **Keep behind ?debug=true** | Zero prod cost, useful for debugging |
| Zod upgrade | **Upgrade to 4.3.6** | Latest minor across all 7 packages |
| Arc UX | **Visual cards with energy curves** | Mini SVG graphs showing energy shape per arc |
| PR strategy | **Single mega PR** | Everything in one PR; fastest to merge |

## Risk Assessment

- **Zod 4.1→4.3 across 7 packages**: Minor version but wide blast radius. Run contract tests after upgrade.
- **Model ID changes**: 14 hardcoded references across 8 files. Centralizing to constants.ts prevents future scatter.
- **Store unification (Step 1)**: Every component importing from mixStore or playlistStore breaks. Must update all consumers atomically.
- **KV schema changes**: New fields default to undefined so existing sessions remain valid. SetPlan is a nested object — validate serialization size.
- **Spotify queue sync**: POST /v1/me/player/queue can fail silently. Aggressive fallback pool (10 tracks) mitigates this.

---

## Step 0: Dependency & Model Modernization

**Goal:** Update all outdated dependencies to Feb 2026 latest and upgrade all Claude model references.

### Step 0a: Patch/Minor Dependency Updates

Update packages staying within the same major version.

**Files:** All `package.json` files across the monorepo

| Package | From | To | Scope |
|---------|------|----|-------|
| react | 19.2.0 | 19.2.4 | @dj/web |
| react-dom | 19.2.0 | 19.2.4 | @dj/web |
| @types/react | 19.2.7 | 19.2.14 | @dj/web (dev) |
| @types/react-dom | 19.2.3 | latest | @dj/web (dev) |
| @ark-ui/react | 5.29.1 | 5.34.0 | @dj/web |
| zustand | 5.0.8 | ^5.0.11 | @dj/web (**fix missing `^`**) |
| hono | 4.10.7 | 4.12.3 | api-client, api-contracts, api-worker, webhook-worker |
| @hono/zod-openapi | 1.1.5 | 1.2.2 | api-contracts, api-worker |
| @hono/swagger-ui | 0.5.2 | 0.5.3 | api-worker |
| zod | 4.1.13 | 4.3.6 | ALL 7 packages |
| @anthropic-ai/sdk | 0.71.0 | 0.78.0 | api-worker |
| vitest | 4.0.14 | 4.0.18 | ALL (root, shared-types, web, api-worker, webhook-worker) |
| @vitest/ui | 4.0.14 | 4.0.18 | root (dev) |
| vite | 7.2.4 | 7.3.1 | @dj/web (dev) |
| @vitejs/plugin-react | 5.1.1 | 5.1.4 | @dj/web (dev) |
| wrangler | 4.51.0 | 4.69.0 | api-worker, webhook-worker (dev) |
| @cloudflare/workers-types | 4.20251126.0 | 4.20260226.1 | api-worker, webhook-worker (dev) |
| @playwright/test | 1.57.0 | 1.58.2 | @dj/web (dev) |
| prettier | 3.6.2 | 3.8.1 | root (dev) |
| typescript-eslint | 8.48.0 | 8.56.1 | root (dev) |
| @testing-library/react | 16.3.0 | 16.3.2 | root, @dj/web (dev) |
| dotenv | 17.2.3 | 17.3.1 | api-worker (dev) |
| happy-dom | 20.0.10 | 20.7.0 | root (dev) |
| zod-to-json-schema | 3.25.0 | 3.25.1 | api-worker (dev) |
| nanoid | 5.1.6 | latest 5.x | api-worker |
| eslint-plugin-react-refresh | 0.4.24 | 0.5.2 | root (dev) |

**NOT upgrading (ESLint 10 deferred):**
- eslint: stays at ^9.39.1
- @eslint/js: stays at ^9.39.1
- eslint-plugin-perfectionist: stays at ^4.15.1
- eslint-plugin-security: stays at ^3.0.1
- globals: stays at ^16.5.0
- jsdom: stays at ^27.2.0
- @types/node: stays at ^24.10.1

**Verify:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

### Step 0b: Claude Model Version Upgrade

Upgrade all 14 hardcoded model references. Centralize to `constants.ts`.

**Model mapping (Sonnet 4.6 everywhere):**

| Current | Updated | Count |
|---------|---------|-------|
| `claude-sonnet-4-5-20250929` | `claude-sonnet-4-6-20260219` | 6 refs |
| `claude-sonnet-4-20250514` | `claude-sonnet-4-6-20260219` | 1 ref |
| `claude-haiku-4-20250929` | `claude-haiku-4-5-20251001` | 2 refs |
| `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | 1 ref (no change) |
| Test fixtures | Updated to match | 4 refs |

**Changes to `workers/api/src/constants.ts`:**
```typescript
export const LLM = {
  MODEL: 'claude-sonnet-4-6-20260219',
  MODEL_HAIKU: 'claude-haiku-4-5-20251001',
  // ... rest unchanged
}
```

**Files to modify (14 changes across 8 files):**

| File | Line(s) | Change |
|------|---------|--------|
| `constants.ts` | 99 | `LLM.MODEL` → `claude-sonnet-4-6-20260219`, add `MODEL_HAIKU` |
| `chat-stream/index.ts` | 324 | Hardcoded model → `LLM.MODEL` |
| `chat-stream/agentic-loop.ts` | 166, 300 | Hardcoded model → `LLM.MODEL` |
| `chat-stream/tools/discovery-tools.ts` | 69, 268, 397 | Hardcoded model → `LLM.MODEL` |
| `lib/progress-narrator.ts` | 102 | Already `claude-haiku-4-5-20251001` → use `LLM.MODEL_HAIKU` |
| `lib/vibe-steering.ts` | 72 | `claude-haiku-4-20250929` → `LLM.MODEL_HAIKU` |
| `routes/steer-stream.ts` | 111 | `claude-haiku-4-20250929` → `LLM.MODEL_HAIKU` |
| `routes/steer-stream.ts` | 160 | `claude-sonnet-4-20250514` → `LLM.MODEL` |
| `__tests__/fixtures/anthropic-mocks.ts` | 70, 344, 411 | Update mock model IDs |
| `__tests__/routes/chat-stream.test.ts` | 136 | Update test model ID |
| `lib/__tests__/vibe-steering.test.ts` | 245 | Update test model ID |

**Verify:** `pnpm typecheck && pnpm test`

### Step 0c: Update Marvel Packs

**Files:** `marvel/packs/dj-llm-tools/guardrails.md`

**Changes:** Update model IDs in "Model Configuration" section to reflect Sonnet 4.6 and centralized constants pattern.

---

## Step 1: Unified DJ Experience

**Goal:** Single DJ page, unified store, server-side conversation, "surprise me" support.

### Step 1a: Shared Types — New Schemas

**Files:** `packages/shared-types/src/schemas/mix-session-schemas.ts`, `packages/shared-types/src/index.ts`

**Add:**
- `ConversationEntry` schema (role, content, timestamp, toolCalls?)
- `ListenerSignal` schema (trackId, type: completed|skipped|partial, listenDuration, trackDuration, timestamp)
- `conversation` field on `MixSession` (array of ConversationEntry, max 50, default [])
- `signals` field on `MixSession` (array of ListenerSignal, max 50, default [])

All fields optional/defaulted so existing KV sessions remain valid.

### Step 1b: Backend — `POST /api/mix/chat` SSE Endpoint

**Files:** `workers/api/src/routes/mix-openapi.ts`, `workers/api/src/services/MixSessionService.ts`

**Changes:**
- New SSE endpoint: `POST /api/mix/chat` — same TransformStream pattern as `chat-stream/index.ts`
- System prompt auto-injects: current vibe, queue state, last 5 played tracks, listener signals
- Stores conversation entries in KV session (no client-side history needed)
- `MixSessionService`: add `addConversationEntry()`, `getConversationContext()`

### Step 1c: Backend — "Surprise Me" Endpoint

**Files:** `workers/api/src/routes/mix-openapi.ts`

**Changes:**
- When `POST /api/mix/start` receives no seed playlist: call Spotify `/me/top/tracks?time_range=short_term&limit=50` and `/me/player/recently-played?limit=50`
- Use combined data as seed for vibe extraction and set planning
- Return session with generated vibe profile

### Step 1d: Frontend — Create `djStore`

**Files:** `apps/web/src/stores/djStore.ts` (new)

**State shape:**
```typescript
interface DJState {
  session: MixSession | null
  status: 'idle' | 'starting' | 'playing' | 'paused' | 'error'
  messages: ChatMessage[]
  isStreaming: boolean
  suggestions: Suggestion[]
  suggestionsLoading: boolean
  steerInProgress: boolean
  steerEvents: SteerStreamEvent[]
  signals: ListenerSignal[]
  selectedArc: string | null  // arc template name chosen by user
}
```

**Actions:** Unified from mixStore + playlistStore + new chat/signal actions.
- Zustand with `subscribeWithSelector` middleware
- No useEffect for state sync (React 19.2 pattern)

### Step 1e: Frontend — DJInterface + ChatPanel + ArcSelector

**New files:**
- `apps/web/src/features/dj/DJInterface.tsx` — Main composition layout
- `apps/web/src/features/dj/ChatPanel.tsx` — Inline chat with SSE streaming
- `apps/web/src/features/dj/ArcSelector.tsx` — Visual cards with energy curve SVGs
- `apps/web/src/features/dj/DJInterface.module.css`
- `apps/web/src/features/dj/ChatPanel.module.css`
- `apps/web/src/features/dj/ArcSelector.module.css`

**ArcSelector UX:** 3 cards, each showing:
- Mini SVG energy curve (~80x40px)
- Label: "Build & Peak", "Steady Cruise", "Rollercoaster"
- Short description below
- Selected state with highlight

**Reuse existing:** NowPlaying, QueuePanel, VibeControls, SuggestionsPanel, PlaybackControls — rewired to `djStore`

### Step 1f: Frontend — Update App.tsx

**Files:** `apps/web/src/App.tsx`, `apps/web/src/stores/navigationStore.ts`

**Changes:**
- Default route `/` renders `<DJInterface />`
- `?debug=true` query param shows ScopeDebugger overlay
- Remove route switching for chat/mix/debug
- Remove `navigationStore` or reduce to `{ showDebug: boolean }`
- Update all component imports: `mixStore` → `djStore`, `playlistStore` → `djStore`

**Verify:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

---

## Step 2: Set Planning Engine

**Goal:** Batch 15-20 track plans in one Claude call with arc-aware transitions.

### Step 2a: Shared Types — SetPlan Schemas

**Files:** `packages/shared-types/src/schemas/mix-session-schemas.ts`

**Add:**
- `ArcPhase` (name, targetEnergy, targetBpmRange: [min, max], durationMinutes, genreHints)
- `ArcTemplate` (name, phases: ArcPhase[], totalDurationMinutes)
- `PlannedTrack` (spotifyUri, name, artist, bpm?, energy, arcPhase, transitionScore, reason)
- `SetPlan` (arc: ArcTemplate, tracks: PlannedTrack[], currentPosition, generatedAt, expiresAt)
- `plan` field on `MixSession` (SetPlan | null, default null)

### Step 2b: Backend — TransitionScorer

**Files:** `workers/api/src/services/TransitionScorer.ts` (new)

Pure algorithmic scoring — zero AI calls:
- `scoreTransition(from, to, arcPhase)` → `TransitionScore`
  - BPM: gaussian penalty for >10 BPM jump
  - Energy: penalty for >0.2 deviation from arc target
  - Genre: Jaccard similarity on Last.fm tags
  - Artist: hard penalty for repeat within 5 tracks
  - Era: bonus for same decade
- `orderByTransition(tracks, arcPhases)` → optimally ordered track list

### Step 2c: Backend — SetPlanner

**Files:** `workers/api/src/services/SetPlanner.ts` (new)

- `planSet(session, seedVibe, enrichment, preferences, arcTemplate)` → `SetPlan`
- One Claude Sonnet 4.6 call with extended thinking → 15-20 track recommendations
- TransitionScorer orders the tracks after Claude picks them
- Spotify search to resolve track URIs
- `extendPlan(session, count)` → append tracks when plan runs low
- `replanFrom(session, position, newVibe)` → partial replan after steering

### Step 2d: Backend — Wire into Mix Routes

**Files:** `workers/api/src/routes/mix-openapi.ts`, `workers/api/src/services/MixSessionService.ts`

- `autoFillQueue()`: draw from `session.plan.tracks[currentPosition++]`
- Only call SetPlanner when plan is empty or < 5 tracks remaining
- `POST /api/mix/start`: accept `arcTemplate` param, generate initial plan
- `POST /api/mix/vibe/steer`: trigger `replanFrom()`
- `MixSessionService`: add `advancePlan()`, `replanFrom()`, `getPlanStatus()`

**Verify:** `pnpm typecheck && pnpm test && pnpm build`

---

## Step 3: Playback Guarantee

**Goal:** Music never stops. Aggressive 10-track fallback pool.

### Step 3a: Backend — Fallback Track Pool

**Files:** `workers/api/src/services/MixSessionService.ts`, `packages/shared-types/src/schemas/mix-session-schemas.ts`

- Add `fallbackPool: string[]` to MixSession (max 10 Spotify URIs)
- On session start: pre-compute from seed playlist (top by popularity, filtered vs history)
- For "surprise me": use top tracks from Spotify `/me/top/tracks`
- `getFallbackTrack()`: pop from pool, verify not in history/queue
- Trigger: plan depleted AND SetPlanner takes > 5 seconds

### Step 3b: Backend — Queue Monitoring + Health Events

**Files:** `workers/api/src/routes/player-stream.ts`, `packages/shared-types/src/schemas/mix-session-schemas.ts`

- Add `SessionHealth` schema (queueDepth, planRemaining, lastAICallMs, consecutiveErrors, fallbacksUsed)
- Fetch Spotify queue periodically (`GET /v1/me/player/queue`) — every 10 seconds, not every 1s poll
- Emit `queue_low` SSE event when Spotify queue < 3 tracks
- Emit `session_health` SSE event every 30 seconds

### Step 3c: Frontend — Queue Low + Health Handling

**Files:** `apps/web/src/stores/playbackStore.ts`, `apps/web/src/stores/djStore.ts`

- `playbackStore`: handle `queue_low` and `session_health` event types
- `djStore`: on `queue_low` → immediately call `autoFillQueue()`; if slow, push fallbacks
- Optional: small health indicator in UI corner (queue depth, plan status)

**Verify:** `pnpm typecheck && pnpm test && pnpm build`

---

## Step 4: Feedback & Adaptation

**Goal:** Detect skips/completions, build taste model, auto-replan on drift.

### Step 4a: Shared Types — TasteModel

**Files:** `packages/shared-types/src/schemas/mix-session-schemas.ts`

- Add `TasteModel` (genreWeights: Record<string, number>, energyPreference, bpmPreference: [min, max], artistAffinities: Record<string, number>, skipPatterns: string[], updatedAt)
- Add `tasteModel` field on `MixSession` (TasteModel | null, default null)

### Step 4b: Frontend — Signal Collection

**Files:** `apps/web/src/stores/playbackStore.ts`, `apps/web/src/stores/djStore.ts`

- `playbackStore`: track `trackStartTime` on `track` events
- On track change: `listenDuration = now - trackStartTime`
- Classify: completed (>80%), skipped (<30s), partial (between)
- `djStore`: accumulate signals, batch-submit every 30 seconds via `POST /api/mix/signal`

### Step 4c: Backend — Signal Processing + Taste Model

**Files:** `workers/api/src/routes/mix-openapi.ts`, `workers/api/src/services/MixSessionService.ts`

- New `POST /api/mix/signal`: receive batch of ListenerSignals
- `processSignals()`: update taste model weights
  - completed → boost genre/artist +0.1
  - skipped → penalize genre/artist -0.2
  - Decay all by 0.95 every 10 tracks
- 3+ consecutive skips → trigger `replanFrom()` with taste context
- Feed taste model into SetPlanner prompt for next batch

**Verify:** `pnpm typecheck && pnpm test && pnpm build`

---

## Step 5: Cleanup & Documentation

### Step 5a: Remove Deprecated Code

**Delete:**
- `apps/web/src/stores/mixStore.ts`
- `apps/web/src/stores/playlistStore.ts`
- `apps/web/src/features/chat/ChatInterface.tsx` (and related CSS)
- Dead imports referencing removed files

**Keep (behind debug flag):**
- `apps/web/src/features/debug/ScopeDebugger.tsx` — accessible via `?debug=true`

### Step 5b: Remove MCP Documentation

**Files:** `CLAUDE.md`, `.claude/guidelines/tools-mcp.md`

- Delete `.claude/guidelines/tools-mcp.md` entirely
- Remove all MCP sections from `CLAUDE.md` (MCP server routes, MCP Integration Flow, MCP Setup references)
- Keep `/api/mcp/*` routes in code for potential future use, but remove from docs

### Step 5c: Update CLAUDE.md

- Update model versions to Sonnet 4.6 / Haiku 4.5
- Update architecture section to reflect unified DJ page
- Update API routes section (add /api/mix/chat, /api/mix/signal, remove chat-only endpoints)
- Update tool list with SetPlanner and fallback pool info
- Remove references to separate chat and mix modes

### Step 5d: Update Marvel Packs

**Files:**
- `marvel/packs/dj-llm-tools/guardrails.md` — Update model IDs, add SetPlanner patterns
- `marvel/packs/dj-spotify-integration/guardrails.md` — Add fallback pool and queue monitoring patterns
- `marvel/packs/dj-react-patterns/guardrails.md` — Update store references (djStore replaces mixStore + playlistStore)

---

## Verification Strategy

After each step within the mega PR:
```bash
pnpm typecheck        # Type safety across all packages
pnpm lint             # Code quality + security rules
pnpm test             # Unit tests (all projects)
pnpm build            # Full build (respects dependency order)
pnpm test:contracts   # API schema validation
```

Manual verification checkpoints:
1. After Step 0: All tests pass with new deps and model versions
2. After Step 1: Single DJ page loads, chat works, queue works, playback works, arc selector shows 3 cards
3. After Step 2: Session start generates 15-20 track plan, queue draws from plan
4. After Step 3: 30-minute unattended session with no gaps; fallback tracks visible in health events
5. After Step 4: Skip 3 tracks → taste model updates → replan triggered

## Resolved Questions

1. **ESLint 10**: Deferred. Pinned to ESLint 9.x with minor updates only.
2. **Zod 4.3 compatibility**: @hono/zod-openapi 1.2.2 supports Zod 4.x (verified peer dep). Safe to upgrade.
3. **KV value size**: MixSession with 20-track plan + 50 conversations + 50 signals + taste model ≈ 80-120KB. Well under 25MB KV limit.
4. **Spotify queue API**: Mitigated with aggressive 10-track fallback pool + 5-second timeout trigger.
5. **Claude Sonnet 4.6 extended thinking**: Anthropic SDK 0.78.0 supports thinking.type: 'enabled' with same API shape.
