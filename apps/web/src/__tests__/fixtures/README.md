# Frontend Test Fixtures

Comprehensive mock infrastructure for testing the DJ frontend application.

## Overview

This directory contains all mock data, test helpers, and utilities needed for frontend testing. All fixtures are type-safe, well-documented, and designed for reusability across test suites.

**Total Lines of Code:** ~1,700 lines
**Files:** 5 (4 implementation + 1 index)

## Files

### 1. `spotify-mocks.ts` (375 lines)

Mock data for Spotify API objects including tokens, users, playlists, tracks, albums, and artists.

**Key Exports:**

- **Token Mocks:**
  - `mockSpotifyToken(expiresInMs?)` - Create valid token with optional expiry
  - `mockExpiredToken()` - Create expired token (1 hour ago)
  - `mockLegacyToken()` - Create old format token (for migration tests)

- **User Mocks:**
  - `mockUserProfile(overrides?)` - Create Spotify user profile

- **Artist/Album Mocks:**
  - `mockArtist(overrides?)` - Create artist object
  - `mockAlbum(overrides?)` - Create album with images
  - `MOCK_ARTISTS` - Pre-made artists (Daft Punk, Radiohead, etc.)

- **Track Mocks:**
  - `buildTrack(overrides?)` - Build complete Spotify track
  - `buildTrackNoPreview(overrides?)` - Track without preview URL
  - `buildMockTracks(count)` - Generate array of N tracks
  - `MOCK_TRACKS` - Pre-made tracks (Around the World, Blank Space, etc.)

- **Playlist Mocks:**
  - `buildPlaylist(overrides?)` - Build complete playlist
  - `buildLargePlaylist(trackCount)` - Playlist with many tracks
  - `buildEmptyPlaylist()` - Empty playlist
  - `MOCK_PLAYLISTS` - Pre-made playlists (Chill Vibes, Workout Mix, etc.)

- **API Response Mocks:**
  - `MOCK_SPOTIFY_RESPONSES.currentUser()` - Mock /me endpoint
  - `MOCK_SPOTIFY_RESPONSES.unauthorized()` - Mock 401 response
  - `MOCK_SPOTIFY_RESPONSES.userPlaylists()` - Mock playlists endpoint

- **Storage Helpers:**
  - `seedSpotifyToken(token?)` - Seed localStorage with token
  - `seedExpiredToken()` - Seed expired token
  - `clearSpotifyStorage()` - Clear all Spotify data

**Usage:**

```typescript
import { buildPlaylist, mockUserProfile, seedSpotifyToken } from './__tests__/fixtures'

// Create mock data
const playlist = buildPlaylist({ name: 'Test Playlist', tracks: { total: 50 } })
const user = mockUserProfile({ display_name: 'John Doe' })

// Seed storage
seedSpotifyToken('test_token')
```

### 2. `sse-events.ts` (439 lines)

Mock Server-Sent Events infrastructure for testing real-time streaming chat.

**Key Exports:**

- **Event Builders:**
  - `mockContentEvent(content)` - Text response from Claude
  - `mockThinkingEvent(message)` - Processing indicator
  - `mockToolStartEvent(tool, args)` - Tool execution starts
  - `mockToolEndEvent(tool, result)` - Tool execution completes
  - `mockLogEvent(level, message)` - Server log
  - `mockDebugEvent(data)` - Debug information
  - `mockErrorEvent(error)` - Error event
  - `mockDoneEvent()` - Stream complete

- **Pre-made Sequences:**
  - `MOCK_EVENT_SEQUENCES.basicChat` - Simple chat without tools
  - `MOCK_EVENT_SEQUENCES.chatWithError` - Chat with error
  - `MOCK_EVENT_SEQUENCES.chatWithTool` - Chat with tool execution
  - `MOCK_EVENT_SEQUENCES.multiTool` - Complex multi-tool flow

