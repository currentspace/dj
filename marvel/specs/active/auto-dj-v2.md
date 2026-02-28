# Auto DJ: Make the Music Never Stop

**Owner:** team
**Status:** Active
**Created:** 2026-02-27

**Packs Required:**
- pack:dj-cloudflare-workers@1.0.0
- pack:dj-spotify-integration@1.0.0
- pack:dj-llm-tools@1.0.0
- pack:dj-monorepo@1.0.0
- pack:code-quality@1.0.0
- pack:testing@1.0.0

---

## 1. Goal

Make the DJ app autonomously keep music playing with smooth transitions, starting from the user's chosen playlist, without requiring frontend cooperation for queue health. The user should be able to start a session, close their laptop, and come back to music still flowing.

## 2. Non-Goals

- Unified UI (chat + mix merge) — separate effort, not required for auto DJ behavior
- Arc templates / visual arc selector — future enhancement
- Cross-session taste profiles — future enhancement
- MCP integration — not implemented, not needed

## 3. Current State (Code-Verified)

### What works
- 45 endpoints, all fully implemented and deployed
- Player-stream SSE delta protocol: 1Hz polling, ~20-byte ticks, track change detection
- SuggestionEngine: Claude Sonnet 4.6 generates track names → Spotify search resolves URIs
- autoFillQueue(): refills to 5 tracks, queues to both KV and Spotify
- Vibe steering: 14 presets + Claude Haiku interpretation
- Enrichment pipeline: Deezer BPM (90-day cache), Last.fm tags (7-day cache), MusicBrainz ISRC fallback

### What's broken (with evidence)

**1. autoFillQueue is always `await`ed — never background**
- `mix-openapi.ts:339`: `await autoFillQueue(c.env, token, session, sessionService)` in start handler
- `mix-openapi.ts:1085`: `await autoFillQueue(...)` in track-played handler
- Every request hangs 8-15s while Claude thinks + Spotify searches per track

**2. No server-side track completion detection**
- `player-stream.ts:326-331`: sends `track` SSE event when trackChanged() is true, but does nothing else
- `NowPlaying.tsx:76-99`: frontend must call `mixApiClient.notifyTrackPlayed()` — if tab is closed, queue stops refilling

**3. seedPlaylistId is accepted but ignored**
- `mix-openapi.ts:315`: `// Note: seedPlaylistId will be used in future versions`
- Session starts with default vibe (energy 5, BPM 80-140, no genres, no mood)
- SuggestionEngine has no context about what music the user actually likes

**4. TransitionScorer exists but is not wired in**
- `TransitionScorer.ts`: 33 passing tests, full BPM/energy/genre/artist/era scoring
- `SuggestionEngine.ts:189`: still uses basic `scoreTransition()` method that only checks BPM diff
- Track ordering in autoFillQueue is insertion-order, not transition-optimized

**5. Spotify queue drift — no reconciliation**
- `mix-openapi.ts:266-280`: Spotify queue add is fire-and-forget in try/catch
- `player-stream.ts`: never checks Spotify queue depth
- If user skips via Spotify app, DJ backend doesn't know

**6. MixSession placeholder fields are never written**
- `conversation: []` — initialized, never populated by any code path
- `signals: []` — initialized, never populated
- `plan: null` — initialized, never populated
- `tasteModel: null` — initialized, never populated
- `fallbackPool: []` — initialized, never populated
- No endpoint exists for `/api/mix/signal` (not registered in index.ts)

## 4. Constraints

- Cloudflare Workers: 950 subrequest budget per invocation, `waitUntil()` for background work
- Anthropic: 2 concurrent connections, Sonnet 4.6 ~5-10s per call with thinking
- Spotify queue API: unreliable across device types, no guarantee of delivery
- KV: eventually consistent, no atomic read-modify-write
- Player-stream: max 5-minute lifetime, reconnects automatically

## 5. Proposed Changes

### Phase 1: Server-Side DJ Brain

**The player-stream becomes the source of truth for track transitions.**

#### 1a. Player-stream triggers track-played server-side

**File:** `workers/api/src/routes/player-stream.ts`

