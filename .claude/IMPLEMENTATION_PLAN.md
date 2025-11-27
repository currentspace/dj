# Live DJ Mode - Implementation Plan

## Overview

Transform the chat-based DJ assistant into a **live mix controller** where users can run an evolving music session throughout the day or during a party.

**Key Principle**: Build with tests first, implement with agents in parallel.

---

## Architecture Summary

### New Data Model: Mix Session

```typescript
// packages/shared-types/src/mix-session.ts
interface MixSession {
  id: string
  userId: string
  createdAt: string
  updatedAt: string

  // Current vibe profile (updated as tracks play)
  vibe: VibeProfile

  // Recent track history for context (last 20)
  history: PlayedTrack[]

  // App-managed smart queue (next 10 tracks)
  queue: QueuedTrack[]

  // User preferences for this session
  preferences: SessionPreferences
}

interface VibeProfile {
  mood: string[]              // ["upbeat", "energetic"]
  genres: string[]            // ["indie rock", "alt pop"]
  era: { start: number; end: number }
  bpmRange: { min: number; max: number }
  energyLevel: number         // 1-10
  energyDirection: 'building' | 'steady' | 'winding_down'
}

interface PlayedTrack {
  trackId: string
  trackUri: string
  name: string
  artist: string
  playedAt: string
  bpm: number | null
  energy: number | null
}

interface QueuedTrack {
  trackId: string
  trackUri: string
  name: string
  artist: string
  addedBy: 'user' | 'ai'
  vibeScore: number           // 0-100, how well it fits
  reason?: string             // Why AI suggested it
  position: number
}

interface SessionPreferences {
  avoidGenres: string[]
  favoriteArtists: string[]
  bpmLock?: { min: number; max: number }
  autoFill: boolean           // Auto-add tracks when queue low
}
```

### New API Routes

```
Mix Session Management:
POST   /api/mix/start           → Create new mix session
GET    /api/mix/current         → Get current session state
DELETE /api/mix/end             → End session, optionally save as playlist

Queue Management:
GET    /api/mix/queue           → Get current queue
POST   /api/mix/queue/add       → Add track to queue
DELETE /api/mix/queue/:position → Remove from queue
PUT    /api/mix/queue/reorder   → Reorder queue items

Vibe Control:
GET    /api/mix/vibe            → Get current vibe profile
PUT    /api/mix/vibe            → Update vibe preferences
POST   /api/mix/vibe/steer      → Natural language vibe steering

Suggestions:
GET    /api/mix/suggestions     → Get AI suggestions for current vibe
POST   /api/mix/suggestions/refresh → Force refresh suggestions

History & Save:
GET    /api/mix/history         → Get session play history
POST   /api/mix/save            → Save current mix as Spotify playlist
```

### New UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]           LIVE MIX                [User Avatar] [⚙️]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│         ┌─────────────────────────────────┐                    │
│         │      [Album Art - Hero]          │                    │
│         │                                  │                    │
│         └─────────────────────────────────┘                    │
│                                                                 │
│         "Track Name"                                           │
│         Artist Name                                            │
│                                                                 │
│         ━━━━━━━━━━●━━━━━━━━━━━━━━ 2:34 / 4:12                 │
│                                                                 │
│         [⏮️]    [⏯️]    [⏭️]        [🔀] [🔁] [🔊━━━]          │
│                                                                 │
├────────────────────┬────────────────────────────────────────────┤
│   UP NEXT          │   SUGGESTIONS                              │
│                    │                                            │
│   1. Track A  [≡]──│   ♫ Track X              [+]              │
│      Artist A [✕]  │     "Great energy match"                   │
│                    │                                            │
│   2. Track B  [≡]──│   ♫ Track Y              [+]              │
│      Artist B [✕]  │     "Perfect BPM transition"              │
│                    │                                            │
│   3. Track C  [≡]──│   ♫ Track Z              [+]              │
│      Artist C [✕]  │     "Matches the vibe"                    │
│                    │                                            │
│   [+ Search...]    │   [🔄 Refresh]                            │
│                    │                                            │
├────────────────────┴────────────────────────────────────────────┤
│  VIBE                                                           │
│                                                                 │
│  Energy: [😴]━━━━━━━━●━━━━━━━[🔥]           Building ↗         │
│                                                                 │
│  [More Energy] [Chill Out] [Go Retro] [Something Fresh]        │
│                                                                 │
│  💬 "Add some 80s synth to this mix..."              [Send]    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Agents

### Agent 1: Shared Types & Schemas

