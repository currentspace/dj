# Auto DJ Modernization

**Owner:** team
**Status:** Active
**Created:** 2026-02-27

**Packs Required:**
- pack:dj-react-patterns@1.0.0
- pack:dj-cloudflare-workers@1.0.0
- pack:dj-spotify-integration@1.0.0
- pack:dj-llm-tools@1.0.0
- pack:dj-monorepo@1.0.0
- pack:code-quality@1.0.0
- pack:testing@1.0.0
- pack:security@1.0.0

---

## 1. Goal

Transform the DJ app from a "smart queue manager with AI suggestions" into an **autonomous DJ** that plans musical arcs, adapts to listener behavior, and never lets the music stop — all while remaining steerable through natural conversation.

The user should be able to select a seed playlist (or say "surprise me"), and within 10 seconds hear music playing that intelligently flows for 30-120 minutes without any further intervention. Chat remains available for steering ("more energy", "throw in some jazz") but is not required.

## 2. Non-Goals

- Building a custom audio playback engine (Spotify handles playback)
- Implementing crossfade/beat-matching (Spotify handles this natively)
- Building a mobile app (web PWA only)
- Social features (sharing, collaborative DJ)
- Offline playback
- Replacing the existing enrichment services (Deezer, Last.fm) — they work well
- Building a full user profile/taste system across sessions (future phase)

## 3. Context

### What exists today

The app has two disconnected experiences:

**Chat Page** (`/` route → `ChatInterface.tsx`):
- Conversational AI assistant for playlist analysis and creation
- 4-phase vibe-driven discovery workflow (analyze → plan → execute → curate)
- SSE streaming responses from Claude Sonnet 4.5
- Conversation history stored client-side in `playlistStore` (max 20 conversations, 100 messages each)
- No connection to playback — analysis only

**Mix Page** (`/mix` route → `MixInterface.tsx`):
- Live DJ mode with queue management (max 10 tracks, target 5)
- Real-time playback monitoring via SSE delta protocol (1Hz polling, ~20 bytes/tick)
- AI suggestion engine using Claude with extended thinking
- Vibe controls (energy slider, BPM range, genre avoidance)
- Natural language vibe steering via `steer-stream.ts`
- Auto-fill queue on track completion (reactive, not proactive)
- Session stored in `MIX_SESSIONS` KV (8h TTL)

**Key problems:**
1. Chat and mix are separate apps that don't talk to each other
2. Queue fill is reactive (waits until queue < 5, then generates suggestions one-at-a-time)
3. No concept of a "set" — each suggestion is independent, no arc planning
4. Every suggestion requires a Claude API call (~5-10s latency, ~$0.01-0.03 cost)
5. No feedback loop — skips, partial listens, and replays are ignored
6. Spotify queue and DJ queue can drift out of sync
7. No session intelligence — fresh start every time

### Key files affected

| File | Lines | Role |
|------|-------|------|
| `packages/shared-types/src/schemas/mix-session-schemas.ts` | 280 | Mix domain types |
| `workers/api/src/routes/mix-openapi.ts` | 1220 | 14 mix API endpoints |
| `workers/api/src/services/SuggestionEngine.ts` | 629 | AI track generation |
| `workers/api/src/services/MixSessionService.ts` | 370 | Session CRUD + queue management |
| `workers/api/src/routes/chat-stream/index.ts` | 599 | Chat SSE endpoint |
| `workers/api/src/routes/steer-stream.ts` | 705 | Vibe steering SSE |
| `workers/api/src/routes/player-stream.ts` | 504 | Playback delta protocol |
| `apps/web/src/stores/mixStore.ts` | 525 | Mix session state |
| `apps/web/src/stores/playlistStore.ts` | 201 | Playlist/chat state |
| `apps/web/src/stores/playbackStore.ts` | 508 | Playback SSE state |
| `apps/web/src/stores/navigationStore.ts` | 75 | Routing (chat/mix/debug) |
| `apps/web/src/features/mix/MixInterface.tsx` | — | Mix page UI |
| `apps/web/src/features/chat/ChatInterface.tsx` | — | Chat page UI |
| `apps/web/src/App.tsx` | 100+ | Route switching |

## 4. Constraints and Guardrails

### From `dj-cloudflare-workers` pack:
- SSE streams via TransformStream with highWaterMark: 10
- Rate limit: 40 RPS global across all external APIs
- Subrequest budget: 950 per worker invocation
- KV storage with mandatory TTL on all writes
- All enrichment is best-effort and non-blocking

