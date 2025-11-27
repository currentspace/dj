# Testing Guidelines (November 2025)

These guidelines represent modern Vitest 4.x testing patterns for November 2025, covering unit tests, contract tests, and integration tests.

## Test Architecture

### Three-Tier Test Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│  UNIT TESTS (pnpm test)                                             │
│  • Fast, mocked dependencies                                        │
│  • Run on every commit                                              │
│  • Target: 80%+ coverage                                            │
│  • Location: src/**/*.test.ts                                       │
├─────────────────────────────────────────────────────────────────────┤
│  CONTRACT TESTS (pnpm test:contracts)                               │
│  • Real API calls with schema validation                            │
│  • Run against external APIs (Spotify, Deezer, Last.fm)            │
│  • Target: Validate API schemas match expectations                  │
│  • Location: src/__tests__/contracts/*.contract.test.ts            │
├─────────────────────────────────────────────────────────────────────┤
│  INTEGRATION TESTS (pnpm test:integration)                          │
│  • Real service behavior with mock KV                               │
│  • Run against public APIs (Deezer is free)                        │
│  • Target: Validate service interactions                            │
│  • Location: src/__tests__/integration/*.integration.test.ts       │
└─────────────────────────────────────────────────────────────────────┘
```

### Vitest Configuration Structure

```
workers/api/
├── vitest.config.ts           # Unit tests (excludes contract/integration)
├── vitest.contracts.config.ts # Contract tests only
├── vitest.integration.config.ts # Integration tests only
└── src/
    ├── test-setup.ts          # Mocks fetch, stores native globals
    └── __tests__/
        ├── contracts/
        │   └── setup.ts       # Restores native fetch for real API calls
        └── integration/
            └── setup.ts       # Restores native fetch for real API calls
```

## Unit Test Patterns

### Vitest 4.x Fetch Mocking with vi.hoisted()

**CRITICAL**: Vitest 4.x requires `vi.hoisted()` for mock factories:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// CORRECT - Vitest 4.x pattern with vi.hoisted()
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('node:fetch', () => ({ default: mockFetch }))

describe('MyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    })

    const result = await myService.fetchData()
    expect(result).toEqual({ data: 'test' })
  })
})
```

**Reference**: `workers/api/src/__tests__/services/AudioEnrichmentService.test.ts`

### Test Setup - Preserving Native Globals

The test setup mocks globals but stores originals for contract/integration tests:

```typescript
// test-setup.ts
import { beforeEach, vi } from 'vitest'

// Store native globals BEFORE mocking (for contract tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeFetch = global.fetch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeSetTimeout = global.setTimeout
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeClearTimeout = global.clearTimeout

// Mock fetch for unit tests
global.fetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})
```

**Reference**: `workers/api/src/test-setup.ts`

### Zod Schema Testing

Test Zod schemas handle edge cases correctly:

```typescript
import { describe, it, expect } from 'vitest'
import { MySchema } from '../schemas'

describe('MySchema', () => {
  it('should parse valid input', () => {
    const result = MySchema.safeParse({ name: 'test', value: 42 })
    expect(result.success).toBe(true)
  })

  it('should reject invalid input', () => {
    const result = MySchema.safeParse({ name: '', value: -1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(2)
  })

  it('should apply defaults', () => {
    const result = MySchema.parse({ name: 'test' })
    expect(result.value).toBe(0) // Default value
  })

  it('should coerce types when configured', () => {
    const result = MySchema.parse({ name: 'test', value: '42' })
    expect(result.value).toBe(42)
    expect(typeof result.value).toBe('number')
  })
})
```

### Service Mock Patterns

```typescript
// Mock KV Namespace
class MockKVNamespace {
  private store = new Map<string, { value: string; timestamp: number }>()

  async get(key: string, type?: 'json'): Promise<unknown | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    return type === 'json' ? JSON.parse(entry.value) : entry.value
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, timestamp: Date.now() })
  }

  clear(): void {
    this.store.clear()
  }
}

// Usage in tests
describe('AudioEnrichmentService', () => {
  let service: AudioEnrichmentService
  let mockKv: MockKVNamespace

  beforeEach(() => {
    mockKv = new MockKVNamespace()
    service = new AudioEnrichmentService(mockKv as unknown as KVNamespace)
  })
})
```

**Reference**: `workers/api/src/__tests__/integration/setup.ts:42-105`

## Contract Test Patterns

### Purpose

Contract tests validate that **external APIs match our expected schemas**. They make **real API calls**.

### Setup - Restoring Native Fetch

```typescript
// contracts/setup.ts
import { beforeAll, afterAll } from 'vitest'

// Restore native globals for real network access
const nativeFetch = (global as any).__nativeFetch as typeof fetch
const nativeSetTimeout = (global as any).__nativeSetTimeout as typeof setTimeout

if (nativeFetch) {
  global.fetch = nativeFetch
} else {
  console.warn('⚠️ Native fetch not available - contract tests may fail')
}

if (nativeSetTimeout) {
  global.setTimeout = nativeSetTimeout
}
```

**Reference**: `workers/api/src/__tests__/contracts/setup.ts`

### Credential-Based Skipping

Use `skipIf` for tests that require optional credentials:

```typescript
const hasSpotifyCredentials = () => {
  const token = getSpotifyAccessToken()
  return token !== null
}

describe('Spotify API Contracts', () => {
  // Skips if no credentials available
  it.skipIf(!hasSpotifyCredentials())('should match TrackSchema', async () => {
    const token = await getSpotifyAccessToken()
    const response = await fetch(`https://api.spotify.com/v1/tracks/${TEST_TRACK_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()

    const result = SpotifyTrackSchema.safeParse(data)
    expect(result.success).toBe(true)
  })
})
```

**Reference**: `workers/api/src/__tests__/contracts/spotify.contract.test.ts`

### Schema Validation Helpers

```typescript
import type { ZodSchema } from 'zod'

function validateSchema<T>(
  schema: ZodSchema<T>,
  data: unknown
): { success: boolean; errors: string[]; data?: T } {
  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true, errors: [], data: result.data }
  }

  // Format errors for readability
  const errors = result.error.errors.map(
    (e) => `${e.path.join('.')}: ${e.message}`
  )

  return { success: false, errors }
}

// Usage
it('should match schema', async () => {
  const data = await fetchFromAPI()
  const result = validateSchema(MySchema, data)

  if (!result.success) {
    console.error('Schema validation failed:', result.errors)
  }

  expect(result.success).toBe(true)
})
```

**Reference**: `workers/api/src/__tests__/contracts/helpers.ts:202-251`

### Rate Limiting in Contract Tests

```typescript
const RATE_LIMITS = {
  SPOTIFY: 1000,    // 1 request per second
  DEEZER: 1000,     // 1 request per second
  LASTFM: 200,      // 5 requests per second
  MUSICBRAINZ: 1000, // 1 request per second (be nice!)
}

async function rateLimitedFetch(
  url: string,
  delay: number,
  options?: RequestInit
): Promise<Response> {
  const domain = new URL(url).hostname
  const lastTime = lastRequestTime.get(domain) || 0
  const timeToWait = Math.max(0, delay - (Date.now() - lastTime))

  if (timeToWait > 0) {
    await new Promise((resolve) => setTimeout(resolve, timeToWait))
  }

  lastRequestTime.set(domain, Date.now())
  return fetch(url, options)
}
```

**Reference**: `workers/api/src/__tests__/contracts/helpers.ts:101-124`

### Documenting Skipped Tests

Always explain WHY tests are skipped:

```typescript
// NOTE: Playlist endpoints require user OAuth even for public playlists since Nov 2024
// Client credentials token returns 404 for playlist endpoints
// https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
describe('GET /playlists/{id}', () => {
  it.skip('matches SpotifyPlaylistFullSchema (requires user OAuth since Nov 2024)', async () => {
    // Test code...
  })
})

// DEPRECATED: Audio features endpoint removed Nov 27, 2024
// https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
describe('GET /audio-features/{id}', () => {
  it.skip('DEPRECATED - requires user auth since Nov 2024', async () => {
    // Test code...
  })
})
```

**Reference**: `workers/api/src/__tests__/contracts/spotify.contract.test.ts:174-178`

## Integration Test Patterns

### Purpose

Integration tests validate that **services work together correctly** with real external APIs but mocked infrastructure (KV).

### Setup - Same Native Fetch Restoration

```typescript
// integration/setup.ts
import { beforeAll, afterAll } from 'vitest'

// Same pattern as contract tests
const nativeFetch = (global as any).__nativeFetch as typeof fetch
if (nativeFetch) global.fetch = nativeFetch

const nativeSetTimeout = (global as any).__nativeSetTimeout as typeof setTimeout
if (nativeSetTimeout) global.setTimeout = nativeSetTimeout
```

**Reference**: `workers/api/src/__tests__/integration/setup.ts:18-39`

### Testing Real API Behavior with Flexible Assertions

Real APIs return variable data. Write tolerant assertions:

```typescript
it('should enrich track with real Deezer API', async () => {
  const track = KNOWN_TEST_TRACKS.BOHEMIAN_RHAPSODY
  const result = await service.enrichTrack(track)

  expect(result).toBeDefined()

  // Source may be null if track not in Deezer catalog
  if (result.source) {
    expect(result.source).toBe('deezer')
  }

  // BPM may be 0 (not analyzed) or null (not found)
  if (result.bpm !== null && result.bpm > 0) {
    expect(result.bpm).toBeGreaterThan(45)
    expect(result.bpm).toBeLessThan(220)
  }

  console.log('✓ Enrichment result:', {
    bpm: result.bpm || 'not available',
    source: result.source || 'not in Deezer',
  })
})
```

**Reference**: `workers/api/src/__tests__/integration/AudioEnrichmentService.integration.test.ts:73-95`

### Known Test Data

Define known test tracks for consistent testing:

```typescript
export const KNOWN_TEST_TRACKS = {
  BOHEMIAN_RHAPSODY: {
    id: '6rqhFgbbKwnb9MLmUQDhG6',
    name: 'Bohemian Rhapsody - Remastered 2011',
    artists: [{ id: '1dfeR4HaWDbWqFHLkxsg1d', name: 'Queen' }],
    duration_ms: 354320,
    popularity: 85,
    external_ids: { isrc: 'GBUM71029604' },
  },
  MR_BRIGHTSIDE: {
    id: '003vvx7Niy0yvhvHt4a68B',
    name: 'Mr. Brightside',
    artists: [{ id: '0C0XlULifJtAgn6ZNCW2eu', name: 'The Killers' }],
    duration_ms: 222973,
    popularity: 88,
    external_ids: { isrc: 'USIR20400274' },
  },
}
```

**Reference**: `workers/api/src/__tests__/helpers/integration-setup.ts`

### Testing Cache Behavior

```typescript
it('should be faster on second call (cache hit)', async () => {
  const track = KNOWN_TEST_TRACKS.BOHEMIAN_RHAPSODY

  // First call: cache miss (slow)
  const [result1, duration1] = await measureExecutionTime(() =>
    service.enrichTrack(track)
  )
  expect(result1).toBeDefined()

  // Second call: cache hit (fast)
  const [result2, duration2] = await measureExecutionTime(() =>
    service.enrichTrack(track)
  )

  expect(result2).toBeDefined()
  expect(duration2).toBeLessThan(100) // Cache hits should be <100ms

  console.log('✓ Cache efficiency:', {
    first: `${duration1}ms`,
    second: `${duration2}ms`,
    speedup: `${Math.round(duration1 / duration2)}x`,
  })
})

// Helper function
async function measureExecutionTime<T>(
  fn: () => Promise<T>
): Promise<[T, number]> {
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start
  return [result, duration]
}
```

**Reference**: `workers/api/src/__tests__/integration/enrichment-pipeline.integration.test.ts:257-304`

## Vitest Configuration

### Unit Test Config (Default)

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],

    // Exclude contract and integration tests
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      'src/**/*.contract.test.ts',
      'src/**/*.integration.test.ts',
    ],
  },
})
```

### Contract Test Config

```typescript
// vitest.contracts.config.ts
export default defineConfig({
  test: {
    name: 'contracts',
    environment: 'node',
    setupFiles: ['./src/__tests__/contracts/setup.ts'],

    include: ['src/**/*.contract.test.ts'],

    testTimeout: 30000,  // 30 seconds for API calls
    hookTimeout: 30000,

    // Sequential to respect rate limits
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
```

### Integration Test Config

```typescript
// vitest.integration.config.ts
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    setupFiles: ['./src/__tests__/integration/setup.ts'],

    include: ['src/**/*.integration.test.ts'],

    testTimeout: 60000,  // 60 seconds
    hookTimeout: 60000,

    // Sequential to respect rate limits
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },

    // Disable watch mode
    watch: false,
  },
})
```

## Test Commands

```bash
# Unit tests (fast, mocked)
pnpm --filter @dj/api-worker test --run

