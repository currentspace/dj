/**
 * Mock data for E2E tests
 * Provides consistent test data across all test files
 */

// ============================================================================
// AUTH MOCKS
// ============================================================================

export const MOCK_TOKEN = 'mock_e2e_test_token_abc123'
export const MOCK_EXPIRED_TOKEN = 'expired_token_xyz789'

export function createTokenData(token: string, expiresInMs: number = 3600000) {
  return {
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInMs,
    token,
  }
}

export function createExpiredTokenData(token: string = MOCK_EXPIRED_TOKEN) {
  return {
    createdAt: Date.now() - 7200000, // 2 hours ago
    expiresAt: Date.now() - 3600000, // 1 hour ago
    token,
  }
}

// ============================================================================
// USER MOCKS
// ============================================================================

export const MOCK_USER = {
  display_name: 'E2E Test User',
  email: 'e2e-test@example.com',
  id: 'e2e_user_123',
  images: [
    {
      height: 300,
      url: 'https://i.scdn.co/image/mock-user-avatar',
      width: 300,
    },
  ],
}

// ============================================================================
// PLAYLIST MOCKS
// ============================================================================

export const MOCK_PLAYLISTS = {
  items: [
    {
      description: 'High energy workout music',
      external_urls: {spotify: 'https://open.spotify.com/playlist/workout123'},
      id: 'playlist_workout_123',
      images: [{height: 640, url: 'https://mosaic.scdn.co/640/workout', width: 640}],
      name: 'Workout Mix',
      owner: {display_name: 'E2E Test User'},
      public: true,
      tracks: {total: 50},
    },
    {
      description: 'Relaxing evening vibes',
      external_urls: {spotify: 'https://open.spotify.com/playlist/chill456'},
      id: 'playlist_chill_456',
      images: [{height: 640, url: 'https://mosaic.scdn.co/640/chill', width: 640}],
      name: 'Chill Vibes',
      owner: {display_name: 'E2E Test User'},
      public: true,
      tracks: {total: 30},
    },
    {
      description: 'Focus and productivity',
      external_urls: {spotify: 'https://open.spotify.com/playlist/focus789'},
      id: 'playlist_focus_789',
      images: [{height: 640, url: 'https://mosaic.scdn.co/640/focus', width: 640}],
      name: 'Deep Focus',
      owner: {display_name: 'E2E Test User'},
      public: false,
      tracks: {total: 25},
    },
  ],
  limit: 50,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
}

// Empty playlists response
export const MOCK_EMPTY_PLAYLISTS = {
  items: [],
  limit: 50,
  next: null,
  offset: 0,
  previous: null,
  total: 0,
}

// ============================================================================
// TRACK MOCKS
// ============================================================================

export const MOCK_TRACKS = [
  {
    album: {
      id: 'album_1',
      images: [{height: 640, url: 'https://i.scdn.co/image/album1', width: 640}],
      name: 'Test Album 1',
    },
    artists: [{id: 'artist_1', name: 'Test Artist 1'}],
    external_urls: {spotify: 'https://open.spotify.com/track/track1'},
    id: 'track_1',
    name: 'Test Track 1',
    preview_url: 'https://p.scdn.co/mp3-preview/track1',
    uri: 'spotify:track:track_1',
  },
  {
    album: {
      id: 'album_2',
      images: [{height: 640, url: 'https://i.scdn.co/image/album2', width: 640}],
      name: 'Test Album 2',
    },
    artists: [{id: 'artist_2', name: 'Test Artist 2'}],
    external_urls: {spotify: 'https://open.spotify.com/track/track2'},
    id: 'track_2',
    name: 'Test Track 2',
    preview_url: 'https://p.scdn.co/mp3-preview/track2',
    uri: 'spotify:track:track_2',
  },
]

// ============================================================================
// PLAYLIST ANALYSIS MOCKS
// ============================================================================

export const MOCK_PLAYLIST_ANALYSIS = {
  deezer_analysis: {
    bpm: {avg: 120, range: {max: 140, min: 100}, sample_size: 50},
    gain: {avg: -8.5, range: {max: -5, min: -12}, sample_size: 50},
    rank: {avg: 50000, range: {max: 100000, min: 10000}, sample_size: 50},
    source: 'deezer',
    total_checked: 50,
    tracks_found: 45,
  },
  lastfm_analysis: {
    artists_enriched: 15,
    avg_listeners: 500000,
    avg_playcount: 2000000,
    crowd_tags: [
      {count: 30, tag: 'electronic'},
      {count: 25, tag: 'dance'},
      {count: 20, tag: 'house'},
    ],
    sample_size: 50,
    similar_tracks: ['Artist A - Track X', 'Artist B - Track Y'],
    source: 'lastfm',
  },
  message: 'Analysis complete',
  metadata_analysis: {
    avg_duration_minutes: 3.5,
    avg_duration_ms: 210000,
    avg_popularity: 75,
    explicit_percentage: 10,
    explicit_tracks: 5,
    release_year_range: {average: 2020, newest: 2024, oldest: 2015},
    top_genres: ['pop', 'electronic', 'dance'],
    total_artists: 25,
  },
  playlist_description: 'High energy workout music',
  playlist_name: 'Workout Mix',
  total_tracks: 50,
  track_ids: ['spotify:track:track_1', 'spotify:track:track_2'],
}

// ============================================================================
// SSE STREAM MOCKS
// ============================================================================

/**
 * Create a mock SSE response body
 */
export function createMockSSEBody(events: Array<{data: unknown; type: string}>): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

export const MOCK_SSE_EVENTS = {
  basicChat: [
    {data: 'Processing your request...', type: 'thinking'},
    {data: 'This is a test response ', type: 'content'},
    {data: 'from the AI assistant.', type: 'content'},
    {data: null, type: 'done'},
  ],

  chatWithError: [
    {data: 'Processing your request...', type: 'thinking'},
    {data: 'Failed to process request', type: 'error'},
    {data: null, type: 'done'},
  ],

  chatWithTool: [
    {data: 'Analyzing your playlist...', type: 'thinking'},
    {data: {args: {playlist_id: 'playlist_workout_123'}, tool: 'analyze_playlist'}, type: 'tool_start'},
    {data: {message: 'Fetching playlist metadata'}, type: 'log'},
    {data: {result: MOCK_PLAYLIST_ANALYSIS, tool: 'analyze_playlist'}, type: 'tool_end'},
    {data: 'Your playlist "Workout Mix" has 50 tracks ', type: 'content'},
    {data: 'with an average BPM of 120.', type: 'content'},
    {data: null, type: 'done'},
  ],
}

// ============================================================================
// API ROUTE PATTERNS
// ============================================================================

export const API_ROUTES = {
  authUrl: '/api/spotify/auth-url',
  chatStream: '/api/chat-stream/message',
  me: '/api/spotify/me',
  playlists: '/api/spotify/playlists',
}
