# Evolution Plan: From Chat DJ to Live Mix Controller

## Vision Statement

Transform the current chat-based playlist assistant into a **live music mixing experience** where users can:

- Run an evolving "mix" throughout the day or during a party
- Add songs that blend naturally with what's playing
- Steer the vibe in real-time ("make it more upbeat", "chill it out")
- Have AI proactively suggest tracks that fit the current flow
- Think: **A radio station you can nudge and evolve**

---

## Gap Analysis: Current vs. Intended

| Aspect | Current State | Intended State |
|--------|--------------|----------------|
| **Primary UI** | Chat conversation | Now Playing + Mix Queue |
| **Mental Model** | Playlist editing | Live session mixing |
| **AI Role** | Reactive assistant | Proactive DJ partner |
| **Queue** | Spotify's native queue | App-managed smart queue |
| **State** | Stateless conversations | Persistent mix session |
| **Vibe** | Analyzed per-request | Continuously tracked |
| **Suggestions** | On-demand only | Always-visible recommendations |
| **User Input** | Full conversation | Quick actions + vibe steering |

---

## Core Concept: The Mix Session

A **Mix Session** is a persistent, evolving musical journey:

```
┌─────────────────────────────────────────────────────────────┐
│                      MIX SESSION                            │
├─────────────────────────────────────────────────────────────┤
│  Current Vibe Profile:                                      │
│    • Mood: Upbeat, Energetic                               │
│    • Genres: Indie Rock, Alt Pop                           │
│    • Era: 2010s-2020s                                      │
│    • BPM Range: 115-130                                    │
│    • Energy Level: 7/10 (building)                         │
├─────────────────────────────────────────────────────────────┤
│  Track History: [last 10 played]                           │
│  Smart Queue: [next 5-10 tracks, auto-maintained]          │
│  User Preferences: [genres to avoid, favorite artists]      │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (MVP)

### Goal: Playback-Centric UI with Smart Queue

**Duration**: 2-3 weeks of focused work

### 1.1 New UI Layout

Replace chat-first layout with mix-first layout:

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]              NOW PLAYING              [User] [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│         ┌─────────────────────────────────┐                │
│         │      [Album Art - Large]         │                │
│         │                                  │                │
│         │                                  │                │
│         └─────────────────────────────────┘                │
│                                                             │
│         "Track Name"                                        │
│         Artist Name • Album Name                           │
│                                                             │
│         ▶️ ━━━━━━━━━●━━━━━━━━━━━━━ 2:34 / 4:12             │
│                                                             │
│         [⏮️]  [⏯️]  [⏭️]     [🔀] [🔁]  [🔊]               │
│                                                             │
├──────────────────────┬──────────────────────────────────────┤
│   UP NEXT (Queue)    │   SUGGESTIONS                       │
│                      │                                      │
│   1. Track A ────────│   Based on current vibe:            │
│      Artist A   [✕]  │                                      │
│                      │   ♫ Track X by Artist X  [+]        │
│   2. Track B ────────│     "Similar energy, great flow"     │
│      Artist B   [✕]  │                                      │
│                      │   ♫ Track Y by Artist Y  [+]        │
│   3. Track C ────────│     "Matches the indie vibe"         │
│      Artist C   [✕]  │                                      │
│                      │   ♫ Track Z by Artist Z  [+]        │
│   [+ Add Track]      │     "Perfect BPM transition"         │
│                      │                                      │
├──────────────────────┴──────────────────────────────────────┤
│  VIBE CONTROLS                                              │
│                                                             │
│  Energy: [😴]━━━━━━━━●━━━━━━━━━[🔥]    Current: Building   │
│                                                             │
│  Quick Shifts: [More Energy] [Chill Out] [Go Retro] [Fresh]│
│                                                             │
│  💬 "Add some 80s synth vibes to this mix"        [Send]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Backend: Mix Session State

**New Data Model** (Cloudflare KV):

```typescript
interface MixSession {
  id: string
  userId: string
  createdAt: string

  // Current vibe profile (updated as tracks play)
  vibe: {
    mood: string[]           // ["upbeat", "energetic"]
    genres: string[]         // ["indie rock", "alt pop"]
    era: { start: number, end: number }  // { start: 2010, end: 2024 }
    bpmRange: { min: number, max: number }
    energyLevel: number      // 1-10
    energyDirection: 'building' | 'steady' | 'winding_down'
  }

  // Track history for context
  history: {
    trackId: string
    playedAt: string
    bpm: number | null
    energy: number | null
  }[]

  // App-managed queue (separate from Spotify's queue)
  queue: {
    trackId: string
    trackUri: string
    addedBy: 'user' | 'ai'
    vibeScore: number        // How well it fits current vibe
    reason?: string          // Why AI suggested it
  }[]

