# Integration Tests

## Overview

Integration tests validate that our services work together with **real external APIs**. Unlike contract tests (which validate API schemas) or unit tests (which test isolated logic), integration tests verify:

- Services interact correctly with external APIs (Deezer, Last.fm, MusicBrainz)
- Caching behavior works as expected
- Rate limiting is respected
- Error handling works with real errors
- Data flows correctly through the entire pipeline

## Key Principle: Test Real Behavior, Not Mocks

> "If you're mocking an external API, you're not testing integration with that API."

Integration tests use:
- ✅ **Real external APIs** (Deezer, Last.fm, MusicBrainz)
- ✅ **Mock KV namespace** (in-memory cache for testing)
- ✅ **Real rate limiting** (same as production)
- ✅ **Real error handling** (real API errors)

We mock KV because we don't want to depend on production KV namespaces, but we still test real caching logic with a real in-memory store.

## Running Integration Tests

### Run all integration tests
```bash
pnpm test:integration
```

### Run specific integration test file
```bash
pnpm test:integration AudioEnrichmentService.integration.test.ts
```

### Run in watch mode (useful during development)
```bash
pnpm test:integration:watch
```

## Required Environment Variables

Integration tests are designed to run with minimal setup:

### Required: NONE
Deezer and MusicBrainz are public APIs that don't require authentication.

### Optional (but recommended):
- `LASTFM_API_KEY` - For Last.fm integration tests
  - Get from: https://www.last.fm/api/account/create
  - Without this, Last.fm tests will be skipped

## Test Execution Time

Integration tests are slower than unit tests because they:
1. Make real API calls to external services
2. Respect rate limits (25ms between Deezer calls, 200ms between Last.fm calls)
3. Test multiple scenarios (cache hits, cache misses, errors)

**Expected execution time:**
- AudioEnrichmentService tests: ~10-15 seconds
- LastFmService tests: ~15-20 seconds
- Full pipeline tests: ~20-30 seconds
- **Total: ~45-65 seconds** for all integration tests

## Test Organization

```
src/__tests__/integration/
├── README.md                                    # This file
├── setup.ts                                     # Global setup (env validation, rate limits)
├── AudioEnrichmentService.integration.test.ts   # Deezer + MusicBrainz integration
├── LastFmService.integration.test.ts            # Last.fm integration
└── enrichment-pipeline.integration.test.ts      # Full pipeline integration
```

## Writing Integration Tests

### Best Practices

#### 1. Use Well-Known Test Data
Always use `KNOWN_TEST_TRACKS` from `helpers/integration-setup.ts`:

```typescript
import { KNOWN_TEST_TRACKS } from '../helpers/integration-setup'

describe('AudioEnrichmentService Integration', () => {
  it('enriches Bohemian Rhapsody with real Deezer data', async () => {
    const track = KNOWN_TEST_TRACKS.BOHEMIAN_RHAPSODY
    const result = await service.enrichTrack(track)

    // Test with real data
    expect(result.bpm).toBeGreaterThan(0)
    expect(result.source).toBe('deezer')
  })
})
```

#### 2. Test Caching Behavior
Verify cache hits/misses with the mock KV:

```typescript
it('uses cache on second enrichment', async () => {
  const track = KNOWN_TEST_TRACKS.MR_BRIGHTSIDE

  // First call: cache miss (API call)
  await service.enrichTrack(track)

  // Second call: cache hit (no API call)
  const [result, duration] = await measureExecutionTime(() =>
    service.enrichTrack(track)
  )

  // Cache hit should be much faster (<10ms)
  expect(duration).toBeLessThan(10)
  expect(result.source).toBe('deezer')
})
```

#### 3. Test Rate Limiting
Validate rate limiting with timing assertions:

```typescript
it('respects rate limit (40 TPS)', async () => {
  const tracks = createTestTracks(10)

  const [result, duration] = await measureExecutionTime(() =>
    service.batchEnrichTracks(tracks)
  )

  // 10 tracks at 40 TPS = 250ms minimum
  expect(duration).toBeGreaterThan(250)
  expect(result.size).toBe(10)
})
```

#### 4. Test Error Handling
Use invalid data to trigger real errors:

```typescript
it('handles invalid ISRC gracefully', async () => {
  const track = createTestTrack({ isrc: 'INVALID123' })

  // Should not throw, should return null
  const result = await service.enrichTrack(track)
  expect(result).toBeNull()
})
```

#### 5. Skip Tests Gracefully
Skip Last.fm tests if credentials are missing:

```typescript
import { describe, it, expect } from 'vitest'

describe('LastFmService Integration', () => {
  it('fetches track signals', async () => {
    if (!process.env.LASTFM_API_KEY) {
      console.warn('Skipping: LASTFM_API_KEY not set')
      return
    }

    // Test implementation
  })
})
```

## Common Patterns

### Pattern 1: Test with Real APIs
```typescript
describe('AudioEnrichmentService Integration', () => {
  let service: AudioEnrichmentService
  let mockKv: MockKVNamespace

  beforeEach(() => {
    mockKv = new MockKVNamespace()
    service = new AudioEnrichmentService(mockKv)
  })

  it('enriches track with Deezer API', async () => {
    const track = KNOWN_TEST_TRACKS.BOHEMIAN_RHAPSODY

    // Real API call to Deezer
    const result = await service.enrichTrack(track)

    // Verify real data
    expect(result).toBeDefined()
    expect(result.bpm).toBeGreaterThan(45)
    expect(result.bpm).toBeLessThan(220)
    expect(result.rank).toBeGreaterThan(0)
    expect(result.source).toBe('deezer')
  })
})
```