- **Stream Simulation:**
  - `createMockSSEStream(events, delayMs?)` - ReadableStream emitting events
  - `createMockSSEResponse(events, delayMs?)` - Response with SSE stream
  - `formatSSEEvent(event)` - Convert event to SSE format

- **Mock EventSource:**
  - `MockEventSource` - Class implementing EventSource interface
  - `createMockEventSource(url, events)` - Create mock EventSource

- **Test Helpers:**
  - `parseSSEStream(response)` - Parse SSE stream into events
  - `waitForSSEEvent(events, predicate, timeout?)` - Wait for specific event

**Usage:**

```typescript
import {
  mockContentEvent,
  mockDoneEvent,
  createMockSSEResponse,
  MOCK_EVENT_SEQUENCES
} from './__tests__/fixtures'

// Create custom stream
const stream = createMockSSEResponse([
  mockThinkingEvent('Analyzing...'),
  mockContentEvent('Your playlist is great!'),
  mockDoneEvent()
])

// Use pre-made sequence
const events = MOCK_EVENT_SEQUENCES.chatWithTool
```

### 3. `storage-mocks.ts` (422 lines)

Mock localStorage and sessionStorage with full Web Storage API compliance.

**Key Exports:**

- **Storage Implementation:**
  - `MockStorage` - Class implementing Storage interface
  - `setupMockStorage()` - Install mock storage globally
  - `clearAllStorage()` - Clear localStorage + sessionStorage

- **Token Data Helpers:**
  - `createMockTokenData(overrides?)` - Create token data object
  - `createExpiredTokenData()` - Create expired token
  - `createTokenDataWithoutExpiry()` - Token without expiry

- **Seeding Helpers:**
  - `setMockTokenInLocalStorage(tokenData?)` - Seed Spotify token
  - `setLegacyTokenInLocalStorage(token)` - Seed legacy format
  - `clearMockTokenFromLocalStorage()` - Clear token
  - `seedLocalStorage(data)` - Seed with arbitrary data
  - `seedSessionStorage(data)` - Seed sessionStorage

- **Retrieval Helpers:**
  - `getMockTokenDataFromLocalStorage()` - Get token data
  - `getLocalStorageJSON<T>(key)` - Parse JSON from localStorage
  - `getSessionStorageJSON<T>(key)` - Parse JSON from sessionStorage

- **Verification:**
  - `expectLocalStorageKey(key)` - Assert key exists
  - `expectNoLocalStorageKey(key)` - Assert key doesn't exist

- **Storage Event Simulation:**
  - `triggerStorageEvent(key, newValue, oldValue?)` - Simulate cross-tab sync

- **Storage Spy:**
  - `StorageSpy` - Class for tracking storage calls
  - `createStorageSpy(storage?)` - Create spy instance

- **Pre-made Scenarios:**
  - `STORAGE_SCENARIOS.authenticated()` - Valid token
  - `STORAGE_SCENARIOS.empty()` - Empty storage
  - `STORAGE_SCENARIOS.expired()` - Expired token
  - `STORAGE_SCENARIOS.legacy()` - Legacy token format
  - `STORAGE_SCENARIOS.withPreferences()` - With user preferences

**Usage:**

```typescript
import {
  setupMockStorage,
  seedSpotifyToken,
  STORAGE_SCENARIOS
} from './__tests__/fixtures'

// Setup in beforeEach
beforeEach(() => {
  setupMockStorage()
  STORAGE_SCENARIOS.authenticated()
})

// Or manually
seedSpotifyToken('test_token', 3600000)
```

### 4. `test-helpers.tsx` (487 lines)

React Testing Library utilities for rendering components and mocking APIs.

**Key Exports:**

- **Test Setup/Teardown:**
  - `setupTestEnvironment()` - Setup before each test (storage, mocks, fetch)
  - `cleanupTestEnvironment()` - Cleanup after each test

- **Render Helpers:**
  - `renderWithProviders(ui, options?)` - Basic render with wrapper
  - `renderWithAuth(ui, options?)` - Render with auth context + token
  - `renderWithPlaylist(ui, options?)` - Render with playlist selected