  // User preferences for this session
  preferences: {
    avoidGenres: string[]
    favoriteArtists: string[]
    bpmLock?: { min: number, max: number }
  }
}
```

**New API Endpoints**:

```
POST   /api/mix/start           - Start new mix session
GET    /api/mix/current         - Get current session state
PUT    /api/mix/vibe            - Update vibe preferences
POST   /api/mix/queue/add       - Add track to mix queue
DELETE /api/mix/queue/:position - Remove from queue
PUT    /api/mix/queue/reorder   - Reorder queue
POST   /api/mix/suggest         - Get AI suggestions for current vibe
POST   /api/mix/steer           - Natural language vibe steering
GET    /api/mix/history         - Get session history
POST   /api/mix/save            - Save current mix as playlist
```

### 1.3 Smart Queue Management

**Queue Auto-Fill Logic**:

```typescript
async function maintainQueue(session: MixSession) {
  const MIN_QUEUE_SIZE = 5
  const currentQueueSize = session.queue.length

  if (currentQueueSize < MIN_QUEUE_SIZE) {
    const needed = MIN_QUEUE_SIZE - currentQueueSize
    const suggestions = await generateVibeMatchingSuggestions(
      session.vibe,
      session.history,
      needed * 2  // Get extra for variety
    )

    // Filter for good transitions
    const lastTrack = session.history[session.history.length - 1]
    const goodTransitions = suggestions.filter(track =>
      isGoodTransition(lastTrack, track, session.vibe)
    )

    // Add top picks to queue
    const toAdd = goodTransitions.slice(0, needed)
    session.queue.push(...toAdd.map(track => ({
      trackId: track.id,
      trackUri: track.uri,
      addedBy: 'ai',
      vibeScore: track.vibeScore,
      reason: track.reason
    })))
  }
}
```

### 1.4 New Claude Tools for Mix Mode

```typescript
// Replaces current tools in mix context
const mixModeTools = [
  {
    name: 'get_mix_state',
    description: 'Get current mix session state including vibe, queue, and history',
  },
  {
    name: 'suggest_for_mix',
    description: 'Get track suggestions that fit the current mix vibe',
    parameters: {
      count: 'number (1-10)',
      criteria: 'optional specific criteria like "more energy" or "90s feel"'
    }
  },
  {
    name: 'add_to_mix',
    description: 'Add a track to the mix queue',
    parameters: {
      trackUri: 'Spotify URI',
      position: 'optional position in queue'
    }
  },
  {
    name: 'steer_vibe',
    description: 'Adjust the mix vibe in a direction',
    parameters: {
      direction: 'natural language like "more upbeat" or "add some jazz"',
      intensity: 'number 1-10 for how strong the shift should be'
    }
  },
  {
    name: 'analyze_transition',
    description: 'Check how well a track would transition from current',
    parameters: {
      trackUri: 'Spotify URI to check'
    }
  }
]
```

---

## Phase 2: Intelligence Layer

### Goal: Proactive AI DJ Partner

**Duration**: 2-3 weeks

### 2.1 Vibe Tracking Engine

Continuously analyze what's playing and update vibe profile:

```typescript
interface VibeUpdateEvent {
  trigger: 'track_changed' | 'track_added' | 'user_feedback' | 'time_elapsed'
  previousVibe: VibeProfile
  newVibe: VibeProfile
  reason: string
}

// On track change
async function onTrackChanged(session: MixSession, newTrack: Track) {
  // Get track's vibe characteristics
  const trackVibe = await analyzeTrackVibe(newTrack)

  // Blend with session vibe (weighted average)
  session.vibe = blendVibes(
    session.vibe,      // 70% weight - maintain continuity
    trackVibe,         // 30% weight - incorporate new track
  )

  // Detect energy direction
  session.vibe.energyDirection = detectEnergyTrend(session.history)

  // Trigger queue refresh if vibe shifted significantly
  if (vibeShiftMagnitude(previousVibe, session.vibe) > THRESHOLD) {
    await refreshQueueForNewVibe(session)
  }
}
```

### 2.2 Proactive Suggestions

AI-initiated recommendations based on context:

```typescript
interface ProactiveSuggestion {
  type: 'vibe_drift' | 'energy_opportunity' | 'variety_needed' | 'user_pattern'
  message: string
  tracks: Track[]
  confidence: number
}

// Examples:
// "The mix has been steady for 20 minutes - want to build some energy?"
// "I noticed you've played a lot of indie rock - here's some adjacent stuff"
// "Perfect moment for a classic - queue is getting same-y"
```

### 2.3 Transition Quality Scoring

Rate how well tracks flow together:

```typescript
interface TransitionScore {
  overall: number        // 0-100
  bpmMatch: number       // How close BPMs are (±5% = 100)
  keyCompatibility: number  // Musical key relationship
  energyFlow: number     // Does energy progression make sense
  genreBlend: number     // Do genres complement
  explanation: string    // Human-readable reason
}

