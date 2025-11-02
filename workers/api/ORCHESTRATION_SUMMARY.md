# Request Orchestration & SSE Pipeline Architecture

## Executive Summary

The API worker implements a **unified rate-limited orchestration system** that manages all external
API calls and SSE writes through two core mechanisms:

1. **RequestOrchestrator**: Global rate limiter (40 RPS) with batch management
2. **SSEWriter Pipeline**: Non-blocking writes with strategic flush points

This architecture provides:

- ✅ Compliance with Cloudflare Workers 40 RPS subrequest limit
- ✅ 4x performance improvement through parallel batching
- ✅ Better UX with non-blocking progress updates
- ✅ Ability to await dependency chains while maintaining global rate limit

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Chat Stream Handler                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              SSEWriter (writeAsync + flush)            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │
│  │  │  write1  │→ │  write2  │→ │  write3  │→ │ flush  │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │ │
│  │      ↓ (queued, non-blocking)         ↓ (await all)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            RequestOrchestrator (Global)                │ │
│  │                                                        │ │
│  │  ┌────────────────────────────────────────────────┐   │ │
│  │  │         RateLimitedQueue                       │   │ │
│  │  │  ┌─────────────────────────────────────────┐  │   │ │
│  │  │  │  Token Bucket (40 tokens/sec)          │  │   │ │
│  │  │  │  Burst: 40 tokens                      │  │   │ │
│  │  │  │  Concurrency: 10 parallel tasks        │  │   │ │
│  │  │  └─────────────────────────────────────────┘  │   │ │
│  │  │                                                │   │ │
│  │  │  Batches:                                      │   │ │
│  │  │  ┌────────────┐  ┌────────────┐              │   │ │
│  │  │  │ spotify-   │  │  lastfm-   │   ...        │   │ │
│  │  │  │ searches   │  │  tracks    │              │   │ │
│  │  │  └────────────┘  └────────────┘              │   │ │
│  │  └────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↓                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Anthropic  │  │  Spotify   │  │  Last.fm   │            │
│  │    API     │  │    API     │  │    API     │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Request Flow

```typescript
// User's code
const result = await rateLimitedSpotifyCall(
  () => spotify.search(query)
);

// Internally:
// ↓
orchestrator.execute(() => spotify.search(query))
// ↓
Queue task with promise
// ↓
Schedule micro-batch processing (setTimeout 0)
// ↓
Drain pending tasks into RateLimitedQueue
// ↓
Process with token bucket rate limiting
// ↓
Return result via promise resolution
```

### 2. Batch Flow

```typescript
// User's code
orchestrator.enqueueBatch('my-batch', [
  () => fetch('url1'),
  () => fetch('url2'),
  () => fetch('url3')
]);

// ... do other work (non-blocking) ...

const results = await orchestrator.awaitBatch('my-batch');

// Internally:
// ↓
Create promises for each task
// ↓
Store batch with ID → Promise.all(promises)
// ↓
Schedule micro-batch processing
// ↓
Drain ALL pending tasks (singletons + batches) into queue
// ↓
Process through token bucket (respects 40 RPS)
// ↓
Resolve individual task promises
// ↓
Batch promise resolves when all tasks complete
```

### 3. SSE Write Flow

```typescript
// Non-blocking writes
sseWriter.writeAsync({ type: 'thinking', data: 'Phase 1...' });
sseWriter.writeAsync({ type: 'thinking', data: 'Phase 2...' });

// ... do work (non-blocking) ...

// Checkpoint: ensure all writes delivered
await sseWriter.flush();

// Internally:
// ↓
writeAsync: Add to internal promise chain (fire-and-forget)
// ↓
flush: await promise chain
// ↓
All queued writes complete before proceeding
```

## Key Design Decisions

### Why Global Orchestrator?

**Problem**: Cloudflare Workers limit is **40 RPS across the entire worker**, not per API.