- **Fetch Mocking:**
  - `mockFetch(data, options?)` - Mock fetch with JSON response
  - `mockFetchError(status, message)` - Mock error response
  - `mockFetchReject(error)` - Mock network error
  - `createMockFetchResponse(body, options?)` - Create Response object

- **Spotify API Mocking:**
  - `mockSpotifyAPI(endpoint, data, options?)` - Mock Spotify endpoint
  - `setupSpotifyMocks()` - Mock common endpoints (/me, /playlists)

- **SSE Stream Mocking:**
  - `mockChatStream(events, delayMs?)` - Mock chat stream endpoint
  - `mockSimpleChatResponse(message)` - Simple thinking → content → done

- **Wait Helpers:**
  - `waitForCondition(condition, timeout?)` - Wait for condition
  - `flushPromises()` - Wait for async operations
  - `waitForNextTick()` - Wait for next tick
  - `wait(ms)` - Wait for milliseconds

- **User Event Helpers:**
  - `typeInInput(input, text)` - Simulate typing
  - `clickElement(element)` - Simulate click
  - `submitForm(form)` - Simulate form submission

- **Auth Flow Helpers:**
  - `setupOAuthCallback(accessToken, expiresIn?)` - Simulate OAuth redirect
  - `clearOAuthCallback()` - Clear OAuth callback
  - `mockAuthFlow(token?)` - Mock full auth flow

- **Error Helpers:**
  - `createAbortError()` - Create AbortError

- **Debugging:**
  - `logStorageState()` - Log localStorage/sessionStorage contents
  - `logFetchCalls()` - Log all fetch calls

**Usage:**

```typescript
import {
  renderWithAuth,
  mockChatStream,
  setupTestEnvironment
} from './__tests__/fixtures'

describe('ChatInterface', () => {
  beforeEach(() => {
    setupTestEnvironment()
  })

  it('renders authenticated', () => {
    const { getByText } = renderWithAuth(<ChatInterface />)
    expect(getByText('Chat')).toBeInTheDocument()
  })

  it('handles streaming', async () => {
    mockChatStream([
      mockThinkingEvent('...'),
      mockContentEvent('Hello'),
      mockDoneEvent()
    ])

    // Test streaming behavior
  })
})
```

### 5. `index.ts` (20 lines)

Central export file for easy imports. Import from a single location instead of multiple files.

**Usage:**

```typescript
// Instead of:
import { buildPlaylist } from './__tests__/fixtures/spotify-mocks'
import { mockContentEvent } from './__tests__/fixtures/sse-events'
import { renderWithAuth } from './__tests__/fixtures/test-helpers'

// Do this:
import { buildPlaylist, mockContentEvent, renderWithAuth } from './__tests__/fixtures'
```

## Common Testing Patterns

### 1. Test Setup with Authentication

```typescript
import { setupTestEnvironment, renderWithAuth } from './__tests__/fixtures'

describe('MyComponent', () => {
  beforeEach(() => {
    setupTestEnvironment() // Installs mocks, clears storage
  })

  it('renders for authenticated user', () => {
    const { getByText } = renderWithAuth(<MyComponent />)
    expect(getByText('Welcome')).toBeInTheDocument()
  })
})
```

### 2. Testing with Playlists

```typescript
import { renderWithPlaylist, buildPlaylist } from './__tests__/fixtures'

it('displays playlist info', () => {
  const playlist = buildPlaylist({ name: 'My Playlist', tracks: { total: 50 } })
  const { getByText } = renderWithPlaylist(<ChatInterface />, { playlist })

  expect(getByText('My Playlist')).toBeInTheDocument()
  expect(getByText('50 tracks')).toBeInTheDocument()
})
```

### 3. Testing SSE Streaming