**Change:** When `trackChanged()` detects a new track AND a mix session exists for this user, the player-stream handler directly processes the track transition instead of relying on the frontend.

In the `sendDeltas()` function (line ~326), after sending the `track` SSE event:

```typescript
// After sending track event to client
if (trackChanged(prev.track, curr.track) && prev.track) {
  // Server-side track transition processing
  ctx.waitUntil(handleTrackTransition(env, token, userId, prev.track, curr.track))
}
```

New function `handleTrackTransition()`:
1. Get session from `MIX_SESSIONS` KV
2. If no session, skip (user isn't in DJ mode)
3. Find previous track in queue, move to history
4. Enrich with BPM from Deezer (if AUDIO_FEATURES_CACHE available)
5. Update vibe via `sessionService.updateVibeFromTrack()`
6. Calculate listen duration: `trackStartTime` to `now` (tracked in poll loop state)
7. Classify signal: completed (>80% duration) / skipped (<30s) / partial
8. Store signal in `session.signals` (append, max 50)
9. If queue.length < 5: trigger background autoFillQueue via `waitUntil()`
10. Save session to KV

**New state in poll loop:** Track `trackStartTimestamp` — set when `track` event is sent, used to calculate listen duration on next track change.

**The frontend `notifyTrackPlayed()` call becomes redundant** but is kept for backward compatibility. The server-side handler checks if the track was already processed (by checking if it's still in queue) to avoid double-processing.

#### 1b. Background autoFillQueue with waitUntil

**File:** `workers/api/src/routes/mix-openapi.ts`

**Change:** Split autoFillQueue into two modes:
- **Blocking mode** (existing): Used only on session start where user expects to see tracks
- **Background mode** (new): Used for all other refills — returns immediately, processes via `waitUntil()`

```typescript
async function autoFillQueueBackground(
  ctx: ExecutionContext,
  env: Env,
  token: string,
  userId: string,
): Promise<void> {
  ctx.waitUntil((async () => {
    const sessionService = new MixSessionService(env.MIX_SESSIONS)
    const session = await sessionService.getSession(userId)
    if (!session) return
    if (session.queue.length >= TARGET_QUEUE_SIZE) return
    await autoFillQueue(env, token, session, sessionService)
  })())
}
```

**Update callers:**
- `track-played` handler (line 1085): change from `await autoFillQueue(...)` to `autoFillQueueBackground(c.executionCtx, ...)`
- `getCurrentMix` handler (line 375-384): same change
- `preferences` handler (line 1202): same change
- `start` handler (line 339): KEEP blocking (user needs to see initial tracks)

#### 1c. Emit queue_low event from player-stream

**File:** `workers/api/src/routes/player-stream.ts`

**Change:** Every 10th poll iteration (every 10 seconds), fetch the session from KV and check queue depth. If queue < 3 tracks, emit `queue_low` SSE event AND trigger background refill.

```typescript
// Every 10 polls (~10 seconds)
if (pollCount % 10 === 0 && env.MIX_SESSIONS) {
  const session = await sessionService.getSession(userId)
  if (session && session.queue.length < 3) {
    writeSSE(writer, 'queue_low', { depth: session.queue.length, seq: seq++ })
    ctx.waitUntil(autoFillQueueBackground(ctx, env, token, userId))
  }
}
```

This is the "belt and suspenders" — even if the track-played handler failed, the periodic check catches it.

### Phase 2: Seed Playlist Wiring

**Make the starting music come from what the user actually listens to.**

#### 2a. Wire seedPlaylistId in start handler

**File:** `workers/api/src/routes/mix-openapi.ts`

**Change:** When `seedPlaylistId` is provided in `POST /api/mix/start`:

1. Fetch playlist tracks from Spotify (limit 50, use existing playlist-tools fetch logic)
2. Extract quick vibe: top genres from artist data, average popularity, BPM range from Deezer cache
3. Set session.vibe from extracted data instead of defaults
4. Store top 10 tracks by popularity (filtered for availability) in `session.fallbackPool`
5. Pass seed context to SuggestionEngine for initial fill

New helper function:
```typescript
async function extractQuickVibe(
  token: string,
  playlistId: string,
  env: Env,
): Promise<{ vibe: Partial<VibeProfile>, fallbackPool: string[] }>
```

This uses ONLY cached enrichment data (no new Deezer/Last.fm API calls on session start). If cache is cold, uses Spotify-only data (genres from artists, popularity).

#### 2b. "Surprise me" from user's top tracks

**File:** `workers/api/src/routes/mix-openapi.ts`

**Change:** When `POST /api/mix/start` has NO seedPlaylistId:

1. Fetch `GET https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=50`
2. Fetch `GET https://api.spotify.com/v1/me/player/recently-played?limit=50`
3. Merge, deduplicate, extract vibe same as 2a
4. Store top 10 as fallback pool
5. Set session vibe from user's actual taste

#### 2c. Pass seed context to SuggestionEngine

**File:** `workers/api/src/services/SuggestionEngine.ts`

**Change:** Add optional `seedTracks` parameter to `generateSuggestions()`:

```typescript
async generateSuggestions(
  session: MixSession,
  count: number,
  seedTracks?: Array<{name: string, artist: string, genres: string[]}>
): Promise<Suggestion[]>
```

When seedTracks are provided and history is empty, include them in the AI prompt:
```
"The user's playlist contains tracks like: [seed tracks]. Suggest tracks that would flow well with this collection."
```

This replaces the current cold-start where AI has only the default vibe (energy 5, no genres).

### Phase 3: Better Suggestions

**Wire the TransitionScorer, batch-generate tracks, and guarantee fallbacks.**

#### 3a. Wire TransitionScorer into SuggestionEngine

**File:** `workers/api/src/services/SuggestionEngine.ts`

**Change:** Replace the basic `scoreTransition()` method (lines ~350-360) with the real TransitionScorer:

```typescript
import { scoreBpmCompatibility, scoreEnergyFlow, scoreGenreBridge } from './TransitionScorer'
```

In `generateContextAwareSuggestions()` (line 189), replace:
```typescript
const transitionScore = lastTrack ? this.scoreTransition(lastTrack, { bpm: enrichment.bpm, energy: null }) : 50
```
With:
```typescript
const bpmScore = lastTrack ? scoreBpmCompatibility(lastTrack.bpm, enrichment.bpm) : 0.5
const energyScore = scoreEnergyFlow(enrichment.energy ?? 0.5, session.vibe.energyLevel / 10)
const transitionScore = Math.round((bpmScore * 0.6 + energyScore * 0.4) * 100)
```

Also add `orderByTransition()` call after generating all suggestions to reorder them for optimal flow before returning.

#### 3b. Batch planning — one Claude call for more tracks

**File:** `workers/api/src/services/SuggestionEngine.ts`

**Change:** When `count > 5`, ask Claude for all tracks in a single call instead of one call per refill:

Current: `generateSuggestions(session, 8)` → 1 Claude call → 8 track names → 8 Spotify searches
New: Same, but cache the plan. When `generateSuggestions()` is called again and the vibe hasn't changed, return from cache instead of calling Claude again.

Add to SuggestionEngine:
```typescript
private cachedPlan: { vibeHash: string, suggestions: Suggestion[], usedCount: number } | null = null
```

On each call: compute `vibeHash = JSON.stringify(session.vibe)`. If matches cache and cache has unused suggestions, return from cache. Otherwise generate fresh.

This reduces Claude API calls from ~1 per refill to ~1 per vibe change.

#### 3c. Fallback pool usage

**File:** `workers/api/src/routes/mix-openapi.ts`

**Change:** In `autoFillQueue()`, after the try/catch that calls SuggestionEngine:

```typescript
// If AI failed or returned no tracks, use fallback pool
if (addedCount === 0 && session.fallbackPool.length > 0) {
  const fallbackUri = session.fallbackPool.shift()!  // pop first
  // Fetch track details from Spotify
  const trackDetails = await fetchTrackDetails(token, fallbackUri)
  if (trackDetails) {
    const queuedTrack = createQueuedTrack(trackDetails, 'ai', 50, 'Fallback from seed playlist')
    sessionService.addToQueue(session, queuedTrack)
    // Queue to Spotify
    await queueToSpotify(token, fallbackUri)
    addedCount = 1
  }
  await sessionService.updateSession(session)
}
```

Also add a timeout wrapper around the SuggestionEngine call:
```typescript
const suggestions = await Promise.race([
  suggestionEngine.generateSuggestions(session, tracksNeeded + 3),
  new Promise<Suggestion[]>(resolve => setTimeout(() => resolve([]), 8000))  // 8s timeout
])
```

If Claude takes longer than 8 seconds, fall back to the seed playlist tracks.

### Phase 4: Skip Detection & Adaptation

**Detect listening behavior and adapt the mix in real-time.**

#### 4a. Signal collection in player-stream

Already handled by Phase 1a — `handleTrackTransition()` classifies signals and stores them in `session.signals`.

Signal classification:
```typescript
function classifySignal(listenDurationMs: number, trackDurationMs: number): 'completed' | 'skipped' | 'partial' {
  const ratio = listenDurationMs / trackDurationMs
  if (ratio >= 0.8) return 'completed'
  if (listenDurationMs < 30000) return 'skipped'
  return 'partial'
}
```

#### 4b. Taste model updates

**File:** `workers/api/src/services/MixSessionService.ts`

New method:
```typescript
updateTasteFromSignal(session: MixSession, signal: ListenerSignal, trackTags: string[], trackArtist: string): void {
  if (!session.tasteModel) {
    session.tasteModel = { genreWeights: {}, energyPreference: 0.5, bpmPreference: [80, 140], artistAffinities: {}, skipPatterns: [], updatedAt: Date.now() }
  }

  const weight = signal.type === 'completed' ? 0.1 : signal.type === 'skipped' ? -0.2 : 0
  if (weight === 0) return

  // Update genre weights
  for (const tag of trackTags) {
    const current = session.tasteModel.genreWeights[tag] ?? 0
    session.tasteModel.genreWeights[tag] = Math.max(-1, Math.min(1, current + weight))
  }

  // Update artist affinity
  const currentAffinity = session.tasteModel.artistAffinities[trackArtist] ?? 0
  session.tasteModel.artistAffinities[trackArtist] = Math.max(-1, Math.min(1, currentAffinity + weight))

  session.tasteModel.updatedAt = Date.now()
}
```

Called from `handleTrackTransition()` in player-stream after classifying the signal.

#### 4c. Auto-replan on consecutive skips

**File:** `workers/api/src/routes/player-stream.ts`

In `handleTrackTransition()`, after updating taste model:

```typescript
// Count recent consecutive skips
const recentSignals = session.signals.slice(-5)
const consecutiveSkips = recentSignals.reduceRight((count, s) => {
  if (s.type === 'skipped') return count + 1
  return -1  // break
}, 0)

if (consecutiveSkips >= 3) {
  // Clear queue and refill with taste-aware suggestions
  session.queue = []
  ctx.waitUntil(autoFillQueueBackground(ctx, env, token, userId))
}
```

#### 4d. Feed taste model into SuggestionEngine

**File:** `workers/api/src/services/SuggestionEngine.ts`

When building the AI prompt, include taste signals:

```typescript
if (session.tasteModel) {
  const likedGenres = Object.entries(session.tasteModel.genreWeights)
    .filter(([_, w]) => w > 0.2).map(([g]) => g)
  const dislikedGenres = Object.entries(session.tasteModel.genreWeights)
    .filter(([_, w]) => w < -0.2).map(([g]) => g)

  if (likedGenres.length > 0) prompt += `\nThe listener has been enjoying: ${likedGenres.join(', ')}`
  if (dislikedGenres.length > 0) prompt += `\nAvoid tracks with these vibes: ${dislikedGenres.join(', ')}`
}
```

This is a lightweight change — just appending to the existing prompt, no new AI calls.

## 6. Files Changed

### New Files
None — all changes are to existing files.

### Modified Files

| File | Change | Complexity |
|------|--------|------------|
| `workers/api/src/routes/player-stream.ts` | Add handleTrackTransition(), queue_low monitoring, trackStartTimestamp | High |
| `workers/api/src/routes/mix-openapi.ts` | Wire seedPlaylistId, add extractQuickVibe(), autoFillQueueBackground(), fallback pool usage, timeout wrapper | High |
| `workers/api/src/services/SuggestionEngine.ts` | Wire TransitionScorer, add seedTracks param, add suggestion caching, add taste model context to prompt | Medium |
| `workers/api/src/services/MixSessionService.ts` | Add updateTasteFromSignal() | Low |
| `workers/api/src/lib/ai-prompts.ts` | Update prompts for seed context and taste signals | Low |

### Files NOT Changed
- `TransitionScorer.ts` — already built and tested
- All frontend files — changes are backend-only
- Enrichment services — work fine as-is
- Schema files — already have all needed fields from previous commit

## 7. Acceptance Criteria

### Phase 1: Server-Side DJ Brain
- [ ] Player-stream processes track transitions without frontend cooperation
- [ ] Closing the browser tab does NOT stop queue refilling (server handles it)
- [ ] `queue_low` event emitted when queue drops below 3
- [ ] autoFillQueue runs in background via `waitUntil()` for non-start endpoints
- [ ] `POST /api/mix/start` still blocks (user sees tracks immediately)
- [ ] No double-processing when both frontend and server detect same track change

### Phase 2: Seed Playlist Wiring
- [ ] `seedPlaylistId` is read and used to set initial vibe (genres, energy, BPM range)
- [ ] `fallbackPool` populated with top 10 seed playlist tracks
- [ ] Without seedPlaylistId: vibe extracted from user's top tracks + recent plays
- [ ] Initial suggestions reflect seed playlist style, not default vibe

### Phase 3: Better Suggestions
- [ ] TransitionScorer used for suggestion ordering (BPM + energy)
- [ ] Suggestion cache prevents redundant Claude calls when vibe unchanged
- [ ] 8-second timeout on Claude → fallback pool used if slow
- [ ] Fallback tracks actually queued when AI fails
- [ ] Music does not stop during a 30-minute unattended session

### Phase 4: Skip Detection
- [ ] `session.signals` populated with completed/skipped/partial for each track
- [ ] `session.tasteModel` weights updated on each signal
- [ ] 3 consecutive skips triggers queue clear + refill
- [ ] Liked genres appear in suggestion prompts; disliked genres avoided
- [ ] Skip 3 hip-hop tracks → next suggestions shift away from hip-hop

## 8. Verification Plan

```bash
pnpm typecheck
pnpm test --run
pnpm build
```

Manual tests:
1. Start session with seed playlist → verify vibe matches playlist style
2. Start session without seed → verify vibe from user's top tracks
3. Play 3 tracks → close browser tab → reopen after 5 minutes → queue should be full
4. Skip 3 tracks rapidly → verify queue rebuilds with different style
5. Let session run 30 minutes unattended → music should never stop
6. Disconnect internet briefly → reconnect → verify queue refills

## 9. Rollback Plan

Each phase is independently revertable:
- **Phase 1:** `handleTrackTransition()` has an early-return guard for missing session. Remove the call in `sendDeltas()` to revert.
- **Phase 2:** `extractQuickVibe()` returns default vibe on any error. Remove the call to revert to default vibe.
- **Phase 3:** TransitionScorer import can be replaced with the original `scoreTransition()` method. Cache has TTL, clears naturally.
- **Phase 4:** Taste model is a nullable field. Setting to `null` disables all adaptation.

## 10. Notes for MARVEL Runner

- **Risk level:** medium (Phase 1 changes the player-stream which is the real-time backbone)
- **Implementation order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 (each builds on previous)
- **Critical invariant:** player-stream must not crash or slow down. All new work in handleTrackTransition must be in `waitUntil()` — never block the poll loop.
- **KV race condition:** Two concurrent handleTrackTransition calls could both read stale session. Mitigate by checking if track is still in queue before processing.
- **Testing priority:** Phase 1 (player-stream changes) needs the most careful testing. Phase 4 (taste model) is pure functions, easy to test.
- **Cost impact:** Phase 3b (suggestion caching) reduces Claude calls from ~1 per refill to ~1 per vibe change. Estimated savings: 80% reduction in API costs.
- **Do not touch:** `AudioEnrichmentService.ts`, `LastFmService.ts`, `RateLimitedQueue.ts`, `RequestOrchestrator.ts` — these work correctly.
