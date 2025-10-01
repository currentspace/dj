# Refactoring Example: analyze_playlist Tool

This document shows a concrete example of refactoring the `analyze_playlist` tool to use the **RequestOrchestrator** and **pipelined SSE writes**.

## Before: Sequential with Blocking Writes

```typescript
async function executeSpotifyToolWithProgress(
  toolName: string,
  args: any,
  ...
) {
  if (toolName === 'analyze_playlist') {
    const { playlistUrl, query, targetTrackCount } = args;

    // 1. Blocking SSE write
    await sseWriter.write({
      type: 'thinking',
      data: `🔍 Searching for tracks matching "${query}"...`
    });

    // 2. Sequential Spotify searches (no batching!)
    const tracks: SpotifyTrack[] = [];
    let offset = 0;
    while (tracks.length < targetTrackCount) {
      const results = await spotifyApi.search(query, { offset });
      tracks.push(...results.items);
      offset += 50;

      // Blocking write
      await sseWriter.write({
        type: 'thinking',
        data: `Found ${tracks.length} tracks...`
      });
    }

    // 3. Sequential audio features (no batching!)
    await sseWriter.write({
      type: 'thinking',
      data: 'Analyzing audio features...'
    });

    const trackIds = tracks.map(t => t.id);
    const features: AudioFeatures[] = [];
    for (const id of trackIds) {
      const feature = await spotifyApi.getAudioFeatures(id);
      features.push(feature);
    }

    // 4. Last.fm enrichment (already batched, but SSE writes block)
    await sseWriter.write({
      type: 'thinking',
      data: 'Enriching with Last.fm data...'
    });

    const lastFmService = new LastFmService(env.LASTFM_API_KEY);
    const enrichedTracks = await lastFmService.enrichTracks(
      tracks,
      (count, total) => {
        // This callback blocks!
        await sseWriter.write({
          type: 'thinking',
          data: `Enriched ${count}/${total} tracks...`
        });
      }
    );

    return { tracks: enrichedTracks };
  }
}
```

**Problems**:
1. ❌ No rate limiting - can hit 40 RPS limit
2. ❌ Sequential searches - could be parallel
3. ❌ Sequential audio features - could be batched
4. ❌ Blocking SSE writes - adds latency
5. ❌ Progress callbacks block enrichment

## After: Orchestrated with Pipelined Writes

```typescript
import { getGlobalOrchestrator, rateLimitedSpotifyCall, executeBatch } from '../utils/RateLimitedAPIClients';

async function executeSpotifyToolWithProgress(
  toolName: string,
  args: any,
  ...
) {
  if (toolName === 'analyze_playlist') {
    const { playlistUrl, query, targetTrackCount } = args;
    const orchestrator = getGlobalOrchestrator();

    // ===== PHASE 1: SEARCH FOR TRACKS =====
    // Non-blocking write
    sseWriter.writeAsync({
      type: 'thinking',
      data: `🔍 Searching for tracks matching "${query}"...`
    });

    // Batch multiple search queries in parallel
    const searchOffsets = [0, 50, 100, 150, 200]; // Up to 250 tracks
    orchestrator.enqueueBatch(
      'spotify-searches',
      searchOffsets.map(offset => () =>
        spotifyApi.search(query, { offset, limit: 50 })
      )
    );

    // Await searches (pipelined - they run in parallel)
    const searchResults = await orchestrator.awaitBatch('spotify-searches');
    const allTracks = searchResults
      .filter(r => r !== null)
      .flatMap(r => r.items)
      .slice(0, targetTrackCount);

    // Flush before next phase (checkpoint)
    await sseWriter.flush();

    // Non-blocking progress update
    sseWriter.writeAsync({
      type: 'thinking',
      data: `✅ Found ${allTracks.length} tracks`
    });

    // ===== PHASE 2: GET AUDIO FEATURES =====
    sseWriter.writeAsync({
      type: 'thinking',
      data: '🎵 Analyzing audio features...'
    });

    // Batch all audio features requests
    const trackIds = allTracks.map(t => t.id);
    orchestrator.enqueueBatch(
      'audio-features',
      trackIds.map(id => () => spotifyApi.getAudioFeatures(id))
    );

    const audioFeatures = await orchestrator.awaitBatch('audio-features');

    // Flush checkpoint
    await sseWriter.flush();

    sseWriter.writeAsync({
      type: 'thinking',
      data: `✅ Analyzed ${audioFeatures.filter(f => f).length} tracks`
    });

    // ===== PHASE 3: ENRICH WITH LAST.FM =====
    sseWriter.writeAsync({
      type: 'thinking',
      data: '🎧 Enriching tracks with Last.fm data...'
    });

    // Batch Last.fm track info requests
    orchestrator.enqueueBatch(
      'lastfm-tracks',
      allTracks.map(track => () =>
        lastFmApi.getTrackInfo(track.artists[0].name, track.name)
      )
    );

    // Progress updates (non-blocking, fire-and-forget)
    let enrichedCount = 0;
    const progressInterval = setInterval(() => {
      const pending = orchestrator.getPendingCount();
      const completed = allTracks.length - pending;
      if (completed > enrichedCount) {
        enrichedCount = completed;
        sseWriter.writeAsync({
          type: 'thinking',
          data: `🎧 Enriched ${enrichedCount}/${allTracks.length} tracks...`
        });
      }
    }, 500);

    const trackInfos = await orchestrator.awaitBatch('lastfm-tracks');
    clearInterval(progressInterval);

    // Flush checkpoint
    await sseWriter.flush();

    sseWriter.writeAsync({
      type: 'thinking',
      data: `✅ Enriched ${trackInfos.filter(i => i).length} tracks`
    });

    // ===== PHASE 4: ENRICH ARTISTS =====
    sseWriter.writeAsync({
      type: 'thinking',
      data: '🎤 Enriching artist data...'
    });

    // Get unique artists
    const uniqueArtists = [...new Set(allTracks.map(t => t.artists[0].name))];

    // Batch artist info requests
    orchestrator.enqueueBatch(
      'lastfm-artists',
      uniqueArtists.map(artist => () => lastFmApi.getArtistInfo(artist))
    );

    const artistInfos = await orchestrator.awaitBatch('lastfm-artists');

    // Final flush before returning
    await sseWriter.flush();

    sseWriter.writeAsync({
      type: 'thinking',
      data: `✅ Complete! Analyzed ${allTracks.length} tracks from ${uniqueArtists.length} artists`
    });

    // Combine all data
    const enrichedTracks = allTracks.map((track, i) => ({
      ...track,
      audioFeatures: audioFeatures[i],
      lastFmInfo: trackInfos[i],
      artistInfo: artistInfos.find(a =>
        a?.name === track.artists[0].name
      )
    }));

    return { tracks: enrichedTracks };
  }
}
```