### From `dj-llm-tools` pack:
- Max 5 agentic turns per request
- Tool results under 5KB
- Extended thinking: 5000 token budget
- Anthropic concurrency: 2

### From `dj-spotify-integration` pack:
- 3-tier iterative data fetching (summary → compact → full)
- Never send full Spotify objects to Claude
- Session tokens in KV with 4h TTL
- Deprecated: Spotify `/audio-features` and `/recommendations` endpoints

### From `dj-react-patterns` pack:
- No useEffect for state synchronization
- Zustand stores with subscribeWithSelector
- CSS Modules for component styling

### From `dj-monorepo` pack:
- pnpm only; build order: types → contracts → client → web → worker
- Deployment via git push only (never manual deploy)

## 5. Proposed Change

### 5.1 Phase 1: Unified DJ Experience

**Goal:** Merge chat and mix into a single DJ page. One store, one experience.

#### 5.1.1 New `djStore` (replaces mixStore + playlistStore)

Create `apps/web/src/stores/djStore.ts`:

```typescript
interface DJState {
  // Session
  session: MixSession | null
  status: 'idle' | 'starting' | 'playing' | 'paused' | 'error'

  // Chat (moved from playlistStore)
  messages: ChatMessage[]
  isStreaming: boolean

  // Queue + suggestions (moved from mixStore)
  suggestions: Suggestion[]
  suggestionsLoading: boolean

  // Steering
  steerInProgress: boolean
  steerEvents: SteerStreamEvent[]

  // Feedback signals (NEW)
  signals: ListenerSignal[]
}

interface ListenerSignal {
  trackId: string
  type: 'completed' | 'skipped' | 'partial'
  listenDuration: number
  trackDuration: number
  timestamp: number
}
```

