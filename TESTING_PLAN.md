# DJ Monorepo Testing Plan

## Executive Summary

This document outlines the comprehensive testing strategy for the DJ monorepo, implementing vitest with React Testing Library following 2025 best practices. The plan covers **287 estimated test cases** across 59 TypeScript files.

**Architecture:** pnpm monorepo with 4 packages (web, api-worker, shared-types, api-client)

**Testing Framework:** Vitest 3.2+ with projects configuration

**Status:** 0% coverage → Target 80%+ coverage

---

## 1. Testing Infrastructure Setup

### 1.1 Vitest Configuration (2025 Best Practices)

**Key Changes from 2024:**
- Use `projects` config instead of deprecated `workspaces`
- Shared config via `vitest.shared.ts` (not extends, due to projects inheritance issue)
- Per-package configs for optimal cache hits
- jsdom for React components
- nodejs environment for backend services

**Files to Create:**
```
/vitest.config.ts                    # Root projects config
/vitest.shared.ts                    # Shared configuration
/apps/web/vitest.config.ts           # Frontend (jsdom)
/workers/api/vitest.config.ts        # Backend (node)
/packages/shared-types/vitest.config.ts
/packages/api-client/vitest.config.ts
```

### 1.2 Dependencies to Add

```json
{
  "devDependencies": {
    "vitest": "^3.2.0",
    "@vitest/ui": "^3.2.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@testing-library/jest-dom": "^6.6.3",
    "jsdom": "^25.0.1",
    "happy-dom": "^16.8.0",
    "@cloudflare/workers-types": "^4.20250114.0"
  }
}
```

### 1.3 Test Scripts

Add to root `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:web": "vitest --project web",
    "test:api": "vitest --project api",
    "test:watch": "vitest --watch"
  }
}
```

---

## 2. Mock Infrastructure

### 2.1 Frontend Mocks (`apps/web/src/__tests__/fixtures/`)

**Files:**
- `spotify-mocks.ts` - Mock Spotify API responses
- `sse-events.ts` - Mock SSE event streams
- `storage-mocks.ts` - Mock localStorage
- `test-helpers.tsx` - React testing utilities

**Key Mocks:**
```typescript
// spotify-mocks.ts
export const mockSpotifyToken = { /* ... */ }
export const mockUserProfile = { /* ... */ }
export const mockPlaylist = { /* ... */ }
export const mockTracks = [{ /* ... */ }]

// sse-events.ts
export const mockSSEStream = (events: SSEEvent[]) => { /* ... */ }
export const mockContentEvent = { /* ... */ }
export const mockToolEvent = { /* ... */ }

// test-helpers.tsx
export const renderWithAuth = (component) => { /* ... */ }
export const waitForSSEEvent = (type) => { /* ... */ }
```

### 2.2 Backend Mocks (`workers/api/src/__tests__/fixtures/`)

**Files:**
- `cloudflare-mocks.ts` - Mock KV, Env, ExecutionContext
- `api-mocks.ts` - Mock external APIs (Spotify, Deezer, Last.fm)
- `anthropic-mocks.ts` - Mock Claude SDK
- `test-builders.ts` - Factory functions for test data

**Key Mocks:**
```typescript
// cloudflare-mocks.ts
export class MockKVNamespace implements KVNamespace { /* ... */ }
export const createMockEnv = () => ({ /* ... */ })

// api-mocks.ts
export const mockDeezerAPI = createMockServer([
  rest.get('https://api.deezer.com/track/isrc:*', /* ... */)
])

// test-builders.ts
export const buildSpotifyTrack = (overrides?) => ({ /* ... */ })
export const buildPlaylist = (overrides?) => ({ /* ... */ })
```

---

## 3. Testing Priorities & Components

### 3.1 HIGH PRIORITY (Complex, Critical Path)

| Component | Lines | Est. Tests | Complexity | Files |
|-----------|-------|-----------|------------|-------|
| useSpotifyAuth | 566 | 45 | Very High | apps/web/src/hooks/useSpotifyAuth.ts |
| AudioEnrichmentService | 18KB | 28 | High | workers/api/src/services/AudioEnrichmentService.ts |
| LastFmService | 24KB | 35 | High | workers/api/src/services/LastFmService.ts |
| chat-stream route | 130KB | 55 | Very High | workers/api/src/routes/chat-stream.ts |
| RateLimitedQueue | 100+ | 22 | High | workers/api/src/utils/RateLimitedQueue.ts |

**Total: 185 tests**

#### 3.1.1 useSpotifyAuth Hook (45 tests)