// "Great transition! BPM drops smoothly from 128 to 120,
//  and the dreamy synths bridge the indie rock to shoegaze perfectly."
```

---

## Phase 3: Social & Collaboration

### Goal: Party Mode with Multiple Contributors

**Duration**: 3-4 weeks

### 3.1 Share Links

Generate shareable links for mix sessions:

```
https://dj.current.space/mix/abc123
```

- Anyone with link can view what's playing
- Optional: Allow guests to suggest tracks
- Host approves/rejects suggestions

### 3.2 Request System

Party guests can request songs:

```typescript
interface TrackRequest {
  trackUri: string
  requestedBy: string    // Guest name/identifier
  timestamp: string
  status: 'pending' | 'approved' | 'rejected' | 'played'
  vibeScore: number      // How well it fits
  aiNote?: string        // "Good fit!" or "Might break the vibe"
}
```

### 3.3 Voting (Future)

Allow guests to vote on upcoming tracks:
- Upvote tracks in queue
- Downvote to skip
- Most voted plays next

---

## Phase 4: Polish & Delight

### Goal: Professional-Quality Experience

**Duration**: Ongoing

### 4.1 Visual Enhancements

- **Vibe Visualization**: Animated background that responds to music mood
- **Energy Wave**: Visual timeline showing energy flow
- **BPM Indicator**: Pulsing element synced to tempo
- **Transition Preview**: Show upcoming track with blend indicator

### 4.2 Audio Features (If Possible)

- **Crossfade Control**: Adjust transition length
- **Gapless Playback**: Seamless track transitions
- **Beat Sync Preview**: Show where tracks align

### 4.3 Session Features

- **Save Mix as Playlist**: One-click save of session history
- **Mix Templates**: Start from preset vibes ("Chill Morning", "House Party")
- **Schedule**: Plan vibe changes ahead of time ("8pm: build energy")

---

## Implementation Priority

### Must Have (MVP)

1. ✅ Playback controls (already have)
2. 🔲 Mix-centric UI layout
3. 🔲 Mix session state (KV storage)
4. 🔲 Smart queue with auto-fill
5. 🔲 Basic vibe tracking
6. 🔲 Quick add from suggestions

### Should Have (V1)

1. 🔲 Natural language vibe steering
2. 🔲 Transition quality scoring
3. 🔲 Proactive suggestions
4. 🔲 Session history & save as playlist
5. 🔲 Vibe presets (quick shift buttons)

### Nice to Have (V2)

1. 🔲 Share links for viewing
2. 🔲 Guest request system
3. 🔲 Visual vibe indicators
4. 🔲 Energy timeline
5. 🔲 Mix templates

### Future

1. 🔲 Multi-user voting
2. 🔲 Crossfade controls
3. 🔲 Scheduled vibe changes
4. 🔲 Mix analytics

---

## Technical Decisions Needed

### 1. Queue Management Strategy

**Option A**: App-controlled queue only
- Pros: Full control, predictable behavior
- Cons: Need to sync with Spotify, handle edge cases

**Option B**: Hybrid (app queue + Spotify queue)
- Pros: Spotify handles playback transitions
- Cons: Two sources of truth, sync complexity

**Recommendation**: Start with Option A for MVP, use Spotify's "add to queue" API to push tracks one at a time as needed.

### 2. Real-Time Updates

**Option A**: Polling (current approach)
- Pros: Simple, works now
- Cons: Latency, wasted requests

**Option B**: WebSockets for state sync
- Pros: Real-time, efficient
- Cons: More complex, connection management

**Recommendation**: Keep polling for MVP (1-2 second interval), add WebSockets in Phase 2 for multi-user.

### 3. Vibe Analysis Approach

**Option A**: Pre-computed (analyze tracks upfront)
- Pros: Fast at runtime
- Cons: Storage, may be stale

**Option B**: On-demand (analyze as needed)
- Pros: Always fresh
- Cons: Latency on each operation

**Recommendation**: Hybrid - cache vibe data with 7-day TTL, compute on miss.

---

## Migration Path

### Preserve Existing Value

The current chat-based features remain valuable:
- **Analyze mode** → "Tell me about this mix's vibe"
- **Create mode** → "Build me a playlist from this session"
- **Edit mode** → Bulk operations on queue

### Gradual Transition

1. **Week 1-2**: Build mix session backend, keep current UI
2. **Week 3-4**: New mix UI as opt-in "DJ Mode"
3. **Week 5-6**: Polish, make DJ Mode the default
4. **Week 7+**: Chat becomes secondary input method

---

## Success Metrics

### Engagement

- Session duration (target: 30+ minutes average)
- Tracks played per session (target: 15+)
- User-initiated vs AI-initiated tracks (target: 50/50 split)

### Quality

- User skips (lower is better)
- Vibe drift complaints (lower is better)
- "Add to library" actions (higher is better)

### Growth

- Return users (weekly active)
- Session shares (for party mode)
- Playlists saved from sessions

---

## Next Steps

1. **Validate concept**: Build quick prototype of mix-centric UI
2. **Design session state**: Finalize MixSession data model
3. **Implement MVP backend**: Mix session CRUD + smart queue
4. **Build new UI**: React components for mix interface
5. **Integrate AI**: Vibe tracking + suggestion generation
6. **Test with real usage**: Dogfood during actual music listening
