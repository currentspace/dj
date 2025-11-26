# Cloudflare Workers Guidelines (November 2025)

These guidelines represent modern async Cloudflare Workers patterns for November 2025, optimized for SSE streaming, rate limiting, and edge computing.

## Core Architecture

### TransformStream for SSE

**Immediate Response + Async Processing** is the critical pattern:

```typescript
export async function handleRequest(c: Context) {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const sseWriter = new SSEWriter(writer)

  // CRITICAL: Return Response immediately
  // This satisfies Cloudflare's request timeout
  const response = new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Encoding': 'identity',
      'Connection': 'keep-alive',
    },
    status: 200,
  })

  // Async processing runs AFTER response is returned
  processStream(sseWriter, c).catch(err => {
    console.error('Stream processing failed:', err)
  })

  return response
}
```

**Why This Works**:
- Cloudflare Workers have a request timeout (~30s)
- TransformStream decouples response from processing
- Client receives stream immediately, events arrive as generated

**Reference**: `workers/api/src/routes/chat-stream.ts:2537-2548`

### SSEWriter with Queued Writes

Prevent concurrent write issues with queue-based serialization:

```typescript
class SSEWriter {
  private writeQueue: Promise<void> = Promise.resolve()
  private closed = false
  private readonly encoder = new TextEncoder()

  constructor(private writer: WritableStreamDefaultWriter) {}

  // Awaitable write - critical messages
  async write(event: StreamEvent): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return

      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        this.closed = true
        console.error('SSE write error:', error)
      }
    })

    return this.writeQueue
  }

  // Fire-and-forget - progress messages
  writeAsync(event: StreamEvent): void {
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      const message = `data: ${JSON.stringify(event)}\n\n`
      await this.writer.write(this.encoder.encode(message)).catch(() => {
        this.closed = true
      })
    })
  }

  // Wait for all pending writes
  async flush(): Promise<void> {
    return this.writeQueue
  }

  // Heartbeat to keep connection alive
  async writeHeartbeat(): Promise<void> {
    if (this.closed) return
    try {
      await this.writer.write(this.encoder.encode(': heartbeat\n\n'))
    } catch {
      this.closed = true
    }
  }

  async close(): Promise<void> {
    await this.flush()
    this.closed = true
    try {
      await this.writer.close()
    } catch {
      // Already closed
    }
  }
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:151-226`

### Heartbeat Pattern

Keep SSE connections alive:

```typescript
const heartbeatInterval = setInterval(() => {
  if (abortController.signal.aborted) {
    clearInterval(heartbeatInterval)
    return
  }
  void sseWriter.writeHeartbeat()
}, 15000)  // Every 15 seconds

// Cleanup on request completion
try {
  await processRequest()
} finally {
  clearInterval(heartbeatInterval)
  await sseWriter.close()
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:2589-2596`

## Rate Limiting Architecture

### Three-Layer System

```
Layer 1: Global RPS Limit (40 RPS - Cloudflare constraint)
    ↓
Layer 2: Per-Service Lane Concurrency (anthropic: 2, spotify: 5, etc.)
    ↓
Layer 3: Subrequest Budget Tracking (950 max per request)
```

### Layer 1: Token Bucket Rate Limiter

```typescript
class RateLimitedQueue<T> {
  private tokens: number
  private lastRefill: number = performance.now()

  constructor(
    private rate: number = 40,      // 40 requests per second
    private burst: number = 40,     // Allow burst up to limit
    private concurrency: number = 10
  ) {
    this.tokens = burst
  }

  private tick(): void {
    const now = performance.now()
    const elapsed = now - this.lastRefill

    // Refill tokens based on elapsed time (precise, no setInterval jitter)
    this.tokens = Math.min(
      this.burst,
      this.tokens + (elapsed * this.rate) / 1000
    )
    this.lastRefill = now

    // Launch tasks while tokens and concurrency allow
    while (this.running < this.concurrency && this.tokens >= 1 && this.queue.length > 0) {
      this.tokens -= 1
      this.running += 1
      const task = this.queue.shift()!
      this.runTask(task)
    }
  }

  async enqueue<R>(task: () => Promise<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.tick()
    })
  }
}
```

**Reference**: `workers/api/src/utils/RateLimitedQueue.ts`

### Layer 2: Per-Lane Concurrency (RequestOrchestrator)