**Test File:** `apps/web/src/__tests__/hooks/useSpotifyAuth.test.ts`

**Test Categories:**
1. Store Creation & State Management (10 tests)
   - Initial state from localStorage
   - Token save/load/clear operations
   - Token expiry detection
   - Listener subscription/cleanup
   - State mutation isolation

2. Async Operation Management (8 tests)
   - Abort signal creation/reuse
   - Loading state transitions
   - Error state management
   - Validation state tracking

3. Token Validation (12 tests)
   - Valid token → 200 response
   - Invalid token → 401 clears token
   - Network error → assume valid
   - Request cancellation
   - Legacy token migration

4. OAuth Callback Processing (10 tests)
   - Single-process guard
   - Error parameter handling
   - Token extraction
   - URL cleanup
   - Cross-tab sync

5. React Integration (5 tests)
   - Hook return values
   - State sync across components
   - Cleanup on unmount

#### 3.1.2 AudioEnrichmentService (28 tests)

**Test File:** `workers/api/src/__tests__/services/AudioEnrichmentService.test.ts`

**Test Categories:**
1. Direct ISRC Enrichment (8 tests)
   - Track with ISRC → Deezer query
   - Valid BPM (45-220)
   - Invalid BPM filtered
   - Network error handling

2. ISRC Fallback via MusicBrainz (6 tests)
   - Track without ISRC → MusicBrainz
   - ISRC found → Deezer query
   - No result handling
   - Error handling

3. Cache Hit/Miss Logic (8 tests)
   - Fresh hit returns immediately
   - Recent miss (<5min) skips retry
   - Old miss (>5min) retries
   - Cache store/retrieve

4. Batch Processing (4 tests)
   - Parallel processing
   - Results keyed by track ID
   - Error in one track doesn't block

5. Data Validation (2 tests)
   - BPM range validation
   - Source tracking

#### 3.1.3 LastFmService (35 tests)

**Test File:** `workers/api/src/__tests__/services/LastFmService.test.ts`

**Test Categories:**
1. Track Signal Fetching (12 tests)
   - Successful fetch
   - Track correction API
   - Tag extraction (up to 15)
   - Similar tracks
   - Listeners/playcount
   - Album/wiki info

2. Tag Aggregation (8 tests)
   - Multiple track aggregation
   - Count occurrences
   - Sort by frequency
   - Limit to top 15
   - Empty list handling

3. Popularity Calculation (5 tests)
   - Average listeners
   - Average playcount
   - Zero tracks handling
   - Rounding

4. Artist Info Enrichment (6 tests)
   - Deduplicate artists
   - Batch fetch
   - Attach to signals
   - Missing artists

5. Cache Lifecycle (4 tests)
   - Hit/miss patterns
   - TTL expiration
   - Retry logic

#### 3.1.4 chat-stream Route (55 tests)

**Test File:** `workers/api/src/__tests__/routes/chat-stream.test.ts`

**Test Categories:**
1. Request Validation (10 tests)
   - Valid request format
   - Required fields
   - Message length limits
   - History size limits
   - Invalid JSON

2. SSE Response Setup (8 tests)
   - Headers correct
   - TransformStream created
   - Writer initialized
   - Response immediate
   - Backpressure

3. Tool Execution Flow (15 tests)
   - Tool list to Claude
   - Tool calling by name
   - Argument validation
   - Result formatting
   - Error handling

4. Enrichment Integration (10 tests)
   - AudioEnrichmentService calls
   - LastFmService calls
   - Progress streaming
   - Error resilience

5. Message Streaming (8 tests)
   - Content chunks
   - Thinking blocks
   - Tool events
   - Error events
   - Done event

6. Claude Integration (4 tests)
   - SDK initialization
   - Message formatting
   - Tool definitions
   - Context management

#### 3.1.5 RateLimitedQueue (22 tests)

**Test File:** `workers/api/src/__tests__/utils/RateLimitedQueue.test.ts`

**Test Categories:**
1. Token Bucket (6 tests)
   - Initial burst allocation
   - Token refill
   - Rate enforcement
   - Never exceed burst

2. Task Processing (8 tests)
   - FIFO order
   - Results in order
   - Concurrent limit
   - Rate limit (TPS)

3. Result Callbacks (4 tests)
   - Callback per task
   - Receives result, index, total
   - Error handling

4. Timer Management (4 tests)
   - Timer lifecycle
   - Jitter application
   - Min tick delay

### 3.2 MEDIUM PRIORITY (63 tests)

