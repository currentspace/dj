# Testing Guidance: Writing Tests That Matter

**Purpose:** Prevent "testing theater" and ensure every test validates real behavior, not mock behavior.

**Audience:** Developers and AI agents writing tests for the DJ monorepo.

**Last Updated:** 2025-01-15

---

## Core Principle: Test Real Behavior, Not Mocks

> "If you're mocking an external API, you're not testing integration with that API. You're testing that your mock works."

### The Golden Rule

**Before writing a test, ask:**
1. What **complicated logic** does this test validate?
2. If I remove this test, what **real bug** would I miss?
3. Am I testing **real behavior** or just **mock behavior**?

If the answer to #1 is "none" or #3 is "mock behavior" - **don't write the test**.

---

## Testing Value Hierarchy

```
Value Level 5: ⭐⭐⭐⭐⭐ CRITICAL
├─ Algorithm validation (RateLimitedQueue token bucket)
├─ Business logic (tag aggregation, popularity calculation)
├─ State machine transitions (OAuth flow states)
└─ Data transformation pipelines

Value Level 4: ⭐⭐⭐⭐ HIGH VALUE
├─ Integration between our components
├─ Error handling with real errors
├─ Cache behavior (hit/miss/expiry)
└─ Request/response validation

Value Level 3: ⭐⭐⭐ MEDIUM VALUE
├─ Simple utility functions
├─ Type guards and wrappers
└─ Configuration validation

Value Level 2: ⭐⭐ LOW VALUE
├─ Testing library behavior (Zod, React)
├─ Simple conditionals (if/else)
└─ Pass-through functions

Value Level 1: ⭐ NO VALUE (Don't Write!)
├─ Testing mocks return what you configured
├─ Testing framework behavior
└─ Trivial getters/setters
```

---

## Decision Tree: When to Mock

```
Is the dependency external (API, database, file system)?
│
├─ YES → Is this a UNIT test?
│   │
│   ├─ YES → Consider mocking, but...
│   │   └─ ALSO write integration tests with real dependency!
│   │
│   └─ NO (integration/E2E test)
│       └─ Use REAL dependency
│
└─ NO (internal dependency) → Is it simple or complex?
    │
    ├─ SIMPLE (pure function, no side effects)
    │   └─ Use real implementation (no mock needed)
    │
    └─ COMPLEX (database, external service)
        └─ Mock at boundaries only, test integration separately
```

---

## The Test Type Matrix

| Test Type | When to Use | Mocking Level | Run Frequency | Example |
|-----------|-------------|---------------|---------------|---------|
| **Unit** | Pure logic, algorithms | 0-20% | Every commit | Token bucket refill |
| **Integration** | Service interactions | 0-30% | On merge | API → Service → Cache |
| **Contract** | API compatibility | 0% | Nightly | Spotify schema validation |
| **E2E** | User workflows | 0-10% | Pre-release | Login → Analyze → Create |

---

## Anti-Patterns to Avoid

### 🚨 Anti-Pattern #1: "Testing Your Own Mock"

**BAD:**
```typescript
// Step 1: Tell mock what to return
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ bpm: 120 })
})

// Step 2: Call service
const result = await service.enrichTrack(track)

// Step 3: Verify mock returned what you configured ❌
expect(result.bpm).toBe(120)  // You're testing the mock!
```

**Why it's bad:**
- Verifies mock configuration, not real behavior
- When API changes, test still passes
- False confidence in code quality

**GOOD:**
```typescript
// Use REAL API in integration test
const result = await service.enrichTrack(realTrack)

// Verify REAL data characteristics
expect(result.bpm).toBeGreaterThan(0)
expect(result.bpm).toBeLessThan(220)
expect(result.source).toBe('deezer')

// OR write contract test
const realResponse = await fetch('https://api.deezer.com/track/isrc:GBUM71029604')
const data = await realResponse.json()
expect(() => DeezerTrackSchema.parse(data)).not.toThrow()
```

---

### 🚨 Anti-Pattern #2: "Testing Library Behavior"

