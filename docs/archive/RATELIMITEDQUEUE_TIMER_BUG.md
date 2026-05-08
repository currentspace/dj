# RateLimitedQueue Timer Bug Report

**Date Discovered:** November 3, 2025
**Discovered During:** Phase 2 Integration Test Implementation
**Severity:** Medium (affects testing, not production)
**Priority:** Medium (should fix before expanding test coverage)

---

## Summary

`RateLimitedQueue.ts` has a timer ID type incompatibility between Node.js and Cloudflare Workers environments. The `setTimeout()` function returns different types in each environment, causing the `toTimerId()` function to throw errors in Node.js test environments.

---

## Root Cause

### Issue Location
**File:** `workers/api/src/utils/RateLimitedQueue.ts`
**Lines:** 360, 394-399

### Code
```typescript
// Line 360: Timer creation
this.timer ??= toTimerId(setTimeout(tick, this.minTickMs))

// Lines 394-399: Timer ID validation
function toTimerId(value: unknown): number {
  if (isValidTimerId(value)) {
    return value
  }
  throw new Error(`Invalid timer ID: ${typeof value}`)
}
```

### Environment Differences

| Environment | setTimeout Return Type | isValidTimerId Result |
|-------------|------------------------|----------------------|
| **Cloudflare Workers** | `number` | ✅ true (works) |
| **Node.js** | `Timeout` object | ❌ false (throws error) |
| **Browser** | `number` | ✅ true (works) |

### Error Message in Tests
```
Error: Invalid timer ID: object
    at toTimerId (RateLimitedQueue.ts:398)
    at RateLimitedQueue.start (RateLimitedQueue.ts:360)
```

---

## Impact Assessment

### Affected Environments

#### ❌ Node.js Test Environment (Vitest)
- **Status:** Broken
- **Impact:** Cannot test RateLimitedQueue directly in integration tests
- **Workaround:** Test rate limiting via service methods (AudioEnrichmentService, LastFmService)
- **Current Tests:** 0 direct RateLimitedQueue integration tests due to this bug

#### ✅ Cloudflare Workers Production
- **Status:** Working correctly
- **Impact:** None (setTimeout returns number)
- **Production Use:** AudioEnrichmentService, LastFmService use RateLimitedQueue successfully