**Files to create/modify**:
- `packages/shared-types/src/mix-session.ts` (NEW)
- `packages/shared-types/src/index.ts` (UPDATE)
- `workers/api/src/schemas/mix-session.schema.ts` (NEW)

**Tests to write first**:
- `packages/shared-types/src/__tests__/mix-session.test.ts`

**Tasks**:
1. Define MixSession, VibeProfile, QueuedTrack, PlayedTrack interfaces
2. Create Zod schemas with validation
3. Export from shared-types package
4. Write unit tests for schema validation

```typescript
// Example test
describe('MixSession Schema', () => {
  it('should validate complete session', () => {
    const session = createTestSession()
    const result = MixSessionSchema.safeParse(session)
    expect(result.success).toBe(true)
  })

  it('should enforce energy level bounds', () => {
    const session = { ...createTestSession(), vibe: { energyLevel: 15 } }
    const result = MixSessionSchema.safeParse(session)
    expect(result.success).toBe(false)
  })
})
```

---

### Agent 2: Mix Session Service (Backend)

**Files to create/modify**:
- `workers/api/src/services/MixSessionService.ts` (NEW)
- `workers/api/src/services/MixSessionService.test.ts` (NEW)

**Tests to write first**:
- Unit tests with mocked KV
- Test session CRUD operations
- Test vibe calculation logic
- Test queue management

**Tasks**:
1. Implement MixSessionService class
2. KV storage for sessions (key: `mix:${userId}`)
3. Vibe blending algorithm
4. Queue auto-fill logic
5. Session TTL (8 hours)

```typescript
// MixSessionService.ts
export class MixSessionService {
  constructor(private kv: KVNamespace) {}

  async createSession(userId: string): Promise<MixSession>
  async getSession(userId: string): Promise<MixSession | null>
  async updateSession(session: MixSession): Promise<void>
  async endSession(userId: string): Promise<PlayedTrack[]>

  // Vibe management
  async updateVibeFromTrack(session: MixSession, track: PlayedTrack): Promise<VibeProfile>
  async steerVibe(session: MixSession, direction: string): Promise<VibeProfile>

  // Queue management
  async addToQueue(session: MixSession, track: QueuedTrack): Promise<void>
  async removeFromQueue(session: MixSession, position: number): Promise<void>
  async reorderQueue(session: MixSession, from: number, to: number): Promise<void>
  async autoFillQueue(session: MixSession): Promise<QueuedTrack[]>
}
```

---

### Agent 3: Mix API Routes (Backend)

**Files to create/modify**:
- `workers/api/src/routes/mix-openapi.ts` (NEW)
- `workers/api/src/index.ts` (UPDATE - add route)

**Tests to write first**:
- `workers/api/src/__tests__/routes/mix.test.ts`
- Test each endpoint with mocked service

**Tasks**:
1. Define OpenAPI routes with Zod schemas
2. Implement handlers calling MixSessionService
3. Add authentication middleware
4. Error handling with proper status codes

```typescript
// mix-openapi.ts
export const mixRouter = new OpenAPIHono<{ Bindings: Env }>()

// POST /api/mix/start
mixRouter.openapi(startMixRoute, async (c) => {
  const userId = getUserFromToken(c)
  const service = new MixSessionService(c.env.MIX_SESSIONS)
  const session = await service.createSession(userId)
  return c.json(session, 201)
})

// GET /api/mix/current
// POST /api/mix/queue/add
// PUT /api/mix/vibe/steer
// etc.
```

---

### Agent 4: Suggestion Engine (Backend)

**Files to create/modify**:
- `workers/api/src/services/SuggestionEngine.ts` (NEW)
- `workers/api/src/services/SuggestionEngine.test.ts` (NEW)