**Migration strategy:**
- Create `djStore.ts` incorporating state from both `mixStore` and `playlistStore`
- `playbackStore` remains separate (it's the SSE connection layer, not business logic)
- `navigationStore` simplified: remove `chat` route, `mix` becomes `/` (default)
- Old stores kept temporarily with deprecation warnings, removed after migration

#### 5.1.2 Unified DJ Page

Replace the two-page layout with a single DJ interface:

```
┌──────────────────────────────────────────────┐
│  [Playlist Selector]     [Vibe Controls]     │
├──────────────┬───────────────────────────────┤
│              │                               │
│  Now Playing │   Chat / Steering Panel       │
│  + Progress  │   (Natural language input)    │
│              │   (Streaming AI responses)    │
│              │   (Contextual to playback)    │
├──────────────┼───────────────────────────────┤
│              │                               │
│  Queue       │   Suggestions                 │
│  (Next 5)    │   (Swipeable cards)           │
│              │                               │
└──────────────┴───────────────────────────────┘
```

**Key changes:**
- `App.tsx`: Remove route switching; single `<DJInterface />` component
- `DJInterface.tsx`: Composition of NowPlaying, ChatPanel, QueuePanel, VibeControls, SuggestionsPanel
- Chat input always visible at bottom; responses stream inline
- Chat context includes current playback state (track, energy, vibe)
- Remove `ScopeDebugger` page from production routes

#### 5.1.3 Server-Side Conversation Context

Move conversation state to the server alongside the mix session:

**Schema addition** (`mix-session-schemas.ts`):
```typescript
const ConversationEntry = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
  toolCalls: z.array(z.string()).optional(), // tool names used
})

// Add to MixSession:
conversation: z.array(ConversationEntry).max(50).default([])
```

**API change** (`mix-openapi.ts`):
- New endpoint: `POST /api/mix/chat` — sends message in DJ context, returns SSE stream
- Replaces `POST /api/chat-stream/message` for DJ mode
- Automatically includes: current vibe, queue state, last 5 tracks played, listener signals
- No need to pass full conversation history from client (server has it in KV)

### 5.2 Phase 2: Set Planning Engine

**Goal:** Replace per-track AI suggestions with batch set planning.

#### 5.2.1 SetPlanner Service

Create `workers/api/src/services/SetPlanner.ts`:

```typescript
interface SetPlan {
  arc: ArcTemplate                    // energy curve over time
  tracks: PlannedTrack[]              // 15-20 pre-computed tracks
  currentPosition: number             // index in the plan
  generatedAt: number                 // timestamp
  expiresAt: number                   // refresh before this
}

interface ArcTemplate {
  name: string                        // "warm-up-peak-cooldown", "steady-cruise", "rollercoaster"
  phases: ArcPhase[]
  totalDurationMinutes: number
}

interface ArcPhase {
  name: string                        // "warm-up", "build", "peak", "cooldown"
  targetEnergy: number                // 0.0 - 1.0
  targetBpmRange: [number, number]
  durationMinutes: number
  genreHints: string[]
}

interface PlannedTrack {
  spotifyUri: string
  name: string
  artist: string
  bpm: number | null
  energy: number
  arcPhase: string                    // which phase this serves
  transitionScore: number             // 0-1, how well it flows from previous
  reason: string                      // why this track was chosen
}
```

**How it works:**
1. On session start: one Claude call generates a `SetPlan` with 15-20 tracks
   - Input: seed playlist vibe profile + enrichment data + user preferences
   - Output: `ArcTemplate` + ordered track list with transition scores
   - Cost: ~$0.03-0.05 per plan (one call vs 15 separate calls)
2. Queue draws from the plan sequentially, respecting arc position
3. When plan has < 5 tracks remaining: background extend with another batch call
4. On vibe steer: partial replan from current position forward

#### 5.2.2 Algorithmic Transition Scoring

Create `workers/api/src/services/TransitionScorer.ts`:

```typescript
interface TransitionScore {
  overall: number          // 0-1 composite
  bpmCompatibility: number // penalize >10 BPM jump
  energyFlow: number       // penalize >0.2 energy jump
  genreBridge: number      // bonus for shared tags
  artistDiversity: number  // penalize same artist within 5 tracks
  eraProximity: number     // bonus for similar decades
}

function scoreTransition(from: TrackProfile, to: TrackProfile, arcPhase: ArcPhase): TransitionScore
```

**This replaces AI for track ordering.** Claude picks the tracks; the algorithm orders them. Key rules:
- BPM within ±10 of previous track (weighted, not hard filter)
- Energy within ±0.15 of arc target for current phase
- No repeat artist within 5 tracks
- Genre overlap bonus from Last.fm tags
- Era proximity bonus (within same decade)

#### 5.2.3 Changes to Existing Code

**`SuggestionEngine.ts`** — Refactor to be called by SetPlanner:
- Extract the prompt building and Claude calling into reusable methods
- Add `generateBatch(session, count, arcContext)` method
- Keep `generateSuggestions()` as a thin wrapper for backward compat during migration

**`MixSessionService.ts`** — Add plan storage:
- `session.plan: SetPlan | null` field in KV
- `advancePlan()` — move position forward, check if refresh needed
- `replanFrom(position, newVibe)` — partial replan after steering

**`mix-openapi.ts`** — Modify auto-fill:
- `autoFillQueue()` draws from `session.plan.tracks` instead of calling SuggestionEngine directly
- Only calls SuggestionEngine/SetPlanner when plan is depleted
- Reduces AI calls from ~1 per track to ~1 per 15 tracks

### 5.3 Phase 3: Feedback & Adaptation

**Goal:** Make the DJ responsive to listener behavior.

#### 5.3.1 Signal Collection

**Playback store changes** (`playbackStore.ts`):
- Track `trackStartTime` when a new track begins
- On track change: calculate listen duration, emit signal

**Signal types:**
| Signal | Detection | Meaning |
|--------|-----------|---------|
| `completed` | Listen > 80% of duration | Strong positive |
| `skipped` | Listen < 30 seconds | Strong negative |
| `partial` | 30s < listen < 80% | Neutral/weak negative |
| `user-queued` | User manually adds track | Strong positive for that style |
| `steer` | User steers vibe | Current vibe wasn't matching |

**API endpoint:** `POST /api/mix/signal` — batch-submit signals
- Signals stored in session: `signals: ListenerSignal[]` (last 50)
- Processed into taste adjustments

#### 5.3.2 Taste Model

Add to `MixSession`:
```typescript
interface TasteModel {
  genreWeights: Record<string, number>   // tag → affinity (-1 to +1)
  energyPreference: number               // learned preferred energy
  bpmPreference: [number, number]        // learned BPM sweet spot
  artistAffinities: Record<string, number> // artist → affinity
  skipPatterns: string[]                  // genres/tags frequently skipped
  updatedAt: number
}
```

**Update logic:**
- On `completed`: boost genre/artist weights by +0.1
- On `skipped`: penalize genre/artist weights by -0.2 (skips are stronger signals)
- On `partial`: no change (ambiguous)
- Decay all weights by 0.95 every 10 tracks (recency bias)
- Feed taste model into SetPlanner for next batch generation

#### 5.3.3 Proactive Adaptation

When signals indicate drift from the plan:
- 3+ consecutive skips → trigger partial replan with steering context
- Energy slider moved → replan remaining tracks for new energy target
- Natural language steer → replan with new vibe constraints
- 10+ tracks without intervention → inject a "surprise" track (calculated gamble)

### 5.4 Phase 4: Playback Guarantee

**Goal:** Music never stops.

#### 5.4.1 Queue Depth Monitoring

**Changes to `player-stream.ts`:**
- New SSE event: `queue_low` — emitted when Spotify queue < 3 tracks
- Client-side handler: immediately trigger `autoFillQueue()` if plan has tracks available

**Changes to `mix-openapi.ts`:**
- `autoFillQueue()` always keeps Spotify queue at 5 tracks (not DJ queue)
- If plan is depleted AND SuggestionEngine is slow: push 3 "fallback" tracks
- Fallback tracks: highest-scored tracks from seed playlist that haven't been played

#### 5.4.2 Fallback Track Pool

On session start, pre-compute a pool of 10 fallback tracks:
- Top tracks from seed playlist by popularity
- Filtered against history (no repeats)
- Stored in session: `fallbackPool: string[]` (Spotify URIs)
- Used only when AI is unavailable or too slow

#### 5.4.3 Health Monitoring

Add to `MixSession`:
```typescript
interface SessionHealth {
  queueDepth: number
  planRemaining: number
  lastAICallMs: number
  consecutiveErrors: number
  fallbacksUsed: number
}
```

Emit `session_health` SSE event every 30 seconds when in DJ mode.

### 5.5 Files and Modules

#### New Files

| File | Purpose |
|------|---------|
| `workers/api/src/services/SetPlanner.ts` | Batch set planning with arc templates |
| `workers/api/src/services/TransitionScorer.ts` | Algorithmic transition scoring |
| `apps/web/src/stores/djStore.ts` | Unified DJ state (replaces mixStore + playlistStore) |
| `apps/web/src/features/dj/DJInterface.tsx` | Unified DJ page component |
| `apps/web/src/features/dj/ChatPanel.tsx` | Inline chat for DJ context |
| `apps/web/src/features/dj/ArcVisualizer.tsx` | Visual energy arc display |

#### Modified Files

| File | Changes |
|------|---------|
| `packages/shared-types/src/schemas/mix-session-schemas.ts` | Add SetPlan, TasteModel, ListenerSignal, SessionHealth, ConversationEntry |
| `workers/api/src/routes/mix-openapi.ts` | Add `/api/mix/chat`, `/api/mix/signal`; modify autoFillQueue to use SetPlanner |
| `workers/api/src/services/SuggestionEngine.ts` | Extract batch generation; add arc-aware prompting |
| `workers/api/src/services/MixSessionService.ts` | Add plan management, signal processing, taste model updates |
| `workers/api/src/routes/player-stream.ts` | Add `queue_low` and `session_health` events |
| `apps/web/src/stores/playbackStore.ts` | Add signal collection (track start time, listen duration) |
| `apps/web/src/App.tsx` | Remove route switching; single DJInterface |
| `apps/web/src/stores/navigationStore.ts` | Simplify or remove |

#### Deprecated/Removed Files

| File | Action |
|------|--------|
| `apps/web/src/stores/mixStore.ts` | Superseded by djStore |
| `apps/web/src/stores/playlistStore.ts` | Superseded by djStore |
| `apps/web/src/features/chat/ChatInterface.tsx` | Replaced by DJInterface + ChatPanel |
| `apps/web/src/features/debug/ScopeDebugger.tsx` | Remove from production |
| `apps/web/src/pages/` (if any separate pages) | Consolidated into DJInterface |

## 6. Acceptance Criteria

### Phase 1: Unified DJ Experience
- [ ] Single DJ page at `/` with NowPlaying, chat, queue, vibe controls, and suggestions
- [ ] `djStore` holds all state; `mixStore` and `playlistStore` removed
- [ ] Chat messages sent via `POST /api/mix/chat` with server-side conversation context
- [ ] Chat automatically includes current playback state and vibe in system prompt
- [ ] Conversation history stored in KV alongside mix session
- [ ] Playlist selector and "surprise me" option on the DJ page
- [ ] All existing mix features work: queue reorder, vibe steering, auto-fill, playback controls

### Phase 2: Set Planning Engine
- [ ] `SetPlanner` generates 15-20 track plans in a single Claude call
- [ ] 3 arc templates available: warm-up-peak-cooldown, steady-cruise, rollercoaster
- [ ] `TransitionScorer` orders tracks by BPM/energy/genre/artist compatibility
- [ ] `autoFillQueue()` draws from plan instead of calling SuggestionEngine per-track
- [ ] Plan auto-extends when < 5 tracks remaining
- [ ] Vibe steer triggers partial replan from current position
- [ ] AI calls reduced from ~1 per track to ~1 per 15 tracks

### Phase 3: Feedback & Adaptation
- [ ] Skip detection: track change before 80% listen duration → `skipped` signal
- [ ] Full listen: track change after 80% → `completed` signal
- [ ] Taste model updates on every signal (genre/artist weights)
- [ ] 3+ consecutive skips triggers automatic partial replan
- [ ] Taste model feeds into next SetPlanner batch

### Phase 4: Playback Guarantee
- [ ] Fallback pool of 10 tracks pre-computed on session start
- [ ] `queue_low` SSE event when Spotify queue < 3 tracks
- [ ] Fallback tracks pushed if AI is unavailable within 5 seconds
- [ ] Music does not stop during a 1-hour unattended session
- [ ] `session_health` event every 30 seconds reports queue depth, plan remaining, AI latency

## 7. Verification Plan

```bash
# Type safety across all packages
pnpm typecheck

# Lint for code quality and security
pnpm lint

# Unit tests (new services + modified stores)
pnpm test

# Build entire workspace (respects dependency order)
pnpm build

# Contract tests (API schema validation)
pnpm test:contracts

# Manual verification
# 1. Start session with seed playlist → verify 15-20 track plan generated
# 2. Let play for 10 minutes unattended → verify no interruptions
# 3. Skip 3 tracks → verify automatic replan
# 4. Steer vibe via chat → verify plan adjusts
# 5. Check AI call count → should be <5 for a 30-minute session
```

## 8. Rollback Plan

Each phase is independently deployable and reversible:

- **Phase 1:** Feature flag `UNIFIED_DJ=true` in wrangler.jsonc vars. When false, old routes and stores remain active.
- **Phase 2:** SetPlanner is additive. If disabled, `autoFillQueue()` falls back to existing SuggestionEngine (per-track mode).
- **Phase 3:** Signal collection is a new field on MixSession. If signals are empty, TasteModel is not updated and behavior is identical to pre-Phase 3.
- **Phase 4:** Fallback pool and queue monitoring are additive safety nets. Removing them returns to current behavior (no fallbacks, reactive fill only).

Git revert any phase independently:
```bash
git revert <phase-commit-range>
git push  # automatic deployment via GitHub Actions
```

## 9. Notes for MARVEL Runner

- **Risk level:** medium (Phase 1 is a significant UI restructure; Phases 2-4 are additive backend changes)
- **Implementation order:** Phase 1 → Phase 2 → Phase 4 → Phase 3 (playback guarantee before feedback, since guarantee is simpler and higher impact)
- **Critical invariant:** Music must never stop. Every code path that modifies the queue must verify Spotify queue depth afterward.
- **Cost target:** < 5 Claude API calls per 30-minute session (vs current ~15-30)
- **Latency target:** < 10 seconds from session start to first track playing
- **Testing focus:** Phase 2 (SetPlanner) and Phase 4 (fallback) need extensive unit tests. Phase 1 is mostly UI wiring. Phase 3 is signal processing (pure functions, easy to test).
- **Pack guardrails that apply most:** `dj-llm-tools` (agentic loop limits, tool result size), `dj-cloudflare-workers` (SSE streaming, KV patterns, rate limits), `dj-spotify-integration` (queue sync, token handling)
- **Do not touch:** `AudioEnrichmentService.ts`, `LastFmService.ts`, `RateLimitedQueue.ts` — these work well and are not part of this spec
- **MCP documentation in CLAUDE.md:** Remove or mark as "not implemented" — no MCP code exists in the codebase
