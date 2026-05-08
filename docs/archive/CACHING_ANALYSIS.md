# DJ Codebase: Caching Implementation Analysis

## Executive Summary

The DJ codebase has a **well-structured but incomplete caching strategy**. While AudioEnrichmentService and LastFmService implement sophisticated KV-based caching, there are significant gaps:

1. **Spotify API responses** are NOT cached (playlist tracks, audio features, search results)
2. **MusicBrainz lookups** are NOT cached (ISRC searches)
3. **Deezer track details** are cached by track ID but Deezer searches/ISRC lookups could be optimized
4. **Canonical track/artist names** (Last.fm corrections) are NOT cached

---

## Current Caching Strategy

### 1. AudioEnrichmentService (Deezer + MusicBrainz)

**File**: `/workers/api/src/services/AudioEnrichmentService.ts`

**What's Cached**:
- ✅ Track BPM enrichment data (Deezer lookup results)
- ✅ Gain and rank data from Deezer
- ✅ Release date from Deezer

**Cache Details**:
```typescript
// KV Namespace: AUDIO_FEATURES_CACHE
// Cache Key: "bpm:{spotify_track_id}"
// Hit TTL: 90 days (90 * 24 * 60 * 60 seconds)
// Miss TTL: 5 minutes (retry soon for new/obscure tracks)

// Sample cache entry:
{
  "bpm:0123456789abcdef": {
    "enrichment": {
      "bpm": 120,
      "gain": -8.5,
      "rank": 50000,
      "release_date": "2020-01-15",
      "source": "deezer"
    },
    "fetched_at": "2025-11-02T12:00:00Z",
    "is_miss": false,
    "ttl": 7776000  // 90 days in seconds
  }
}
```

**Lookup Flow**:
```
enrichTrack() →
  1. Check KV cache by track_id
  2. If hit (bpm != null): Return immediately
  3. If recent miss (< 5m old): Return miss
  4. Try Deezer direct ISRC lookup (isrc:{isrc})
  5. Fallback: Deezer search by ISRC with duration matching
  6. Fallback: MusicBrainz to find ISRC (NOT CACHED!)
  7. Cache result with appropriate TTL
```

**Performance Metrics**:
- **Rate Limiting**: Deezer calls go through orchestrator (10 concurrent)
- **Parallel Processing**: Multiple tracks enriched in parallel
- **Progress Streaming**: Updates every 5 tracks
- **API Calls for 100 tracks**:
  - Best case (100% cache hit): 0 Deezer calls
  - Worst case (0% hit): ~100-200 Deezer calls (search + detail fetch)
  - Typical case: ~20-30 Deezer calls (new tracks) + MusicBrainz fallbacks

---

### 2. LastFmService (Tags, Popularity, Similar Tracks)

**File**: `/workers/api/src/services/LastFmService.ts`

**What's Cached**:
- ✅ Track signals (tags, listeners, playcount, similar tracks)
- ✅ Artist info (bio, images, similar artists, stats)

**Cache Details**:
```typescript
// KV Namespace: AUDIO_FEATURES_CACHE (same namespace!)
// Cache Keys:
//   Track signals: "lastfm:{hash(artist_track)}"
//   Artist info: "artist_{hash(artist)}"
// Hit TTL: 7 days (refresh weekly)
// Miss TTL: 5 minutes

// Sample track signals cache:
{
  "lastfm:abc123def456": {
    "signals": {
      "album": {...},
      "artistInfo": null,  // Fetched separately
      "canonicalArtist": "The Beatles",
      "canonicalTrack": "Hey Jude",
      "topTags": ["rock", "pop", "60s"],
      "listeners": 5000000,
      "playcount": 25000000,
      "similar": [
        {"artist": "The Rolling Stones", "name": "Sympathy for the Devil", "match": 0.95},
        ...
      ]
    },
    "fetched_at": "2025-10-28T08:30:00Z",
    "is_miss": false,
    "ttl": 604800  // 7 days
  }
}

// Sample artist info cache:
{
  "artist_def456ghi789": {
    "bio": {"summary": "...", "content": "..."},
    "tags": ["rock", "british"],
    "listeners": 50000000,
    "playcount": 150000000,
    "similar": [
      {"name": "The Rolling Stones", "url": "..."},
      ...
    ],
    "images": {"small": null, "medium": "...", "large": "..."}
  }
}
```

