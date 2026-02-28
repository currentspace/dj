# Opus 4.6 DJ Brain: Strategic Reasoning for Autonomous Music Curation

**Owner:** team
**Status:** Active
**Created:** 2026-02-28

**Packs Required:**
- pack:dj-llm-tools@1.0.0
- pack:dj-experience@1.0.0
- pack:dj-set-planning@1.0.0
- pack:dj-cloudflare-workers@1.0.0
- pack:dj-spotify-integration@1.0.0
- pack:code-quality@1.0.0
- pack:testing@1.0.0

---

## 1. Goal

Use Claude Opus 4.6 as the strategic DJ brain that plans coherent sets, reasons about listener behavior, and makes autonomous guiding decisions — elevating the app from "chatbot with Spotify access" to a real automated DJ with musical intelligence and personality.

The DJ should autonomously plan energy arcs, reason about why tracks were skipped (not just that they were), inject deliberate contrast to maintain engagement, and narrate its decisions with opinionated musical knowledge.

## 2. Non-Goals

- Replacing Sonnet for tool execution or search operations (Sonnet remains the "hands")
- Audio DSP, crossfade control, or beatmatching (Spotify handles playback)
- Training or fine-tuning models on music data
- Real-time audio analysis or waveform processing
- Harmonic key matching (Spotify deprecated audio-features; Deezer doesn't reliably return key data)

## 3. Research Findings (Code-Verified + External)

### Why Opus 4.6 Specifically

Benchmark data (Anthropic, DataCamp, Vellum - Feb 2026):

| Capability | Opus 4.6 | Sonnet 4.6 | Why It Matters |
|-----------|----------|------------|----------------|
| Abstract reasoning (ARC-AGI-2) | 68.8% | ~13.6% | Vibe matching is abstract multi-dimensional reasoning |
| Tool use reliability (tau2-bench) | 91.9% | ~82% (est.) | Multi-step agentic loops need reliable tool calling |
| 1M context accuracy (MRCR v2, 8-needle) | 76.0% | 18.5% | Full session context (history, taste, signals) must be retained |
| Long-form reasoning | Extended thinking with adaptive effort | Basic thinking | Set planning requires deep strategic reasoning |

The 5x abstract reasoning advantage is the differentiator. Music curation requires synthesizing mood, energy, era, production aesthetic, and cultural context simultaneously — exactly the kind of multi-dimensional abstract reasoning where Opus excels.

### What Real DJs Do (DJ.Studio, Mixed In Key, DJ TechTools)

Professional DJ sets follow a five-phase energy structure:
1. **Warm-up** (15-20%): Low-medium energy, spacious tracks, long blends. Energy 3-5.
2. **Build** (20-25%): Stronger drums, gradual intensity increase. Energy 5-7.
3. **Peak** (20-25%): Anthems, shorter switches. Peak hits ~2/3 through the set. Energy 7-9.
4. **Release** (15-20%): Melodic/vocal tracks, let the audience breathe. Energy 5-7.
5. **Finale** (10-15%): Extended outros, memorable closer. Energy 4-6.

Critical principle: **Contrast holds attention, not sustained intensity.** The "serpentine" pattern — wave-like energy fluctuations within phases — prevents fatigue. Playing Energy 9 constantly is worse than alternating 6-8-9-7-9.

Source: [DJ.Studio Blog](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic), [Mixed In Key](https://mixedinkey.com/book/control-the-energy-level-of-your-dj-sets/)

### What Spotify's DJ Gets Wrong (User Research)

Analysis of 1400+ user comments (SAGE journals, 2025):
- **34% negative sentiment outweighs 26% positive**
- **#1 complaint: Repetition / echo chamber** — the DJ keeps serving the same saved music
- **#2 complaint: Failure to learn** — skipping doesn't teach it
- **#3 complaint: Hollow commentary** — narration feels generic, not insightful

The personalization paradox (ACM RecSys 2025): Algorithm-driven listening reduces consumption diversity. Users need explicit agency ("more of this, less of that"), not just implicit signals.

Source: [Managing the personalization paradox](https://journals.sagepub.com/doi/10.1177/20438869251395753), [Ohio University study](https://www.ohio.edu/news/2026/02/convenient-personalization-or-death-organic-discovery-streaming-algorithms-have)

### What PulseDJ Proves

PulseDJ recommends next tracks based on data from **1.8 million real DJ sets** — what actual DJs play in sequence. This outperforms pure audio analysis for sequencing because real DJ choices encode musical knowledge that audio features miss (cultural context, crowd response patterns, genre narrative conventions).

Our system's Last.fm similar tracks data serves a comparable role — it captures what listeners and DJs actually pair together, not just what sounds similar by BPM/key.

Source: [PulseDJ](https://blog.pulsedj.com/ai-dj-software)

### Spotify Smart Reorder (Feb 2026)

Spotify just launched Smart Reorder: automatic playlist reorganization by BPM, key, and energy to create DJ-set-like flow. This validates that energy-arc-based reordering is a mainstream, understood UX pattern. Our system can go further by adding AI reasoning about WHY tracks should be ordered a certain way.

Source: [Spotify Newsroom](https://newsroom.spotify.com/2026-02-25/smart-reorder-playlist-mixing/)

## 4. Current State (Code-Verified)

### Model Usage Today

**File:** `workers/api/src/constants.ts` (lines 97-112)

```typescript
MODEL: 'claude-sonnet-4-6-20260219',       // ALL conversation + tool-internal AI calls
MODEL_HAIKU: 'claude-haiku-4-5-20251001',  // Progress narrator + vibe steering fallback
```

No Opus model is configured. Every AI decision — from initial conversation to vibe extraction to curation — uses the same Sonnet model.

### AI Decision Points Today

| Decision | Model | File | Quality Issue |
|----------|-------|------|--------------|
| Initial conversation response | Sonnet + thinking (5000 tokens) | `chat-stream/index.ts:322` | Good for simple responses, insufficient for strategic set planning |
| Follow-up agentic turns | Sonnet, NO thinking, temp 0.7 | `agentic-loop.ts:174-187` | Complex tool-calling turns get no deep reasoning |
| Vibe extraction (inner tool call) | Sonnet, NO thinking | `discovery-tools.ts:68` | The most judgment-intensive operation gets no extended thinking |
| Discovery strategy planning | Sonnet, NO thinking | `discovery-tools.ts:270` | Creative strategy needs reasoning; doesn't get it |
| Curation ranking | Sonnet, NO thinking | `discovery-tools.ts:402` | Subjective quality judgment with no reasoning |
| Track suggestions (mix mode) | Sonnet, optional thinking (2000 tokens) | `SuggestionEngine.ts:114` | Reasonable but not strategic |
| Vibe steering interpretation | Haiku OR Sonnet + thinking (4000 tokens) | `steer-stream.ts:468` | Appropriate for quick reactions |
| Progress narration | Haiku | `progress-narrator.ts` | Fine for flavor text |

### What's Missing

1. **No set planning**: The system picks tracks one-at-a-time or in small batches. There is no concept of "plan the next 30 minutes as a coherent arc."

2. **No skip reasoning**: `player-stream.ts` classifies skips as `skipped` (boolean) but never asks WHY. The taste model updates genre weights uniformly — a skip subtracts 0.2 from every tag on the track, even if only one aspect was wrong.

3. **No contrast/diversity mechanism**: `curate_recommendations` and `SuggestionEngine` optimize for vibe FIT but not for variety or tension-release. This causes the echo chamber effect that users hate.

4. **No session narrative**: The DJ has no memory of what it said, why it made choices, or how the session arc has progressed. Each suggestion call starts fresh with only the vibe profile and recent history.

5. **No autonomous personality**: The current prompts are functional ("suggest N tracks matching this vibe") but not opinionated. A real DJ has taste, surprises, and reasoning that goes beyond matching parameters.

## 5. Proposed Changes

### 5.1 Three-Tier Model Architecture

Route AI decisions to the appropriate model based on reasoning depth required:

| Tier | Model | Use Cases | Cost per call |
|------|-------|-----------|---------------|
| **Strategic** | Opus 4.6 | Set planning, skip reasoning, narration, vibe strategy | ~$0.03-0.10 |
| **Execution** | Sonnet 4.6 | Tool calling, search, track filtering, basic decisions | ~$0.005-0.02 |
| **Reactive** | Haiku 4.5 | Progress messages, simple acknowledgments, preset matching | ~$0.0005 |

**Estimated session cost**: A 1-hour DJ session would use:
- 2-3 Opus calls (initial plan + 1-2 replans) = ~$0.15-0.30
- 10-15 Sonnet calls (track search/curation) = ~$0.10-0.30
- 20-30 Haiku calls (progress, quick narration) = ~$0.01-0.02
- **Total: ~$0.26-0.62/hour** (vs current ~$0.15-0.40/hour with Sonnet-only)

The cost increase is modest (~60-70%) because Opus is used sparingly for high-judgment calls only.

### 5.2 Set Plan Generation (Opus)

When a DJ session starts, Opus generates a **set plan** — a high-level strategy for the next 20-30 minutes.

**File:** `workers/api/src/lib/set-planner.ts` (new)

```typescript
interface SetPlan {
  /** The overall narrative for this set */
  narrative: string
  /** Planned energy arc as phase targets */
  phases: SetPhase[]
  /** Genre clusters to traverse */
  genreClusters: GenreCluster[]
  /** Tracks/styles to deliberately avoid */
  avoidList: string[]
  /** When to inject surprise/contrast tracks */
  surprisePoints: number[]
  /** Timestamp of plan creation */
  createdAt: number
  /** Number of tracks planned for */
  targetTrackCount: number
}

interface SetPhase {
  /** Phase name: warm_up, build, peak, release, finale */
  phase: 'warm_up' | 'build' | 'peak' | 'release' | 'finale'
  /** Target energy level (1-10) */
  targetEnergy: number
  /** Target BPM range */
  bpmRange: { min: number; max: number }
  /** Genre focus for this phase */
  genres: string[]
  /** Approximate number of tracks in this phase */
  trackCount: number
  /** Strategy note for track selection */
  strategy: string
}

interface GenreCluster {
  /** Primary genre/mood */
  primary: string
  /** Compatible genres for transitions */
  bridges: string[]
  /** How many tracks in this cluster */
  trackCount: number
}
```

**Prompt strategy**: The Opus call receives:
- Seed playlist analysis (if available) or user's top tracks
- User's taste model (genre weights, skip patterns)
- Session duration target (default 45 minutes, ~12-15 tracks)
- Current time of day (for contextual energy — evening sessions start lower)

Opus returns a structured set plan with explicit reasoning about WHY each phase has the targets it does.

**When to replan**: A new plan is generated when:
- Session starts (always)
- 3+ consecutive skips (the current direction is wrong)
- User sends a major vibe steer ("completely change the mood")
- Set plan is >80% consumed (need to plan the next arc)

### 5.3 Skip Reasoning (Opus)

Replace the blunt "skip → subtract genre weight" heuristic with Opus-powered reasoning about WHY tracks were skipped.

**File:** `workers/api/src/lib/skip-analyzer.ts` (new)

When 2+ tracks are skipped in a short window (< 5 minutes), batch-analyze the skipped tracks:

```typescript
interface SkipAnalysis {
  /** What the skipped tracks had in common */
  commonFactors: string[]
  /** What aspect was likely wrong (energy, genre, era, artist, production style) */
  likelyIssue: 'energy' | 'genre' | 'era' | 'artist' | 'tempo' | 'production' | 'unknown'
  /** Specific adjustment recommendation */
  adjustment: string
  /** Updated avoid list additions */
  newAvoidItems: string[]
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low'
}
```

**Prompt strategy**: Opus receives the skipped tracks (name, artist, tags, BPM, energy) alongside the recent completed tracks (what the user DID listen to). The contrast between kept and skipped tracks reveals the actual preference:

- Skipped 3 hip-hop tracks but kept an R&B track → issue is genre, not energy
- Skipped 2 high-energy tracks but kept a high-energy one from a different era → issue is era, not energy
- Skipped 3 tracks all above 140 BPM → issue is tempo

This is materially better than the current approach where a single skip penalizes ALL tags equally.

**Cost control**: Skip analysis is batched (2+ skips within 5 min trigger one Opus call, not per-skip). Maximum 3 Opus skip-analysis calls per session.

### 5.4 DJ Narration (Opus)

The DJ narrates its decisions with musical intelligence and personality. This is the primary UX differentiator from Spotify's DJ (which users criticize as "hollow").

**File:** `workers/api/src/lib/dj-narrator.ts` (new, referenced in existing UX spec)

**Narration events and examples:**

| Event | Trigger | Example Narration |
|-------|---------|-------------------|
| `session_start` | Session created with plan | "Starting with your Chill Vibes playlist — I see a lot of lo-fi and ambient in here. Going to ease in with some warm textures and build from there." |
| `track_queued` | Track added to queue | "Added Khruangbin — that lazy psychedelic groove bridges perfectly from the shoegaze we just had." |
| `skip_detected` | 1 skip | "Skipped that one? No worries, adjusting." |
| `skip_pattern` | 2+ skips analyzed | "Okay, I see what's happening — the energy was climbing too fast. Pulling back to something more grounded." |
| `vibe_shift` | Energy direction changed | "We've been building for 4 tracks now. Time to let it breathe — dropping into something more spacious." |
| `surprise_inject` | Deliberate contrast track | "Wild card incoming — this is a left turn but trust me, the groove connects." |
| `user_steer` | User typed a request | Conversational response explaining what's changing and why |
| `queue_refill` | Background queue fill | "Digging for more tracks that match where we've landed..." |
| `plan_change` | Replan triggered | "Okay, resetting the plan. Based on what you've been vibing with, I'm taking us in a [new direction]." |

**Narration prompt structure**: The Opus narrator receives:
- The event type and data
- The current set plan (phase, target energy, genre cluster)
- Recent history (last 3-5 tracks with completion/skip status)
- Session narrative so far (what the DJ has already said)

This last point — the session narrative — is critical. It prevents the DJ from repeating itself and allows it to build a coherent conversational thread. Stored in `session.conversation` (max 20 messages).

**Delivery**: Narrations are pushed to the frontend via a `dj_message` SSE event on the player-stream (as specified in the UX spec). They appear in the DJ Messages panel as conversational bubbles.

**Cost**: ~$0.01-0.03 per narration (Opus with 100-200 token output, ~500 token input context). At 10-15 narrations per hour: ~$0.15-0.45/hour. Some high-frequency narrations (queue_refill, single skips) can use Haiku instead to reduce cost.

### 5.5 Contrast and Diversity Scoring

Add explicit diversity mechanisms to prevent the echo chamber effect.

**File:** `workers/api/src/services/TransitionScorer.ts` (modify)

New scoring dimension alongside existing BPM/energy/genre/artist/era:

```typescript
/** Score how much this track adds variety to the recent set */
function scoreContrast(
  candidate: CandidateTrack,
  recentTracks: HistoryTrack[],
  currentPhase: SetPhase,
): number {
  // 1. Genre novelty: does this introduce a genre not in recent history?
  const recentGenres = new Set(recentTracks.flatMap(t => t.tags))
  const novelGenres = candidate.tags.filter(t => !recentGenres.has(t))
  const genreNovelty = novelGenres.length / Math.max(candidate.tags.length, 1)

  // 2. Artist novelty: different artist from recent tracks
  const recentArtists = new Set(recentTracks.map(t => t.artist))
  const artistNovelty = recentArtists.has(candidate.artist) ? 0 : 1

  // 3. Era contrast: does this come from a different decade?
  const recentDecades = new Set(recentTracks.map(t => Math.floor(t.year / 10)))
  const candidateDecade = Math.floor(candidate.year / 10)
  const eraNovelty = recentDecades.has(candidateDecade) ? 0 : 0.5

  // 4. Phase-appropriate contrast: at surprise points, boost novelty weight
  const surpriseBoost = currentPhase.phase === 'release' ? 1.3 : 1.0

  return ((genreNovelty * 0.4 + artistNovelty * 0.3 + eraNovelty * 0.3) * surpriseBoost)
}
```

**Integration**: The contrast score is weighted at 15% in the composite transition score, reducing genre bridge from 20% to 15% and artist diversity from 15% to 10%:

| Dimension | Current Weight | New Weight |
|-----------|---------------|------------|
| BPM compatibility | 30% | 30% |
| Energy flow | 25% | 25% |
| Genre bridge | 20% | 15% |
| Artist diversity | 15% | 10% |
| Era proximity | 10% | 5% |
| **Contrast/novelty** | — | **15%** |

### 5.6 Session Plan in Prompts

Wire the set plan into all AI prompts so every model tier makes decisions in the context of the overall strategy.

**File:** `workers/api/src/lib/ai-prompts.ts` (modify)

Add to `buildNextTrackPrompt`:
```
SET PLAN — CURRENT PHASE:
Phase: {phase.phase} (track {trackNumber} of ~{phase.trackCount})
Target energy: {phase.targetEnergy}/10
Target BPM: {phase.bpmRange.min}-{phase.bpmRange.max}
Genre focus: {phase.genres.join(', ')}
Strategy: {phase.strategy}

IMPORTANT: This track should serve the phase's strategy. We're {phasePosition} through the {phase.phase} phase.
```

This means even Sonnet (for track selection) and Haiku (for progress narration) operate within the strategic framework Opus created.

## 6. Files Changed

### New Files

| File | Purpose |
|------|---------|
| `workers/api/src/lib/set-planner.ts` | Opus-powered set plan generation |
| `workers/api/src/lib/skip-analyzer.ts` | Opus-powered skip reasoning |
| `workers/api/src/lib/dj-narrator.ts` | Opus-powered narration generation |
| `workers/api/src/lib/ai-prompts-opus.ts` | Opus-specific prompt templates (separate from existing ai-prompts.ts for Sonnet) |

### Modified Files

| File | Change | Complexity |
|------|--------|------------|
| `workers/api/src/constants.ts` | Add `MODEL_OPUS` constant | Low |
| `workers/api/src/lib/ai-service.ts` | Add Opus model routing method | Low |
| `workers/api/src/lib/ai-prompts.ts` | Add set plan context to existing prompts | Medium |
| `workers/api/src/services/TransitionScorer.ts` | Add contrast scoring dimension | Medium |
| `workers/api/src/services/SuggestionEngine.ts` | Accept set plan, use phase-aware selection | Medium |
| `workers/api/src/services/MixSessionService.ts` | Store set plan and conversation in session | Low |
| `workers/api/src/routes/player-stream.ts` | Trigger narration on track change events | Medium |
| `workers/api/src/routes/steer-stream.ts` | Trigger replan on major vibe shifts | Low |
| `workers/api/src/routes/mix-openapi.ts` | Generate set plan on session start, wire skip analyzer | High |
| `packages/shared-types/src/index.ts` | Add SetPlan, SetPhase, SkipAnalysis types | Low |

### Files NOT Changed

- `TransitionScorer.ts` existing methods (BPM, energy, genre, artist, era) — only additions
- All frontend files — narration delivery is via existing SSE infrastructure
- `AudioEnrichmentService.ts`, `LastFmService.ts` — work correctly as-is
- `RateLimitedQueue.ts`, `RateLimitedAPIClients.ts` — no changes needed

## 7. Acceptance Criteria

### Three-Tier Model Architecture
- [ ] `constants.ts` defines `MODEL_OPUS: 'claude-opus-4-6-20260219'`
- [ ] `ai-service.ts` supports routing to Opus, Sonnet, or Haiku based on task type
- [ ] No Opus calls in hot paths (tool execution, search, filtering)
- [ ] Opus calls are in `waitUntil()` where possible to avoid blocking responses

### Set Plan Generation
- [ ] Session start generates a set plan with 4-5 phases
- [ ] Set plan includes energy targets, BPM ranges, and genre focus per phase
- [ ] Set plan is stored in `session.plan` in KV
- [ ] Plan is consumed by SuggestionEngine — track selection is phase-aware
- [ ] Replan triggers on 3+ consecutive skips or major vibe steer
- [ ] Plan includes at least 1 surprise/contrast point

### Skip Reasoning
- [ ] 2+ skips within 5 minutes triggers batch skip analysis
- [ ] Skip analysis identifies the likely issue (energy, genre, era, tempo, etc.)
- [ ] Taste model updates are targeted (only penalize the identified issue, not all tags)
- [ ] Maximum 3 Opus skip-analysis calls per session
- [ ] Skip analysis results are used in the next track selection prompt

### DJ Narration
- [ ] Session start produces a narration describing the vibe and plan
- [ ] Track queueing produces a brief reason narration
- [ ] Skip patterns produce an adaptation narration
- [ ] User steers produce a conversational response
- [ ] Narrations are pushed via `dj_message` SSE event
- [ ] Session narrative (last 20 messages) prevents repetition
- [ ] DJ voice is opinionated and music-savvy, never technical ("calling tool X")

### Contrast Scoring
- [ ] TransitionScorer includes a contrast/novelty dimension
- [ ] Genre novelty, artist novelty, and era novelty are scored
- [ ] Contrast is weighted at 15% in composite score
- [ ] After 10+ tracks without user steering, a mild surprise is injected
- [ ] No single genre dominates more than 40% of a 15-track sequence

### Integration
- [ ] Set plan context appears in all track selection prompts (Sonnet and Haiku)
- [ ] All new code passes `pnpm typecheck` with zero errors
- [ ] All new code passes `pnpm lint` with zero errors and zero warnings
- [ ] No `eslint-disable`, `@ts-ignore`, or `as any` in production code
- [ ] New types exported from `@dj/shared-types`
- [ ] All new functions have unit tests

## 8. Verification Plan

```bash
pnpm typecheck
pnpm lint
pnpm test --run
pnpm build
```

Manual tests:
1. Start session with seed playlist → verify set plan generated with appropriate phases
2. Verify plan phases match seed playlist energy/genre (not default values)
3. Let 5 tracks play → verify track selection follows phase energy targets
4. Skip 3 tracks rapidly → verify Opus skip analysis runs and identifies likely issue
5. Verify narration message appears on session start, track queue, and skip pattern
6. Type "completely change the vibe to jazz" → verify replan triggered
7. Let session run 15+ tracks → verify at least 1 surprise/contrast track was injected
8. Check that no single genre exceeds 40% of played tracks
9. Verify all narrations are music-savvy, no technical language

## 9. Rollback Plan

Each component is independently revertable:

- **Set Plan**: `set-planner.ts` is a new file. If plan generation fails, `SuggestionEngine` falls back to current behavior (phase-unaware selection). Guard: `if (!session.plan) { /* existing behavior */ }`.
- **Skip Analyzer**: `skip-analyzer.ts` is a new file. If Opus fails, fall back to current uniform genre weight adjustment. Guard: try/catch around Opus call with existing behavior in catch.
- **DJ Narrator**: `dj-narrator.ts` is a new file. If narration fails, no `dj_message` events are sent — the frontend simply shows no DJ commentary. This is graceful degradation.
- **Contrast Scoring**: New function in TransitionScorer. Remove the `scoreContrast` call and restore original weights to revert.
- **Model constant**: Removing `MODEL_OPUS` from constants reverts all routing to Sonnet.

## 10. Notes for MARVEL Runner

- **Risk level:** medium (new files only, no destructive changes to existing code)
- **Implementation order:**
  1. Constants + types (shared-types, constants.ts) — foundation
  2. Set planner (set-planner.ts) — core strategic feature
  3. AI prompts update (ai-prompts.ts) — wire plan into existing prompts
  4. Contrast scoring (TransitionScorer.ts) — add diversity mechanism
  5. Skip analyzer (skip-analyzer.ts) — behavioral reasoning
  6. DJ narrator (dj-narrator.ts) — personality layer
  7. Integration (mix-openapi.ts, player-stream.ts, SuggestionEngine.ts) — wire it all together
  8. Tests for each new module

- **Critical invariant:** Opus calls must NEVER block the player-stream poll loop. All Opus calls must be in `waitUntil()` or in endpoint handlers that are not time-critical. The player-stream sends `dj_message` events but does not wait for Opus to generate them.

- **Cost control:** Maximum Opus calls per session:
  - 1 set plan generation (session start)
  - 2 replans (skip pattern + major steer)
  - 3 skip analyses
  - 15 narrations (some can be Haiku for low-complexity events like single skips)
  - **Total: ~21 Opus calls/session maximum = ~$0.60-1.00/session**

- **Anthropic concurrency:** Workers allow 2 concurrent Anthropic connections. Opus calls must respect this. Use the existing `RateLimitedAPIClients` Anthropic lane (2 concurrent). Opus calls should be lower priority than Sonnet tool execution calls — if both are queued, Sonnet goes first.

- **Do not touch:** `AudioEnrichmentService.ts`, `LastFmService.ts`, `RateLimitedQueue.ts`, `SubrequestTracker.ts` — these work correctly and are not part of this spec.

- **Testing approach:** Unit test each new module in isolation (set-planner, skip-analyzer, dj-narrator). Mock the Opus AI calls to return deterministic responses. Integration tests verify the wiring in mix-openapi and player-stream.

## Sources

- [Anthropic: Introducing Claude Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6)
- [DataCamp: Claude Opus 4.6 Benchmarks](https://www.datacamp.com/blog/claude-opus-4-6)
- [Vellum: Claude Opus 4.6 vs 4.5 Benchmarks](https://www.vellum.ai/blog/claude-opus-4-6-benchmarks)
- [DJ.Studio: Anatomy of a Great DJ Mix](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic)
- [Mixed In Key: Control Energy Levels](https://mixedinkey.com/book/control-the-energy-level-of-your-dj-sets/)
- [DJ TechTools: Organizing Playlists by Energy](https://djtechtools.com/2022/11/25/controlling-the-dancefloor-a-guide-on-organizing-playlists-by-energy/)
- [SAGE: Managing the Personalization Paradox](https://journals.sagepub.com/doi/10.1177/20438869251395753)
- [Ohio University: Streaming Algorithms and Discovery](https://www.ohio.edu/news/2026/02/convenient-personalization-or-death-organic-discovery-streaming-algorithms-have)
- [PulseDJ: AI DJ Software](https://blog.pulsedj.com/ai-dj-software)
- [Spotify: Smart Reorder](https://newsroom.spotify.com/2026-02-25/smart-reorder-playlist-mixing/)
- [Spotify: DJ Takes Requests](https://newsroom.spotify.com/2025-10-15/dj-spanish-text-requests-update/)
- [ACM RecSys 2025: Biases in LLM-Generated Musical Taste Profiles](https://dl.acm.org/doi/10.1145/3705328.3748030)
- [arXiv: Music Recommendation with LLMs Survey](https://arxiv.org/html/2511.16478)
- [Spotify Research: Text2Tracks](https://research.atspotify.com/2025/04/text2tracks-improving-prompt-based-music-recommendations-with-generative-retrieval)