# Contract tests (real APIs, schema validation)
pnpm test:contracts --run

# Integration tests (real APIs, service behavior)
pnpm test:integration --run

# All tests
pnpm test --run && pnpm test:contracts --run && pnpm test:integration --run

# Watch mode (unit tests only)
pnpm --filter @dj/api-worker test

# Single file
pnpm --filter @dj/api-worker test AudioEnrichmentService
```

## Test Organization

### File Naming

```
src/
├── services/
│   └── AudioEnrichmentService.ts
└── __tests__/
    ├── services/
    │   └── AudioEnrichmentService.test.ts      # Unit tests
    ├── contracts/
    │   ├── setup.ts
    │   ├── helpers.ts
    │   ├── deezer.contract.test.ts             # Deezer API contracts
    │   ├── spotify.contract.test.ts            # Spotify API contracts
    │   └── lastfm.contract.test.ts             # Last.fm API contracts
    ├── integration/
    │   ├── setup.ts
    │   ├── AudioEnrichmentService.integration.test.ts
    │   └── enrichment-pipeline.integration.test.ts
    └── helpers/
        └── integration-setup.ts                # Shared test data
```

### Debug Tests (Manual Only)

Keep debug tests permanently skipped - they're for manual troubleshooting:

```typescript
// debug-*.integration.test.ts
describe.skip('Debug Rate Limited API', () => {
  // These tests are for manual debugging only
  // Run manually with: pnpm test:integration debug-rate-limited
})
```

## Anti-Patterns

### DON'T: Overly Strict Real API Assertions

```typescript
// WRONG - Assumes API always returns specific data
expect(result.bpm).toBe(123)