### Pattern 2: Test Cache Population
```typescript
it('populates cache after enrichment', async () => {
  const track = KNOWN_TEST_TRACKS.MR_BRIGHTSIDE

  // Verify cache is empty
  const cached = await mockKv.get(`bpm:${track.id}`)
  expect(cached).toBeNull()

  // Enrich track (populates cache)
  await service.enrichTrack(track)

  // Verify cache was populated
  const cachedAfter = await mockKv.get(`bpm:${track.id}`)
  expect(cachedAfter).toBeTruthy()
})
```

### Pattern 3: Test Batch Operations
```typescript
it('enriches multiple tracks with rate limiting', async () => {
  const tracks = [
    KNOWN_TEST_TRACKS.BOHEMIAN_RHAPSODY,
    KNOWN_TEST_TRACKS.MR_BRIGHTSIDE,
    KNOWN_TEST_TRACKS.STAIRWAY_TO_HEAVEN,
  ]

  const [results, duration] = await measureExecutionTime(() =>
    service.batchEnrichTracks(tracks)
  )

  // Verify all tracks enriched
  expect(results.size).toBe(3)

  // Verify rate limiting (3 tracks at 40 TPS = 75ms minimum)
  expect(duration).toBeGreaterThan(75)
})
```

## Anti-Patterns to Avoid

### ❌ Don't Mock External APIs
```typescript
// BAD: Mocking Deezer API
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ bpm: 120 })
})

// This is NOT an integration test!
```

### ❌ Don't Test Mock Behavior
```typescript
// BAD: Testing that mock returns what you configured
it('returns BPM from Deezer', async () => {
  // Mock configured to return 120
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ bpm: 120 })
  })

  const result = await service.enrichTrack(track)

  // You're just testing the mock! ❌
  expect(result.bpm).toBe(120)
})
```

### ❌ Don't Skip Error Handling Tests
```typescript
// BAD: Only testing happy path
it('enriches track', async () => {
  const result = await service.enrichTrack(validTrack)
  expect(result).toBeDefined()
})

// GOOD: Also test error cases
it('handles invalid ISRC gracefully', async () => {
  const result = await service.enrichTrack(invalidTrack)
  expect(result).toBeNull()
})
```

## Debugging Tips

### 1. Enable Verbose Logging
Integration tests log rate limits and cache status. Check the console output:

```
Integration test timeout: 60000ms
Rate limits configured (same as production):
  - Deezer: 25ms between requests (40 TPS)
  - Last.fm: 200ms between requests (5 TPS)
  - MusicBrainz: 1000ms between requests (1 TPS)
```

### 2. Check Cache State
Use `mockKv.size()` to debug cache behavior:

```typescript
console.log(`Cache size: ${mockKv.size()}`)
```

### 3. Measure Execution Time
Use `measureExecutionTime` to debug performance issues:

```typescript
const [result, duration] = await measureExecutionTime(() =>
  service.enrichTrack(track)
)
console.log(`Execution time: ${duration}ms`)
```

### 4. Test with Known Tracks
If a test fails, verify the test track exists in the external API:
- Deezer: https://api.deezer.com/track/isrc:GBUM71029604
- Last.fm: https://www.last.fm/music/Queen/_/Bohemian+Rhapsody

## Differences from Other Test Types

### vs Contract Tests
| Aspect | Contract Tests | Integration Tests |
|--------|---------------|-------------------|
| **Purpose** | Validate API schemas | Validate service behavior |
| **Mocking** | 0% (always real APIs) | ~10% (only KV) |
| **Focus** | API response shape | Service integration |
| **Speed** | Fast (simple API calls) | Slower (rate limiting) |
| **Run** | Nightly | On merge to main |

### vs Unit Tests
| Aspect | Unit Tests | Integration Tests |
|--------|------------|-------------------|
| **Purpose** | Test isolated logic | Test services together |
| **Mocking** | <20% (minimal) | ~10% (only KV) |
| **Focus** | Pure functions | Real API interactions |
| **Speed** | Fast (<100ms) | Slower (30-60s) |
| **Run** | Every commit | On merge to main |

### vs E2E Tests
| Aspect | E2E Tests | Integration Tests |
|--------|-----------|-------------------|
| **Purpose** | Test user workflows | Test service interactions |
| **Mocking** | <10% (almost none) | ~10% (only KV) |
| **Focus** | Complete user journey | API integration |
| **Speed** | Slowest (minutes) | Slower (30-60s) |
| **Run** | Pre-release | On merge to main |

## CI/CD Integration

Integration tests run automatically on merge to main:

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - name: Run integration tests
        run: pnpm test:integration
        env:
          LASTFM_API_KEY: ${{ secrets.LASTFM_API_KEY }}
```

## Summary

Integration tests are **critical** for validating that our services work correctly with real external APIs. They:

- ✅ Test real API interactions (Deezer, Last.fm, MusicBrainz)
- ✅ Validate caching behavior with real KV operations
- ✅ Verify rate limiting under real load
- ✅ Test error handling with real API errors
- ✅ Build confidence for refactoring services

**Key Principle:** Test real behavior, not mocks. If you're testing mocks, you're not testing integration.

## Additional Resources

- [Testing Guidance](../../../../../TESTING_GUIDANCE.md) - Testing philosophy
- [Phase 2 Plan](../../../../../TESTING_PHASE2_PLAN.md) - Integration test plan
- [Contract Tests](../contracts/README.md) - API schema validation
