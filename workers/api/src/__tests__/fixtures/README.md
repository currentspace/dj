# Test Fixtures Documentation

Comprehensive mock infrastructure for backend/API worker testing in the DJ monorepo.

## Overview

This directory contains mock implementations for:

1. **Cloudflare Workers** - KV, Env, ExecutionContext, Request, Context
2. **External APIs** - Deezer, Last.fm, MusicBrainz, Spotify
3. **Anthropic SDK** - Claude streaming responses, tool calls
4. **Test Builders** - Factory pattern for realistic test data
5. **Rate Limiting** - Mock queues with timing verification

## Files

### cloudflare-mocks.ts

Mocks for Cloudflare Workers infrastructure.

**Classes:**

- `MockKVNamespace` - Full KVNamespace implementation with TTL tracking
- `MockExecutionContext` - ExecutionContext with waitUntil tracking

**Functions:**

- `createMockEnv()` - Create mock Env object with KV and secrets
- `createMockRequest()` - Create Hono-compatible Request
- `createMockContext()` - Create Hono Context (c)

### api-mocks.ts

Mocks for external API calls (Deezer, Last.fm, MusicBrainz, Spotify).

**Builder Functions:**

- `buildDeezerTrack()` - Realistic Deezer track response
- `buildLastFmTrack()` - Last.fm track info response
- `buildLastFmArtistInfo()` - Last.fm artist info response
- `buildMusicBrainzRecording()` - MusicBrainz recording response
- `buildSpotifyTrack()` - Spotify track full response
- `buildSpotifyPlaylist()` - Spotify playlist full response

**Mock Functions:**

- `mockDeezerAPI()` - Mock fetch for Deezer API
- `mockLastFmAPI()` - Mock fetch for Last.fm API
- `mockMusicBrainzAPI()` - Mock fetch for MusicBrainz API
- `mockSpotifyAPI()` - Mock fetch for Spotify API

### anthropic-mocks.ts

Mocks for Anthropic SDK (@anthropic-ai/sdk).

**Classes:**

- `MockAnthropicClient` - Mock client with pre-configured responses

**Builder Functions:**

- `buildMessageStartEvent()` - Message start event
- `buildTextBlockStartEvent()` - Text content block start
- `buildTextDeltaEvent()` - Text delta (streaming chunk)
- `buildToolUseBlockStartEvent()` - Tool use block start
- `buildToolInputDeltaEvent()` - Tool input delta
- `buildContentBlockStopEvent()` - Content block stop
- `buildMessageDeltaEvent()` - Message delta
- `buildMessageStopEvent()` - Message stop

**Response Builders:**

- `buildTextResponseStream()` - Complete text response
- `buildToolCallResponseStream()` - Complete tool call response
- `buildMixedResponseStream()` - Text + tool call response

**Functions:**

- `createMockAnthropicClient()` - Create client with responses
- `mockMessageCreate()` - Mock non-streaming message

### test-builders.ts

Builder pattern and faker utilities for test data.

**Classes:**

- `EnrichmentResultBuilder` - Build BPM enrichment results
- `LastFmSignalsBuilder` - Build Last.fm signals
- `PlaylistAnalysisBuilder` - Build playlist analysis results
- `SSEWriterBuilder` - Mock WritableStreamDefaultWriter for SSE

**Faker Utilities:**

- `faker.isrc()` - Generate random ISRC code
- `faker.spotifyId()` - Generate random Spotify ID
- `faker.artistName()` - Generate random artist name
- `faker.trackName()` - Generate random track name
- `faker.bpm()` - Generate random BPM (60-190)
- `faker.popularity()` - Generate random popularity (0-100)
- `faker.durationMs()` - Generate random duration (2-7 min)
- `faker.releaseYear()` - Generate random year (1974-2024)
- `faker.genre()` - Generate random genre

**Convenience Functions:**

- `buildEnrichmentResult()` - Quick enrichment result
- `buildLastFmSignals()` - Quick Last.fm signals
- `buildPlaylistAnalysis()` - Quick playlist analysis
- `buildSSEWriter()` - Quick SSE writer mock

### rate-limit-mocks.ts

Mocks for rate limiting with timing verification.

**Classes:**

- `MockRateLimitedQueue<T>` - Queue with timestamp tracking
- `MockRequestOrchestrator` - Orchestrator with request history

**Helper Functions:**

