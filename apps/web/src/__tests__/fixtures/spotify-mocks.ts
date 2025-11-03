/**
 * Spotify API Mock Data and Factory Functions
 * Provides comprehensive mock data for Spotify objects (tokens, users, playlists, tracks, albums, artists)
 */

import type {SpotifyPlaylist, SpotifyTrack, SpotifyUser} from '@dj/shared-types'

// ============================================================================
// TOKEN MOCKS
// ============================================================================

export interface MockTokenData {
  createdAt: number
  expiresAt: null | number
  token: string
}

/**
 * Create a mock Spotify token with optional expiry
 * @param expiresInMs - Optional expiry time in milliseconds from now (null = no expiry)
 */
export function mockSpotifyToken(expiresInMs: null | number = 3600000): MockTokenData {
  const now = Date.now()
  return {
    createdAt: now,
    expiresAt: expiresInMs ? now + expiresInMs : null,
    token: `mock_access_token_${Math.random().toString(36).slice(2)}`,
  }
}

/**
 * Create an expired token (expired 1 hour ago)
 */
export function mockExpiredToken(): MockTokenData {
  const now = Date.now()
  const oneHourAgo = now - 3600000
  return {
    createdAt: oneHourAgo - 3600000,
    expiresAt: oneHourAgo,
    token: 'expired_token_abc123',
  }
}

/**
 * Create a legacy token (old format without metadata)
 */
export function mockLegacyToken(): string {
  return `legacy_token_${Math.random().toString(36).slice(2)}`
}

// ============================================================================
// USER MOCKS
// ============================================================================

/**
 * Create a mock Spotify user profile
 */
export function mockUserProfile(overrides?: Partial<SpotifyUser>): SpotifyUser {
  return {
    display_name: 'Test User',
    email: 'testuser@example.com',
    id: 'user123',
    images: [
      {
        height: 300,
        url: 'https://i.scdn.co/image/ab6775700000ee85mock',
        width: 300,
      },
    ],
    ...overrides,
  }
}

// ============================================================================
// ARTIST MOCKS
// ============================================================================

export interface MockArtist {
  id: string
  name: string
}

/**
 * Create a mock artist
 */
export function mockArtist(overrides?: Partial<MockArtist>): MockArtist {
  return {
    id: `artist_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Artist',
    ...overrides,
  }
}

/**
 * Collection of pre-made artists for variety
 */
export const MOCK_ARTISTS = {
  daftPunk: mockArtist({id: 'artist_daft_punk', name: 'Daft Punk'}),
  radiohead: mockArtist({id: 'artist_radiohead', name: 'Radiohead'}),
  taylorSwift: mockArtist({id: 'artist_taylor_swift', name: 'Taylor Swift'}),
  theWeeknd: mockArtist({id: 'artist_the_weeknd', name: 'The Weeknd'}),
}

// ============================================================================
// ALBUM MOCKS
// ============================================================================

export interface MockAlbum {
  id: string
  images: {height: number; url: string; width: number}[]
  name: string
}

/**
 * Create a mock album
 */
export function mockAlbum(overrides?: Partial<MockAlbum>): MockAlbum {
  return {
    id: `album_${Math.random().toString(36).slice(2, 8)}`,
    images: [
      {
        height: 640,
        url: 'https://i.scdn.co/image/ab67616d0000b273mock',
        width: 640,
      },
      {
        height: 300,
        url: 'https://i.scdn.co/image/ab67616d00001e02mock',
        width: 300,
      },
      {
        height: 64,
        url: 'https://i.scdn.co/image/ab67616d00004851mock',
        width: 64,
      },
    ],
    name: 'Test Album',
    ...overrides,
  }
}

// ============================================================================
// TRACK MOCKS
// ============================================================================

/**
 * Build a mock Spotify track with sensible defaults
 * @param overrides - Partial track properties to override
 * @returns Complete SpotifyTrack object
 */
export function buildTrack(overrides?: Partial<SpotifyTrack>): SpotifyTrack {
  const trackId = overrides?.id || `track_${Math.random().toString(36).slice(2, 8)}`
  const trackName = overrides?.name || 'Test Track'

  return {
    album: mockAlbum({name: 'Test Album'}),
    artists: [mockArtist({name: 'Test Artist'})],
    external_urls: {spotify: `https://open.spotify.com/track/${trackId}`},
    id: trackId,
    name: trackName,
    preview_url: `https://p.scdn.co/mp3-preview/${trackId}`,
    uri: `spotify:track:${trackId}`,
    ...overrides,
  }
}

/**
 * Create a track without preview URL (common scenario)
 */
export function buildTrackNoPreview(overrides?: Partial<SpotifyTrack>): SpotifyTrack {
  return buildTrack({
    ...overrides,
    preview_url: null,
  })
}

/**
 * Collection of pre-made tracks for testing
 */