**BAD:**
```typescript
describe('SpotifyTrackSchema', () => {
  it('validates track object', () => {
    const track = { id: '123', name: 'Song', artists: [...] }
    expect(() => SpotifyTrackSchema.parse(track)).not.toThrow()
    // ↑ You're testing Zod can validate objects!
  })
})
```

**Why it's bad:**
- Tests Zod library, not your code
- Doesn't validate real API compatibility
- No value for catching bugs

**GOOD:**
```typescript
describe('Spotify API Contract', () => {
  it('real track response matches schema', async () => {
    // Use REAL Spotify API
    const track = await spotifyAPI.getTrack('6rqhFgbbKwnb9MLmUQDhG6')

    // Verify real data matches schema
    const result = SpotifyTrackSchema.safeParse(track)

    if (!result.success) {
      console.error('API changed:', result.error.format())
    }

    expect(result.success).toBe(true)
    // ↑ This catches real API changes!
  })
})
```

---

### 🚨 Anti-Pattern #3: "Testing Simulations Instead of Real Code"

**BAD:**
```typescript
// Create a SIMPLIFIED version of your handler
async function simulateChatStreamHandler(context, client) {
  // Simplified logic (NOT the real handler!)
  const body = await context.req.json()
  if (!body.message) throw new Error('Required')
  // ...
}

// Test the simulation
it('validates request', async () => {
  await expect(simulateChatStreamHandler(mockContext, mockClient))
    .rejects.toThrow('Required')
  // ↑ Real handler could be broken and test passes!
})
```

**Why it's bad:**
- Tests your simulation, not real code
- Real handler can diverge from simulation
- False confidence

**GOOD:**
```typescript
// Import REAL handler
import { chatStreamRouter } from './routes/chat-stream'

it('validates request', async () => {
  const response = await chatStreamRouter.fetch(
    new Request('http://localhost/api/chat-stream/message', {
      method: 'POST',
      body: JSON.stringify({})  // Missing required field
    }),
    mockEnv
  )

  expect(response.status).toBe(400)
  // ↑ Tests real handler!
})
```

---

### 🚨 Anti-Pattern #4: "100% Mocking in Integration Tests"

**BAD:**
```typescript
describe('Full Analysis Pipeline', () => {
  it('analyzes playlist', async () => {
    // Mock EVERYTHING
    spotifyAPI.getPlaylist = vi.fn().mockResolvedValue(mockPlaylist)
    deezerAPI.getTrack = vi.fn().mockResolvedValue(mockBPM)
    lastFmAPI.getInfo = vi.fn().mockResolvedValue(mockTags)

    const result = await analyzePlaylist('id')

    expect(result.bpm.avg).toBe(120)  // All mocked!
    // ↑ Not testing real integration!
  })
})
```

**Why it's bad:**
- Claims to test integration, but everything is mocked
- Doesn't test real service interactions
- Doesn't validate data flows

**GOOD:**
```typescript
describe('Full Analysis Pipeline Integration', () => {
  it('analyzes playlist with real APIs', async () => {
    // Use REAL services
    const playlist = await spotifyAPI.getPlaylist('test-playlist-id')

    // Real enrichment
    const enriched = await audioService.batchEnrichTracks(playlist.tracks)

    // Real aggregation
    const lastFmData = await lastFmService.batchGetSignals(playlist.tracks)

    // Verify real pipeline
    expect(enriched.size).toBe(playlist.tracks.length)
    expect(lastFmData.crowd_tags.length).toBeGreaterThan(0)
    // ↑ Tests real data flow!
  })
})
```

---

## Best Practices by Test Type

### 1. Unit Tests (Pure Logic)

**When to write:**
- Algorithms (token bucket, rate limiting)
- Data transformations (tag aggregation)
- Pure functions (no side effects)
- State machines

**Mocking guidance:**
- Mock: External APIs, databases, file system
- Don't mock: Pure functions, simple utilities
- Keep mocking <20%

**Example (GOOD):**
```typescript
describe('Tag Aggregation', () => {
  it('aggregates tags from multiple tracks', () => {
    const tracks = [
      { tags: [{ name: 'rock', count: 100 }] },
      { tags: [{ name: 'rock', count: 50 }, { name: 'classic', count: 75 }] }
    ]

    const aggregated = LastFmService.aggregateTags(tracks)

    expect(aggregated).toEqual([
      { tag: 'rock', count: 150 },
      { tag: 'classic', count: 75 }
    ])
    // ↑ Tests real algorithm with real data structures
  })
})
```