**Solution**: Single `globalOrchestrator` instance ensures ALL external calls (Anthropic, Spotify,
Last.fm, narrator) share the same rate limit budget.

```typescript
// ❌ BAD: Multiple separate queues
const spotifyQueue = new RateLimitedQueue({ rate: 40 })
const lastfmQueue = new RateLimitedQueue({ rate: 40 })
// → Can hit 80 RPS total!

// ✅ GOOD: Single global orchestrator
const orchestrator = globalOrchestrator // rate: 40 total
```

### Why Token Bucket?

**Problem**: Simple interval-based rate limiting can't handle bursts efficiently.

**Solution**: Token bucket allows bursts up to capacity while maintaining average rate.

```
Time: 0s   1s   2s   3s   4s
      ↓    ↓    ↓    ↓    ↓
Tokens: 40 → 40 → 40 → 40 → 40  (refills at 40/sec)

Burst at t=0s: Use all 40 tokens immediately
              (processes 40 requests in parallel)

Remaining work: Processes at steady 40 RPS as tokens refill
```

### Why Micro-Batching?

**Problem**: If we process immediately on each `execute()`, we lose batching opportunities.

**Solution**: Small delay (setTimeout 0) allows multiple `execute()` calls to accumulate before
processing.

```typescript
// Calls arrive within same event loop tick
orchestrator.execute(() => call1())
orchestrator.execute(() => call2())
orchestrator.execute(() => call3())

// All three batched together in next tick
// → More efficient than processing individually
```

### Why writeAsync + flush?

**Problem**: Blocking SSE writes add latency to request processing.

**Solution**: Queue writes asynchronously, flush at checkpoints.

```typescript
// ❌ BAD: Blocks for 30ms per write
for (let i = 0; i < 10; i++) {
  await sseWriter.write({ data: `Progress ${i}` }) // 30ms each
}
// Total: 300ms wasted

// ✅ GOOD: Non-blocking, flush once
for (let i = 0; i < 10; i++) {
  sseWriter.writeAsync({ data: `Progress ${i}` }) // ~0ms
}
await sseWriter.flush() // 30ms total
// Total: 30ms (10x faster!)
```

## Real-World Example: Playlist Analysis

### Execution Timeline

```
Phase 1: Search (5 parallel searches)
─────────────────────────────────────────
0ms    writeAsync("Searching...")       ← non-blocking
0ms    enqueueBatch('searches', 5 tasks) ← schedules processing
10ms   [Processing 5 searches in parallel with rate limit]
200ms  awaitBatch('searches') ← resolves when all complete
200ms  flush() ← ensure "Searching..." delivered

Phase 2: Audio Features (50 tracks, 10 concurrent)
─────────────────────────────────────────
200ms  writeAsync("Analyzing...")       ← non-blocking
200ms  enqueueBatch('audio', 50 tasks)
210ms  [Processing with concurrency=10, rate=40 RPS]
       - Batch 1 (10 tracks): 100ms
       - Batch 2 (10 tracks): 100ms
       - Batch 3 (10 tracks): 100ms
       - Batch 4 (10 tracks): 100ms
       - Batch 5 (10 tracks): 100ms
700ms  awaitBatch('audio')
700ms  flush()

Phase 3: Last.fm Enrichment (50 tracks + 45 artists)
─────────────────────────────────────────
700ms  writeAsync("Enriching...")       ← non-blocking
700ms  enqueueBatch('lastfm-tracks', 50)
700ms  enqueueBatch('lastfm-artists', 45)
710ms  [Processing 95 tasks total with concurrency=10]
       - Progress updates via writeAsync (non-blocking)
       - Interval polls pending count every 500ms
2500ms awaitBatch('lastfm-tracks')
2500ms awaitBatch('lastfm-artists')
2500ms flush()

Total: ~2.5 seconds
```

### Without Orchestration

```
Phase 1: Sequential searches (5 × 200ms) = 1000ms
Phase 2: Sequential audio (50 × 100ms)  = 5000ms
Phase 3: Sequential Last.fm (95 × 80ms) = 7600ms

Total: ~13.6 seconds
```

