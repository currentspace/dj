# DJ Product Capabilities (November 2025)

> Reference document for AI agents working on this codebase

## What This Product Is

DJ is an **AI-powered conversational playlist assistant** that helps users discover, analyze, and curate music through intelligent multi-step workflows. It combines Anthropic Claude with Spotify's catalog and enrichment data from Deezer and Last.fm.

**Current Focus:** Playlist analysis and creation through chat
**NOT Currently:** Live playback control or real-time DJ functionality

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

### 5. Real-Time Streaming

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
| **Edit** | Modify existing playlists | Playlist ID |

---

## Current Limitations

### NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| Playback control (play/pause/skip) | ❌ None |
| Queue management | ❌ None |
| Device selection (Spotify Connect) | ❌ None |
| Real-time playback monitoring | ❌ None |
| Multi-user collaboration | ❌ None |
| Session persistence | ❌ None (in-memory only) |
| Cross-playlist comparison | ❌ None |
| Feedback/learning system | ❌ None |

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
user-read-playback-state    ⚠ Requested but NOT used
user-read-currently-playing ⚠ Requested but NOT used
user-read-recently-played   ⚠ Requested but NOT used
user-top-read               ⚠ Requested but NOT used
```

**Missing for Playback Control:**
```
user-modify-playback-state  ❌ Not requested
streaming                   ❌ Not requested (Premium only)
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
| SSE Client | `apps/web/src/lib/streaming-client.ts` |
| Auth Hook | `apps/web/src/hooks/useSpotifyAuth.ts` |
| Spotify Tools | `workers/api/src/lib/spotify-tools.ts` |
| Chat Stream | `workers/api/src/routes/chat-stream.ts` |
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

## What Claude Cannot Do Today

❌ Control playback (play, pause, skip)
❌ Manage the play queue
❌ See what's currently playing
❌ Switch playback devices
❌ Remember preferences across sessions
❌ Collaborate with multiple users
❌ Learn from user feedback