---

### 2. Integration Tests (Service Interactions)

**When to write:**
- Services calling external APIs
- Services interacting with each other
- Cache behavior (hit/miss/expiry)
- Rate limiting under load

**Mocking guidance:**
- Mock: NOTHING (or <10%)
- Use: Real APIs with test credentials
- Run: Slower, on merge to main

**Example (GOOD):**
```typescript
describe('AudioEnrichmentService Integration', () => {
  it('enriches track with real Deezer API', async () => {
    // Real track from Spotify
    const track = await spotifyAPI.getTrack('6rqhFgbbKwnb9MLmUQDhG6')

    // Real enrichment (calls Deezer)
    const enriched = await service.enrichTrack(track)

    // Verify real BPM data
    expect(enriched.bpm).toBeTypeOf('number')
    expect(enriched.bpm).toBeGreaterThan(45)
    expect(enriched.bpm).toBeLessThan(220)
    expect(enriched.source).toBe('deezer')

    // Verify cache populated (real KV)
    const cached = await kv.get(`bpm:${track.id}`)
    expect(cached).toBeTruthy()
    // ↑ Tests real API, real caching, real validation
  })
})
```

---

### 3. Contract Tests (API Compatibility)

**When to write:**
- Validating external API schemas
- Catching API breaking changes
- Documenting API expectations

**Mocking guidance:**
- Mock: NOTHING (0%)
- Use: Real APIs exclusively
- Run: Nightly (rate limit friendly)

**Example (GOOD):**
```typescript
describe('Deezer API Contract', () => {
  it('track response matches DeezerTrackSchema', async () => {
    // Real API call
    const response = await fetch('https://api.deezer.com/track/isrc:GBUM71029604')
    const data = await response.json()

    // Validate schema
    const result = DeezerTrackSchema.safeParse(data)

    if (!result.success) {
      console.error('Schema mismatch:', result.error.format())
      console.error('Actual data:', JSON.stringify(data, null, 2))
    }

    expect(result.success).toBe(true)
    // ↑ Catches API changes immediately!
  })

  it('error response has expected format', async () => {
    // Test error case with real API
    const response = await fetch('https://api.deezer.com/track/isrc:INVALID')
    const error = await response.json()

    expect(error).toHaveProperty('error')
    expect(error.error).toHaveProperty('type')
    // ↑ Documents error format
  })
})
```

---

### 4. E2E Tests (User Workflows)

**When to write:**
- Critical user journeys (login → analyze → create)
- Multi-step workflows
- Golden paths
- Error recovery flows

**Mocking guidance:**
- Mock: Almost nothing (<10%)
- Use: Real frontend + backend + APIs
- Run: Pre-release (slowest)

**Example (GOOD):**
```typescript
import { test, expect } from '@playwright/test'

test('user analyzes playlist end-to-end', async ({ page }) => {
  // Real browser automation
  await page.goto('http://localhost:3000')

  // Real OAuth flow
  await page.click('text=Login with Spotify')
  await page.waitForURL('**/callback**')

  // Real user interactions
  await page.click('text=Rock Classics')
  await page.fill('input[placeholder="Ask DJ..."]', 'Analyze this playlist')
  await page.click('button[type="submit"]')

  // Real streaming response
  await expect(page.getByText(/analyzing/i)).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/analyze_playlist/)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/bpm/i)).toBeVisible({ timeout: 30000 })

  // Verify persistence
  await page.reload()
  await expect(page.getByText('Analyze this playlist')).toBeVisible()
  // ↑ Tests complete user experience
})
```

---

## Quality Checklist

Before submitting a test file, verify:

### ✅ Value Check
- [ ] Tests complicated logic, not simple pass-through
- [ ] Tests real behavior, not mock behavior
- [ ] Tests business rules, not library behavior
- [ ] Removing test would allow real bugs to slip through