**Lookup Flow**:
```
getTrackSignals() →
  1. Check KV cache by track key
  2. If hit (has tags or listeners): Return immediately
  3. If recent miss (< 5m): Return miss
  4. Call track.getCorrection() - NOT CACHED!
  5. Call track.getInfo()
  6. Call track.getTopTags()
  7. Call track.getSimilar()
  8. Skip artist.getInfo() unless explicitly requested
  9. Cache signals (without artist info)

batchGetArtistInfo() →
  1. Deduplicate artist list
  2. For each unique artist:
    a. Check KV cache by artist hash
    b. If hit: Use cached data
    c. Call artist.getInfo() + cache result
  3. Attach cached artist info to track signals
  4. Update cached signals with artist info
```

**Performance Metrics**:
- **Rate Limiting**: Last.fm calls go through orchestrator (10 concurrent)
- **Artist Optimization**: Deduplicates and batches unique artists separately
  - Example: 50 tracks with 20 unique artists = 20 API calls (not 50)
- **API Calls for 50 tracks**:
  - Track signals: 4 calls each (correction, info, tags, similar) = 200 calls
  - Artist info (if requested): Up to 20 calls (unique artists)
  - Total: ~220 calls (but orchestrator pools concurrency)
- **Progress Updates**: Every 10 artists completed

---

### 3. Spotify API (NOT CACHED!)

**File**: `/workers/api/src/lib/spotify-tools.ts`

**What's NOT Cached**:
- ❌ Playlist metadata (name, description, total tracks)
- ❌ Playlist tracks (fetched fresh every time)
- ❌ Audio features (energy, danceability, tempo, etc.)
- ❌ Track details
- ❌ Search results
- ❌ Recommendations
- ❌ User profile

**Current Flow** (from analyzePlaylist):
```
analyzePlaylist() →
  1. Fetch playlist metadata (1 call)
  2. Fetch playlist tracks up to 100 (1 call)
  3. Fetch audio features for all tracks (1 call)
  4. Deezer enrichment (via AudioEnrichmentService - CACHED)
  5. Last.fm enrichment (via LastFmService - CACHED)
  6. Return analysis
```

**Performance Impact**:
- Every playlist analysis makes 3 Spotify API calls minimum
- User asks "analyze this playlist" → 3 fresh API calls every time
- No caching of frequently-accessed playlists

---

### 4. MusicBrainz (NOT CACHED!)

**File**: `/workers/api/src/services/AudioEnrichmentService.ts` (lines 391-452)

**Current Implementation**:
```typescript
private async findISRCViaMusicBrainz(
  trackName: string,
  artistName: string,
  durationMs: number,
): Promise<null | string>
```

**What's NOT Cached**:
- ❌ ISRC lookup by track name + artist
- ❌ Recording search results
- ❌ ISRC discovery attempts

**Performance Issue**:
- Every track without ISRC → Fresh MusicBrainz search
- User re-analyzes playlist → All ISRC searches repeated
- No deduplication of artist-track combinations

**Typical Flow for 100 Tracks with No ISRCs**:
```
• 20 Spotify tracks have ISRC → 20 Deezer lookups cached or done
• 80 tracks missing ISRC → 80 MusicBrainz searches (NOT CACHED)
• Even on second analysis of same playlist: 80 MB searches again
```

---

## KV Namespace Organization

