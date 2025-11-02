# Iterative Tools Migration Guide

## What Changed

We've migrated from a **monolithic data loading** approach to an **iterative, on-demand** approach
for fetching playlist data.

### Before (Monolithic)

```typescript
analyze_playlist() → Returns EVERYTHING:
  - Playlist metadata
  - 20 full track objects (55KB!)
  - 20 audio feature objects
  - Average metrics

Problem: Always fetched max data regardless of what user asked
Result: 55KB payloads overwhelming Claude
```

### After (Iterative)

```typescript
analyze_playlist() → Returns SUMMARY only:
  - Playlist metadata
  - Average audio metrics
  - track_ids[] (just IDs)
  - Size: ~500 bytes

get_playlist_tracks(offset, limit) → Returns compact track info:
  - name, artists, duration, popularity, album
  - Paginated (20-50 at a time)
  - Size: ~100 bytes per track

get_track_details(track_ids) → Returns full metadata:
  - Everything: album art, release dates, external URLs
  - Only for specific tracks
  - Size: ~2.5KB per track
```

## New Workflow

### Example: "What's the tempo of this playlist?"

**Old way:**

```
1. analyze_playlist()
   → Returns 55KB of data
   → Claude gets overwhelmed
   → May not respond correctly
```

**New way:**

```
1. analyze_playlist()
   → Returns ~500 bytes with avg_tempo: 120
   → Claude: "The playlist has an average tempo of 120 BPM"
   → No additional fetching needed ✨
```

### Example: "List the first 10 tracks"

**Old way:**

```
1. analyze_playlist()
   → Returns 20 tracks (even though only 10 requested)
   → 55KB payload
```

**New way:**

```
1. analyze_playlist()
   → Returns summary + track_ids
2. get_playlist_tracks(offset: 0, limit: 10)
   → Returns 10 compact tracks
   → ~1KB payload
   → Claude lists the 10 tracks
```

### Example: "What album is the 5th track from?"

**Old way:**

```
1. analyze_playlist()
   → Returns 20 full tracks with all album data
   → 55KB payload
   → Claude finds track 5
```

**New way:**

```
1. analyze_playlist()
   → Returns summary + track_ids
2. get_playlist_tracks(offset: 0, limit: 10)
   → Returns compact info (includes album name)
   → Claude: "Track 5 is from album 'Lover'"
   → Only fetched what was needed
```

### Example: "Show me album art for the first track"

**New way:**

```
1. analyze_playlist()
   → Returns summary + track_ids
2. get_playlist_tracks(offset: 0, limit: 1)
   → Returns first track (compact)
   → Gets track_id
3. get_track_details([track_id])
   → Returns full metadata including album.images[]
   → Claude: "Here's the album art: [URL]"
```

## Benefits

### 1. Efficient Data Loading

- Only fetch what's needed for the specific question
- Reduce API calls and bandwidth
- Faster responses for simple questions

### 2. Scalable to Large Playlists

- Old: 1000-track playlist → analyze_playlist returns 20 tracks → arbitrary limit
- New: 1000-track playlist → analyze_playlist returns summary → Claude can paginate through all
  tracks if needed

### 3. Better LLM Performance

- Smaller payloads = better Claude comprehension
- No more "I don't see any data" errors
- More consistent responses

### 4. Flexible Detail Levels

- Let Claude decide how much detail to fetch
- User asks for tempo? Just summary needed
- User asks for album art? Fetch full details

## Tool Reference

### analyze_playlist

**Purpose:** Get high-level summary of playlist

**Input:**

```typescript
{
  playlist_id?: string  // Auto-injected if playlist selected
}
```

**Output:**

```typescript
{
  playlist_name: string,
  playlist_description: string,
  total_tracks: number,
  audio_analysis: {
    avg_energy: number,      // 0-1
    avg_danceability: number, // 0-1
    avg_valence: number,      // 0-1 (happiness)
    avg_tempo: number,        // BPM
    avg_acousticness: number,
    avg_instrumentalness: number
  } | null,
  track_ids: string[],  // All track IDs
  message: string       // Instructions for next steps
}
```

**When to use:**

- First step for any playlist question
- Answers questions about overall vibe, tempo, energy
- Provides track_ids for subsequent fetching

### get_playlist_tracks

**Purpose:** Get compact track info in paginated batches

**Input:**

```typescript
{
  playlist_id?: string,  // Auto-injected
  offset?: number,       // Default: 0
  limit?: number         // Default: 20, max: 50
}
```

**Output:**

```typescript
{
  tracks: [
    {
      id: string,
      name: string,
      artists: string,      // Comma-separated
      duration_ms: number,
      popularity: number,   // 0-100
      uri: string,          // spotify:track:...
      album: string         // Album name
    }
  ],
  offset: number,
  limit: number,
  total: number,
  has_more: boolean
}
```

**When to use:**

- User wants to see track names/artists
- Listing tracks
- Finding a specific track by name
- Getting track IDs for detailed lookup

**Pagination example:**

