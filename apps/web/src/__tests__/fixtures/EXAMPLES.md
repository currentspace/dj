# Test Fixtures - Usage Examples

Comprehensive examples demonstrating how to use the test fixture infrastructure.

## Table of Contents

1. [Basic Component Testing](#basic-component-testing)
2. [Authentication Testing](#authentication-testing)
3. [SSE Streaming Testing](#sse-streaming-testing)
4. [Storage Testing](#storage-testing)
5. [Spotify API Testing](#spotify-api-testing)
6. [Integration Testing](#integration-testing)

---

## Basic Component Testing

### Simple Component Render

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { setupTestEnvironment, renderWithProviders } from './__tests__/fixtures'
import { MyComponent } from '../components/MyComponent'

describe('MyComponent', () => {
  beforeEach(() => {
    setupTestEnvironment()
  })

  it('renders without crashing', () => {
    renderWithProviders(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

### Component with User Interaction

```typescript
import { clickElement, typeInInput, submitForm } from './__tests__/fixtures'

it('handles form submission', async () => {
  renderWithProviders(<LoginForm />)

  const input = screen.getByRole('textbox')
  const button = screen.getByRole('button')

  await typeInInput(input, 'test@example.com')
  await clickElement(button)

  expect(screen.getByText('Success')).toBeInTheDocument()
})
```

---

## Authentication Testing

### Testing with Valid Token

```typescript
import { renderWithAuth, mockUserProfile } from './__tests__/fixtures'

describe('Authenticated Component', () => {
  it('displays user info when authenticated', () => {
    const user = mockUserProfile({ display_name: 'John Doe' })

    renderWithAuth(<UserProfile />, {
      initialToken: 'valid_token',
      validateToken: true
    })

    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
```

### Testing Token Expiry

```typescript
import {
  setupMockStorage,
  seedExpiredToken,
  expectNoLocalStorageKey
} from './__tests__/fixtures'

it('clears expired token', async () => {
  setupMockStorage()
  seedExpiredToken()

  renderWithProviders(<App />)

  // Wait for token validation
  await waitFor(() => {
    expectNoLocalStorageKey('spotify_token_data')
  })

  expect(screen.getByText('Login')).toBeInTheDocument()
})
```

### Testing OAuth Callback

```typescript
import {
  setupOAuthCallback,
  clearOAuthCallback,
  expectLocalStorageKey
} from './__tests__/fixtures'

it('processes OAuth callback', async () => {
  setupOAuthCallback('new_token', 3600)

  renderWithProviders(<OAuthHandler />)

  await waitFor(() => {
    expectLocalStorageKey('spotify_token_data')
  })

  // Clean up
  clearOAuthCallback()
})
```

### Testing Legacy Token Migration

```typescript
import { setLegacyTokenInLocalStorage } from './__tests__/fixtures'

it('migrates legacy token format', async () => {
  setLegacyTokenInLocalStorage('old_token_format')

  renderWithAuth(<App />)

  // Should migrate to new format
  const tokenData = getMockTokenDataFromLocalStorage()
  expect(tokenData).toBeTruthy()
  expect(tokenData?.token).toBe('old_token_format')
  expect(tokenData?.createdAt).toBeDefined()
})
```

---

## SSE Streaming Testing

### Basic Chat Stream

```typescript
import {
  mockChatStream,
  mockThinkingEvent,
  mockContentEvent,
  mockDoneEvent
} from './__tests__/fixtures'

it('displays streaming response', async () => {
  mockChatStream([
    mockThinkingEvent('Processing your request...'),
    mockContentEvent('This is '),
    mockContentEvent('a streaming '),
    mockContentEvent('response!'),
    mockDoneEvent()
  ])

  renderWithAuth(<ChatInterface />)

  await typeInInput(screen.getByRole('textbox'), 'Hello')
  await clickElement(screen.getByRole('button', { name: 'Send' }))

  // Wait for thinking indicator
  await waitFor(() => {
    expect(screen.getByText('Processing your request...')).toBeInTheDocument()
  })

  // Wait for full response
  await waitFor(() => {
    expect(screen.getByText(/This is a streaming response/)).toBeInTheDocument()
  })
})
```

### Testing Tool Execution

```typescript
import {
  mockToolStartEvent,
  mockToolEndEvent,
  MOCK_EVENT_SEQUENCES
} from './__tests__/fixtures'

it('shows tool execution progress', async () => {
  mockChatStream([
    mockThinkingEvent('Analyzing your playlist...'),
    mockToolStartEvent('analyze_playlist', { playlist_id: 'test123' }),
    mockToolEndEvent('analyze_playlist', {
      total_tracks: 50,
      avg_popularity: 75
    }),
    mockContentEvent('Your playlist has 50 tracks with average popularity of 75.'),
    mockDoneEvent()
  ])

  renderWithAuth(<ChatInterface />)

  // Send message
  await typeInInput(screen.getByRole('textbox'), 'Analyze my playlist')
  await submitForm(screen.getByRole('form'))

  // Check tool indicator appears
  await waitFor(() => {
    expect(screen.getByText(/analyze_playlist/)).toBeInTheDocument()
  })
})
```

### Testing Pre-made Event Sequences

```typescript
import { MOCK_EVENT_SEQUENCES } from './__tests__/fixtures'

it('handles basic chat sequence', async () => {
  mockChatStream(MOCK_EVENT_SEQUENCES.basicChat)
  // Test behavior
})

it('handles chat with tool', async () => {
  mockChatStream(MOCK_EVENT_SEQUENCES.chatWithTool)
  // Test behavior
})

it('handles multi-tool sequence', async () => {
  mockChatStream(MOCK_EVENT_SEQUENCES.multiTool)
  // Test behavior
})
```

### Testing Stream Errors

```typescript
import { mockErrorEvent, MOCK_EVENT_SEQUENCES } from './__tests__/fixtures'

it('displays error message', async () => {
  mockChatStream(MOCK_EVENT_SEQUENCES.chatWithError)

  renderWithAuth(<ChatInterface />)

  await typeInInput(screen.getByRole('textbox'), 'Test')
  await clickElement(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => {
    expect(screen.getByText(/Failed to connect/)).toBeInTheDocument()
  })
})
```

---

## Storage Testing

### Testing Storage Operations

```typescript
import {
  setupMockStorage,
  seedLocalStorage,
  getLocalStorageJSON
} from './__tests__/fixtures'

it('saves data to localStorage', () => {
  setupMockStorage()

  const component = renderWithProviders(<SettingsForm />)

  // User changes settings
  // ...

  const settings = getLocalStorageJSON('user_settings')
  expect(settings).toEqual({
    theme: 'dark',
    volume: 0.8
  })
})
```

### Testing Cross-Tab Synchronization

```typescript
import { triggerStorageEvent } from './__tests__/fixtures'

it('syncs token across tabs', async () => {
  renderWithAuth(<App />)

  // Simulate token change in another tab
  const newToken = JSON.stringify({
    token: 'new_token',
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000
  })

  triggerStorageEvent('spotify_token_data', newToken, null)

  // Component should update
  await waitFor(() => {
    expect(screen.getByText(/new_token/)).toBeInTheDocument()
  })
})
```

### Testing Storage Spy

```typescript
import { createStorageSpy } from './__tests__/fixtures'

it('tracks storage operations', () => {
  const { storage, getCalls } = createStorageSpy()

  // Replace global storage temporarily
  Object.defineProperty(window, 'localStorage', { value: storage })

  renderWithProviders(<MyComponent />)

  // Check storage calls
  const setItemCalls = getCalls().filter(call => call.method === 'setItem')
  expect(setItemCalls).toHaveLength(2)
})
```

### Testing Storage Scenarios

```typescript
import { STORAGE_SCENARIOS } from './__tests__/fixtures'

describe('Storage Scenarios', () => {
  it('handles authenticated state', () => {
    STORAGE_SCENARIOS.authenticated()
    renderWithProviders(<App />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('handles empty state', () => {
    STORAGE_SCENARIOS.empty()
    renderWithProviders(<App />)
    expect(screen.getByText('Login')).toBeInTheDocument()
  })

  it('handles expired token', () => {
    STORAGE_SCENARIOS.expired()
    renderWithProviders(<App />)
    expect(screen.getByText('Session Expired')).toBeInTheDocument()
  })
})
```

---

## Spotify API Testing

### Testing User Profile Fetch

```typescript
import { mockSpotifyAPI, mockUserProfile } from './__tests__/fixtures'

it('fetches user profile', async () => {
  const user = mockUserProfile({ display_name: 'Jane Doe' })
  mockSpotifyAPI('/me', user)

  renderWithAuth(<UserProfile />)

  await waitFor(() => {
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })
})
```

### Testing Playlist Operations

```typescript
import { buildPlaylist, mockSpotifyAPI } from './__tests__/fixtures'

it('loads user playlists', async () => {
  const playlists = [
    buildPlaylist({ name: 'Workout' }),
    buildPlaylist({ name: 'Chill' }),
    buildPlaylist({ name: 'Study' })
  ]

  mockSpotifyAPI('/me/playlists', {
    items: playlists,
    total: 3
  })

  renderWithAuth(<PlaylistList />)

  await waitFor(() => {
    expect(screen.getByText('Workout')).toBeInTheDocument()
    expect(screen.getByText('Chill')).toBeInTheDocument()
    expect(screen.getByText('Study')).toBeInTheDocument()
  })
})
```

### Testing with Comprehensive Mocks

```typescript
import { setupSpotifyMocks } from './__tests__/fixtures'

it('loads all Spotify data', async () => {
  const { mockMe, mockPlaylists } = setupSpotifyMocks()

  renderWithAuth(<Dashboard />)

  await waitFor(() => {
    expect(mockMe).toHaveBeenCalled()
    expect(mockPlaylists).toHaveBeenCalled()
  })
})
```

### Testing API Errors

```typescript
import { mockFetchError } from './__tests__/fixtures'

it('handles API error', async () => {
  mockFetchError(500, 'Internal Server Error')

  renderWithAuth(<PlaylistList />)

  await waitFor(() => {
    expect(screen.getByText(/Error loading playlists/)).toBeInTheDocument()
  })
})
```

### Testing Network Errors

```typescript
import { mockFetchReject } from './__tests__/fixtures'

it('handles network error', async () => {
  mockFetchReject('Network request failed')

  renderWithAuth(<UserProfile />)

  await waitFor(() => {
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })
})
```

---

## Integration Testing

### Full Auth Flow

```typescript
import {
  setupTestEnvironment,
  setupOAuthCallback,
  clearOAuthCallback,
  mockAuthFlow
} from './__tests__/fixtures'

describe('Full Authentication Flow', () => {
  beforeEach(() => {
    setupTestEnvironment()
  })

  it('completes OAuth flow end-to-end', async () => {
    // 1. User clicks login
    renderWithProviders(<App />)
    await clickElement(screen.getByRole('button', { name: 'Login' }))

    // 2. Simulate OAuth redirect (mocked)
    setupOAuthCallback('test_token', 3600)

    // 3. Mock token validation
    mockAuthFlow('test_token')

    // 4. Reload component to process callback
    renderWithAuth(<App />)

    // 5. Verify authenticated state
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })

    // Cleanup
    clearOAuthCallback()
  })
})
```

### Chat Flow with Playlist Selection

```typescript
import {
  renderWithPlaylist,
  buildPlaylist,
  mockChatStream,
  MOCK_EVENT_SEQUENCES
} from './__tests__/fixtures'

it('analyzes selected playlist', async () => {
  // Setup
  const playlist = buildPlaylist({
    id: 'test_playlist',
    name: 'My Test Playlist',
    tracks: { total: 50 }
  })

  mockChatStream(MOCK_EVENT_SEQUENCES.chatWithTool)

  const { playlist: selected } = renderWithPlaylist(<ChatInterface />, {
    playlist
  })

  // User sends message
  await typeInInput(screen.getByRole('textbox'), 'Analyze this playlist')
  await submitForm(screen.getByRole('form'))

  // Verify playlist ID injected
  await waitFor(() => {
    expect(screen.getByText(/Playlist ID: test_playlist/)).toBeInTheDocument()
  })

  // Verify analysis displayed
  await waitFor(() => {
    expect(screen.getByText(/average popularity of 75/)).toBeInTheDocument()
  })
})
```

### Multi-Component Integration

```typescript
import {
  setupTestEnvironment,
  renderWithAuth,
  mockSpotifyAPI,
  buildPlaylist
} from './__tests__/fixtures'

describe('App Integration', () => {
  beforeEach(() => {
    setupTestEnvironment()
  })

  it('loads all data and navigates', async () => {
    // Mock all endpoints
    mockSpotifyAPI('/me', mockUserProfile({ display_name: 'Test User' }))
    mockSpotifyAPI('/me/playlists', {
      items: [buildPlaylist({ name: 'Test Playlist' })],
      total: 1
    })

    // Render full app
    renderWithAuth(<App />)

    // Wait for user info
    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    // Click on playlist
    await clickElement(screen.getByText('Test Playlist'))

    // Verify navigation
    expect(screen.getByText(/Selected: Test Playlist/)).toBeInTheDocument()
  })
})
```

---

## Advanced Patterns

### Custom Event Sequences

```typescript
import {
  mockChatStream,
  mockThinkingEvent,
  mockToolStartEvent,
  mockToolEndEvent,
  mockContentEvent,
  mockDoneEvent
} from './__tests__/fixtures'

it('handles complex multi-tool workflow', async () => {
  const events = [
    mockThinkingEvent('Starting analysis...'),

    // Tool 1: Analyze playlist
    mockToolStartEvent('analyze_playlist', { playlist_id: 'abc' }),
    mockToolEndEvent('analyze_playlist', { total_tracks: 50 }),

    // Tool 2: Extract vibe
    mockToolStartEvent('extract_playlist_vibe', { analysis_data: {} }),
    mockToolEndEvent('extract_playlist_vibe', { vibe_profile: 'energetic' }),

    // Tool 3: Get recommendations
    mockToolStartEvent('get_recommendations', { seed_tracks: [] }),
    mockToolEndEvent('get_recommendations', { tracks: [] }),

    mockContentEvent('Based on your playlist, I found some great recommendations!'),
    mockDoneEvent()
  ]

  mockChatStream(events, 50) // 50ms delay between events
  // Test behavior
})
```

### Testing Abort Signals

```typescript
import { createAbortError } from './__tests__/fixtures'

it('handles request cancellation', async () => {
  const abortError = createAbortError()
  mockFetchReject(abortError)

  renderWithAuth(<ChatInterface />)

  await typeInInput(screen.getByRole('textbox'), 'Test')
  await clickElement(screen.getByRole('button', { name: 'Send' }))

  // Cancel request
  await clickElement(screen.getByRole('button', { name: 'Cancel' }))

  // Should show cancelled state, not error
  expect(screen.queryByText(/Error/)).not.toBeInTheDocument()
})
```

### Debugging Failed Tests

```typescript
import { logStorageState, logFetchCalls } from './__tests__/fixtures'

it('complex test that might fail', async () => {
  // ... test code ...

  // Add debugging when test fails
  if (screen.queryByText('Expected Text') === null) {
    console.log('=== Test failed, debugging info: ===')
    logStorageState()
    logFetchCalls()
  }
})
```

---

## Tips and Best Practices

### 1. Always Clean Up

```typescript
import { setupTestEnvironment, cleanupTestEnvironment } from './__tests__/fixtures'

describe('MyTests', () => {
  beforeEach(() => {
    setupTestEnvironment()
  })

  afterEach(() => {
    cleanupTestEnvironment()
  })
})
```

### 2. Use Factory Functions

```typescript
// ✅ Good
const tracks = buildMockTracks(10).map((track, i) =>
  buildTrack({ ...track, name: `Track ${i + 1}` })
)

// ❌ Bad
const tracks = Array.from({ length: 10 }, (_, i) => ({
  id: `track_${i}`,
  name: `Track ${i + 1}`,
  // ... manual object construction
}))
```

### 3. Reuse Pre-made Data

```typescript
import { MOCK_TRACKS, MOCK_PLAYLISTS, MOCK_ARTISTS } from './__tests__/fixtures'

// Use pre-made data when possible
const playlist = MOCK_PLAYLISTS.workoutMix
const track = MOCK_TRACKS.aroundTheWorld
const artist = MOCK_ARTISTS.daftPunk
```

### 4. Test Edge Cases

```typescript
import { buildEmptyPlaylist, buildLargePlaylist } from './__tests__/fixtures'

it('handles empty playlist', () => {
  const playlist = buildEmptyPlaylist()
  // Test behavior
})

it('handles large playlist', () => {
  const playlist = buildLargePlaylist(500)
  // Test behavior
})
```

---

**Last Updated:** 2025-01-15
**See Also:** [README.md](./README.md) for full API documentation