- `createMockRateLimitedQueue()` - Create mock queue
- `createMockRequestOrchestrator()` - Create mock orchestrator
- `verifyRateLimitCompliance()` - Verify rate from timestamps
- `measureExecutionTime()` - Measure async function duration
- `createDelayedTask()` - Create task with delay
- `createDelayedTaskBatch()` - Create batch of delayed tasks
- `verifyBurstBehavior()` - Verify burst compliance

## Usage Examples

### 1. Testing with Mock KV

```typescript
import {describe, it, expect, beforeEach} from 'vitest'
import {MockKVNamespace, createMockEnv} from './fixtures/cloudflare-mocks'

describe('KV Storage', () => {
  let kv: MockKVNamespace

  beforeEach(() => {
    kv = new MockKVNamespace()
  })

  it('should store and retrieve values', async () => {
    await kv.put('key1', 'value1')
    const value = await kv.get('key1')
    expect(value).toBe('value1')
  })

  it('should handle TTL expiration', async () => {
    await kv.put('key1', 'value1', {expirationTtl: 1}) // 1 second
    await new Promise(resolve => setTimeout(resolve, 1100))
    const value = await kv.get('key1')
    expect(value).toBeNull()
  })

  it('should store JSON', async () => {
    const data = {foo: 'bar', count: 42}
    await kv.put('key1', JSON.stringify(data))
    const retrieved = await kv.get('key1', 'json')
    expect(retrieved).toEqual(data)
  })
})
```

### 2. Testing with Mock Hono Context

```typescript
import {describe, it, expect} from 'vitest'
import {createMockContext, createMockEnv} from './fixtures/cloudflare-mocks'

describe('API Route', () => {
  it('should access env variables', async () => {
    const env = createMockEnv({
      SPOTIFY_CLIENT_ID: 'test-client-id',
    })

    const ctx = createMockContext({env})

    expect(ctx.env.SPOTIFY_CLIENT_ID).toBe('test-client-id')
  })

  it('should parse request body', async () => {
    const ctx = createMockContext({
      request: createMockRequest({
        url: 'http://localhost:8787/api/test',
        method: 'POST',
        body: {message: 'Hello'},
      }),
    })

    const body = await ctx.req.json()
    expect(body).toEqual({message: 'Hello'})
  })
})
```

### 3. Testing with Mock External APIs

```typescript
import {describe, it, expect, afterEach} from 'vitest'
import {mockDeezerAPI, buildDeezerTrack} from './fixtures/api-mocks'

describe('Audio Enrichment', () => {
  afterEach(() => {
    // Cleanup is handled by the mock's return function
  })

  it('should fetch track by ISRC', async () => {
    const cleanup = mockDeezerAPI({
      USUM71234567: buildDeezerTrack({
        bpm: 128,
        rank: 900000,
      }),
    })

    const response = await fetch('https://api.deezer.com/track/isrc:USUM71234567')
    const data = await response.json()

    expect(data.bpm).toBe(128)
    expect(data.rank).toBe(900000)

    cleanup()
  })

  it('should return 404 for unknown ISRC', async () => {
    const cleanup = mockDeezerAPI({})

    const response = await fetch('https://api.deezer.com/track/isrc:UNKNOWN123')

    expect(response.status).toBe(404)

    cleanup()
  })
})
```

### 4. Testing with Mock Anthropic Client

```typescript
import {describe, it, expect} from 'vitest'
import {
  createMockAnthropicClient,
  buildTextResponseStream,
  buildToolCallResponseStream,
} from './fixtures/anthropic-mocks'

describe('Claude Integration', () => {
  it('should stream text response', async () => {
    const client = createMockAnthropicClient({
      'analyze playlist': buildTextResponseStream('The playlist has a chill vibe'),
    })

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{role: 'user', content: 'analyze playlist'}],
    })

    const chunks: string[] = []
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        chunks.push(event.delta.text ?? '')
      }
    }

    const fullText = chunks.join('')
    expect(fullText).toBe('The playlist has a chill vibe')
  })

  it('should handle tool calls', async () => {
    const client = createMockAnthropicClient({
      'get playlist': buildToolCallResponseStream('get_playlist_tracks', {
        playlist_id: 'abc123',
        limit: 20,
      }),
    })

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{role: 'user', content: 'get playlist'}],
    })

    const message = await stream.finalMessage()
    const toolBlock = message.content.find(block => block.type === 'tool_use')

    expect(toolBlock).toBeDefined()
    expect(toolBlock?.type).toBe('tool_use')
    if (toolBlock?.type === 'tool_use') {
      expect(toolBlock.name).toBe('get_playlist_tracks')
      expect(toolBlock.input).toEqual({playlist_id: 'abc123', limit: 20})
    }
  })
})
```