```typescript
// Get tracks 0-20
get_playlist_tracks({ offset: 0, limit: 20 })

// Get tracks 20-40
get_playlist_tracks({ offset: 20, limit: 20 })

// Get tracks 40-60
get_playlist_tracks({ offset: 40, limit: 20 })
```

### get_track_details

**Purpose:** Get full metadata for specific tracks

**Input:**

```typescript
{
  track_ids: string[]  // 1-50 track IDs
}
```

**Output:**

```typescript
{
  tracks: [
    {
      id: string,
      name: string,
      artists: [{ id: string, name: string }],
      album: {
        id: string,
        name: string,
        release_date: string, // YYYY-MM-DD
        total_tracks: number,
        images: [{ url: string, height: number, width: number }],
      },
      duration_ms: number,
      popularity: number,
      explicit: boolean,
      uri: string,
      external_urls: { spotify: string },
      preview_url: string | null,
    },
  ]
}
```

**When to use:**

- User asks about album art
- User asks about release dates
- User wants Spotify URLs
- Need full artist objects (not just names)

## System Prompt Updates

Claude now receives instructions on when to use each tool:

```
ITERATIVE DATA FETCHING WORKFLOW:
1. analyze_playlist returns SUMMARY only (avg tempo, energy, etc. + track_ids)
2. get_playlist_tracks gets compact track info in batches (20 at a time)
3. get_track_details gets full metadata when needed (album art, release dates, etc.)

EXAMPLE QUESTIONS:
- "What's the tempo?" → analyze_playlist only (has avg_tempo)
- "List the first 10 tracks" → analyze_playlist + get_playlist_tracks(limit: 10)
- "What album is track 5 from?" → get_playlist_tracks + get_track_details for that track
- "Show me album art for the first track" → get_playlist_tracks + get_track_details
```

## Testing the Changes

### Test Case 1: Simple Question

```
User: "What's the vibe of this playlist?"

Expected:
1. Claude calls: analyze_playlist()
2. Claude responds: "This playlist has a [mellow/energetic] vibe with average tempo of X BPM..."
3. No additional tool calls needed ✅
```

### Test Case 2: List Tracks

```
User: "What are the first 5 tracks?"

Expected:
1. Claude calls: analyze_playlist()
2. Claude calls: get_playlist_tracks({ offset: 0, limit: 5 })
3. Claude responds: "1. Song Name - Artist, 2. ..." ✅
```

### Test Case 3: Deep Dive

```
User: "Show me the album art for the first track"

Expected:
1. Claude calls: analyze_playlist()
2. Claude calls: get_playlist_tracks({ offset: 0, limit: 1 })
3. Claude calls: get_track_details([track_id])
4. Claude responds: "Here's the album art: [image URL]" ✅
```

### Test Case 4: Pagination

```
User: "List all tracks" (100-track playlist)

Expected:
1. Claude calls: analyze_playlist() → total_tracks: 100
2. Claude calls: get_playlist_tracks({ offset: 0, limit: 50 })
3. Claude calls: get_playlist_tracks({ offset: 50, limit: 50 })
4. Claude lists all 100 tracks ✅
```

## Migration Notes

### What Stays the Same

- OAuth flow unchanged
- SSE streaming unchanged
- Frontend unchanged (just receives responses)
- Other tools (search, recommendations, create_playlist) unchanged

### What's New

- analyze_playlist returns minimal data
- Two new tools: get_playlist_tracks, get_track_details
- System prompt guides Claude on iterative fetching

### Breaking Changes

- None for end users
- Claude will make multiple tool calls instead of one
- More SSE events during analysis (one per tool call)

## Performance Impact

### Before

```
Single analyze_playlist call:
- 1 Spotify API call to get playlist
- 1 Spotify API call to get tracks
- 1 Spotify API call to get audio features
- Total data transferred: ~55KB
- Total time: ~2-3 seconds
```

### After (Simple Question)

```
Single analyze_playlist call:
- 1 Spotify API call to get playlist
- 1 Spotify API call to get tracks
- 1 Spotify API call to get audio features
- Total data transferred: ~500 bytes
- Total time: ~2-3 seconds
- Result: Same API calls, 99% less data to Claude ✅
```

### After (Complex Question)

```
analyze_playlist + get_playlist_tracks + get_track_details:
- 1 call to get playlist (cached from analyze)
- 1 call to get tracks (cached from analyze)
- 1 call to get audio features (cached from analyze)
- 1 call to get full track details
- Total data transferred: ~500 bytes + ~2KB + ~5KB = ~7.5KB
- Total time: ~3-4 seconds
- Result: One extra API call, but still 85% less data than before ✅
```

## Rollout Plan

1. ✅ Implement new tools
2. ✅ Update system prompt
3. ✅ Update documentation
4. → Commit and push to main
5. → Automatic deployment via GitHub Actions
6. → Test with real Spotify playlists
7. → Monitor logs for tool usage patterns

## Rollback Plan

If issues arise:

1. Git revert to previous commit
2. Push to main
3. Automatic redeployment of old version

Old version is fully functional, just less efficient.
