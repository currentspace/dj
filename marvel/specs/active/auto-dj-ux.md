# Auto DJ: Unified Experience & Intelligent UX

**Owner:** team
**Status:** Active
**Created:** 2026-02-28

**Packs Required:**

- pack:dj-react-patterns@1.0.0
- pack:dj-cloudflare-workers@1.0.0
- pack:dj-spotify-integration@1.0.0
- pack:dj-llm-tools@1.0.0
- pack:code-quality@1.0.0

---

## 1. Goal

Redesign the DJ app into a single-page experience where the user lands, music starts, and everything works from one screen. The AI DJ should feel like talking to a friend who's DJing your party — responsive, opinionated, and always keeping the music flowing.

## 2. Non-Goals

- Custom audio engine / crossfade DSP (Spotify handles crossfade natively)
- Waveform visualization (requires audio analysis APIs that Spotify doesn't expose)
- Harmonic key matching (Spotify deprecated audio-features; Deezer doesn't reliably return key data)
- Mobile native app

## 3. Research Findings

### What Spotify's Own DJ Does (October 2025)

- Voice-based with a persona ("X") who narrates between songs
- Takes typed or spoken requests: genre, mood, artist, activity
- Distinguishes contexts: "focus while studying" vs "energetic for the gym"
- No user control over transitions or queue order — fully autonomous
- Engagement doubled YoY — users want passive listening with occasional steering

Source: [Spotify DJ Takes Requests](https://newsroom.spotify.com/2025-05-13/dj-voice-requests/), [Text-based DJ](https://techcrunch.com/2025/10/15/you-can-now-text-spotifys-ai-dj/)

### What Algoriddim djay Does (December 2025)

- AI Automix: analyzes tracks, finds best intro/outro transition points
- Auto tempo alignment: incoming track BPM adjusted to match current
- Transition effects: Filter, Echo, Tremolo, Neural Mix
- Now has Spotify integration in 56 markets
- Key insight: transition QUALITY matters more than track SELECTION

Source: [Algoriddim Automix](https://help.algoriddim.com/user-manual/djay-pro-windows/mixing-basics/automix), [Spotify + djay](https://magneticmag.com/2025/12/algoriddim-brings-spotify-integration-to-djay/)

### What Professional DJ Sets Do (DJ.Studio analysis)

- Five-phase energy arc: Warm-up → Build → Peak → Release → Finale
- Avoid sustained peak intensity — contrast between high and low maintains engagement
- Group similar genres into clusters; use breakdowns as bridges between clusters
- Phrasing: start transitions at phrase boundaries (8/16/32 bars)
- Engagement comes from tension-release cycles, not constant intensity

Source: [Anatomy of a Great DJ Mix](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic)

### What Our App Currently Does (Code-Verified)

- **Two separate pages** with zero shared context (chat at `/`, mix at `/mix`)
- **9-step startup sequence**: Login → see playlists → select playlist → switch to "DJ mode" in chat OR click "Mix" in header → see start dialog → click "Start" → wait 8-15s → see queue
- **NowPlaying bar** at the bottom of chat page is 48px tall, shows track + basic controls
- **Mix page** is dense: NowPlayingHero (300px album art) + Queue + Suggestions + VibeControls + AutoFill toggle — all visible at once with no hierarchy
- **Chat interface** is a standard messaging UI — messages scroll, tool calls show as status text, no visual connection to what's playing
- **No onboarding**: first-time user sees a list of playlists with no explanation of what the app does

## 4. Current UX Problems (Specific)

### P1: Too Many Steps to Start

A user who opens the app for the first time has to:

1. Login with Spotify (1 click + redirect)
2. See playlists page (automatic)
3. Click a playlist (1 click)
4. Realize they need to switch to Mix mode (cognitive load)
5. Click "Mix" in header (1 click)
6. See "Start Mix Session" dialog (another decision)
7. Click "Start Mix Session" (1 click)
8. Wait 8-15 seconds for Claude to generate suggestions
9. Music starts (finally)

**That's 5 user actions + 1 wait before music plays.** Spotify's DJ: 1 tap on "DJ" → music plays.

### P2: Two Pages, Two Mental Models

- Chat page: text-based, analytical, no playback controls beyond the tiny NowPlaying bar
- Mix page: visual, playback-focused, no chat/text input except the "Steer" text field in VibeControls
- User has to decide which mode they want before they start — but they don't know what each mode does

### P3: Information Overload on Mix Page

The MixInterface renders ALL of these simultaneously:

- NowPlayingHero (album art 300px, progress, controls, device picker, up-next preview)
- QueuePanel (scrollable list of tracks with metadata, scores, reasons, remove buttons)
- SuggestionsPanel (separate scrollable list with scores, BPM, reasons)
- VibeControls (energy slider, 4 preset buttons, steer text input, genre/era/BPM info display)
- AutoFillToggle

A new user doesn't know where to look. There's no visual hierarchy — everything competes for attention equally.

### P4: No Feedback Visibility

When the DJ adapts (vibe changes, queue rebuilds, taste model updates), the user sees nothing. There's no indicator of:

- "I noticed you skipped 3 tracks, shifting away from hip-hop"
- "Your energy has been climbing, keeping the momentum going"
- "Queue low, finding more tracks..."
- Progress of background operations

### P5: Steer UX is Buried

The natural-language steering (the most powerful feature) is a small text input at the bottom of VibeControls, labeled "Steer the Vibe" with a generic text placeholder. Meanwhile, the 4 preset buttons ("More Energy", "Chill Out", etc.) take prominent space but are one-shot actions with no feedback.

## 5. Proposed Changes

### 5.1 Single Page — DJ-First Layout

**Replace the two-page architecture with a single DJ page.** The chat page's analysis features become available through the chat input on the DJ page.

**New layout:**

```
┌─────────────────────────────────────────────────────┐
│  DJ                    [device ▼]  [⚙️]  [Logout]  │
├─────────────────────────────────────────────────────┤
│                                                      │
│              [Album Art - 200px]                     │
│              Track Name                              │
│              Artist                                  │
│              ── progress bar ──                      │
│              [◄◄] [⏵] [►►]                          │
│                                                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  DJ Messages (scrollable, newest at bottom)          │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🎧 Started from your "Chill Vibes" playlist.  │ │
│  │    Energy: medium, genres: lo-fi, ambient.     │ │
│  │    Playing 5 tracks to start.                  │ │
│  │                                                │ │
│  │ 🎧 Noticed you skipped the last 2 hip-hop     │ │
│  │    tracks. Shifting toward more indie.         │ │
│  │                                                │ │
│  │ 👤 throw in some jazz                          │ │
│  │                                                │ │
│  │ 🎧 Nice — blending in some jazz fusion.       │ │
│  │    Added 3 tracks from Snarky Puppy, Hiatus   │ │
│  │    Kaiyote, and BadBadNotGood.                 │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Up Next: Track Name — Artist            [2 more]   │
│                                                      │
├─────────────────────────────────────────────────────┤
│  [Type something to steer the DJ...]        [Send]  │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **NowPlaying is the hero** but compact (200px art, not 300px). It's the constant anchor.
- **DJ Messages replace both chat and suggestions panels.** The DJ narrates what it's doing, why it chose tracks, and how it's adapting. This is the primary feedback channel.
- **Up Next is a single line** showing the next track, not a full scrollable panel. Tap to expand.
- **Text input at the very bottom** — the most natural mobile position. This IS the steering interface. No separate "Steer the Vibe" text field.
- **No VibeControls panel, no SuggestionsPanel, no QueuePanel visible by default.** These become expandable drawers accessible via the gear icon or swipe gestures.

### 5.2 One-Tap Start

**Replace the 9-step flow with a 1-tap start.**

When the user opens the app (already authenticated):

1. Show their playlists as a horizontal scrollable strip at top
2. Show a prominent "▶ Start DJ" button below
3. Below that: "Pick a playlist to seed the vibe, or just hit Start"

When they tap Start:

- If a playlist is selected → seed from it (Phase 2 already built)
- If no playlist selected → "surprise me" from top tracks (Phase 2 already built)
- Music starts within 3-5 seconds (fallback pool plays immediately, AI-generated queue loads in background)

**The first thing the DJ says:**

```
🎧 Starting from your "Chill Vibes" playlist.
   Feeling: lo-fi, ambient, indie. Energy: medium.
   Let me find you some great tracks...
```

If using "surprise me":

```
🎧 Based on what you've been listening to lately:
   lots of indie rock and electronic.
   Let's see where this goes...
```

### 5.3 DJ Narration System

**The DJ should narrate its decisions in the message stream.** This is the Opus 4.6 opportunity — use the most capable model to be an opinionated, contextual DJ personality.

**Narration triggers (automatic, not user-initiated):**

| Event               | What the DJ says                                                         |
| ------------------- | ------------------------------------------------------------------------ |
| Session start       | Describes the seed vibe, what it noticed about the playlist              |
| Track queued        | Brief reason: "Added X — great transition from the current BPM"          |
| Skip detected       | "Noticed you skipped that one. Steering away from [genre/artist]"        |
| 3+ skips            | "Okay, clearly not the right direction. Rebuilding with [new vibe]"      |
| Vibe shift detected | "Energy's been climbing for 4 tracks. Keeping it going."                 |
| Queue low           | "Running low on tracks, finding more..."                                 |
| Fallback used       | "Pulling from your playlist favorites while I think of something better" |
| User steers         | Responds conversationally, explains what it's changing                   |

**Implementation:** Each narration is a single Opus 4.6 call with a tight prompt (~100 tokens output) that receives the event context and generates a 1-2 sentence response in the DJ's voice. These are stored in `session.conversation` and sent to the frontend via a new SSE event type `dj_message` on the player-stream.

**Cost:** ~$0.001 per narration (Opus with 100-token output). At ~15 narrations per hour: ~$0.015/hour. Negligible compared to suggestion generation.

### 5.4 Expandable Panels (Progressive Disclosure)

The Queue, Suggestions, and Vibe details are available but hidden by default:

- **Tap "Up Next" line** → expands to show full queue with remove/reorder
- **Tap ⚙️ gear icon** → slide-up drawer with: Energy slider, BPM range, genre preferences, auto-fill toggle
- **Long-press on a DJ message about a track** → shows track details (album, BPM, popularity, why it was chosen)

This keeps the default view clean — NowPlaying + DJ Messages + Input — while making everything accessible.

### 5.5 Playback-First Empty State

When the user first opens the app (no session):

```
┌─────────────────────────────────────────┐
│                                          │
│        🎵 DJ                             │
│                                          │
│   Your AI-powered DJ that learns         │
│   what you like and keeps the            │
│   music flowing.                         │
│                                          │
│   ── Your Playlists ──                   │
│   [art] Chill    [art] Work   [art] Run │
│   [art] Party    [art] Focus  [→ more]  │
│                                          │
│   [▶ Start DJ]                           │
│                                          │
│   Pick a playlist above to seed the      │
│   vibe, or just hit Start.              │
│                                          │
└─────────────────────────────────────────┘
```

### 5.6 Chat as Steering (Not a Separate Feature)

The text input at the bottom serves ALL purposes:

- **"more energy"** → vibe steer (parsed as preset or sent to Claude)
- **"play some Radiohead"** → artist search + queue
- **"what's playing?"** → DJ responds with current track info
- **"analyze my Running playlist"** → full playlist analysis (existing chat-stream endpoint)
- **"skip"** → skip current track

This means the existing `POST /api/chat-stream/message` endpoint (with all 15 tools) becomes the input handler for the DJ page too. The mode is always "dj" — the DJ has access to all tools and uses them contextually.

## 6. Files Changed

### New Files

| File                                             | Purpose                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| `apps/web/src/features/dj/DJPage.tsx`            | Single-page DJ layout                             |
| `apps/web/src/features/dj/DJMessages.tsx`        | Narration message stream                          |
| `apps/web/src/features/dj/PlaylistStrip.tsx`     | Horizontal scrollable playlist picker             |
| `apps/web/src/features/dj/CompactNowPlaying.tsx` | Compact 200px album art + controls                |
| `apps/web/src/features/dj/UpNext.tsx`            | Single-line expandable next track                 |
| `apps/web/src/features/dj/SettingsDrawer.tsx`    | Slide-up vibe controls + preferences              |
| `apps/web/src/features/dj/DJPage.module.css`     | Styles                                            |
| `apps/web/src/stores/djStore.ts`                 | Unified store (replaces mixStore + playlistStore) |
| `workers/api/src/lib/dj-narrator.ts`             | Opus 4.6 narration generator                      |

### Modified Files

| File                                      | Change                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| `apps/web/src/App.tsx`                    | Single `<DJPage />` (remove route switching)         |
| `apps/web/src/stores/navigationStore.ts`  | Simplify to `{ showSettings: boolean }` or remove    |
| `workers/api/src/routes/player-stream.ts` | Add `dj_message` SSE event type for narration push   |
| `workers/api/src/routes/mix-openapi.ts`   | Trigger narration on key events (start, skip, steer) |
| `apps/web/src/stores/playbackStore.ts`    | Handle `dj_message` SSE event                        |

### Deprecated Files

| File                                               | Action                         |
| -------------------------------------------------- | ------------------------------ |
| `apps/web/src/stores/mixStore.ts`                  | Replaced by djStore            |
| `apps/web/src/stores/playlistStore.ts`             | Replaced by djStore            |
| `apps/web/src/features/chat/ChatInterface.tsx`     | Replaced by DJMessages + input |
| `apps/web/src/features/mix/MixInterface.tsx`       | Replaced by DJPage             |
| `apps/web/src/features/mix/NowPlayingHero.tsx`     | Replaced by CompactNowPlaying  |
| `apps/web/src/features/mix/SuggestionsPanel.tsx`   | Absorbed into DJ narration     |
| `apps/web/src/features/mix/VibeControls.tsx`       | Moved to SettingsDrawer        |
| `apps/web/src/pages/MixPage.tsx`                   | Replaced by DJPage             |
| `apps/web/src/features/playlist/UserPlaylists.tsx` | Replaced by PlaylistStrip      |

## 7. Acceptance Criteria

- [ ] App opens to single DJ page (no route switching)
- [ ] Playlists shown as horizontal strip at top
- [ ] One-tap "Start DJ" button → music playing within 5 seconds
- [ ] "Surprise me" works without selecting a playlist
- [ ] DJ narrates its decisions in the message stream
- [ ] Skip detection triggers DJ narration ("noticed you skipped...")
- [ ] Text input steers the DJ ("more energy", "play some jazz", "analyze my playlist")
- [ ] Queue, vibe controls, and details are in expandable panels (not always visible)
- [ ] NowPlaying is compact (200px art, inline controls)
- [ ] "Up Next" shows next track in a single line, expandable
- [ ] All existing mix features accessible (queue management, vibe controls, auto-fill)
- [ ] Works on mobile (responsive, touch-friendly)

## 8. Verification Plan

```bash
pnpm typecheck
pnpm test --run
pnpm build
```

Manual:

1. Open app → see playlists + Start button (no routing)
2. Tap Start without selecting playlist → music plays within 5s
3. See DJ narration: "Starting from your recent listening..."
4. Skip 3 tracks → DJ narrates the shift
5. Type "more jazz" → DJ responds and queue changes
6. Tap "Up Next" → queue expands
7. Tap ⚙️ → settings drawer slides up
8. Test on mobile viewport (375px width)

## 9. Notes for MARVEL Runner

- **Risk level:** high (complete frontend restructure)
- **Implementation order:** djStore first → DJPage layout → DJMessages → narration backend → expandable panels → cleanup
- **Key insight from research:** Spotify's DJ succeeds because it's OPINIONATED and NARRATES. Our DJ should have a voice — not just silently manage a queue. Opus 4.6 is the differentiator here.
- **Do not over-engineer panels:** Start with the simplest possible expandable drawer. Ship it, iterate.
- **Preserve backend:** All backend work from v2 spec is unchanged. This is purely frontend + narration.

Sources:

- [Spotify DJ Takes Requests](https://newsroom.spotify.com/2025-05-13/dj-voice-requests/)
- [Text-based Spotify DJ](https://techcrunch.com/2025/10/15/you-can-now-text-spotifys-ai-dj/)
- [Algoriddim Automix](https://help.algoriddim.com/user-manual/djay-pro-windows/mixing-basics/automix)
- [Algoriddim + Spotify](https://magneticmag.com/2025/12/algoriddim-brings-spotify-integration-to-djay/)
- [Anatomy of a Great DJ Mix](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic)
- [Spotify Playlist Transitions](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/)