**~5.5x faster with orchestration!**

## Component Responsibilities

### RateLimitedQueue

- Token bucket algorithm
- Monotonic timing (performance.now)
- Concurrency bounds
- Jitter injection
- **Responsibility**: Low-level rate limiting mechanics

### RequestOrchestrator

- Task promise management
- Batch ID tracking
- Micro-batching scheduler
- Queue lifecycle (clear, process)
- **Responsibility**: High-level orchestration API

### RateLimitedAPIClients

- Convenience wrappers per API type
- Logging integration
- Error handling
- **Responsibility**: Developer-friendly API

### SSEWriter

- Promise chain for writes
- writeAsync (fire-and-forget)
- flush (await all)
- **Responsibility**: Non-blocking streaming

## Usage Guidelines

### When to use execute()

Single API calls:

```typescript
const playlist = await orchestrator.execute(() => spotify.createPlaylist(userId, { name }))
```

### When to use enqueueBatch()

Independent parallel work:

```typescript
orchestrator.enqueueBatch(
  'searches',
  queries.map(q => () => spotify.search(q)),
)
const results = await orchestrator.awaitBatch('searches')
```

### When to use writeAsync()

Progress updates, thinking messages:

```typescript
sseWriter.writeAsync({ type: 'thinking', data: 'Working...' })
```

### When to use flush()

Phase boundaries, before expensive work:

```typescript
await sseWriter.flush() // Ensure user sees progress
await expensiveComputation()
```

### When to use write()

Critical messages that MUST arrive:

```typescript
await sseWriter.write({ type: 'error', data: 'Failed!' })
await sseWriter.write({ type: 'done', data: null })
```

## Performance Monitoring

### Track orchestrator state

```typescript
const orchestrator = getGlobalOrchestrator()

console.log(`Pending before: ${orchestrator.getPendingCount()}`)

orchestrator.enqueueBatch('work', tasks)

console.log(`Pending after enqueue: ${orchestrator.getPendingCount()}`)

const results = await orchestrator.awaitBatch('work')

console.log(`Pending after complete: ${orchestrator.getPendingCount()}`)
```

### Expected values

- **Healthy**: Pending count grows during enqueue, drops to 0 after await
- **Warning**: Pending count remains high (>100) after await
- **Critical**: Pending count continuously grows (memory leak)

## Error Handling

All orchestrated tasks return `T | null`:

```typescript
const results = await orchestrator.awaitBatch('work')

// Always check for null (failed tasks)
const successfulResults = results.filter(r => r !== null)

console.log(`${successfulResults.length}/${results.length} tasks succeeded`)
```

Individual task errors are caught and logged:

```typescript
orchestrator.execute(async () => {
  throw new Error('Task failed!')
  // → Logs error, returns null
  // → Does NOT crash entire batch
})
```

## Next Steps

1. **Audit current code** for direct API calls
2. **Identify batching opportunities** (searches, audio features, etc.)
3. **Convert SSE writes** from `await write()` to `writeAsync()` + `flush()`
4. **Test rate limiting** with production-scale loads
5. **Monitor orchestrator** pending counts in production

See `REFACTORING_EXAMPLE.md` for concrete migration examples.

## Summary

The orchestration architecture provides:

| Feature       | Before               | After               |
| ------------- | -------------------- | ------------------- |
| Rate limiting | ❌ None              | ✅ 40 RPS global    |
| Parallelism   | ❌ Sequential        | ✅ 10 concurrent    |
| Batching      | ❌ Manual            | ✅ Automatic        |
| SSE latency   | ⚠️ Blocking writes   | ✅ Pipelined        |
| UX            | ⚠️ Slow progress     | ✅ Responsive       |
| Compliance    | ❌ Can exceed 40 RPS | ✅ Always compliant |

**Performance**: ~4-5x faster with better UX and guaranteed rate limit compliance.