```typescript
import {
  mockChatStream,
  mockThinkingEvent,
  mockContentEvent,
  mockDoneEvent
} from './__tests__/fixtures'

it('handles streaming responses', async () => {
  mockChatStream([
    mockThinkingEvent('Processing...'),
    mockContentEvent('Here is your response'),
    mockDoneEvent()
  ])

  // Trigger chat
  // Assert on streaming behavior
})
```

### 4. Testing Storage Behavior

```typescript
import {
  setupMockStorage,
  seedSpotifyToken,
  expectLocalStorageKey
} from './__tests__/fixtures'

it('saves token to storage', () => {
  setupMockStorage()

  // Perform action that saves token

  expectLocalStorageKey('spotify_token_data')
})
```

### 5. Testing OAuth Flow

```typescript
import { setupOAuthCallback, clearOAuthCallback } from './__tests__/fixtures'

it('handles OAuth callback', () => {
  setupOAuthCallback('test_token', 3600)

  // Trigger OAuth processing

  expect(localStorage.getItem('spotify_token_data')).toBeTruthy()

  clearOAuthCallback()
})
```

## Best Practices

### 1. Always Use setupTestEnvironment()

```typescript
beforeEach(() => {
  setupTestEnvironment() // ✅ Good
})

// Not:
beforeEach(() => {
  vi.clearAllMocks() // ❌ Incomplete
})
```

### 2. Use Factory Functions with Overrides

```typescript
// ✅ Good - Override only what you need
const track = buildTrack({ name: 'Test Track' })

// ❌ Bad - Manual object creation
const track = { id: '123', name: 'Test Track', artists: [...], album: {...} }
```

### 3. Use Pre-made Sequences for Common Scenarios

```typescript
// ✅ Good - Reuse pre-made sequences
mockChatStream(MOCK_EVENT_SEQUENCES.chatWithTool)

// ❌ Bad - Duplicate event sequences across tests
mockChatStream([
  mockThinkingEvent('...'),
  mockToolStartEvent('analyze_playlist', {}),
  // ... etc
])
```

### 4. Seed Storage Before Rendering

```typescript
// ✅ Good - Setup storage first
beforeEach(() => {
  setupTestEnvironment()
  seedSpotifyToken('test_token')
})

const { getByText } = render(<MyComponent />)

// ❌ Bad - Render before storage setup
const { getByText } = render(<MyComponent />)
seedSpotifyToken('test_token') // Too late!
```

## TypeScript Support

All fixtures are fully typed using types from `@dj/shared-types`. Enjoy full autocomplete and type safety:

```typescript
import { buildPlaylist } from './__tests__/fixtures'
import type { SpotifyPlaylist } from '@dj/shared-types'

const playlist: SpotifyPlaylist = buildPlaylist() // ✅ Type-safe
```

## Debugging

Use the debugging helpers when tests fail:

```typescript
import { logStorageState, logFetchCalls } from './__tests__/fixtures'

it('my test', () => {
  // ... test code ...

  // Debug storage
  logStorageState()

  // Debug fetch calls
  logFetchCalls()
})
```

## Contributing

When adding new fixtures:

1. **Add to appropriate file** - Group related mocks together
2. **Export from index.ts** - Make it easily importable
3. **Document with JSDoc** - Include examples
4. **Add TypeScript types** - Use shared types when possible
5. **Create factory functions** - Use builder pattern with overrides
6. **Add pre-made examples** - For common scenarios

## File Structure

```
apps/web/src/__tests__/fixtures/
├── index.ts              # Central exports
├── spotify-mocks.ts      # Spotify API mocks
├── sse-events.ts         # SSE streaming mocks
├── storage-mocks.ts      # localStorage/sessionStorage mocks
├── test-helpers.tsx      # React testing utilities
└── README.md            # This file
```

## Related Documentation

- **TESTING_PLAN.md** - Overall testing strategy
- **vitest.config.ts** - Vitest configuration
- **@dj/shared-types** - Shared TypeScript types

---

**Last Updated:** 2025-01-15
**Total Lines:** ~1,700 lines
**Coverage:** Comprehensive frontend mocking infrastructure
