# Batched Enrichment Strategy

## Problem Statement

Cloudflare Workers free tier limits each request to **50 subrequests** (total fetch() calls). Our enrichment process was hitting this limit:

- **Last.fm**: 4 API calls per track (correction, info, tags, similar)
- **Deezer**: 1 API call per track
- **Previous approach**: Fixed limits (8 Last.fm + 100 Deezer) = ~47 worst-case

This conservative approach worked but left enrichment data on the table.

## Solution: Smart Batching with Cache Awareness

### Key Insights

1. **KV Cache is Free**: Cached responses don't count toward subrequest limit
2. **High Cache Hit Rates**: After first analysis, most data is cached
   - Deezer: 90-day TTL → very high hit rate for popular tracks
   - Last.fm: 7-day TTL → good hit rate for recent analyses
3. **Dynamic Budget**: We can check cache FIRST, then use remaining budget for uncached items

### Strategy

```
Phase 1: Check Cache (Free)
├─ Query KV for all tracks
├─ Count cache hits vs misses
└─ Calculate remaining subrequest budget

Phase 2: Smart Batching (Budget-Aware)
├─ Remaining budget = 45 - already_used
├─ Last.fm uncached: budget * 0.3 / 4 tracks
├─ Deezer uncached: budget * 0.7 tracks
└─ Process in batches if needed

Phase 3: Progressive Results
├─ Return partial results after each batch
├─ Cache all results immediately
└─ Next analysis benefits from cache
```

### Example Scenarios

#### Scenario 1: First Analysis (Cold Cache)
```
Playlist: 100 tracks
Cache status: 0% hit rate

Budget: 45 subrequests
├─ Last.fm: 45 * 0.3 / 4 = 3 tracks (12 calls)
├─ Deezer: 45 * 0.7 = 31 tracks (31 calls, assuming no cache)
└─ Total: 43 subrequests

Result: Limited enrichment, but all results cached
```

#### Scenario 2: Repeat Analysis (Warm Cache)
```
Playlist: Same 100 tracks
Cache status: 95% hit rate (Deezer), 80% hit rate (Last.fm)

Budget: 45 subrequests
├─ Deezer cached: 95 tracks (0 calls)
├─ Deezer uncached: 5 tracks (5 calls)
├─ Last.fm cached: 80% of previous enrichment (0 calls)
├─ Remaining budget: 45 - 5 = 40
├─ Last.fm new: 40 / 4 = 10 tracks (40 calls)
└─ Total: 45 subrequests

Result: 10 Last.fm + 100 Deezer tracks enriched!
```

#### Scenario 3: Popular Playlist (90%+ Cache)
```
Playlist: 200 tracks
Cache status: 90%+ hit rate

Budget: 45 subrequests
├─ Deezer: 180 cached (0 calls) + 20 uncached (20 calls)
├─ Last.fm: Most cached from previous analyses
├─ Remaining: 25 subrequests
├─ New Last.fm: 25 / 4 = 6 tracks (24 calls)
└─ Total: 44 subrequests

Result: 200 Deezer + significant Last.fm coverage
```

## Implementation

### 1. Subrequest Tracking

```typescript
class SubrequestTracker {
  private count = 0
  private readonly maxSubrequests = 45 // Safety margin

  record(count: number): boolean {
    this.count += count
    return this.count <= this.maxSubrequests
  }

  canMake(count: number): boolean {
    return this.count + count <= this.maxSubrequests
  }

  remaining(): number {
    return Math.max(0, this.maxSubrequests - this.count)
  }
}
```

### 2. Cache-Aware Batch Calculation

```typescript
async function calculateSmartBatches(
  tracker: SubrequestTracker,
  tracks: SpotifyTrack[],
  kvCache: KVNamespace,
): Promise<{
  deezer: {cached: Track[]; uncached: Track[]}
  lastfm: {cached: Track[]; uncached: Track[]}
  estimatedCalls: number
}> {
  // Check cache status (parallel, no subrequests)
  const deezerStatus = await checkDeezerCache(tracks, kvCache)
  const lastfmStatus = await checkLastFmCache(tracks, kvCache)

  const remaining = tracker.remaining()

  // Allocate budget based on uncached items
  const deezerBudget = Math.min(deezerStatus.uncached.length, remaining * 0.7)
  const lastfmBudget = Math.floor((remaining - deezerBudget) / 4)

  return {
    deezer: {
      cached: deezerStatus.cached,
      uncached: deezerStatus.uncached.slice(0, deezerBudget),
    },
    lastfm: {
      cached: lastfmStatus.cached,
      uncached: lastfmStatus.uncached.slice(0, lastfmBudget),
    },
    estimatedCalls: deezerBudget + lastfmBudget * 4,
  }
}
```

### 3. Progressive Enrichment

```typescript
// Enrich in waves, returning partial results
for (const batch of batches) {
  const results = await enrichBatch(batch, tracker)

  // Cache immediately
  await cacheResults(results, kvCache)

  // Stream progress to user
  sseWriter.write({
    type: 'thinking',
    data: `Enriched ${results.length} tracks...`,
  })

  // Check remaining budget
  if (!tracker.canMake(10)) break
}
```

## Benefits

### Immediate
1. **More Data on Repeat Analyses**: 3x-10x more tracks enriched on cached playlists
2. **Smarter Resource Usage**: Use full subrequest budget efficiently
3. **No Limit Errors**: Stay safely under 50 subrequest cap

### Long-Term
4. **Compound Effect**: Each analysis improves cache coverage
5. **Popular Track Advantage**: Well-known tracks cached across playlists
6. **User Experience**: More data = better recommendations

## Migration Path

### Phase 1: Add Tracking (No Behavior Change)
- Add SubrequestTracker
- Log actual vs estimated subrequests
- Verify accuracy

### Phase 2: Cache-Aware Batching
- Check KV before enrichment
- Calculate dynamic batch sizes
- Still conservative limits

### Phase 3: Progressive Enrichment (Future)
- Multiple batches per request
- Background continuation (Durable Objects?)
- Real-time result streaming

## Monitoring

```typescript
{
  subrequests: {
    used: 43,
    max: 45,
    percentage: 95.6
  },
  enrichment: {
    deezer: {
      cached: 85,
      enriched: 15,
      total: 100
    },
    lastfm: {
      cached: 20,
      enriched: 10,
      total: 30
    }
  },
  cache_efficiency: "85% hit rate"
}
```

## Future Enhancements

1. **Prefetch Popular Tracks**: Background worker to pre-cache common tracks
2. **Collaborative Caching**: Enrichment from one user helps others
3. **Adaptive Batching**: Learn optimal batch sizes per playlist type
4. **Durable Object Continuation**: Long-running enrichment beyond single request