### 5. Testing with Builder Pattern

```typescript
import {describe, it, expect} from 'vitest'
import {
  EnrichmentResultBuilder,
  LastFmSignalsBuilder,
  buildPlaylistAnalysis,
} from './fixtures/test-builders'

describe('Data Builders', () => {
  it('should build enrichment result', () => {
    const result = new EnrichmentResultBuilder()
      .withBPM(140)
      .withGain(-10)
      .withSource('deezer')
      .build()

    expect(result.bpm).toBe(140)
    expect(result.gain).toBe(-10)
    expect(result.source).toBe('deezer')
  })

  it('should build Last.fm signals', () => {
    const signals = new LastFmSignalsBuilder()
      .withCanonicalNames('Artist', 'Track')
      .withListeners(50000)
      .withTags(['rock', 'indie'])
      .build()

    expect(signals.canonicalArtist).toBe('Artist')
    expect(signals.listeners).toBe(50000)
    expect(signals.topTags).toEqual(['rock', 'indie'])
  })

  it('should build playlist analysis', () => {
    const analysis = buildPlaylistAnalysis()
      .withPlaylistName('My Playlist')
      .withTotalTracks(20)
      .withAvgPopularity(80)
      .build()

    expect(analysis.playlist_name).toBe('My Playlist')
    expect(analysis.total_tracks).toBe(20)
    expect(analysis.metadata_analysis.avg_popularity).toBe(80)
  })
})
```

### 6. Testing Rate Limiting

```typescript
import {describe, it, expect} from 'vitest'
import {
  createMockRateLimitedQueue,
  createDelayedTaskBatch,
  verifyRateLimitCompliance,
} from './fixtures/rate-limit-mocks'

describe('Rate Limiting', () => {
  it('should respect 40 TPS limit', async () => {
    const queue = createMockRateLimitedQueue<number>({rate: 40})
    const tasks = createDelayedTaskBatch([1, 2, 3, 4, 5], 5)

    tasks.forEach(task => queue.enqueue(task))
    await queue.processAll()

    const timestamps = queue.getTimestamps()
    const {compliant, actualRate} = verifyRateLimitCompliance(timestamps, 40, 0.1)

    expect(compliant).toBe(true)
    expect(actualRate).toBeLessThanOrEqual(44) // 40 + 10% tolerance
  })

  it('should track task execution', async () => {
    const queue = createMockRateLimitedQueue<string>({rate: 10})

    queue.enqueue(async () => 'task1')
    queue.enqueue(async () => 'task2')
    queue.enqueue(async () => 'task3')

    const results = await queue.processAll()

    expect(results).toEqual(['task1', 'task2', 'task3'])
  })
})
```

### 7. Testing SSE Streams

```typescript
import {describe, it, expect} from 'vitest'
import {buildSSEWriter} from './fixtures/test-builders'

describe('SSE Streaming', () => {
  it('should capture SSE events', async () => {
    const writerBuilder = buildSSEWriter()
    const writer = writerBuilder.build()

    // Write SSE events
    await writer.write(new TextEncoder().encode('event: thinking\n'))
    await writer.write(new TextEncoder().encode('data: Processing request\n\n'))

    await writer.write(new TextEncoder().encode('event: content\n'))
    await writer.write(new TextEncoder().encode('data: Hello world\n\n'))

    const events = writerBuilder.getSSEEvents()

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      event: 'thinking',
      data: 'Processing request',
    })
    expect(events[1]).toEqual({
      event: 'content',
      data: 'Hello world',
    })
  })
})
```

### 8. Using Faker Utilities

```typescript
import {describe, it, expect} from 'vitest'
import {faker} from './fixtures/test-builders'

describe('Faker Utilities', () => {
  it('should generate realistic data', () => {
    const isrc = faker.isrc()
    expect(isrc).toMatch(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/)

    const spotifyId = faker.spotifyId()
    expect(spotifyId).toHaveLength(22)

    const bpm = faker.bpm()
    expect(bpm).toBeGreaterThanOrEqual(60)
    expect(bpm).toBeLessThanOrEqual(190)

    const popularity = faker.popularity()
    expect(popularity).toBeGreaterThanOrEqual(0)
    expect(popularity).toBeLessThanOrEqual(100)
  })

  it('should generate random names', () => {
    const artist = faker.artistName()
    expect(artist).toBeTruthy()
    expect(typeof artist).toBe('string')

    const track = faker.trackName()
    expect(track).toBeTruthy()
    expect(typeof track).toBe('string')
  })
})
```