### ✅ Mocking Check
- [ ] Mocking is <20% for unit tests (or test is wrong type)
- [ ] Integration tests use real APIs
- [ ] Contract tests use real APIs (0% mocking)
- [ ] E2E tests use real frontend + backend

### ✅ Clarity Check
- [ ] Test name describes WHAT and WHY
- [ ] Failure message clearly indicates problem
- [ ] Test has single responsibility
- [ ] Setup/teardown is clear and isolated

### ✅ Reliability Check
- [ ] Test doesn't depend on test order
- [ ] Test cleans up after itself
- [ ] Test doesn't have race conditions
- [ ] Test handles timing appropriately (no arbitrary sleeps)

---

## Examples: Good vs Bad Tests

### Example 1: Service Testing

**❌ BAD (Testing Mock):**
```typescript
describe('LastFmService', () => {
  it('fetches track info', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        listeners: 10000,
        playcount: 50000
      })
    })

    const info = await service.getTrackInfo('Artist', 'Track')

    expect(info.listeners).toBe(10000)  // Testing mock!
  })
})
```

**✅ GOOD (Testing Real Integration):**
```typescript
describe('LastFmService Integration', () => {
  it('fetches real track info from Last.fm API', async () => {
    // Real API call (known track)
    const info = await service.getTrackInfo('Queen', 'Bohemian Rhapsody')

    // Verify real data characteristics
    expect(info.listeners).toBeGreaterThan(1000000)  // Popular track!
    expect(info.playcount).toBeGreaterThan(info.listeners)
    expect(info.topTags.length).toBeGreaterThan(0)
    expect(info.topTags[0]).toHaveProperty('name')

    // Verify cache was populated
    const cached = await kv.get(cacheKey)
    expect(cached).toBeTruthy()
  })
})
```

---

### Example 2: Schema Testing

**❌ BAD (Testing Zod):**
```typescript
describe('SpotifySchemas', () => {
  it('validates track', () => {
    const track = {
      id: '123',
      name: 'Song',
      artists: [{ id: 'a1', name: 'Artist' }]
    }

    expect(() => SpotifyTrackSchema.parse(track)).not.toThrow()
    // Testing Zod library behavior!
  })
})
```

**✅ GOOD (Testing API Contract):**
```typescript
describe('Spotify API Contract', () => {
  it('real track matches SpotifyTrackSchema', async () => {
    // Use REAL Spotify API
    const response = await fetch(
      'https://api.spotify.com/v1/tracks/6rqhFgbbKwnb9MLmUQDhG6',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const track = await response.json()

    // Validate real response
    const result = SpotifyTrackSchema.safeParse(track)

    if (!result.success) {
      console.error('Spotify API schema changed!')
      console.error('Errors:', result.error.format())
    }

    expect(result.success).toBe(true)
  })
})
```

---

### Example 3: Route Handler Testing

**❌ BAD (Testing Simulation):**
```typescript
describe('Chat Stream Route', () => {
  // Create simplified simulation
  async function simulateHandler(req) {
    const body = await req.json()
    if (!body.message) throw new Error('Required')
    return { ok: true }
  }

  it('validates request', async () => {
    await expect(simulateHandler(new Request(...))).rejects.toThrow()
    // Testing simulation, not real handler!
  })
})
```

**✅ GOOD (Testing Real Handler):**
```typescript
describe('Chat Stream Route Integration', () => {
  it('validates request with real handler', async () => {
    // Import REAL route handler
    const { chatStreamRouter } = await import('./routes/chat-stream')

    // Create real request
    const request = new Request('http://localhost/api/chat-stream/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})  // Missing required field
    })

    // Call REAL handler
    const response = await chatStreamRouter.fetch(request, mockEnv)

    expect(response.status).toBe(400)
    const error = await response.json()
    expect(error).toHaveProperty('error')
  })
})
```

---

## When Mocking IS Appropriate

### Acceptable Mocking Scenarios

**1. External Services You Don't Control**
```typescript
// OK to mock in unit tests
const emailService = {
  send: vi.fn().mockResolvedValue({ sent: true })
}

// But ALSO write integration test with real email (test mode)
```