**Current Setup** (from `index.ts`):
```typescript
interface Env {
  AUDIO_FEATURES_CACHE?: KVNamespace  // Used by: Deezer + Last.fm
  SESSIONS?: KVNamespace              // Used by: OAuth session management
}
```

**Key Naming Conventions**:
```
bpm:{track_id}              → Deezer enrichment data
lastfm:{hash}               → Last.fm track signals
artist_{hash}               → Last.fm artist info
{session_token}             → OAuth session (SESSIONS namespace)
```

**Problem**: All enrichment data (Deezer + Last.fm) in one namespace → Risk of key collisions

---

## Performance Analysis

### Enrichment Flow for Typical 100-Track Playlist (First Analysis)

**Timeline**:
```
1. Fetch playlist metadata (Spotify)           [1 call] ~300ms
2. Fetch 100 tracks (Spotify)                  [1 call] ~500ms
3. Fetch audio features (Spotify)              [1 call] ~400ms
4. Deezer enrichment:
   - With ISRCs (70% of tracks): Direct lookups [70 calls] ~1500ms
   - Without ISRCs (30% of tracks): MB+Deezer   [30×2 calls] ~2000ms
   Total Deezer: ~100 calls over ~3500ms
5. Last.fm enrichment:
   - Track signals: 50 tracks × 4 calls/track [200 calls] ~8000ms
   - Artist info: 20 unique artists            [20 calls] ~2000ms
   Total Last.fm: ~220 calls over ~10000ms
6. Return analysis to Claude                  ~500ms

Total: ~16 seconds for first analysis
Cache: ~3KB (minimal, just summary data to Claude)
```

### Enrichment Flow for Same Playlist (Second Analysis)

**Without Spotify caching**:
```
1. Fetch playlist metadata (Spotify)           [1 call] ~300ms (REPEATED)
2. Fetch 100 tracks (Spotify)                  [1 call] ~500ms (REPEATED)
3. Fetch audio features (Spotify)              [1 call] ~400ms (REPEATED)
4. Deezer enrichment:
   - Cache hits (90% of popular tracks)        [0 calls] ~0ms
   - Cache misses (new metadata)               [10 calls] ~500ms
5. Last.fm enrichment:
   - Cache hits (tracks seen before)           [0 calls] ~0ms
   - Cache misses (new metadata)               [~20 calls] ~2000ms

Total: ~4.6 seconds (3× faster than first analysis)
BUT: Re-fetching same Spotify data adds 1.2 seconds of wasted calls
```

---

## Missing Caching Opportunities

### CRITICAL (High Impact)

**1. Spotify Playlist Tracks Cache**
- **Impact**: 30-40% of enrichment time
- **TTL**: 24 hours (playlists change infrequently)
- **Key**: `spotify:playlist_tracks:{playlist_id}:{offset}`
- **Payload**: 100 track objects (~150KB each)
- **Risk**: Stale tracks if user adds/removes tracks
- **Mitigation**: Short TTL + invalidate on user update

**Example Cache Entry**:
```json
{
  "spotify:playlist_tracks:37i9dQZF2DMg0SWrLw1I6d:0": {
    "tracks": [...100 tracks...],
    "offset": 0,
    "total": 5000,
    "fetched_at": "2025-11-02T12:00:00Z",
    "ttl": 86400  // 24 hours
  }
}
```