// CORRECT - Tolerant of API variability
if (result.bpm !== null && result.bpm > 0) {
  expect(result.bpm).toBeGreaterThan(45)
  expect(result.bpm).toBeLessThan(220)
}
```

### DON'T: Forget vi.hoisted() in Vitest 4

```typescript
// WRONG - Vitest 4.x will fail
const mockFetch = vi.fn()
vi.mock('node:fetch', () => ({ default: mockFetch }))

// CORRECT - Vitest 4.x pattern
const mockFetch = vi.hoisted(() => vi.fn())
vi.mock('node:fetch', () => ({ default: mockFetch }))
```

### DON'T: Run Real API Tests in CI Without Rate Limiting

```typescript
// WRONG - Hammers API, gets rate limited
for (const track of manyTracks) {
  await fetch(`https://api.example.com/track/${track.id}`)
}

// CORRECT - Respect rate limits
for (const track of manyTracks) {
  await rateLimitedFetch(url, RATE_LIMITS.EXAMPLE)
}
```

### DON'T: Skip Tests Without Explanation

```typescript
// WRONG - No context
it.skip('should work', () => {})

// CORRECT - Documented reason
// NOTE: Requires user OAuth since Spotify Nov 2024 changes
// https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
it.skip('requires user OAuth since Nov 2024', () => {})
```

## Test Data Best Practices

### Use Real ISRCs for Contract Tests

```typescript
export const TEST_DEFAULTS = {
  TRACK_ID: '6rqhFgbbKwnb9MLmUQDhG6',        // Bohemian Rhapsody
  TRACK_ISRC: 'GBUM71029604',                // Same track's ISRC
  ARTIST_NAME: 'Queen',
  TRACK_NAME: 'Bohemian Rhapsody',
  PLAYLIST_ID: '37i9dQZF1DXcBWIGoYBM5M',     // Today's Top Hits (public)
}
```

### Environment Variables for Credentials

```typescript
// Check for optional credentials
const hasLastFmKey = !!process.env.LASTFM_API_KEY

describe.skipIf(!hasLastFmKey)('Last.fm Integration', () => {
  // Tests that need LASTFM_API_KEY
})

// Auto-fetch Spotify token from client credentials
async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  // Fetch token using client credentials flow
  // ... (see helpers.ts)
}
```

**Reference**: `workers/api/src/__tests__/contracts/helpers.ts:32-74`