| Component | Tests | File |
|-----------|-------|------|
| ChatInterface | 18 | apps/web/src/__tests__/features/chat/ChatInterface.test.tsx |
| App.tsx | 12 | apps/web/src/__tests__/App.test.tsx |
| spotify-tools | 18 | workers/api/src/__tests__/lib/spotify-tools.test.ts |
| UserPlaylists | 8 | apps/web/src/__tests__/features/playlist/UserPlaylists.test.tsx |
| SpotifyAuth | 7 | apps/web/src/__tests__/features/auth/SpotifyAuth.test.tsx |

### 3.3 LOW PRIORITY (39 tests)

| Component | Tests | File |
|-----------|-------|------|
| guards.ts | 9 | workers/api/src/__tests__/lib/guards.test.ts |
| shared-types schemas | 20 | packages/shared-types/src/__tests__/schemas.test.ts |
| Other utilities | 10 | Various |

---

## 4. Integration Testing Strategy

### 4.1 Frontend Integration Tests

**Test:** Full auth flow
```typescript
describe('Spotify Authentication Flow', () => {
  it('should complete OAuth flow end-to-end', async () => {
    // 1. Render App
    // 2. Click login
    // 3. Mock OAuth callback
    // 4. Verify token stored
    // 5. Verify authenticated UI
  })
})
```

**Test:** Chat streaming flow
```typescript
describe('Chat Streaming', () => {
  it('should stream messages and handle tools', async () => {
    // 1. Render ChatInterface
    // 2. Send message
    // 3. Mock SSE stream with tool calls
    // 4. Verify UI updates
    // 5. Verify tool tracking
  })
})
```

### 4.2 Backend Integration Tests

**Test:** Enrichment pipeline
```typescript
describe('Enrichment Pipeline', () => {
  it('should enrich tracks with Deezer and Last.fm', async () => {
    // 1. Mock Spotify tracks
    // 2. Mock Deezer API
    // 3. Mock Last.fm API
    // 4. Call analyze_playlist tool
    // 5. Verify enrichment data
    // 6. Verify cache writes
  })
})
```

**Test:** Rate limiting
```typescript
describe('Rate Limiting', () => {
  it('should respect 40 TPS limit', async () => {
    // 1. Queue 100 tasks
    // 2. Measure execution time
    // 3. Verify ~2.5 seconds (100/40)
    // 4. Verify no concurrent overflow
  })
})
```

---

## 5. Coverage Goals

### 5.1 Target Coverage

| Package | Target | Priority |
|---------|--------|----------|
| @dj/api-worker | 80% | HIGH |
| @dj/web | 75% | HIGH |
| @dj/shared-types | 90% | MEDIUM |
| @dj/api-client | 70% | MEDIUM |

### 5.2 Critical Paths (100% coverage required)

- OAuth authentication flow
- SSE streaming pipeline
- Tool execution in chat-stream
- Rate limiting logic
- Cache hit/miss logic
- Error boundaries

---

## 6. Execution Plan

### Phase 1: Infrastructure (Day 1)
1. ✅ Research 2025 vitest best practices
2. ✅ Analyze codebase architecture
3. Create vitest configs (root + packages)
4. Set up shared test configuration
5. Install dependencies
6. Create mock infrastructure

### Phase 2: HIGH Priority Tests (Days 2-4)
1. useSpotifyAuth (45 tests) - Agent 1
2. AudioEnrichmentService (28 tests) - Agent 2
3. LastFmService (35 tests) - Agent 2
4. chat-stream route (55 tests) - Agent 3
5. RateLimitedQueue (22 tests) - Agent 4

### Phase 3: MEDIUM Priority Tests (Day 5)
1. ChatInterface (18 tests) - Agent 5
2. App.tsx (12 tests) - Agent 5
3. spotify-tools (18 tests) - Agent 6

### Phase 4: LOW Priority Tests (Day 6)
1. guards.ts (9 tests) - Agent 7
2. shared-types schemas (20 tests) - Agent 7
3. Utilities (10 tests) - Agent 7

### Phase 5: Integration Tests (Day 7)
1. Frontend integration tests - Agent 8
2. Backend integration tests - Agent 8
3. End-to-end flows - Agent 8

### Phase 6: Validation (Day 8)
1. Run full test suite
2. Generate coverage report
3. Fix failing tests
4. Update CI/CD pipeline
5. Document testing patterns

---

## 7. Agent Assignment

### Agent 1: Frontend Infrastructure & useSpotifyAuth
- Create web vitest config
- Set up React Testing Library
- Create frontend fixtures
- Implement useSpotifyAuth tests (45)

### Agent 2: Backend Services (Enrichment)
- Create api-worker vitest config
- Set up Cloudflare mocks
- Implement AudioEnrichmentService tests (28)
- Implement LastFmService tests (35)