#### ✅ Unit Tests
- **Status:** Working correctly
- **Impact:** None (unit tests don't use setTimeout timers)
- **Current Tests:** 10 RateLimitedQueue unit tests pass

### Severity Justification

**Medium Severity** because:
- ✅ Production works correctly (Cloudflare Workers)
- ❌ Cannot test RateLimitedQueue in integration tests (Node.js)
- ⚠️ Limits test coverage expansion
- ⚠️ Creates confusion about timer handling

**Not High Severity** because:
- Production is unaffected
- Workarounds exist (test via service methods)
- Unit tests still work

---

## Technical Details

### setTimeout Return Types

#### Cloudflare Workers
```typescript
// In Cloudflare Workers global scope
const timerId: number = setTimeout(() => {}, 100)
clearTimeout(timerId) // expects number
```

#### Node.js
```typescript
// In Node.js
import { Timeout } from 'timers'
const timerId: Timeout = setTimeout(() => {}, 100)
clearTimeout(timerId) // accepts Timeout object or number
```

#### Browser
```typescript
// In browser
const timerId: number = setTimeout(() => {}, 100)
clearTimeout(timerId) // expects number
```

### Current Type Guards

```typescript
// Current implementation (line ~400)
function isValidTimerId(value: unknown): value is number {
  return typeof value === 'number'
}
```

**Problem:** This only accepts `number`, but Node.js returns `Timeout` object.

---

## Recommended Fixes

### Option 1: Normalize Timer IDs (Recommended)

**Approach:** Accept both number and Timeout object, normalize to number.

```typescript
function toTimerId(value: unknown): number {
  // Cloudflare Workers & Browser: number
  if (typeof value === 'number') {
    return value
  }

  // Node.js: Timeout object
  if (typeof value === 'object' && value !== null) {
    // Node.js Timeout objects can be coerced to numbers
    // Or use a WeakMap to track them
    return 0 // Placeholder - doesn't affect functionality
  }

  throw new Error(`Invalid timer ID: ${typeof value}`)
}

function isValidTimerId(value: unknown): value is number {
  return typeof value === 'number' ||
         (typeof value === 'object' && value !== null)
}
```

**Pros:**
- Works in all environments
- Maintains type safety
- Simple implementation

**Cons:**
- Returns 0 for Node.js timers (acceptable since we don't use timer IDs for clearing in tests)

---

### Option 2: Type Guard Enhancement

**Approach:** Update type guard to accept both types.

```typescript
// Update type to union type
type TimerId = number | NodeJS.Timeout

function isValidTimerId(value: unknown): value is TimerId {
  // Accept number (Workers, Browser)
  if (typeof value === 'number') {
    return true
  }

  // Accept Timeout object (Node.js)
  if (typeof value === 'object' && value !== null) {
    // Optional: Check for Timeout-specific properties
    return true
  }

  return false
}

function toTimerId(value: unknown): number {
  if (isValidTimerId(value)) {
    return typeof value === 'number' ? value : 0
  }
  throw new Error(`Invalid timer ID: ${typeof value}`)
}
```

**Pros:**
- Type-safe with union types
- Explicit about supported types
- Clear intent

**Cons:**
- Requires NodeJS types
- Still returns placeholder for Node.js timers

---

### Option 3: Environment Detection

**Approach:** Detect runtime environment and handle accordingly.

```typescript
// Detect environment
const isCloudflareWorkers = typeof globalThis.caches !== 'undefined'
const isNode = typeof process !== 'undefined' && process.versions?.node

function toTimerId(value: unknown): number {
  if (isCloudflareWorkers) {
    // In Cloudflare Workers, setTimeout returns number
    if (typeof value !== 'number') {
      throw new Error(`Expected number timer ID in Workers, got ${typeof value}`)
    }
    return value
  }

  if (isNode) {
    // In Node.js, setTimeout returns Timeout object
    // We don't need to track timer IDs in tests
    return 0
  }

  // Browser or unknown environment
  return typeof value === 'number' ? value : 0
}
```

**Pros:**
- Explicit environment handling
- Clear error messages per environment
- No ambiguity

**Cons:**
- More complex
- Requires environment detection
- Might not handle all edge cases

---

### Option 4: Skip Timer Tracking in Tests

**Approach:** Only track timers in production (Cloudflare Workers).

```typescript
function toTimerId(value: unknown): number {
  // In production (Workers), setTimeout returns number
  if (typeof value === 'number') {
    return value
  }

  // In test environments (Node.js), don't track timers
  // Tests don't need timer cleanup, so return placeholder
  return 0
}

function isValidTimerId(value: unknown): value is number {
  return typeof value === 'number' ||
         typeof value === 'object' // Node.js Timeout object
}
```

**Pros:**
- Simplest fix
- Works in all environments
- No timer tracking overhead in tests

**Cons:**
- Loses timer tracking in Node.js (acceptable for tests)

---

## Recommended Solution

**Use Option 1 (Normalize Timer IDs)** because:
1. ✅ Simple implementation
2. ✅ Works in all environments
3. ✅ Maintains type safety
4. ✅ No external dependencies
5. ✅ Timer tracking isn't critical in tests (we don't manually clear timers)

### Implementation

```typescript
function toTimerId(value: unknown): number {
  // Cloudflare Workers & Browser: number
  if (typeof value === 'number') {
    return value
  }

  // Node.js: Timeout object (acceptable, doesn't affect functionality)
  if (typeof value === 'object' && value !== null) {
    return 0 // Placeholder - timer cleanup happens automatically in tests
  }

  throw new Error(`Invalid timer ID: ${typeof value}`)
}

function isValidTimerId(value: unknown): value is number {
  return typeof value === 'number' ||
         (typeof value === 'object' && value !== null)
}
```

**Why this works:**
- Production (Cloudflare Workers): Returns actual number timer ID
- Tests (Node.js): Returns 0 placeholder (timers clean up automatically)
- Both environments: RateLimitedQueue functionality is identical

---

## Testing Strategy After Fix

Once fixed, add integration tests for RateLimitedQueue:

### New Integration Tests to Add

```typescript
describe('RateLimitedQueue Integration', () => {
  it('respects rate limit with real timing', async () => {
    const queue = new RateLimitedQueue<number>(40) // 40 TPS

    const tasks = Array.from({ length: 10 }, (_, i) =>
      async () => i
    )

    tasks.forEach(task => queue.enqueue(task))

    const [results, duration] = await measureExecutionTime(() =>
      queue.processAll()
    )

    // 10 tasks at 40 TPS = 250ms minimum
    expect(duration).toBeGreaterThan(250)
    expect(results).toHaveLength(10)
  })

  it('handles concurrent enqueueing', async () => {
    const queue = new RateLimitedQueue<number>(40)

    // Start processing
    const processingPromise = queue.start()

    // Enqueue tasks while processing
    for (let i = 0; i < 10; i++) {
      queue.enqueue(async () => i)
      await waitForMs(10)
    }

    // Wait for all tasks to complete
    await queue.processAll()

    expect(queue.size()).toBe(0)
  })

  it('respects concurrency limit', async () => {
    const queue = new RateLimitedQueue<number>(40, 2) // concurrency: 2

    let concurrent = 0
    let maxConcurrent = 0

    const tasks = Array.from({ length: 10 }, () =>
      async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await waitForMs(50)
        concurrent--
        return 1
      }
    )

    tasks.forEach(task => queue.enqueue(task))
    await queue.processAll()

    expect(maxConcurrent).toBe(2)
  })
})
```

---

## Workaround (Current Approach)

Until fixed, integration tests avoid testing RateLimitedQueue directly:

### Current Integration Test Pattern

```typescript
// ❌ Don't test RateLimitedQueue directly (throws timer error)
it('rate limits correctly', async () => {
  const queue = new RateLimitedQueue<number>(40)
  // ... This will fail with "Invalid timer ID: object"
})

// ✅ Test rate limiting via service methods (works)
it('AudioEnrichmentService respects rate limit', async () => {
  const service = new AudioEnrichmentService(mockKv)

  const tracks = createTestTracks(10)
  const [results, duration] = await measureExecutionTime(() =>
    service.batchEnrichTracks(tracks)
  )

  // Service uses RateLimitedQueue internally
  expect(duration).toBeGreaterThan(250) // 40 TPS validation
})
```

---

## Related Issues

### 1. Timer Cleanup
**Question:** Do we need to track timer IDs at all in tests?

**Answer:** No. In test environments:
- Timers clean up automatically when process ends
- We don't manually call `clearTimeout()`
- Timer tracking is defensive coding, not functional requirement

### 2. Production Implications
**Question:** Does this affect production?

**Answer:** No. Cloudflare Workers always returns `number` from `setTimeout()`, so production is unaffected.

### 3. Type Safety
**Question:** How do we maintain type safety across environments?

**Answer:** Use union type `number | NodeJS.Timeout` with runtime type checking.

---

## Next Steps

### Immediate (Optional):
1. Apply Option 1 fix to `RateLimitedQueue.ts`
2. Verify unit tests still pass
3. Add integration tests for RateLimitedQueue

### Future (Phase 3):
1. Add E2E tests that exercise RateLimitedQueue via user workflows
2. Monitor for similar cross-environment issues
3. Document environment-specific quirks

---

## References

- **MDN setTimeout:** https://developer.mozilla.org/en-US/docs/Web/API/setTimeout
- **Node.js Timers:** https://nodejs.org/api/timers.html
- **Cloudflare Workers Runtime:** https://developers.cloudflare.com/workers/runtime-apis/
- **TypeScript Timer Types:** https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/timers.d.ts

---

**Status:** Documented
**Priority:** Medium
**Fix Estimate:** 30 minutes
**Test Expansion After Fix:** +5-10 RateLimitedQueue integration tests
