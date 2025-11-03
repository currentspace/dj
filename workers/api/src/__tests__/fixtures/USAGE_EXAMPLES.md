# Mock Infrastructure Usage Examples

Quick reference guide for using the mock infrastructure in tests.

## 1. Basic KV Mock

```typescript
import {MockKVNamespace} from './fixtures/cloudflare-mocks'

const kv = new MockKVNamespace()

// Store and retrieve
await kv.put('key', 'value')
const value = await kv.get('key') // 'value'

// JSON storage
await kv.put('data', JSON.stringify({foo: 'bar'}))
const data = await kv.get('data', 'json') // {foo: 'bar'}

// TTL
await kv.put('temp', 'value', {expirationTtl: 60}) // 60 seconds
```

## 2. Mock External APIs

```typescript
import {mockDeezerAPI, buildDeezerTrack} from './fixtures/api-mocks'

// Set up mock
const cleanup = mockDeezerAPI({
  'USUM71234567': buildDeezerTrack({bpm: 128, rank: 900000}),
})

// Use in test
const response = await fetch('https://api.deezer.com/track/isrc:USUM71234567')
const data = await response.json()
expect(data.bpm).toBe(128)

// Clean up
cleanup()
```

## 3. Mock Anthropic Streaming

```typescript
import {
  createMockAnthropicClient,
  buildTextResponseStream,
  buildToolCallResponseStream,
} from './fixtures/anthropic-mocks'

// Text response
const client = createMockAnthropicClient({
  'analyze': buildTextResponseStream('Analysis complete'),
})

// Tool call response
const client2 = createMockAnthropicClient({
  'get playlist': buildToolCallResponseStream('get_playlist_tracks', {
    playlist_id: 'abc123',
    limit: 20,
  }),
})
```

## 4. Test Data Builders

```typescript
import {
  EnrichmentResultBuilder,
  LastFmSignalsBuilder,
  buildPlaylistAnalysis,
  faker,
} from './fixtures/test-builders'

// Builder pattern
const enrichment = new EnrichmentResultBuilder()
  .withBPM(140)
  .withGain(-10)
  .build()

// Faker utilities
const isrc = faker.isrc() // 'USUM71234567'
const artist = faker.artistName() // 'The Mountain Band'
const bpm = faker.bpm() // 120
```

## 5. Rate Limiting Tests

```typescript
import {
  createMockRateLimitedQueue,
  createDelayedTaskBatch,
  verifyRateLimitCompliance,
} from './fixtures/rate-limit-mocks'

const queue = createMockRateLimitedQueue<number>({rate: 40})
const tasks = createDelayedTaskBatch([1, 2, 3, 4, 5], 5)

tasks.forEach(task => queue.enqueue(task))
await queue.processAll()

// Verify rate limit
const timestamps = queue.getTimestamps()
const {compliant, actualRate} = verifyRateLimitCompliance(timestamps, 40)
expect(compliant).toBe(true)
```

## 6. SSE Stream Testing

```typescript
import {buildSSEWriter} from './fixtures/test-builders'

const writerBuilder = buildSSEWriter()
const writer = writerBuilder.build()

// Write events
await writer.write(new TextEncoder().encode('event: thinking\n'))
await writer.write(new TextEncoder().encode('data: Processing\n\n'))

// Verify
const events = writerBuilder.getSSEEvents()
expect(events[0]).toEqual({event: 'thinking', data: 'Processing'})
```

## 7. Mock Hono Context

```typescript
import {createMockContext, createMockEnv} from './fixtures/cloudflare-mocks'

const ctx = createMockContext({
  env: createMockEnv({SPOTIFY_CLIENT_ID: 'test-id'}),
})

// Access env
expect(ctx.env.SPOTIFY_CLIENT_ID).toBe('test-id')

// Use methods
const response = ctx.json({success: true})
expect(response.status).toBe(200)
```

## Common Patterns

### Pattern 1: Service with KV Cache

```typescript
describe('MyService', () => {
  let service: MyService
  let cache: MockKVNamespace

  beforeEach(() => {
    cache = new MockKVNamespace()
    service = new MyService(cache as unknown as KVNamespace)
  })

  it('should cache results', async () => {
    // Test implementation
  })
})
```

### Pattern 2: API Mock with Cleanup

```typescript
describe('API Integration', () => {
  let cleanup: () => void

  afterEach(() => {
    cleanup?.()
  })

  it('should fetch data', async () => {
    cleanup = mockDeezerAPI({...})
    // Test implementation
  })
})
```

### Pattern 3: Realistic Test Data

```typescript
describe('Track Processing', () => {
  it('should process tracks', () => {
    const tracks = Array.from({length: 10}, (_, i) => ({
      id: faker.spotifyId(),
      name: faker.trackName(),
      artists: [{name: faker.artistName()}],
      external_ids: {isrc: faker.isrc()},
      duration_ms: faker.durationMs(),
    }))

    // Test implementation
  })
})
```

See README.md for comprehensive documentation.
