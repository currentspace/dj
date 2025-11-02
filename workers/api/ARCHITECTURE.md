# API Worker Architecture: Rate-Limited Request Orchestration

## Overview

The API worker uses a **unified rate-limited orchestrator** to manage all external API calls,
ensuring we stay within Cloudflare Workers' 40 RPS (requests per second) limit for outbound
subrequests.

## Core Components

### 1. RateLimitedQueue (`utils/RateLimitedQueue.ts`)

Foundation: Token bucket algorithm with bounded concurrency

- **Rate limiting**: 40 tokens/second (configurable)
- **Burst capacity**: Allows bursts up to `burst` tokens
- **Concurrency**: Runs N tasks in parallel (default: 10)
- **Monotonic timing**: Uses `performance.now()` to avoid clock drift
- **Jitter**: Random 0-5ms delay to prevent thundering herd

### 2. RequestOrchestrator (`utils/RequestOrchestrator.ts`)

High-level API for managing rate-limited requests

**Key Features**:

- Single global rate limit across ALL external calls (Anthropic, Spotify, Last.fm)
- Micro-batching: Collects multiple `enqueue()` calls before processing
- Batch management: Can await specific named batches
- Per-task promises: Each task gets its own promise that resolves independently

**API**:

```typescript
// Execute single task
const result = await orchestrator.execute(() => apiCall())

// Execute batch with ID
orchestrator.enqueueBatch('my-batch', [
  () => fetch('url1'),
  () => fetch('url2'),
  () => fetch('url3'),
])
const results = await orchestrator.awaitBatch('my-batch')

// Get pending task count
const count = orchestrator.getPendingCount()
```

### 3. Rate-Limited API Wrappers (`utils/RateLimitedAPIClients.ts`)

Convenience wrappers for common API types

```typescript
// Anthropic (Claude + Haiku)
await rateLimitedAnthropicCall(() =>
  anthropic.messages.create({...}), logger, 'context'
);

// Spotify
await rateLimitedSpotifyCall(() =>
  spotify.search(query), logger, 'search tracks'
);

// Last.fm
await rateLimitedLastFmCall(() =>
  lastfm.getTrackInfo(track), logger, 'track info'
);

// Batch helper
const results = await executeBatch([
  () => spotify.search('query1'),
  () => spotify.search('query2'),
  () => spotify.search('query3')
], 'spotify-searches');
```

## Architecture Patterns

### Pattern 1: Single Request

For one-off API calls:

```typescript
import { rateLimitedSpotifyCall } from '../utils/RateLimitedAPIClients'

const playlist = await rateLimitedSpotifyCall(
  () => spotifyApi.createPlaylist(userId, { name }),
  logger,
  'create playlist',
)
```

### Pattern 2: Parallel Batch

For independent parallel requests (e.g., enriching 50 tracks):

```typescript
import { getGlobalOrchestrator } from '../utils/RateLimitedAPIClients'

const orchestrator = getGlobalOrchestrator()

// Enqueue all tasks
orchestrator.enqueueBatch(
  'enrich-tracks',
  tracks.map(track => () => lastfm.getTrackInfo(track)),
)

// Do other work here (non-blocking)

// Wait for batch when needed
const results = await orchestrator.awaitBatch('enrich-tracks')
```

### Pattern 3: Dependency Chains

For sequential dependencies with pipelined sub-tasks:

```typescript
// Step 1: Search for tracks (batched)
orchestrator.enqueueBatch(
  'searches',
  queries.map(q => () => spotify.search(q)),
)
const searchResults = await orchestrator.awaitBatch('searches')

// Step 2: Get audio features for found tracks (batched)
orchestrator.enqueueBatch(
  'audio-features',
  trackIds.map(id => () => spotify.getAudioFeatures(id)),
)
const features = await orchestrator.awaitBatch('audio-features')

// Step 3: Enrich with Last.fm (batched)
orchestrator.enqueueBatch(
  'lastfm-enrich',
  tracks.map(t => () => lastfm.getTrackInfo(t)),
)
const enriched = await orchestrator.awaitBatch('lastfm-enrich')
```

### Pattern 4: Pipeline with Progress Updates

Combine rate-limited requests with non-blocking SSE writes:

```typescript
import { SSEWriter } from './chat-stream'

// Start batch processing
orchestrator.enqueueBatch('enrich', tasks)

// Update progress without blocking (fire-and-forget)
sseWriter.writeAsync({ type: 'thinking', data: 'Enriching tracks...' })

// Process batch with progress callbacks
const results = await orchestrator.awaitBatch('enrich')

// Flush SSE writes before next phase
await sseWriter.flush()

sseWriter.writeAsync({ type: 'thinking', data: 'Analyzing features...' })
```

## SSE Write Pipeline Pattern

The `SSEWriter` class supports **non-blocking writes** with strategic flush points.

### SSEWriter API

```typescript
class SSEWriter {
  // BLOCKING: Waits for write to complete
  async write(event: StreamEvent): Promise<void>

  // NON-BLOCKING: Queues write and returns immediately
  writeAsync(event: StreamEvent): void

  // BLOCKING: Waits for all queued writes to complete
  async flush(): Promise<void>
}
```

### When to use `writeAsync()` vs `write()`

**Use `writeAsync()` (non-blocking)**:

- Progress updates during batch processing
- Thinking messages
- Non-critical debug/log messages
- Narrator-generated messages (dynamic progress)

**Use `write()` (blocking)**:

- Tool execution results (must arrive before next step)
- Error messages
- Final completion message
- Messages that must arrive before response closes

