# DJ Evolution Plan: From Playlist Creator to Live DJ Assistant

## The Vision

Transform DJ from a **playlist creation tool** into a **live music curation assistant** that helps you DJ your day, work session, or party - evolving the vibe in real-time as the mood and situation change.

**Think:** A radio station you can talk to and shape as you go.

---

## Current State vs. Target State

| Aspect | Current | Target |
|--------|---------|--------|
| **Primary Use** | Create/analyze playlists | Control live music flow |
| **Interaction** | Chat → create playlist → listen elsewhere | Chat while music plays → shape the vibe |
| **Playback** | None | Full control (play/pause/skip/queue) |
| **Time Horizon** | Plan ahead | React in real-time |
| **Feedback Loop** | None | "Skip this" / "More like this" |
| **Session** | Ephemeral (resets on refresh) | Persistent (resume where you left off) |
| **Users** | Single user, single session | Single user first, then collaborative |

---

## Core Concept: The "Live Mix"

### What Is a Live Mix?

A **Live Mix** is an evolving queue of tracks that:
1. Has a **current playing track** (the "now")
2. Has an **upcoming queue** (the next 5-20 tracks)
3. Has a **vibe trajectory** (where the energy is heading)
4. Can be **shaped by conversation** ("make it more chill", "add some 90s hip hop")
5. **Learns from skips** (didn't like that? noted)

### The DJ Loop

```
┌─────────────────────────────────────────────────────────┐
│                    THE DJ LOOP                          │
│                                                         │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐        │
│   │ LISTEN  │ ──→  │ REACT   │ ──→  │ EVOLVE  │        │
│   │         │      │         │      │         │        │
│   │ Current │      │ User    │      │ AI adds │        │
│   │ track   │      │ says    │      │ tracks  │        │
│   │ plays   │      │ "more   │      │ that    │        │
│   │         │      │ upbeat" │      │ match   │        │
│   └─────────┘      └─────────┘      └─────────┘        │
│        ▲                                  │             │
│        │                                  │             │
│        └──────────────────────────────────┘             │
│              Queue cycles, vibe evolves                 │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Playback Foundation (1-2 weeks)

**Goal:** See what's playing, control it, have a queue.

#### 1.1 OAuth Scope Addition
```diff
// Current scopes + new ones needed
+ user-modify-playback-state   // CRITICAL: Control playback
+ streaming                    // WebPlayback SDK (Premium only)
```

#### 1.2 New API Routes (`workers/api/src/routes/player.ts`)
```typescript
// Player state
GET  /api/player/state        // Current track, progress, device
GET  /api/player/devices      // Available devices
GET  /api/player/queue        // Current queue

// Playback control
POST /api/player/play         // Play/resume (optional: specific track/context)
POST /api/player/pause        // Pause
POST /api/player/next         // Skip to next
POST /api/player/previous     // Previous track
POST /api/player/seek         // Seek to position
PUT  /api/player/device       // Transfer playback to device

// Queue management
POST /api/player/queue/add    // Add track to queue
POST /api/player/queue/clear  // Clear upcoming queue
```

#### 1.3 New Frontend Component (`apps/web/src/features/player/NowPlaying.tsx`)
```
┌─────────────────────────────────────────────────────────┐
│  🎵 Now Playing                              🔊 Device  │
│ ─────────────────────────────────────────────────────── │
│  [Album Art]  Track Name                                │
│               Artist Name                               │
│               ════════════●══════  2:34 / 4:12          │
│                                                         │
│              ⏮  ▶/⏸  ⏭     🔀 🔁                       │
│                                                         │
│  Up Next:                                               │
│  1. Next Track - Artist                                 │
│  2. After That - Artist                                 │
│  3. Then This - Artist                                  │
└─────────────────────────────────────────────────────────┘
```

#### 1.4 Playback State Polling
- Poll `/api/player/state` every 1-3 seconds
- Update progress bar, current track display
- Detect track changes for "what just played" history

**Deliverable:** User can see now-playing, control playback, see queue.

---

### Phase 2: AI Queue Management (2-3 weeks)

**Goal:** Claude can add tracks to the queue and shape the mix.

#### 2.1 New Tools for Claude (`spotify-tools.ts`)
```typescript
// Queue tools
add_to_queue          // Add single track to Spotify queue
add_multiple_to_queue // Add multiple tracks (batch)
get_current_queue     // See what's coming up
clear_queue           // Clear upcoming tracks

// Playback awareness
get_now_playing       // What's playing right now
get_recent_plays      // What played in this session
```

#### 2.2 System Prompt Update (DJ Mode)
```xml
<role>
You are a live DJ assistant. Music is playing RIGHT NOW. Your job is to:
1. Keep the vibe going by maintaining queue depth (always 5-10 tracks ahead)
2. React to user requests ("more chill", "add some jazz")
3. Notice when queue is getting low and proactively suggest additions
4. Learn from skips (if user skipped a track, note it for future)
</role>

<current_state>
Now Playing: {track_name} by {artist} ({time_remaining} remaining)
Queue Depth: {queue_length} tracks ({total_minutes} minutes)
Session Vibe: {extracted_vibe_summary}
Tracks Played This Session: {count}
Tracks Skipped: {skip_count}
</current_state>

<behaviors>
- When queue drops below 5 tracks, proactively suggest additions
- When user says "skip" or "next", note the track for future avoidance
- When user describes a vibe shift, gradually transition (don't hard pivot)
- When asked "what's playing", describe current + upcoming
</behaviors>
```

#### 2.3 Queue Depth Monitor (Backend)
```typescript
// SSE event when queue gets low
type: 'queue_low'
data: { current_depth: 3, recommended_depth: 8 }

// AI auto-responds with suggestions
"Your queue is getting low! Based on the current vibe, I'd suggest adding:
1. Track A - maintains the energy
2. Track B - slight transition toward chill
3. Track C - perfect for 20 minutes from now

Should I add these, or would you like different suggestions?"
```

**Deliverable:** Claude actively manages the queue, responds to vibe requests.

---

### Phase 3: Vibe Evolution & Memory (2-3 weeks)

**Goal:** The mix evolves intelligently, session has memory.

#### 3.1 Session Persistence (KV Storage)
```typescript
interface DJSession {
  id: string
  userId: string
  startedAt: Date

  // What's happened
  tracksPlayed: PlayedTrack[]
  tracksSkipped: string[]  // Track IDs user skipped

  // Current state
  currentVibe: VibeProfile
  vibeHistory: VibeSnapshot[]  // Vibe at 15-min intervals

  // User preferences learned
  preferredGenres: string[]
  avoidGenres: string[]
  energyPreference: 'low' | 'medium' | 'high' | 'dynamic'

  // Active state
  queueSnapshot: string[]  // Track IDs in queue
  lastUpdated: Date
}
```

#### 3.2 Vibe Trajectory Planning
```typescript
interface VibeTrajectory {
  current: VibePoint       // Energy 0.7, Valence 0.6
  target: VibePoint        // Energy 0.4, Valence 0.7 (user said "wind down")
  transitionTracks: number // 5 tracks to get there
  strategy: string         // "Gradual tempo decrease, maintain positivity"
}
```

#### 3.3 Skip Learning
```typescript
// When user skips a track
onSkip(trackId) {
  session.tracksSkipped.push(trackId)

  // Extract "why" signals
  const skippedTrack = await getTrackFeatures(trackId)

  // If skipped 3+ tracks with tempo > 140, maybe user doesn't want high BPM
  // If skipped 3+ explicit tracks, maybe user wants clean version

  updatePreferences(session, skippedTrack)
}
```

#### 3.4 Time-Aware Suggestions
```typescript
// Morning (6am-10am): Gentle wake-up energy
// Midday (10am-2pm): Productive focus
// Afternoon (2pm-6pm): Maintaining energy
// Evening (6pm-10pm): Social/dinner vibes
// Night (10pm-2am): Party or wind-down depending on context
// Late Night (2am-6am): Chill/ambient

function getTimeContext(): TimeContext {
  const hour = new Date().getHours()
  // Return appropriate energy targets and genre suggestions
}
```

**Deliverable:** Sessions persist, AI learns from skips, vibe evolves over time.

---

### Phase 4: Party Mode (Future - 4+ weeks)

**Goal:** Multiple people can influence the mix.

#### 4.1 Session Sharing
- Generate shareable link: `dj.current.space/session/abc123`
- QR code for party guests to scan
- Mobile-optimized request interface

#### 4.2 Request System
```
┌─────────────────────────────────────────────────────────┐
│  🎉 Party Mode: Brian's Saturday Mix                    │
│ ─────────────────────────────────────────────────────── │
│  Now Playing: Song Name - Artist                        │
│                                                         │
│  📝 Requests (3 pending):                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ "Uptown Funk" - Guest 1           [▲ 3] [✓] [✗]  │  │
│  │ "Blinding Lights" - Guest 2       [▲ 2] [✓] [✗]  │  │
│  │ "Bad Guy" - Guest 3               [▲ 1] [✓] [✗]  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  [+ Request a Song]                                     │
└─────────────────────────────────────────────────────────┘
```

#### 4.3 DJ (Host) Controls
- Approve/reject requests
- Set vibe boundaries ("no heavy metal tonight")
- Auto-approve from trusted guests
- Rate limit requests per guest

#### 4.4 AI Moderation
```
Guest requests "Death Metal Scream Track"
AI: "That doesn't quite fit the current chill dinner vibe.
     I found some energetic alternatives that might work:
     1. Rock song with similar energy but cleaner
     2. Electronic track with intensity
     Would any of these work instead?"
```

**Deliverable:** Multiple guests can request songs, host approves, AI moderates fit.

---

## UI Evolution

### Current Layout
```
┌────────────────┬─────────────────────────────────────────┐
│                │                                         │
│   Playlists    │            Chat Interface               │
│    (400px)     │                                         │
│                │                                         │
└────────────────┴─────────────────────────────────────────┘
```

### Phase 1: Add Player
```
┌────────────────┬─────────────────────────────────────────┐
│                │                                         │
│   Playlists    │            Chat Interface               │
│    (300px)     │                                         │
│                │                                         │
├────────────────┴─────────────────────────────────────────┤
│  🎵 Now Playing: Track - Artist    ⏮ ▶ ⏭    Queue (8)  │
└──────────────────────────────────────────────────────────┘
```

### Phase 2: DJ Mode Layout
```
┌──────────────────────────────────────────────────────────┐
│  🎵 Now Playing                                          │
│  [Art] Track Name - Artist         ════●════  2:34/4:12 │
│         ⏮  ▶  ⏭    Energy: ████████░░  Vibe: Upbeat    │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│   Up Next (8)  │            DJ Chat                      │
│                │                                         │
│   1. Track A   │  "Make it more chill for dinner"       │
│   2. Track B   │                                         │
│   3. Track C   │  🤖 "Got it! I'll gradually bring      │
│   4. Track D   │     the energy down over the next      │
│   5. Track E   │     few tracks. Adding some acoustic   │
│      ...       │     jazz and downtempo electronic."    │
│                │                                         │
└────────────────┴─────────────────────────────────────────┘
```

### Phase 4: Party Mode
```
┌──────────────────────────────────────────────────────────┐
│  🎉 PARTY MODE: Saturday Night                   👥 12   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         [LARGE ALBUM ART / VISUALIZER]                   │
│                                                          │
│              Track Name - Artist                         │
│              ════════════●══════  2:34 / 4:12            │
│                                                          │
├────────────────┬────────────────┬────────────────────────┤
│   Up Next (5)  │  Requests (3)  │      DJ Controls       │
│                │                │                        │
│   1. Track A   │  [▲3] Song X   │  [Auto-approve: ON]   │
│   2. Track B   │  [▲2] Song Y   │  [Vibe Lock: Party]   │
│   3. Track C   │  [▲1] Song Z   │  [Skip Current]       │
│                │                │  [Clear Queue]        │
└────────────────┴────────────────┴────────────────────────┘
```

---

## Technical Requirements by Phase

### Phase 1 Requirements
- [ ] Add `user-modify-playback-state` OAuth scope
- [ ] Create `/api/player/*` routes (8 endpoints)
- [ ] Build `NowPlaying` component with controls
- [ ] Implement playback state polling (1-3s interval)
- [ ] Add device selector dropdown
- [ ] Create queue preview component

### Phase 2 Requirements
- [ ] Add queue management tools for Claude
- [ ] Update system prompt for DJ mode
- [ ] Implement queue depth monitoring
- [ ] Add proactive queue replenishment
- [ ] Create "DJ Mode" conversation context

### Phase 3 Requirements
- [ ] Design session schema for KV storage
- [ ] Implement session persistence/recovery
- [ ] Build skip tracking and preference learning
- [ ] Create vibe trajectory planning
- [ ] Add time-of-day awareness

### Phase 4 Requirements
- [ ] WebSocket server for real-time multi-user
- [ ] Session sharing with QR codes
- [ ] Request/voting system
- [ ] Host approval workflow
- [ ] AI moderation for request fit

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Spotify Premium required for WebPlayback | High | Medium | Use Player API (works with any account playing elsewhere) |
| Rate limits on Player API | Medium | High | Cache state, debounce controls, batch operations |
| Queue API limitations | Medium | Medium | Spotify queue is limited; may need shadow queue |
| Session state complexity | Medium | Medium | Start simple, iterate |
| Multi-user sync issues | High | High | Start single-user, add collab later |

---

## Success Metrics

### Phase 1
- User can control playback without leaving app
- Queue visibility > 5 tracks ahead
- Device switching works reliably

### Phase 2
- Claude maintains queue depth automatically
- Vibe shift requests result in appropriate track additions
- < 5 seconds from request to queue update

### Phase 3
- Sessions survive page refresh
- Skip patterns influence future suggestions
- Vibe evolution feels natural (not jarring transitions)

### Phase 4
- Party guests can request songs easily
- Host approval workflow is fast (< 3 taps)
- AI moderation catches obvious misfits

---

## Immediate Next Steps

1. **Add OAuth scope** for playback control
2. **Create player routes** (basic state + control)
3. **Build NowPlaying component** (display + controls)
4. **Test with real playback** (verify API works)
5. **Add queue tools for Claude** (basic add-to-queue)
6. **Update chat mode** to include "DJ Mode"

---

## Appendix: Spotify API Reference

### Player Endpoints Needed
```
GET  /v1/me/player                    # Playback state
GET  /v1/me/player/devices            # Available devices
PUT  /v1/me/player/play               # Start playback
PUT  /v1/me/player/pause              # Pause playback
POST /v1/me/player/next               # Next track
POST /v1/me/player/previous           # Previous track
PUT  /v1/me/player/seek               # Seek position
PUT  /v1/me/player                    # Transfer playback
POST /v1/me/player/queue              # Add to queue
GET  /v1/me/player/queue              # Get queue (recently added)
```

### Web Playback SDK (Premium Only)
- Allows playing directly in browser
- No external device needed
- Full control over playback
- Requires `streaming` scope
