# DJ Product Capabilities (November 2025)

> Reference document for AI agents working on this codebase

## What This Product Is

DJ is an **AI-powered conversational playlist assistant** that helps users discover, analyze, and curate music through intelligent multi-step workflows. It combines Anthropic Claude with Spotify's catalog and enrichment data from Deezer and Last.fm.

**Current Focus:** Playlist analysis, creation, and **Live DJ Mode**
**NEW:** Live playback control and real-time DJ functionality

---

## Core Capabilities

### 1. Playlist Analysis

| Tool | What It Does | Returns |
|------|--------------|---------|
| `analyze_playlist` | Comprehensive single-call analysis | ~2-5KB summary with audio stats, genres, enrichment data |
| `get_playlist_tracks` | Paginated track fetching | Compact track info (name, artists, duration, popularity) |
| `get_track_details` | Full metadata for specific tracks | Complete track objects with album art, release dates |

**Enrichment Data (Automatic):**
- **Deezer**: BPM (45-220 range), popularity rank, gain normalization
- **Last.fm**: Crowd-sourced tags, listener counts, similar tracks, artist bios

### 2. AI-Powered Vibe Discovery

Three-step intelligent discovery workflow:

```
extract_playlist_vibe → plan_discovery_strategy → curate_recommendations
```

**Vibe Extraction** analyzes 9 dimensions:
- Emotional arc, production aesthetic, vocal characteristics
- Instrumentation, temporal context, mixing philosophy
- Mood trajectory, structural patterns, cultural resonance

**Discovery Strategy** creates multi-pronged search plan:
- Last.fm similar track selection
- Creative tag combinations
- Spotify search queries (era + mood + style)
- Tuned recommendation parameters

### 3. Spotify Catalog Access

| Tool | Purpose |
|------|---------|
| `search_spotify_tracks` | Full-text search with audio feature filters |
| `get_recommendations` | Algorithmic recommendations with seed tuning |
| `get_artist_info` | Artist metadata and genres |
| `get_artist_top_tracks` | Artist's popular tracks |
| `get_related_artists` | Artist network discovery |
| `get_album_info` | Album details with audio features |
| `get_available_genres` | Spotify genre seeds list |

### 4. Playlist Creation & Modification

| Tool | Capabilities |
|------|-------------|
| `create_playlist` | Create new playlist, add up to 100 tracks |
| `modify_playlist` | Add, remove, or reorder tracks |

### 5. Live DJ Mode (NEW)

Real-time playback control and queue management through conversational AI:

| Tool | Purpose |
|------|---------|
| `get_now_playing` | Get current track with progress |
| `get_queue` | View upcoming tracks in queue |
| `add_to_queue` | Add tracks to playback queue |
| `control_playback` | Play, pause, skip, or previous |

**DJ Mode Features:**
- NowPlaying bar with real-time track display and controls
- Context-aware DJ assistant that knows what's playing
- Proactive queue management (suggests additions when queue low)
- Conversational control ("skip this", "add some jazz", "what's playing?")

### 6. Real-Time Streaming

**SSE Event Types:**
- `thinking` - Claude's reasoning with enrichment progress
- `content` - Text response chunks
- `tool_start` / `tool_end` - Tool execution lifecycle
- `debug` / `log` - Server debugging
- `done` - Stream completion

**Progress Tracking:** Real-time updates during Deezer/Last.fm enrichment (every 2-5 tracks)

---

## Conversation Modes

| Mode | Purpose | Auto-Injected Context |
|------|---------|----------------------|
| **Analyze** | Question-focused analysis | Playlist ID |
| **Create** | Generate new playlists | None |
| **DJ** | Live playback control & queue management | Playlist ID + Current playback state |
| **Edit** | Modify existing playlists | Playlist ID |

---

## Current Limitations

### Implementation Status

| Feature | Status |
|---------|--------|
| Playback control (play/pause/skip) | ✅ Implemented (DJ Mode) |
| Queue management | ✅ Implemented (DJ Mode) |
| Device selection (Spotify Connect) | ⚠️ Partial (via Player API) |
| Real-time playback monitoring | ✅ Implemented (NowPlaying bar) |
| Multi-user collaboration | ❌ Not implemented |
| Session persistence | ❌ Not implemented (in-memory only) |
| Cross-playlist comparison | ❌ Not implemented |
| Feedback/learning system | ❌ Not implemented |

### Constraints