**Use `flush()` (checkpoint)**:

- Before expensive operations (ensure user sees progress)
- After batch completion (ensure all updates delivered)
- Before sending final response
- At logical phase boundaries

### Example: Pipelined Playlist Analysis

```typescript
// Phase 1: Search tracks
sseWriter.writeAsync({ type: 'thinking', data: '🔍 Searching for tracks...' })

orchestrator.enqueueBatch('searches', searchTasks)
const tracks = await orchestrator.awaitBatch('searches')

// Flush before next phase (checkpoint)
await sseWriter.flush()

// Phase 2: Enrich tracks (with progress updates)
sseWriter.writeAsync({ type: 'thinking', data: '🎧 Enriching tracks...' })

orchestrator.enqueueBatch('enrich-tracks', enrichTasks)

// Update progress during enrichment (non-blocking)
let enriched = 0
for (const track of tracks) {
  orchestrator
    .execute(() => enrichTrack(track))
    .then(() => {
      enriched++
      if (enriched % 10 === 0) {
        sseWriter.writeAsync({
          type: 'thinking',
          data: `🎧 Enriched ${enriched}/${tracks.length} tracks...`,
        })
      }
    })
}

const results = await orchestrator.awaitBatch('enrich-tracks')

// Flush before final response
await sseWriter.flush()

// Send final result (blocking)
await sseWriter.write({ type: 'done', data: null })
```

## Rate Limit Budget

Cloudflare Workers Free tier: **40 RPS** outbound subrequests

Typical playlist analysis flow:

- 1x Initial Claude call
- 5-10x Spotify searches
- 50x Audio features (batched)
- 50x Last.fm track info (batched)
- 45x Last.fm artist info (batched)
- 5-10x Progress narrator calls (Haiku)
- 1x Final Claude call
- 1x Create playlist
- 1-2x Add tracks

**Total**: ~170 requests over ~10 seconds = **~17 RPS average**

With bursts:

- 50 audio features in 1 second = 50 RPS burst
- Token bucket allows burst up to 40 tokens
- Remaining 10 requests queued and processed over next 0.25s

## Migration Guide

### Before (Direct API calls)

```typescript
// ❌ No rate limiting, no batching
const track1 = await lastfm.getTrackInfo(track1)
const track2 = await lastfm.getTrackInfo(track2)
const track3 = await lastfm.getTrackInfo(track3)

// ❌ Blocking SSE writes
await sseWriter.write({ type: 'thinking', data: 'Processing...' })
await sseWriter.write({ type: 'thinking', data: 'Still processing...' })
```

### After (Orchestrated + Pipelined)

```typescript
// ✅ Batched + rate limited
const orchestrator = getGlobalOrchestrator()
orchestrator.enqueueBatch('tracks', [
  () => lastfm.getTrackInfo(track1),
  () => lastfm.getTrackInfo(track2),
  () => lastfm.getTrackInfo(track3),
])

// ✅ Non-blocking SSE writes
sseWriter.writeAsync({ type: 'thinking', data: 'Processing...' })
sseWriter.writeAsync({ type: 'thinking', data: 'Still processing...' })

// ✅ Await batch when needed
const results = await orchestrator.awaitBatch('tracks')

// ✅ Flush at checkpoint
await sseWriter.flush()
```

## Performance Benefits

1. **Reduced latency**: Parallel execution of independent requests
2. **Better throughput**: Token bucket smooths request rate
3. **Improved UX**: Non-blocking SSE writes keep UI responsive
4. **Rate limit compliance**: Automatic pacing prevents 429 errors
5. **Resource efficiency**: Bounded concurrency prevents overwhelming APIs

## Monitoring

Track orchestrator performance:

```typescript
const orchestrator = getGlobalOrchestrator()

// Before batch
const startCount = orchestrator.getPendingCount()
console.log(`Starting with ${startCount} pending tasks`)

// After batch
orchestrator.enqueueBatch('my-batch', tasks)
const afterCount = orchestrator.getPendingCount()
console.log(`Now ${afterCount} pending tasks`)

// After completion
const results = await orchestrator.awaitBatch('my-batch')
const endCount = orchestrator.getPendingCount()
console.log(`Completed, ${endCount} tasks remaining`)
```

## Best Practices

1. **Always use orchestrator for external calls** - Never call APIs directly
2. **Batch independent requests** - Use `enqueueBatch()` + `awaitBatch()`
3. **Pipeline SSE writes** - Use `writeAsync()` + strategic `flush()`
4. **Use descriptive batch IDs** - Makes debugging easier
5. **Flush before expensive operations** - Ensures user sees progress
6. **Log orchestrator state** - Track pending count for debugging
7. **Handle null results** - Rate-limited calls can fail, always check for null

## Debugging

Enable detailed logging:

```typescript
import { ServiceLogger } from '../utils/ServiceLogger'

const logger = new ServiceLogger('Orchestrator')

await rateLimitedSpotifyCall(
  () => spotify.search(query),
  logger, // ← Logs timing and errors
  'search tracks',
)
```

Check orchestrator state:

```typescript
const pending = orchestrator.getPendingCount()
if (pending > 100) {
  logger.warn(`High pending count: ${pending} tasks queued`)
}
```

## Future Enhancements

1. **Adaptive rate limiting**: Adjust rate based on 429 responses
2. **Priority queues**: High-priority requests jump queue
3. **Request deduplication**: Cache identical concurrent requests
4. **Retry with backoff**: Automatic retry for transient failures
5. **Per-API rate limits**: Different limits for different APIs
6. **Metrics export**: Export queue stats for monitoring