**Improvements**:
1. ✅ All API calls rate-limited through orchestrator
2. ✅ Parallel searches (5x 50-track searches concurrently)
3. ✅ Batched audio features (50+ tracks processed in parallel with concurrency limit)
4. ✅ Non-blocking SSE writes (writeAsync)
5. ✅ Strategic flush points (checkpoints between phases)
6. ✅ Progress updates don't block enrichment (setInterval)

## Performance Comparison

### Before
```
Search 1:  wait 200ms
Search 2:  wait 200ms
Search 3:  wait 200ms
...
Total searches: 5 × 200ms = 1000ms

Audio 1:   wait 100ms
Audio 2:   wait 100ms
...
Total audio: 50 × 100ms = 5000ms

Last.fm:   batched but progress blocks

TOTAL: ~6000ms+ with blocking writes
```

### After
```
Searches:  5 parallel × 200ms = 200ms (pipelined)
Audio:     50 batched, 10 concurrent × (50/10 × 100ms) = 500ms
Last.fm:   batched, 10 concurrent, non-blocking progress = 800ms

TOTAL: ~1500ms with pipelined writes
```

**~4x faster** with better UX!

## Key Patterns

### 1. Phase Boundaries with Flush

```typescript
// Phase 1: Do work
orchestrator.enqueueBatch('phase1', tasks);
sseWriter.writeAsync({ type: 'thinking', data: 'Phase 1...' });
await orchestrator.awaitBatch('phase1');

// Flush checkpoint (ensures user saw progress)
await sseWriter.flush();

// Phase 2: Do work
sseWriter.writeAsync({ type: 'thinking', data: 'Phase 2...' });
```

### 2. Progress Updates During Batch

```typescript
// Start batch
orchestrator.enqueueBatch('work', tasks);

// Poll for progress (non-blocking)
const interval = setInterval(() => {
  const pending = orchestrator.getPendingCount();
  const done = total - pending;
  sseWriter.writeAsync({
    type: 'thinking',
    data: `Progress: ${done}/${total}`
  });
}, 500);

// Await completion
await orchestrator.awaitBatch('work');
clearInterval(interval);
```

### 3. Dependency Chains

```typescript
// Step 1: Independent batch
orchestrator.enqueueBatch('step1', step1Tasks);
const step1Results = await orchestrator.awaitBatch('step1');

// Step 2: Depends on step 1
const step2Tasks = step1Results
  .filter(r => r !== null)
  .map(r => () => processResult(r));

orchestrator.enqueueBatch('step2', step2Tasks);
const step2Results = await orchestrator.awaitBatch('step2');
```

### 4. Fire-and-Forget with Error Handling

```typescript
// Optional enhancement: narrator messages
orchestrator.execute(() =>
  narrator.generateMessage({ eventType: 'enriching_tracks' })
).then(message => {
  sseWriter.writeAsync({ type: 'thinking', data: message });
}).catch(error => {
  // Fallback to static message
  sseWriter.writeAsync({
    type: 'thinking',
    data: 'Enriching tracks...'
  });
});
```

## Migration Checklist

- [ ] Import `getGlobalOrchestrator` and API wrappers
- [ ] Identify independent API calls that can be batched
- [ ] Replace sequential loops with `enqueueBatch()`
- [ ] Change `await sseWriter.write()` → `sseWriter.writeAsync()`
- [ ] Add `await sseWriter.flush()` at phase boundaries
- [ ] Update progress callbacks to use `writeAsync()`
- [ ] Add error handling for null results from orchestrator
- [ ] Test with production load to verify rate limiting
- [ ] Monitor orchestrator pending count for bottlenecks

## Testing

Verify rate limiting compliance:

```typescript
// Log all API calls during test
const startTime = Date.now();
const callTimes: number[] = [];

orchestrator.enqueueBatch('test',
  Array(100).fill(0).map(() => () => {
    callTimes.push(Date.now() - startTime);
    return mockApiCall();
  })
);

await orchestrator.awaitBatch('test');

// Verify rate: should be ~40 RPS
const duration = (Date.now() - startTime) / 1000;
const rps = callTimes.length / duration;
console.log(`RPS: ${rps.toFixed(2)}`); // Should be ≤ 40
```