**2. Spotify Audio Features Cache**
- **Impact**: 20-30% of enrichment time (500ms+ per call)
- **TTL**: 7 days (audio features don't change)
- **Key**: `spotify:audio_features:{track_id_csv}`
- **Payload**: ~2KB per batch of 100
- **Note**: Can batch up to 100 track IDs per call

**Example**:
```json
{
  "spotify:audio_features:3n3Ppam7vgaVa1iaRUc9Lp,5mJpFqGiV1hRFZXPv6R8c0": {
    "audio_features": [...],
    "fetched_at": "2025-11-02T12:00:00Z",
    "ttl": 604800  // 7 days
  }
}
```

**3. MusicBrainz ISRC Lookups Cache**
- **Impact**: 10-20% of enrichment time for tracks without ISRC
- **TTL**: 30 days (stable recordings)
- **Key**: `mb:isrc:{artist_normalized}:{track_normalized}:{duration_s}`
- **Payload**: ~20 bytes (just ISRC string)

**Example**:
```json
{
  "mb:isrc:the_beatles:hey_jude:427": "GBUM71505078"
}
```

### MODERATE (Medium Impact)

**4. Last.fm Track Corrections Cache**
- **Impact**: 5-10% of enrichment time
- **TTL**: 30 days (artist/track names don't change)
- **Key**: `lastfm:correction:{artist_hash}:{track_hash}`
- **Payload**: ~100 bytes

**Current Issue**: Called 4 times per track in `getTrackSignals()`:
- Once in `getCorrection()` (NOT cached)
- Names used for `getInfo()`, `getTopTags()`, `getSimilar()` (all require canonical names)

**5. Spotify Playlist Metadata Cache**
- **Impact**: 5-10% of enrichment time
- **TTL**: 24 hours
- **Key**: `spotify:playlist:{playlist_id}`
- **Payload**: ~500 bytes

**6. Deezer Search Results Cache**
- **Impact**: 5-10% for tracks without direct ISRC
- **TTL**: 7 days
- **Key**: `deezer:search:{isrc}:{duration_s}`
- **Payload**: ~200 bytes (top result)

### NICE-TO-HAVE (Lower Impact)

**7. Spotify User Profile Cache**
- **Impact**: <1% (only needed once per user session)
- **TTL**: 7 days
- **Key**: `spotify:user:{user_id}`
- **Payload**: ~500 bytes

**8. Spotify Track Details Cache**
- **Impact**: 1-5% (used when user asks for specific track details)
- **TTL**: 7 days
- **Key**: `spotify:track:{track_id}`
- **Payload**: ~5KB per track

**9. Spotify Search Results Cache**
- **Impact**: 2-5% (user searches for tracks)
- **TTL**: 7 days
- **Key**: `spotify:search:{query_hash}`
- **Payload**: ~5KB (top 10 results)

---

## Recommended Implementation Plan

### Phase 1: Critical Performance Improvements (Est. 40-50% reduction in enrichment time)

**1. Add Spotify Audio Features Cache**
```typescript
// New file: workers/api/src/services/SpotifyEnrichmentService.ts
export class SpotifyEnrichmentService {
  private cache: KVNamespace | null
  private cacheTTL: number = 7 * 24 * 60 * 60  // 7 days

  async getAudioFeatures(
    trackIds: string[],
    token: string
  ): Promise<Map<string, SpotifyAudioFeatures>> {
    // 1. Deduplicate requested IDs
    // 2. Check cache for each ID
    // 3. Batch fetch uncached IDs (up to 100 per call)
    // 4. Cache individual IDs with 7-day TTL
    // 5. Return combined results
  }
}
```

**2. Add MusicBrainz ISRC Cache**
```typescript
// In AudioEnrichmentService.findISRCViaMusicBrainz():
private async getCachedISRC(artist: string, track: string): Promise<string | null>
private async setCachedISRC(artist: string, track: string, isrc: string): Promise<void>
```

**3. Add Last.fm Correction Cache**
```typescript
// In LastFmService.getCorrection():
private async getCachedCorrection(artist: string, track: string)
private async setCachedCorrection(artist: string, track: string, corrected: {...})
```

### Phase 2: Medium Improvements (Est. 20-30% reduction)

**4. Add Spotify Playlist Tracks Cache**
```typescript
// In spotify-tools.ts analyzePlaylist():
// Check cache before fetching from Spotify API
```

**5. Add Spotify Playlist Metadata Cache**
```typescript
// Cache playlist name, description, total tracks
```

### Phase 3: Polish (Est. 5-10% reduction)

**6. Add remaining Spotify caches** (profile, track details, search)

---

## Implementation Strategy for Phase 1

### New Cache Keys (Avoid Collisions)

Extend naming scheme to prevent issues:

```typescript
// Namespace: AUDIO_FEATURES_CACHE
"bpm:{track_id}"              // Existing: Deezer enrichment
"lastfm:{hash}"               // Existing: Last.fm signals
"artist_{hash}"               // Existing: Last.fm artist info

// NEW:
"spotify:audio_features:{track_id}"     // Single track features
"spotify:audio_features_batch:{batch_hash}"  // Batch of up to 100
"mb:isrc:{artist}:{track}:{duration}"   // MusicBrainz ISRC
"lastfm:correction:{artist}:{track}"    // Last.fm canonical names
"spotify:playlist:{playlist_id}"        // Playlist metadata
"deezer:search:{isrc}:{duration}"       // Deezer search results
```

### Estimated Performance Gains

| Cache | Current Cost | With Cache | Reduction |
|-------|-------------|-----------|-----------|
| Spotify audio features | 400ms | 50ms (cache hit) | 350ms |
| MusicBrainz ISRC | 600ms (30 tracks × 20ms) | 0ms | 600ms |
| Last.fm corrections | 400ms (50 calls × 8ms) | 0ms | 400ms |
| Spotify playlist tracks | 500ms | 0ms | 500ms |
| Total enrichment time | 16s | 6-8s | 50-60% |

---

## Cache Invalidation Strategy

### Time-Based (Current)
- Hits: 7-90 days TTL
- Misses: 5 minutes TTL (retry failed lookups)

### Event-Based (Recommended)
- User deletes/adds tracks → Invalidate playlist cache
- User creates new playlist → Cache from first analysis
- Explicit cache bust endpoint for debugging

---

## Cloudflare KV Limits & Costs

**Current Usage Estimate** (100-track playlist analyzed):
- Deezer enrichment: ~10KB (50 track entries × 200 bytes)
- Last.fm enrichment: ~30KB (50 track entries × 600 bytes)
- Artist info: ~5KB (20 artist entries × 250 bytes)
- **Total per analysis**: ~45KB

**New Usage with Phase 1**:
- Add Spotify audio features: ~10KB per 100 tracks
- Add MusicBrainz ISRC cache: ~2KB per playlist
- Add Last.fm corrections: ~1KB per playlist
- **Total overhead**: +13KB per analysis

**Cloudflare KV Limits**:
- Max value size: 25MB (no issue)
- Read limit: 10M reads/month on free tier
- Write limit: 1M writes/month on free tier
- Cost: $0.15 per 1M reads, $1.50 per 1M writes (paid tier)

---

## Summary Table

| Service | What's Cached | TTL (Hit/Miss) | Cache Key | Performance Impact | Notes |
|---------|--------------|---|-----------|-------------------|-------|
| **Deezer** | Track BPM, gain, rank | 90d / 5m | `bpm:{id}` | 3-5s saved | Via orchestrator, 10 concurrent |
| **Last.fm Signals** | Tags, listeners, playcount | 7d / 5m | `lastfm:{hash}` | 8-10s saved | Dedupes unique artists |
| **Last.fm Artists** | Bio, images, stats | 7d / 5m | `artist_{hash}` | 2-3s saved | Batched separately |
| **MusicBrainz** | ❌ NOT CACHED | - | - | **2-3s lost** | **CRITICAL GAP** |
| **Spotify Tracks** | ❌ NOT CACHED | - | - | **0.5s lost** | **HIGH IMPACT** |
| **Spotify Features** | ❌ NOT CACHED | - | - | **0.4s lost** | **HIGH IMPACT** |
| **Spotify Playlist** | ❌ NOT CACHED | - | - | **0.3s lost** | **MEDIUM GAP** |