```typescript
const LANE_LIMITS: Record<LaneKey, number> = {
  anthropic: 2,   // Anthropic SDK limitation in Workers
  spotify: 5,     // Spotify API concurrency
  deezer: 10,     // Deezer API concurrency
  lastfm: 10,     // Last.fm API concurrency
  default: 3,
}

class RequestOrchestrator {
  private lanes = new Map<LaneKey, LaneConfig>()

  async execute<T>(task: () => Promise<T>, lane: LaneKey): Promise<T> {
    // Wait for lane slot
    await this.acquireLaneSlot(lane)

    try {
      // Execute through global rate limiter
      return await this.rateLimiter.enqueue(task)
    } finally {
      // Release slot for next waiting task
      this.releaseLaneSlot(lane)
    }
  }

  private async acquireLaneSlot(lane: LaneKey): Promise<void> {
    const config = this.lanes.get(lane)!

    if (config.running < config.maxConcurrency) {
      config.running++
      return
    }

    // Wait in queue for slot
    return new Promise(resolve => {
      config.queue.push(resolve)
    })
  }

  private releaseLaneSlot(lane: LaneKey): void {
    const config = this.lanes.get(lane)!
    config.running--

    // Notify next waiting task
    const next = config.queue.shift()
    if (next) {
      config.running++
      next()
    }
  }
}

// Global singleton
export const globalOrchestrator = new RequestOrchestrator()
```

**Reference**: `workers/api/src/utils/RequestOrchestrator.ts`

### Layer 3: Subrequest Budget Tracking

```typescript
class SubrequestTracker {
  private count = 0
  private readonly maxSubrequests: number

  constructor(options: { maxSubrequests?: number } = {}) {
    this.maxSubrequests = options.maxSubrequests ?? 950  // Safety margin below 1000
  }

  record(count = 1): boolean {
    this.count += count

    if (this.count / this.maxSubrequests >= 0.8) {
      console.warn(`Approaching subrequest limit: ${this.count}/${this.maxSubrequests}`)
    }

    return this.count <= this.maxSubrequests
  }

  remaining(): number {
    return Math.max(0, this.maxSubrequests - this.count)
  }

  canMake(count: number): boolean {
    return this.count + count <= this.maxSubrequests
  }
}
```

**Usage in chat-stream**:
```typescript
const tracker = new SubrequestTracker({ maxSubrequests: 950 })

await runWithSubrequestTracker(tracker, async () => {
  // Budget allocation for enrichment
  const remaining = tracker.remaining()
  const availableBudget = Math.max(0, remaining - 10)  // Reserve 10 for overhead

  const deezerBudget = Math.floor(availableBudget * 0.5)
  const lastfmBudget = Math.floor(availableBudget * 0.5)

  tracksToEnrichDeezer = uncachedTracks.slice(0, deezerBudget)
  tracksToEnrichLastfm = uncachedTracks.slice(0, lastfmBudget)
})
```

**Reference**: `workers/api/src/utils/SubrequestTracker.ts`

## AsyncLocalStorage Patterns

### Logger Context (Per-Request Isolation)

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'

interface LoggerContext {
  logger: ServiceLogger
}

const loggerStorage = new AsyncLocalStorage<LoggerContext>()

export async function runWithLogger<T>(
  logger: ServiceLogger,
  fn: () => Promise<T>
): Promise<T> {
  return loggerStorage.run({ logger }, fn)
}

export function getLogger(): ServiceLogger | undefined {
  return loggerStorage.getStore()?.logger
}
```

**Usage**:
```typescript
const logger = new ServiceLogger({
  requestId: crypto.randomUUID(),
  serviceName: 'chat-stream',
  sseWriter,
})

await runWithLogger(logger, async () => {
  // All nested calls can access via getLogger()
  await processRequest()
})
```

**Reference**: `workers/api/src/utils/LoggerContext.ts`

### Subrequest Tracker Context

```typescript
const subrequestStorage = new AsyncLocalStorage<SubrequestTracker>()

export async function runWithSubrequestTracker<T>(
  tracker: SubrequestTracker,
  fn: () => Promise<T>
): Promise<T> {
  return subrequestStorage.run(tracker, fn)
}

export function getSubrequestTracker(): SubrequestTracker | undefined {
  return subrequestStorage.getStore()
}
```

**Reference**: `workers/api/src/utils/SubrequestTrackerContext.ts`

## KV Storage Patterns

### Differential TTLs

```typescript
// Cache hits: Long TTL (data is valid)
const HIT_TTL = 90 * 24 * 60 * 60  // 90 days

// Cache misses: Short TTL (retry soon)
const MISS_TTL = 5 * 60  // 5 minutes

async function cacheResult(key: string, value: unknown, isHit: boolean): Promise<void> {
  await env.CACHE.put(
    key,
    JSON.stringify(value),
    { expirationTtl: isHit ? HIT_TTL : MISS_TTL }
  )
}
```

**Why**:
- Hits stay cached (data won't change)
- Misses retry quickly (API might have data later)
- Prevents repeated lookups for known-null data

**Reference**: `workers/api/src/services/AudioEnrichmentService.ts`

### Key Namespacing

```typescript
// Prefix keys by data type to prevent collisions
const BPM_PREFIX = 'bpm:'
const LASTFM_PREFIX = 'lastfm:'
const ARTIST_PREFIX = 'artist:'