### Agent 3: Streaming & Routes
- Create SSE mocking utilities
- Implement chat-stream tests (55)
- Create Anthropic SDK mocks

### Agent 4: Utilities & Core Logic
- Implement RateLimitedQueue tests (22)
- Create timing test utilities
- Implement guards tests (9)

### Agent 5: React Components
- Implement ChatInterface tests (18)
- Implement App.tsx tests (12)
- Create component test helpers

### Agent 6: API Tools & Integration
- Implement spotify-tools tests (18)
- Create Spotify API mocks
- Integration tests for tools

### Agent 7: Shared Types & Low Priority
- Create shared-types vitest config
- Implement schema validation tests (20)
- Implement remaining utility tests (10)

### Agent 8: Integration & E2E
- Frontend integration tests
- Backend integration tests
- End-to-end flow tests
- Performance benchmarks

---

## 8. Success Metrics

### 8.1 Quantitative Metrics

- **Test Count:** 287 tests passing
- **Coverage:** 80%+ overall
- **Performance:** All tests run in <60 seconds
- **Reliability:** 0 flaky tests

### 8.2 Qualitative Metrics

- All critical paths tested
- Clear test organization
- Comprehensive mocks
- Easy to add new tests
- Good developer experience

---

## 9. Maintenance & Documentation

### 9.1 Testing Guidelines

Create `TESTING_GUIDELINES.md`:
- How to write new tests
- Mock patterns
- Naming conventions
- CI/CD integration

### 9.2 CI/CD Integration

Update `.github/workflows/test.yml`:
```yaml
- name: Run tests
  run: pnpm test

- name: Generate coverage
  run: pnpm test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v4
```

---

## 10. Timeline

| Phase | Duration | Tests | Status |
|-------|----------|-------|--------|
| Infrastructure | 1 day | 0 | 🚧 In Progress |
| HIGH Priority | 3 days | 185 | ⏳ Pending |
| MEDIUM Priority | 1 day | 63 | ⏳ Pending |
| LOW Priority | 1 day | 39 | ⏳ Pending |
| Integration | 1 day | TBD | ⏳ Pending |
| Validation | 1 day | - | ⏳ Pending |
| **TOTAL** | **8 days** | **287+** | **0% → 80%** |

---

## Appendix A: Key Resources

### 2025 Vitest Best Practices
- [Vitest 3 Monorepo Setup](https://www.thecandidstartup.org/2025/09/08/vitest-3-monorepo-setup.html)
- [Vitest Projects Guide](https://vitest.dev/guide/projects)
- [React Testing Best Practices 2025](https://www.codingeasypeasy.com/blog/react-component-testing-best-practices-with-vitest-and-jest-2025-guide)

### Testing Patterns
- React Testing Library
- Cloudflare Workers testing
- Rate limiting testing
- SSE streaming testing

---

## Appendix B: File Structure

```
dj/
├── vitest.config.ts (root projects config)
├── vitest.shared.ts (shared settings)
├── TESTING_PLAN.md (this file)
├── TESTING_GUIDELINES.md (to create)
│
├── apps/web/
│   ├── vitest.config.ts
│   └── src/__tests__/
│       ├── fixtures/
│       │   ├── spotify-mocks.ts
│       │   ├── sse-events.ts
│       │   ├── storage-mocks.ts
│       │   └── test-helpers.tsx
│       ├── hooks/
│       │   └── useSpotifyAuth.test.ts
│       ├── features/
│       │   ├── chat/ChatInterface.test.tsx
│       │   ├── auth/SpotifyAuth.test.tsx
│       │   └── playlist/UserPlaylists.test.tsx
│       └── App.test.tsx
│
├── workers/api/
│   ├── vitest.config.ts
│   └── src/__tests__/
│       ├── fixtures/
│       │   ├── cloudflare-mocks.ts
│       │   ├── api-mocks.ts
│       │   ├── anthropic-mocks.ts
│       │   └── test-builders.ts
│       ├── services/
│       │   ├── AudioEnrichmentService.test.ts
│       │   └── LastFmService.test.ts
│       ├── routes/
│       │   └── chat-stream.test.ts
│       ├── lib/
│       │   ├── guards.test.ts
│       │   └── spotify-tools.test.ts
│       └── utils/
│           └── RateLimitedQueue.test.ts
│
└── packages/
    └── shared-types/
        ├── vitest.config.ts
        └── src/__tests__/
            └── schemas.test.ts
```

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Status:** 🚧 In Progress (Phase 1: Infrastructure)
