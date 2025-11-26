# DJ Product Capabilities Overview

> **For AI Agents**: This document describes the current capabilities of the DJ application.
> Use this to understand what the system can do when helping users.

## What This Product Is

DJ is an AI-powered music companion that helps users discover, analyze, create, and control their Spotify music through natural conversation. It combines Claude AI with Spotify's API and enrichment data from Deezer and Last.fm.

**Production URL**: https://dj.current.space

---

## Core Capabilities

### 1. Conversational Music AI

Users chat with an AI DJ that can:

- **Understand music context** - Analyze playlists to understand genre, mood, era, energy levels
- **Execute actions** - Search tracks, create playlists, control playback, queue songs
- **Provide insights** - Explain what makes a playlist work, suggest improvements
- **Stream responses** - Real-time typing effect with progress updates during long operations

**4 Conversation Modes**:
| Mode | Purpose | Auto-Context |
|------|---------|--------------|
| **Analyze** | Deep-dive playlist analysis | Selected playlist ID |
| **Create** | Build new playlists from descriptions | None |
| **DJ** | Real-time playback control | Selected playlist ID |
| **Edit** | Modify existing playlists | Selected playlist ID |

---

### 2. Playlist Analysis & Discovery

#### What Claude Can Analyze

| Data Point | Source | Description |
|------------|--------|-------------|
| Genre/Mood Tags | Last.fm | Crowd-sourced genre and mood labels |
| BPM (Tempo) | Deezer | Beats per minute (45-220 range) |
| Popularity | Spotify + Last.fm | Track popularity scores and play counts |
| Release Era | Spotify + Deezer | Year range and average release date |
| Similar Tracks | Last.fm | Recommendations for transitions |
| Artist Info | Last.fm | Bio, similar artists, genre tags |

#### Vibe-Driven Discovery (AI-Powered)

A multi-step intelligent discovery system:

1. **Extract Vibe** → Analyze emotional arc, production aesthetic, vocal style, instrumentation
2. **Plan Strategy** → Create discovery plan with Last.fm similar tracks, Spotify queries, tag searches
3. **Execute Searches** → Find candidate tracks from multiple sources
4. **Curate Results** → AI ranks tracks by vibe alignment and diversity

---

### 3. Playback Control (DJ Mode)

#### Available Controls

| Action | Description |
|--------|-------------|
| Play/Pause | Start or pause current playback |
| Next/Previous | Skip forward or back |
| Add to Queue | Queue a specific track next |
| Seek | Jump to position in current track |
| Transfer Device | Move playback to different device |
| Shuffle | Toggle shuffle mode on/off |
| Repeat | Set repeat mode (off/track/context) |
| Volume | Adjust volume (0-100%) |

#### What Claude Can See

- Currently playing track (name, artist, album, progress)
- Playback queue (upcoming tracks)
- Available devices (speakers, phones, computers)
- Playback state (shuffle, repeat, device info)

---

### 4. Playlist Management

#### Create New Playlists

Claude can create playlists from natural language:
- "Make me a chill Sunday morning playlist"
- "Create a high-energy workout mix with 90s hip hop"
- "Build a dinner party playlist that flows well"

#### Modify Existing Playlists

- Add tracks at specific positions
- Remove unwanted tracks
- Reorder tracks for better flow
- Get suggestions for what's missing

---

### 5. Music Search

Claude can search Spotify for:
- Tracks by name, artist, or album
- Specific song requests
- Genre or mood-based queries

Search results include: track name, artists, album, popularity, duration, Spotify URI.

---

## Technical Details for Agents

### Available Tools (18 Total)

**Discovery & Analysis**:
- `analyze_playlist` - Full playlist analysis with enrichment
- `get_playlist_tracks` - Paginated track fetching (1-50 per call)
- `get_track_details` - Complete metadata for specific tracks
- `search_spotify_tracks` - Search Spotify catalog

**Vibe Discovery**:
- `extract_playlist_vibe` - AI vibe analysis
- `plan_discovery_strategy` - AI discovery planning
- `recommend_from_similar` - Last.fm → Spotify track matching
- `recommend_from_tags` - Tag-based discovery
- `curate_recommendations` - AI-powered track curation

**Playlist Management**:
- `create_playlist` - Create new playlist
- `modify_playlist` - Add/remove/reorder tracks

**Playback Control**:
- `get_now_playing` - Current track info
- `get_queue` - Playback queue
- `get_playback_state` - Full playback details
- `control_playback` - Play/pause/skip
- `add_to_queue` - Queue a track
- `set_shuffle`, `set_repeat`, `set_volume` - Playback settings
- `transfer_playback` - Switch devices

### Data Enrichment

| Service | Data Provided | Rate Limit | Cache TTL |
|---------|--------------|------------|-----------|
| Deezer | BPM, rank, gain, release date | 40/sec | 90 days |
| Last.fm | Tags, listeners, similar tracks, artist info | 40/sec | 7 days |

### Constraints

- **Playlist analysis**: Up to 100 tracks enriched with Deezer, 50 with Last.fm
- **Batch operations**: Up to 100 tracks per playlist modification
- **Search results**: Up to 50 tracks per search
- **Token expiration**: Spotify tokens expire after ~1 hour

---

## User Authentication

- **OAuth Flow**: Spotify PKCE-based authentication
- **Required Scopes**: playlist-modify-public, playlist-modify-private, user-read-private, user-read-email, playlist-read-private, playlist-read-collaborative, user-read-playback-state, user-read-currently-playing, user-read-recently-played, user-top-read
- **Premium Required**: Some playback features may require Spotify Premium

---

## Current Limitations

1. **Single User**: No multi-user collaboration features
2. **No Persistent Queue**: Queue state is Spotify's native queue, not app-managed
3. **No Mix Transitions**: No crossfade or transition effects between tracks
4. **Session-Based**: Conversation history not persisted between sessions
5. **Reactive Only**: AI responds to requests, doesn't proactively suggest based on context
6. **No Tempo Matching**: BPM data available but not used for automatic beat-matching