const bpmKey = `${BPM_PREFIX}${trackId}`
const lastfmKey = `${LASTFM_PREFIX}${hashKey(artist, track)}`
const artistKey = `${ARTIST_PREFIX}${hashKey(artistName)}`
```

### Session Storage

```typescript
// 4-hour TTL for OAuth sessions
const SESSION_TTL = 4 * 60 * 60

await env.SESSIONS.put(
  sessionToken,
  spotifyAccessToken,
  { expirationTtl: SESSION_TTL }
)

// Retrieve session
const spotifyToken = await env.SESSIONS.get(sessionToken)
if (!spotifyToken) {
  throw new Error('Session expired')
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts`

## Hono Framework Patterns

### Type-Safe Environment

```typescript
// Define Env interface at root
export interface Env {
  ANTHROPIC_API_KEY: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  LASTFM_API_KEY?: string  // Optional
  FRONTEND_URL?: string
  ENVIRONMENT: string
  ASSETS: Fetcher
  SESSIONS?: KVNamespace
  AUDIO_FEATURES_CACHE?: KVNamespace
}

// Use in Hono app
const app = new OpenAPIHono<{ Bindings: Env }>()

// All routes get typed access
app.get('/api/status', (c) => {
  const env = c.env.ENVIRONMENT  // TypeScript knows this is string
  const cache = c.env.AUDIO_FEATURES_CACHE  // TypeScript knows this is KVNamespace | undefined
})
```

**Reference**: `workers/api/src/index.ts`

### OpenAPI Integration

```typescript
import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'

const app = new OpenAPIHono<{ Bindings: Env }>()

// Define schema
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze'),
})

// Route with validation
app.post('/api/chat-stream/message', async (c) => {
  const body = await c.req.json()
  const request = ChatRequestSchema.parse(body)  // Throws on invalid
  // ...
})

// OpenAPI docs
app.doc('/api/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'DJ API', version: '1.0.0' },
})
```

**Reference**: `workers/api/src/routes/chat-stream.ts:66-78`

### Global CORS Middleware

```typescript
import { cors } from 'hono/cors'

// Allow all origins (for public API)
app.use('*', cors())

// Or restrict to specific origin
app.use('*', cors({
  origin: (origin) => {
    if (origin === process.env.FRONTEND_URL) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))
```

**Reference**: `workers/api/src/index.ts:23`

## Error Handling Patterns

### Type-Safe Error Extraction

```typescript
import { z } from 'zod'

const ErrorDetailsSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  status: z.number().optional(),
  context: z.string().optional(),
})

type ErrorDetails = z.infer<typeof ErrorDetailsSchema>

function buildErrorDetails(error: unknown, context?: string): ErrorDetails {
  const details: ErrorDetails = { context }

  if (error instanceof Error) {
    details.message = error.message

    // Check for status property (API errors)
    if ('status' in error && typeof error.status === 'number') {
      details.status = error.status
    }
  }

  return ErrorDetailsSchema.parse(details)
}
```

**Reference**: `workers/api/src/utils/RateLimitedAPIClients.ts:32-44`

### Streaming Error Recovery

```typescript
try {
  for await (const event of stream) {
    // Process event
  }
} catch (streamError) {
  const errorDetails = {
    errorMessage: streamError.message,
    errorType: streamError.constructor.name,
    stack: streamError.stack?.split('\n').slice(0, 10),
  }

  logger?.error('Stream processing error', streamError, errorDetails)

  // Graceful degradation
  if (fullResponse.length > 0) {
    // Have some content, send what we have
    await sseWriter.write({ type: 'content', data: fullResponse })
    await sseWriter.write({ type: 'done', data: null })
  } else {
    // No content yet, send error
    await sseWriter.write({ type: 'error', data: 'Stream processing failed' })
  }
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3450-3522`

## Service Architecture

### Service Class Pattern

```typescript
export class AudioEnrichmentService {
  constructor(
    private cache?: KVNamespace,
    private rateLimiter?: RateLimitedQueue
  ) {}

  async enrichTrack(track: SpotifyTrack): Promise<BPMEnrichment> {
    const logger = getLogger()  // From AsyncLocalStorage

    // Check cache first
    const cached = await this.cache?.get(track.id)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.enrichment.bpm !== null) {
        logger?.debug('Cache hit', { trackId: track.id })
        return data.enrichment
      }
    }

    // Fetch from API
    const enrichment = await this.fetchFromDeezer(track)

    // Cache result
    await this.cacheResult(track.id, enrichment)

    return enrichment
  }
}
```

**Reference**: `workers/api/src/services/AudioEnrichmentService.ts`

### Per-API Wrappers

```typescript
// Spotify API wrapper
export async function rateLimitedSpotifyCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string
): Promise<T> {
  return globalOrchestrator.execute(
    async () => {
      const start = performance.now()
      try {
        const result = await call()
        logger?.debug(`Spotify call completed`, {
          context,
          durationMs: performance.now() - start,
        })
        return result
      } catch (error) {
        logger?.error('Spotify call failed', error, { context })
        throw error
      }
    },
    'spotify'  // Lane key
  )
}