**Tests to write first**:
- Test suggestion generation based on vibe
- Test deduplication (don't suggest played tracks)
- Test integration with existing enrichment services

**Tasks**:
1. Generate suggestions based on current vibe profile
2. Use existing Last.fm similar tracks
3. Use existing Deezer BPM data for transition scoring
4. Rank suggestions by vibe fit
5. Cache suggestions with short TTL (2 minutes)

```typescript
// SuggestionEngine.ts
export class SuggestionEngine {
  constructor(
    private lastFmService: LastFmService,
    private audioService: AudioEnrichmentService,
    private spotifyToken: string
  ) {}

  async generateSuggestions(
    session: MixSession,
    count: number = 5
  ): Promise<Suggestion[]>

  async scoreSuggestion(
    track: SpotifyTrack,
    vibe: VibeProfile
  ): Promise<number>

  async findTransitionCandidates(
    fromTrack: PlayedTrack,
    vibe: VibeProfile
  ): Promise<SpotifyTrack[]>
}
```

---

### Agent 5: Mix UI Components (Frontend)

**Files to create/modify**:
- `apps/web/src/features/mix/MixInterface.tsx` (NEW)
- `apps/web/src/features/mix/NowPlayingHero.tsx` (NEW)
- `apps/web/src/features/mix/QueuePanel.tsx` (NEW)
- `apps/web/src/features/mix/SuggestionsPanel.tsx` (NEW)
- `apps/web/src/features/mix/VibeControls.tsx` (NEW)
- `apps/web/src/features/mix/mix.module.css` (NEW)

**Tests to write first**:
- Component render tests
- User interaction tests (add to queue, remove, reorder)
- Vibe control interactions

**Tasks**:
1. Create MixInterface as main container
2. NowPlayingHero with large album art and controls
3. QueuePanel with drag-drop reordering
4. SuggestionsPanel with add buttons
5. VibeControls with slider and quick buttons
6. Follow React 19.2 guidelines (no useEffect for state sync)

```typescript
// MixInterface.tsx
export function MixInterface() {
  const { session, isLoading } = useMixSession()
  const [isPending, startTransition] = useTransition()

  // Direct state sync (not useEffect)
  const currentTrack = session?.history[session.history.length - 1] ?? null

  return (
    <div className={styles.mixContainer}>
      <NowPlayingHero track={currentTrack} />
      <div className={styles.panels}>
        <QueuePanel queue={session?.queue ?? []} />
        <SuggestionsPanel vibeProfile={session?.vibe} />
      </div>
      <VibeControls
        vibe={session?.vibe}
        onSteer={(direction) => startTransition(() => steerVibe(direction))}
      />
    </div>
  )
}
```

---

### Agent 6: Mix Hooks & State (Frontend)

**Files to create/modify**:
- `apps/web/src/hooks/useMixSession.ts` (NEW)
- `apps/web/src/hooks/useMixSession.test.ts` (NEW)
- `apps/web/src/lib/mix-api-client.ts` (NEW)

**Tests to write first**:
- Hook state management tests
- API client mock tests
- Polling behavior tests

**Tasks**:
1. Create useMixSession hook with polling
2. Create useSuggestions hook
3. Create useVibeControls hook
4. API client with proper error handling
5. Optimistic updates for queue changes

```typescript
// useMixSession.ts
export function useMixSession() {
  const [session, setSession] = useState<MixSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Poll for updates (playback state changes)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await mixApiClient.getCurrentSession()
        setSession(updated)
      } catch (err) {
        // Handle gracefully
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  const addToQueue = useCallback(async (track: QueuedTrack) => {
    // Optimistic update
    setSession(prev => prev ? {
      ...prev,
      queue: [...prev.queue, track]
    } : null)

    try {
      await mixApiClient.addToQueue(track)
    } catch (err) {
      // Revert on error
      setSession(prev => prev ? {
        ...prev,
        queue: prev.queue.filter(t => t.trackId !== track.trackId)
      } : null)
      throw err
    }
  }, [])

  return { session, isLoading, error, addToQueue, /* ... */ }
}
```

---

### Agent 7: Vibe Steering AI (Backend)

**Files to create/modify**:
- `workers/api/src/lib/vibe-steering.ts` (NEW)
- `workers/api/src/lib/vibe-steering.test.ts` (NEW)

**Tests to write first**:
- Test vibe profile updates from natural language
- Test preset button mappings
- Test Claude integration for complex steering

**Tasks**:
1. Parse natural language vibe requests
2. Map preset buttons to vibe changes
3. Use Claude Haiku for complex requests
4. Validate resulting vibe profiles

```typescript
// vibe-steering.ts
export async function steerVibe(
  currentVibe: VibeProfile,
  direction: string,
  anthropicKey: string
): Promise<VibeProfile> {
  // Try preset mappings first
  const preset = PRESET_MAPPINGS[direction.toLowerCase()]
  if (preset) {
    return applyPreset(currentVibe, preset)
  }

  // Use AI for complex requests
  const anthropic = new Anthropic({ apiKey: anthropicKey })
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-20250929',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: buildVibeSteeringPrompt(currentVibe, direction)
    }]
  })

  return parseVibeResponse(response)
}

const PRESET_MAPPINGS = {
  'more energy': { energyLevel: +2, energyDirection: 'building' },
  'chill out': { energyLevel: -2, energyDirection: 'winding_down' },
  'go retro': { era: { start: 1970, end: 1995 } },
  'something fresh': { era: { start: 2020, end: 2025 } },
}
```

---

### Agent 8: Integration & Polish

**Files to create/modify**:
- `apps/web/src/App.tsx` (UPDATE - add Mix route)
- `apps/web/src/features/mix/index.ts` (NEW - exports)
- `workers/api/wrangler.jsonc` (UPDATE - add KV binding)

**Tests to write first**:
- E2E flow test (start session → add tracks → steer vibe)
- Integration test for full API flow

**Tasks**:
1. Add `/mix` route to frontend
2. Add navigation to mix mode
3. Add MIX_SESSIONS KV namespace
4. Create preview/staging environment
5. Documentation updates

---

## Test Strategy

### Unit Tests (Each Agent)

Every agent writes tests FIRST:

```bash
# Run before implementing
pnpm --filter @dj/api-worker test MixSessionService
pnpm --filter @dj/api-worker test SuggestionEngine
pnpm --filter @dj/api-worker test mix-routes
pnpm --filter @dj/web test useMixSession
```

### Integration Tests

After agents complete:

```typescript
// workers/api/src/__tests__/integration/mix-session.integration.test.ts
describe('Mix Session Integration', () => {
  it('should create session and manage queue', async () => {
    // Full flow test
  })

  it('should update vibe as tracks play', async () => {
    // Vibe tracking test
  })

  it('should generate relevant suggestions', async () => {
    // AI suggestion test
  })
})
```

### Contract Tests

Validate Spotify playback API:

```typescript
// workers/api/src/__tests__/contracts/spotify-player.contract.test.ts
describe('Spotify Player API Contracts', () => {
  it.skipIf(!hasUserToken())('GET /me/player matches schema', async () => {
    // Validate playback state schema
  })

  it.skipIf(!hasUserToken())('POST /me/player/queue works', async () => {
    // Validate queue endpoint
  })
})
```

---

## Execution Order

### Phase 1: Foundation (Parallel)

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Agent 1       │  │   Agent 2       │  │   Agent 4       │
│   Shared Types  │  │   Session Svc   │  │   Suggestions   │
│   & Schemas     │  │   (Backend)     │  │   Engine        │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                     Types available to all
```

### Phase 2: API & UI (Parallel, after Phase 1)

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Agent 3       │  │   Agent 5       │  │   Agent 6       │
│   Mix Routes    │  │   UI Components │  │   Hooks/State   │
│   (Backend)     │  │   (Frontend)    │  │   (Frontend)    │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                     Full API + UI ready
```

### Phase 3: Intelligence & Integration (After Phase 2)

```
┌─────────────────┐  ┌─────────────────┐
│   Agent 7       │  │   Agent 8       │
│   Vibe AI       │  │   Integration   │
│   (Backend)     │  │   & Polish      │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └────────────────────┘
                   │
                   ▼
              SHIP IT
```

---

## KV Namespace Setup

Add to `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    // Existing
    { "binding": "SESSIONS", "id": "..." },
    { "binding": "AUDIO_FEATURES_CACHE", "id": "..." },
    // New
    { "binding": "MIX_SESSIONS", "id": "TO_BE_CREATED" }
  ]
}
```

Create namespace:
```bash
wrangler kv:namespace create "MIX_SESSIONS"
wrangler kv:namespace create "MIX_SESSIONS" --preview
```

---

## Success Criteria

### Functional

- [ ] User can start a new mix session
- [ ] Now playing updates in real-time (2s polling)
- [ ] Queue displays next 10 tracks
- [ ] User can add/remove/reorder queue
- [ ] Suggestions refresh based on current vibe
- [ ] Vibe slider adjusts energy level
- [ ] Quick buttons apply preset vibe shifts
- [ ] Natural language vibe steering works
- [ ] Session saves as Spotify playlist

### Performance

- [ ] Session load < 500ms
- [ ] Suggestion generation < 2s
- [ ] Queue operations < 200ms (optimistic)
- [ ] UI renders at 60fps during playback

### Quality

- [ ] 80%+ unit test coverage on new code
- [ ] All contract tests pass
- [ ] Integration tests for critical flows
- [ ] No TypeScript errors
- [ ] Follows all coding guidelines

---

## Migration Notes

### Preserve Existing Features

The current chat interface remains fully functional:
- `/chat` route keeps existing behavior
- All existing tools work unchanged
- Analyze/Create/Edit modes unchanged

### Add New Entry Point

- `/mix` route for new live mix experience
- Header navigation includes both modes
- User can switch between modes freely

### Gradual Rollout

1. Deploy behind feature flag initially
2. Dogfood internally
3. Enable for all users
4. Consider making `/mix` the default homepage
