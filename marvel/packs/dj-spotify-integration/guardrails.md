# DJ Spotify Integration

Spotify API patterns, OAuth handling, data enrichment, playback control, and queue management.

## Iterative Data Fetching (Critical)

- NEVER send full Spotify track objects to Claude; always strip to compact format
- Follow the 3-tier data strategy to keep tool results under 5KB:
  - **Tier 1** `analyze_playlist`: Aggregate stats + track IDs only (~2-5KB regardless of playlist size)
  - **Tier 2** `get_playlist_tracks`: Compact info per track — name, artists, duration, popularity, uri (~100 bytes/track, paginated)
  - **Tier 3** `get_track_details`: Full metadata with album art, release dates (~2.5KB/track, fetch selectively)
- Compact track format: `{ id, name, artists: string[], duration_ms, popularity, uri, album: string }`
- Strip: full album objects, images arrays, external_ids, available_markets, preview_url (unless specifically needed)

## OAuth & Token Security

- Spotify tokens use OAuth2 implicit grant flow with PKCE
- Extract Bearer token from `Authorization` header on every request; never cache tokens server-side beyond KV session
- Proactive token refresh: schedule refresh 5 minutes before expiry on the client
- NEVER expose Spotify tokens in logs, error messages, or SSE events
- Session tokens in KV have 4-hour TTL; always set `expirationTtl`
- Required scopes: `playlist-modify-public`, `playlist-modify-private`, `user-read-private`, `user-read-email`, `playlist-read-private`, `playlist-read-collaborative`, `user-read-playback-state`, `user-read-currently-playing`, `user-read-recently-played`, `user-top-read`, `user-modify-playback-state`, `streaming`

## Playback SSE Delta Protocol

- Server polls Spotify `/v1/me/player` every 1 second
- Send only deltas, not full state: `tick` (~20 bytes) instead of `init` (~500 bytes)
- Event types: `init`, `tick`, `track`, `state`, `device`, `modes`, `volume`, `context`, `idle`
- Every event carries a sequence number (`seq`) for ordering
- Client interpolates progress every 250ms between server ticks for smooth UI
- Max stream lifetime: 5 minutes; send `reconnect` event then close
- Max 5 consecutive errors before closing stream
- Handle `auth_expired` events: client refreshes token, then reconnects

## Data Enrichment Services

- **Deezer** (BPM/rank/gain): Query by ISRC first (`/track/isrc:{isrc}`), fallback to MusicBrainz for ISRC lookup
- **Last.fm** (tags/popularity/similar): 4 API calls per track (correction, info, tags, similar) + separate artist batch
- Cache Deezer results for 90 days; cache Last.fm results for 7 days; cache misses for 5 minutes
- Deduplicate artist enrichment: fetch unique artists separately to avoid N+1 (50 tracks with 20 artists = 20 calls, not 50)
- BPM validation: only accept values between 45-220
- All enrichment is best-effort; failures must not block the main response

## Queue Management

- DJ queue (KV) and Spotify queue (API) are separate systems; sync them explicitly
- When adding to DJ queue, also call Spotify's `POST /v1/me/player/queue` as best-effort
- Target queue depth: 5 tracks; auto-fill when queue drops below target
- Track completion detection: playback stream detects track ID change; previous track assumed complete
- On track change: move from queue to history, update vibe, auto-fill if needed
- Queue max: 10 tracks; history max: 20 tracks (newest first)

## Deprecated Spotify Endpoints

- Spotify `/audio-features` endpoint deprecated November 2024; use Deezer for BPM/energy data instead
- Spotify `/recommendations` endpoint deprecated November 2024; use Last.fm similar + vibe-driven discovery
- Do not add new code that calls these deprecated endpoints