// Similar for Deezer, Last.fm, Anthropic...
```

**Reference**: `workers/api/src/utils/RateLimitedAPIClients.ts`

## Client Disconnect Handling

```typescript
const abortController = new AbortController()

// Listen for client disconnect
const onAbort = () => {
  getLogger()?.info('Client disconnected')
  abortController.abort()
}
c.req.raw.signal.addEventListener('abort', onAbort)

// Check abort signal throughout processing
async function processWithAbortCheck(): Promise<void> {
  for (const track of tracks) {
    if (abortController.signal.aborted) {
      throw new Error('Request aborted')
    }
    await processTrack(track)
  }
}

// Cleanup
try {
  await processWithAbortCheck()
} finally {
  c.req.raw.signal.removeEventListener('abort', onAbort)
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts`

## Performance Optimizations

### Parallel Tool Execution

```typescript
// WRONG - Sequential (slow)
for (const toolCall of toolCalls) {
  results.push(await executeTool(toolCall))
}

// CORRECT - Parallel (respects rate limits)
const results = await Promise.all(
  toolCalls.map(toolCall => executeTool(toolCall))
)
```

### Batch Enrichment

```typescript
// Process tracks in parallel batches
async function batchEnrichTracks(
  tracks: SpotifyTrack[],
  batchSize: number = 10
): Promise<Map<string, Enrichment>> {
  const results = new Map<string, Enrichment>()

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(track => enrichTrack(track))
    )

    batchResults.forEach((result, index) => {
      results.set(batch[index].id, result)
    })
  }

  return results
}
```

### Cache-First Pattern

```typescript
async function getWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { ttl: number }
): Promise<T> {
  // Try cache first
  const cached = await env.CACHE.get(key)
  if (cached) {
    return JSON.parse(cached)
  }

  // Fetch from source
  const result = await fetcher()

  // Cache for next time (don't await)
  env.CACHE.put(key, JSON.stringify(result), {
    expirationTtl: options.ttl,
  }).catch(err => console.error('Cache put failed:', err))

  return result
}
```

## Wrangler Configuration

```jsonc
// wrangler.jsonc
{
  "name": "dj-api",
  "main": "dist/index.js",
  "compatibility_date": "2024-01-01",
  "compatibility_flags": ["nodejs_compat"],  // Required for AsyncLocalStorage

  "vars": {
    "ENVIRONMENT": "production",
    "FRONTEND_URL": "https://dj.current.space"
  },

  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "c81455430c6d4aa2a5da4bf2c1fcd3a2"
    },
    {
      "binding": "AUDIO_FEATURES_CACHE",
      "id": "eb3657a3d4f045edb31efba6567eca0f"
    }
  ],

  "assets": {
    "directory": "../apps/web/dist",
    "binding": "ASSETS"
  },

  // SPA routing
  "not_found_handling": "single-page-application",

  // API routes take priority
  "run_worker_first": ["/api/*"]
}
```

**Reference**: `workers/api/wrangler.jsonc`

## Anti-Patterns to Avoid

### DON'T: Block on Response

```typescript
// WRONG - Blocks until complete
const result = await longOperation()
return new Response(JSON.stringify(result))

// CORRECT - Return stream immediately
const { readable, writable } = new TransformStream()
const response = new Response(readable)
processAsync(writable)  // Don't await
return response
```

### DON'T: Exceed Subrequest Limits

```typescript
// WRONG - No budget tracking
for (const track of allTracks) {
  await enrichTrack(track)  // Could exceed 1000 subrequests
}

// CORRECT - Budget-aware
const budget = tracker.remaining()
const tracksToProcess = allTracks.slice(0, Math.min(budget, allTracks.length))
```

### DON'T: Use setTimeout for Rate Limiting

```typescript
// WRONG - setTimeout jitter, blocks event loop
await new Promise(r => setTimeout(r, 25))

// CORRECT - Token bucket with performance.now()
// See RateLimitedQueue implementation above
```

### DON'T: Leak AsyncLocalStorage

```typescript
// WRONG - Context escapes scope
const logger = getLogger()
setTimeout(() => {
  logger?.info('Delayed log')  // May be undefined
}, 1000)

// CORRECT - Capture in closure
const loggerInstance = getLogger()
setTimeout(() => {
  loggerInstance?.info('Delayed log')  // Uses captured instance
}, 1000)
```