## Best Practices

### 1. Use Builders for Complex Data

```typescript
// Good - flexible and maintainable
const result = new EnrichmentResultBuilder()
  .withBPM(120)
  .withGain(-8.5)
  .build()

// Less good - harder to maintain
const result = {
  bpm: 120,
  gain: -8.5,
  rank: null,
  release_date: null,
  source: null,
}
```

### 2. Clean Up Mocks

```typescript
describe('API Tests', () => {
  let cleanup: () => void

  beforeEach(() => {
    cleanup = mockDeezerAPI({...})
  })

  afterEach(() => {
    cleanup()
  })

  it('should work', async () => {
    // test code
  })
})
```

### 3. Use Realistic Data

```typescript
// Good - realistic ISRC
const track = buildSpotifyTrack({
  external_ids: {isrc: faker.isrc()},
})

// Less good - fake ISRC format
const track = buildSpotifyTrack({
  external_ids: {isrc: 'ABC123'},
})
```

### 4. Verify Rate Limits

```typescript
it('should respect rate limit', async () => {
  const queue = createMockRateLimitedQueue({rate: 40})

  // ... process tasks

  expect(queue.verifyRateLimit()).toBe(true)
})
```

### 5. Test Edge Cases

```typescript
describe('Edge Cases', () => {
  it('should handle missing ISRC', async () => {
    const track = buildSpotifyTrack({
      external_ids: undefined,
    })
    // test handling
  })

  it('should handle null BPM', () => {
    const result = new EnrichmentResultBuilder().asNull().build()
    expect(result.bpm).toBeNull()
  })
})
```

## Testing Patterns

### Pattern 1: Unit Test with Mock KV

```typescript
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {MockKVNamespace} from './fixtures/cloudflare-mocks'

describe('AudioEnrichmentService', () => {
  let service: AudioEnrichmentService
  let cache: MockKVNamespace

  beforeEach(() => {
    cache = new MockKVNamespace()
    service = new AudioEnrichmentService(cache)
  })

  it('should cache enrichment results', async () => {
    // Test implementation
  })
})
```

### Pattern 2: Integration Test with External API Mocks

```typescript
import {mockDeezerAPI, mockLastFmAPI} from './fixtures/api-mocks'

describe('Enrichment Pipeline', () => {
  afterEach(() => {
    // Cleanup handled by returned functions
  })

  it('should enrich with both Deezer and Last.fm', async () => {
    const deezerCleanup = mockDeezerAPI({...})
    const lastfmCleanup = mockLastFmAPI({...})

    // Test implementation

    deezerCleanup()
    lastfmCleanup()
  })
})
```

### Pattern 3: Stream Testing

```typescript
import {buildSSEWriter} from './fixtures/test-builders'

describe('SSE Streaming', () => {
  it('should stream events correctly', async () => {
    const writerBuilder = buildSSEWriter()
    const writer = writerBuilder.build()

    // Write events
    await streamFunction(writer)

    // Verify
    const events = writerBuilder.getSSEEvents()
    expect(events).toHaveLength(expectedCount)
  })
})
```

## Troubleshooting

### Issue: Mock fetch not working

**Solution:** Ensure you're calling the cleanup function and not overlapping mocks.

```typescript
afterEach(() => {
  cleanup() // Important!
})
```

### Issue: Rate limit verification failing

**Solution:** Check tolerance setting and actual task timing.

```typescript
// Increase tolerance for CI environments
expect(queue.verifyRateLimit(0.2)).toBe(true) // 20% tolerance
```

### Issue: Type errors with KV

**Solution:** Use proper type parameters for get().

```typescript
// Correct
const data = await kv.get('key', 'json') as MyType

// Incorrect
const data = await kv.get('key') as MyType
```

## Contributing

When adding new mocks:

1. Follow existing naming patterns
2. Add JSDoc comments
3. Include usage examples in this README
4. Add type safety with TypeScript
5. Ensure compatibility with Cloudflare Workers types

## References

- [Cloudflare Workers Types](https://www.npmjs.com/package/@cloudflare/workers-types)
- [Vitest Documentation](https://vitest.dev/)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [TESTING_PLAN.md](/TESTING_PLAN.md) - Overall testing strategy