**2. Slow/Expensive Operations in Unit Tests**
```typescript
// OK to mock database in unit tests
const db = {
  query: vi.fn().mockResolvedValue([...])
}

// But ALSO write integration test with real database
```

**3. Time-Dependent Logic**
```typescript
// OK to mock Date.now() for time-dependent tests
vi.spyOn(Date, 'now').mockReturnValue(1234567890)

// But ALSO test with real time for integration
```

**4. Non-Deterministic Behavior**
```typescript
// OK to mock random for predictable tests
vi.spyOn(Math, 'random').mockReturnValue(0.5)

// But ALSO test with real randomness for distribution
```

### The Key Rule for Mocking

**If you mock in unit tests:**
- ✅ ALSO write integration tests with real implementation
- ✅ Keep unit tests fast and focused
- ✅ Keep integration tests comprehensive and realistic

**Never mock without a plan to test the real thing.**

---

## Test Organization

### Directory Structure

```
src/
├── __tests__/
│   ├── unit/              # Pure logic, <20% mocking
│   │   ├── guards.test.ts
│   │   └── RateLimitedQueue.test.ts
│   │
│   ├── integration/       # Real APIs, <10% mocking
│   │   ├── enrichment-pipeline.integration.test.ts
│   │   └── chat-stream.integration.test.ts
│   │
│   ├── contracts/         # API validation, 0% mocking
│   │   ├── spotify.contract.test.ts
│   │   ├── deezer.contract.test.ts
│   │   └── lastfm.contract.test.ts
│   │
│   ├── e2e/               # User workflows, <10% mocking
│   │   ├── analyze-playlist.e2e.test.ts
│   │   └── create-playlist.e2e.test.ts
│   │
│   ├── fixtures/          # Test data
│   └── helpers/           # Test utilities
```

### Naming Conventions

```typescript
// Unit tests
describe('ClassName/functionName', () => {
  it('does specific thing', () => {})
})

// Integration tests
describe('FeatureName Integration', () => {
  it('completes workflow with real dependencies', async () => {})
})

// Contract tests
describe('APIName API Contract', () => {
  it('endpoint matches schema', async () => {})
})

// E2E tests
describe('User Journey: FeatureName', () => {
  it('user completes workflow end-to-end', async () => {})
})
```

---

## Common Questions

### Q: "How much mocking is too much?"

**A:** If >50% of your test is mock setup, you're probably testing mocks. Ask:
- What real logic am I validating?
- Would integration test be more valuable?
- Am I just testing that mocks work?

---

### Q: "Should I mock internal services?"

**A:** Depends on the test type:
- **Unit test:** Yes, mock internal services
- **Integration test:** No, use real internal services
- **E2E test:** No, everything should be real

---

### Q: "When should I write contract tests?"

**A:** For ALL external APIs you depend on:
- Spotify, Deezer, Last.fm, MusicBrainz
- Anthropic Claude API
- Any external service where schema matters

Run nightly to catch API changes early.

---

### Q: "How do I know if a test has value?"

**A:** Ask the "deletion test":
1. Imagine deleting this test
2. What real bug would you miss?
3. If answer is "none" or "mock behavior" → delete the test

---

### Q: "What if external APIs are rate-limited?"

**A:** Layer your testing:
- **Unit tests:** Mock (fast, run every commit)
- **Integration tests:** Real APIs (medium, run on merge)
- **Contract tests:** Real APIs (slow, run nightly)
- **E2E tests:** Real everything (slowest, run pre-release)

---

## Summary: The Testing Manifesto

### We Value

1. **Real behavior** over mock behavior
2. **Integration** over isolation
3. **User journeys** over unit coverage
4. **Quality** over quantity

### We Avoid

1. Testing that mocks return what we configured
2. Testing library/framework behavior
3. Testing simulations instead of real code
4. 100% mocking in "integration" tests

### We Remember

> "Tests should give confidence that real features work for real users with real data."

If your test doesn't do that, it's testing theater, not testing value.

---

**When in doubt, ask:** *"Am I testing real behavior or just testing my mocks?"*

If you're testing mocks, **stop and write an integration test instead**.