- Max 20 conversation turns (token management)
- Max 5 agentic loop iterations (cost control)
- 40 requests/second rate limit (API protection)
- Enrichment limits: 100 Deezer tracks, 50 Last.fm tracks per analysis
- Conversation resets on page refresh

---

## OAuth Scopes (Current)

```
playlist-modify-public       ✓ Used
playlist-modify-private      ✓ Used
user-read-private           ✓ Used
user-read-email             ✓ Used
playlist-read-private       ✓ Used
playlist-read-collaborative ✓ Used
user-read-playback-state    ✓ Used (Player API)
user-read-currently-playing ✓ Used (Player API)
user-read-recently-played   ⚠ Requested but NOT used
user-top-read               ⚠ Requested but NOT used
user-modify-playback-state  ✓ Used (Player API - play/pause/skip/seek)
streaming                   ✓ Requested (Premium only, for Web Playback SDK)
```

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React 19.2 Frontend                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ SpotifyAuth │  │ UserPlaylists│  │ ChatInterface   │  │
│  │   (OAuth)   │  │   (Select)   │  │ (SSE Streaming) │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ SSE
┌───────────────────────────▼─────────────────────────────┐
│              Cloudflare Workers (Hono 4.9)               │
│  ┌─────────────────────────────────────────────────────┐│
│  │               chat-stream.ts                         ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  ││
│  │  │ Claude       │  │ Spotify      │  │ Progress  │  ││
│  │  │ Sonnet 4.5   │  │ Tools        │  │ Narrator  │  ││
│  │  └──────────────┘  └──────────────┘  └───────────┘  ││
│  └─────────────────────────────────────────────────────┘│
│  ┌────────────────┐  ┌────────────────┐  ┌────────────┐ │
│  │AudioEnrichment │  │ LastFmService  │  │ KV Cache   │ │
│  │   (Deezer)     │  │  (Crowd Data)  │  │ (90 days)  │ │
│  └────────────────┘  └────────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Spotify API         Deezer API         Last.fm API
```

---

## Data Flow: Playlist Analysis

```
User: "Analyze this playlist"
        │
        ▼
    analyze_playlist()
        │
        ├─→ Fetch playlist metadata (name, description, total)
        │
        ├─→ Fetch tracks (up to 100)
        │
        ├─→ Calculate metadata analysis
        │   (popularity, genres, release years, explicit %)
        │
        ├─→ Deezer enrichment (40 TPS, 90-day cache)
        │   Stream progress every 5 tracks
        │
        ├─→ Last.fm enrichment (40 TPS, 7-day cache)
        │   Stream progress every 2 tracks
        │
        └─→ Return aggregated analysis (~2-5KB)
```

---

## File Reference

| Component | Path |
|-----------|------|
| Main App | `apps/web/src/App.tsx` |
| Chat Interface | `apps/web/src/features/chat/ChatInterface.tsx` |
| NowPlaying Bar | `apps/web/src/features/playback/NowPlaying.tsx` |
| SSE Client | `apps/web/src/lib/streaming-client.ts` |
| Auth Hook | `apps/web/src/hooks/useSpotifyAuth.ts` |
| Spotify Tools | `workers/api/src/lib/spotify-tools.ts` |
| Chat Stream | `workers/api/src/routes/chat-stream.ts` |
| Player Routes | `workers/api/src/routes/player-openapi.ts` |
| Audio Enrichment | `workers/api/src/services/AudioEnrichmentService.ts` |
| Last.fm Service | `workers/api/src/services/LastFmService.ts` |
| Guidelines | `.claude/guidelines/*.md` |

---

## What Claude Can Do Today

✅ Analyze any user playlist with rich insights
✅ Extract subtle vibe characteristics beyond genre tags
✅ Create intelligent multi-source discovery strategies
✅ Search Spotify catalog with audio feature filters
✅ Get algorithmic recommendations with tuning
✅ Create new playlists with up to 100 tracks
✅ Modify existing playlists (add/remove/reorder)
✅ Stream real-time progress during analysis
✅ **Control playback** (play, pause, skip, previous) - DJ Mode
✅ **Manage the play queue** (add tracks, view queue) - DJ Mode
✅ **See what's currently playing** (NowPlaying bar + get_now_playing tool)
✅ **Switch playback devices** (via Player API routes)

## What Claude Cannot Do Today

❌ Remember preferences across sessions
❌ Collaborate with multiple users
❌ Learn from user feedback
❌ Cross-playlist analysis/comparison