export const MOCK_TRACKS = {
  aroundTheWorld: buildTrack({
    album: mockAlbum({id: 'album_homework', name: 'Homework'}),
    artists: [MOCK_ARTISTS.daftPunk],
    id: 'track_around_the_world',
    name: 'Around the World',
  }),

  blankSpace: buildTrack({
    album: mockAlbum({id: 'album_1989', name: '1989'}),
    artists: [MOCK_ARTISTS.taylorSwift],
    id: 'track_blank_space',
    name: 'Blank Space',
  }),

  blindingLights: buildTrack({
    album: mockAlbum({id: 'album_after_hours', name: 'After Hours'}),
    artists: [MOCK_ARTISTS.theWeeknd],
    id: 'track_blinding_lights',
    name: 'Blinding Lights',
  }),

  karma: buildTrack({
    album: mockAlbum({id: 'album_ok_computer', name: 'OK Computer'}),
    artists: [MOCK_ARTISTS.radiohead],
    id: 'track_karma',
    name: 'Karma Police',
  }),
}

/**
 * Generate an array of mock tracks
 * @param count - Number of tracks to generate
 * @returns Array of tracks with unique IDs
 */
export function buildMockTracks(count: number): SpotifyTrack[] {
  return Array.from({length: count}, (_, i) =>
    buildTrack({
      id: `track_${i + 1}`,
      name: `Track ${i + 1}`,
    }),
  )
}

// ============================================================================
// PLAYLIST MOCKS
// ============================================================================

/**
 * Build a mock Spotify playlist with sensible defaults
 * @param overrides - Partial playlist properties to override
 * @returns Complete SpotifyPlaylist object
 */
export function buildPlaylist(overrides?: Partial<SpotifyPlaylist>): SpotifyPlaylist {
  const playlistId = overrides?.id || `playlist_${Math.random().toString(36).slice(2, 8)}`

  return {
    description: 'A test playlist for unit testing',
    external_urls: {spotify: `https://open.spotify.com/playlist/${playlistId}`},
    id: playlistId,
    images: [
      {
        height: 640,
        url: 'https://mosaic.scdn.co/640/mock',
        width: 640,
      },
    ],
    name: 'Test Playlist',
    owner: {display_name: 'Test User'},
    public: true,
    tracks: {total: 10},
    ...overrides,
  }
}

/**
 * Create a playlist with many tracks
 */
export function buildLargePlaylist(trackCount: number = 100): SpotifyPlaylist {
  return buildPlaylist({
    description: `Large playlist with ${trackCount} tracks`,
    name: 'Large Test Playlist',
    tracks: {total: trackCount},
  })
}

/**
 * Create an empty playlist
 */
export function buildEmptyPlaylist(): SpotifyPlaylist {
  return buildPlaylist({
    description: 'Empty playlist',
    name: 'Empty Playlist',
    tracks: {total: 0},
  })
}

/**
 * Collection of pre-made playlists for testing
 */
export const MOCK_PLAYLISTS = {
  chillVibes: buildPlaylist({
    description: 'Chill electronic vibes',
    id: 'playlist_chill_vibes',
    name: 'Chill Vibes',
    tracks: {total: 25},
  }),

  empty: buildEmptyPlaylist(),

  large: buildLargePlaylist(150),

  rockClassics: buildPlaylist({
    description: 'Classic rock anthems',
    id: 'playlist_rock_classics',
    name: 'Rock Classics',
    tracks: {total: 50},
  }),

  workoutMix: buildPlaylist({
    description: 'High energy workout music',
    id: 'playlist_workout',
    name: 'Workout Mix',
    tracks: {total: 30},
  }),
}

// ============================================================================
// API RESPONSE MOCKS
// ============================================================================

/**
 * Mock Spotify API responses for fetch interception
 */
export const MOCK_SPOTIFY_RESPONSES = {
  /**
   * Mock /me endpoint response
   */
  currentUser: (user?: Partial<SpotifyUser>) => ({
    json: async () => mockUserProfile(user),
    ok: true,
    status: 200,
  }),

  /**
   * Mock 401 Unauthorized response
   */
  unauthorized: () => ({
    json: async () => ({error: {message: 'Invalid access token', status: 401}}),
    ok: false,
    status: 401,
  }),

  /**
   * Mock user playlists endpoint
   */
  userPlaylists: (playlists: SpotifyPlaylist[] = Object.values(MOCK_PLAYLISTS)) => ({
    json: async () => ({
      items: playlists,
      limit: 50,
      next: null,
      offset: 0,
      previous: null,
      total: playlists.length,
    }),
    ok: true,
    status: 200,
  }),
}

// ============================================================================
// FACTORY UTILITIES
// ============================================================================

/**
 * Seed localStorage with a valid Spotify token
 */
export function seedSpotifyToken(token?: MockTokenData): void {
  const tokenData = token || mockSpotifyToken()
  localStorage.setItem('spotify_token_data', JSON.stringify(tokenData))
}

/**
 * Seed localStorage with an expired token
 */
export function seedExpiredToken(): void {
  seedSpotifyToken(mockExpiredToken())
}

/**
 * Clear all Spotify-related localStorage items
 */
export function clearSpotifyStorage(): void {
  localStorage.removeItem('spotify_token_data')
  localStorage.removeItem('spotify_token') // Legacy cleanup
}
