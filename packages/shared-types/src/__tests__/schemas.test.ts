/**
 * Comprehensive Zod schema validation tests for all shared types
 * Tests 20 different schema categories across Spotify, SSE, external APIs, and internal APIs
 */

import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {
  ChatRequestSchema,
  PlaylistSchema,
  SavePlaylistResponseSchema,
  TrackSchema,
} from '../schemas/api-schemas'
import {
  DeezerTrackSchema,
  EnrichedTrackDataSchema,
  LastFmSimilarTrackSchema,
  LastFmTrackInfoSchema,
  MusicBrainzRecordingSchema,
} from '../schemas/external-api-schemas'
// Import all schemas
import {
  SpotifyAlbumFullSchema,
  SpotifyArtistFullSchema,
  SpotifyAudioFeaturesSchema,
  SpotifyPlaylistFullSchema,
  SpotifyRecommendationsResponseSchema,
  SpotifySearchResponseSchema,
  SpotifyTrackFullSchema,
  SpotifyUserSchema,
} from '../schemas/spotify-schemas'
import {
  StreamContentEventSchema,
  StreamErrorEventSchema,
  StreamEventSchema,
  StreamToolStartEventSchema,
} from '../schemas/sse-schemas'

// ===== Helper Functions =====

function expectSchemaToFail<T>(schema: z.ZodSchema<T>, data: unknown, description?: string) {
  const result = schema.safeParse(data)
  if (result.success) {
    throw new Error(
      `Schema validation should have failed${description ? `: ${description}` : ''}\nData: ${JSON.stringify(data)}`,
    )
  }
  expect(result.success).toBe(false)
}

function expectSchemaToPass<T>(schema: z.ZodSchema<T>, data: unknown, description?: string) {
  try {
    schema.parse(data)
  } catch (error) {
    throw new Error(
      `Schema validation failed${description ? `: ${description}` : ''}\nData: ${JSON.stringify(data)}\nError: ${error}`,
    )
  }
  const result = schema.safeParse(data)
  expect(result.success).toBe(true)
}

// ===== 1. Spotify Schemas Tests (8 tests) =====

describe('Spotify Schemas', () => {
  it('SpotifyTrackFull validates valid track object', () => {
    const track = {
      album: {
        album_type: 'album' as const,
        artists: [
          {
            external_urls: {
              spotify: 'https://open.spotify.com/artist/artist1',
            },
            href: 'https://api.spotify.com/v1/artists/artist1',
            id: 'artist1',
            name: 'Artist Name',
            type: 'artist' as const,
            uri: 'spotify:artist:artist1',
          },
        ],
        external_urls: {
          spotify: 'https://open.spotify.com/album/album1',
        },
        href: 'https://api.spotify.com/v1/albums/album1',
        id: 'album1',
        images: [
          {
            height: 640,
            url: 'https://example.com/image.jpg',
            width: 640,
          },
        ],
        name: 'Album Name',
        release_date: '2023-01-15',
        release_date_precision: 'day' as const,
        total_tracks: 12,
        type: 'album' as const,
        uri: 'spotify:album:album1',
      },
      artists: [
        {
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist1',
          },
          href: 'https://api.spotify.com/v1/artists/artist1',
          id: 'artist1',
          name: 'Artist Name',
          type: 'artist' as const,
          uri: 'spotify:artist:artist1',
        },
      ],
      disc_number: 1,
      duration_ms: 180000,
      explicit: false,
      external_ids: {
        isrc: 'USRC17607839',
      },
      external_urls: {
        spotify: 'https://open.spotify.com/track/track123',
      },
      href: 'https://api.spotify.com/v1/tracks/track123',
      id: 'track123',
      is_local: false,
      name: 'Song Name',
      popularity: 75,
      preview_url: 'https://example.com/preview.mp3',
      track_number: 1,
      type: 'track' as const,
      uri: 'spotify:track:track123',
    }

    expectSchemaToPass(SpotifyTrackFullSchema, track)
  })

  it('SpotifyTrackFull rejects invalid track (missing required fields)', () => {
    const invalid = {
      id: 123,
      name: null,
    }

    expectSchemaToFail(SpotifyTrackFullSchema, invalid)
  })

  it('SpotifyPlaylistFull validates valid playlist', () => {
    const playlist = {
      collaborative: false,
      description: 'A great playlist',
      external_urls: {
        spotify: 'https://open.spotify.com/playlist/playlist123',
      },
      followers: {
        href: null,
        total: 100,
      },
      href: 'https://api.spotify.com/v1/playlists/playlist123',
      id: 'playlist123',
      images: [
        {
          height: 640,
          url: 'https://example.com/image.jpg',
          width: 640,
        },
      ],
      name: 'My Playlist',
      owner: {
        display_name: 'User Name',
        external_urls: {
          spotify: 'https://open.spotify.com/user/user1',
        },
        href: 'https://api.spotify.com/v1/users/user1',
        id: 'user1',
        type: 'user' as const,
        uri: 'spotify:user:user1',
      },
      public: true,
      snapshot_id: 'snapshot123',
      tracks: {
        href: 'https://api.spotify.com/v1/playlists/playlist123/tracks',
        items: [],
        limit: 20,
        next: 'https://api.spotify.com/v1/playlists/playlist123/tracks?offset=20',
        offset: 0,
        previous: null,
        total: 50,
      },
      type: 'playlist' as const,
      uri: 'spotify:playlist:playlist123',
    }

    expectSchemaToPass(SpotifyPlaylistFullSchema, playlist)
  })

  it('SpotifyUser validates valid user object', () => {
    const user = {
      display_name: 'John Doe',
      email: 'john@example.com',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user123',
      },
      href: 'https://api.spotify.com/v1/users/user123',
      id: 'user123',
      images: [
        {
          height: 300,
          url: 'https://example.com/image.jpg',
          width: 300,
        },
      ],
      type: 'user' as const,
      uri: 'spotify:user:user123',
    }

    expectSchemaToPass(SpotifyUserSchema, user)
  })

  it('SpotifyAudioFeatures validates audio characteristics', () => {
    const features = {
      acousticness: 0.2,
      analysis_url: 'https://api.spotify.com/v1/audio-analysis/track123',
      danceability: 0.7,
      duration_ms: 180000,
      energy: 0.8,
      id: 'track123',
      instrumentalness: 0.1,
      key: 0,
      liveness: 0.15,
      loudness: -5.0,
      mode: 1,
      speechiness: 0.05,
      tempo: 120.5,
      time_signature: 4,
      track_href: 'https://api.spotify.com/v1/tracks/track123',
      type: 'audio_features' as const,
      uri: 'spotify:track:track123',
      valence: 0.6,
    }

    expectSchemaToPass(SpotifyAudioFeaturesSchema, features)
  })

  it('SpotifyArtistFull validates complete artist object', () => {
    const artist = {
      external_urls: {
        spotify: 'https://open.spotify.com/artist/artist123',
      },
      followers: {
        href: null,
        total: 1000000,
      },
      genres: ['rock', 'alternative'],
      href: 'https://api.spotify.com/v1/artists/artist123',
      id: 'artist123',
      images: [
        {
          height: 640,
          url: 'https://example.com/image.jpg',
          width: 640,
        },
      ],
      name: 'Artist Name',
      popularity: 85,
      type: 'artist' as const,
      uri: 'spotify:artist:artist123',
    }

    expectSchemaToPass(SpotifyArtistFullSchema, artist)
  })

  it('SpotifyAlbumFull validates complete album object', () => {
    const album = {
      album_type: 'album' as const,
      artists: [
        {
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist1',
          },
          href: 'https://api.spotify.com/v1/artists/artist1',
          id: 'artist1',
          name: 'Artist Name',
          type: 'artist' as const,
          uri: 'spotify:artist:artist1',
        },
      ],
      external_urls: {
        spotify: 'https://open.spotify.com/album/album123',
      },
      genres: ['rock'],
      href: 'https://api.spotify.com/v1/albums/album123',
      id: 'album123',
      images: [
        {
          height: 640,
          url: 'https://example.com/image.jpg',
          width: 640,
        },
      ],
      name: 'Album Name',
      popularity: 80,
      release_date: '2023-01-15',
      release_date_precision: 'day' as const,
      total_tracks: 12,
      tracks: {
        href: 'https://api.spotify.com/v1/albums/album123/tracks',
        items: [],
        limit: 20,
        next: null,
        offset: 0,
        previous: null,
        total: 12,
      },
      type: 'album' as const,
      uri: 'spotify:album:album123',
    }

    expectSchemaToPass(SpotifyAlbumFullSchema, album)
  })

  it('SpotifySearchResponse validates search results', () => {
    const searchResponse = {
      tracks: {
        href: 'https://api.spotify.com/v1/search?q=test&type=track',
        items: [],
        limit: 20,
        next: null,
        offset: 0,
        previous: null,
        total: 100,
      },
    }

    expectSchemaToPass(SpotifySearchResponseSchema, searchResponse)
  })
})

// ===== 2. SSE Event Schemas Tests (4 tests) =====

describe('SSE Event Schemas', () => {
  it('StreamContentEvent validates content events', () => {
    const event = {
      data: 'Hello world, this is streaming content',
      type: 'content' as const,
    }

    expectSchemaToPass(StreamContentEventSchema, event)
  })

  it('StreamToolStartEvent validates tool execution start', () => {
    const event = {
      data: {
        args: {
          playlist_id: 'abc123',
        },
        tool: 'analyze_playlist',
      },
      type: 'tool_start' as const,
    }

    expectSchemaToPass(StreamToolStartEventSchema, event)
  })

  it('StreamErrorEvent validates error events', () => {
    const event = {
      data: 'Something went wrong during processing',
      type: 'error' as const,
    }

    expectSchemaToPass(StreamErrorEventSchema, event)
  })

  it('StreamEventSchema rejects invalid event types', () => {
    const invalid = {
      data: 'test',
      type: 'invalid_type',
    }

    expectSchemaToFail(StreamEventSchema, invalid)
  })
})

// ===== 3. External API Schemas Tests (6 tests) =====

describe('External API Schemas', () => {
  it('DeezerTrack validates Deezer track response', () => {
    const track = {
      album: {
        id: 1,
        title: 'Album Name',
        type: 'album' as const,
      },
      artist: {
        id: 1,
        name: 'Artist Name',
        type: 'artist' as const,
      },
      bpm: 120,
      duration: 180,
      gain: -8.5,
      id: 123456,
      rank: 500000,
      release_date: '2023-01-15',
      title: 'Song Name',
      type: 'track' as const,
    }

    expectSchemaToPass(DeezerTrackSchema, track)
  })

  it('LastFmTrackInfo validates Last.fm track response', () => {
    const track = {
      artist: {
        name: 'Artist',
        url: 'https://www.last.fm/music/Artist',
      },
      listeners: 1000000,
      name: 'Song',
      playcount: 5000000,
      toptags: {
        tag: [
          {
            name: 'rock',
            url: 'https://www.last.fm/tag/rock',
          },
        ],
      },
      url: 'https://www.last.fm/music/Artist/Song',
    }

    expectSchemaToPass(LastFmTrackInfoSchema, track)
  })

  it('MusicBrainzRecording validates recording response', () => {
    const recording = {
      id: 'mbid123',
      isrcs: ['USRC17607839'],
      title: 'Song',
    }

    expectSchemaToPass(MusicBrainzRecordingSchema, recording)
  })

  it('External API schemas handle missing optional fields', () => {
    const deezerTrack = {
      bpm: null,
      duration: 180,
      gain: null,
      id: 123,
      rank: null,
      title: 'Song',
    }

    expectSchemaToPass(DeezerTrackSchema, deezerTrack)
  })

  it('LastFmSimilarTrack validates similar track data', () => {
    const similarTrack = {
      artist: {
        name: 'Similar Artist',
        url: 'https://www.last.fm/music/Similar+Artist',
      },
      match: 0.95,
      name: 'Similar Song',
      url: 'https://www.last.fm/music/Similar+Artist/Similar+Song',
    }

    expectSchemaToPass(LastFmSimilarTrackSchema, similarTrack)
  })

  it('EnrichedTrackData validates enrichment result', () => {
    const enrichment = {
      bpm: 120,
      gain: -8.5,
      listeners: null,
      playcount: null,
      rank: 500000,
      release_date: '2023-01-15',
      source: 'deezer' as const,
    }

    expectSchemaToPass(EnrichedTrackDataSchema, enrichment)
  })
})

// ===== 4. API Request/Response Schemas Tests (4 tests) =====

describe('API Request/Response Schemas', () => {
  it('ChatRequest validates chat message requests', () => {
    const request = {
      conversationHistory: [
        {
          content: 'Hello',
          role: 'user' as const,
        },
        {
          content: 'Hi there!',
          role: 'assistant' as const,
        },
      ],
      message: 'Analyze my playlist',
      mode: 'analyze' as const,
    }

    expectSchemaToPass(ChatRequestSchema, request)
  })

  it('ChatRequest requires message field', () => {
    const invalid = {
      conversationHistory: [],
      mode: 'analyze',
    }

    expectSchemaToFail(ChatRequestSchema, invalid)
  })

  it('ChatRequest validates with empty history', () => {
    const request = {
      conversationHistory: [],
      message: 'Create a playlist',
    }

    expectSchemaToPass(ChatRequestSchema, request)
  })

  it('SavePlaylistResponse validates save result', () => {
    const response = {
      playlistId: 'playlist123',
      playlistUrl: 'https://open.spotify.com/playlist/playlist123',
      success: true,
    }

    expectSchemaToPass(SavePlaylistResponseSchema, response)
  })
})

// ===== Integration Tests (5 additional tests for edge cases) =====

describe('Schema Integration and Edge Cases', () => {
  it('Audio features validates boundary values', () => {
    const features = {
      acousticness: 0.5,
      analysis_url: 'https://api.spotify.com/v1/audio-analysis/track123',
      danceability: 1,
      duration_ms: 1,
      energy: 0,
      id: 'track123',
      instrumentalness: 0.5,
      key: -1,
      liveness: 0.5,
      loudness: -60,
      mode: 0,
      speechiness: 0.5,
      tempo: 0,
      time_signature: 1,
      track_href: 'https://api.spotify.com/v1/tracks/track123',
      type: 'audio_features' as const,
      uri: 'spotify:track:track123',
      valence: 1,
    }

    expectSchemaToPass(SpotifyAudioFeaturesSchema, features)
  })

  it('Stream event discriminated union validates all types', () => {
    const events = [
      {data: 'text', type: 'content' as const},
      {data: 'thinking...', type: 'thinking' as const},
      {data: {args: {}, tool: 'test'}, type: 'tool_start' as const},
      {data: {result: {}, tool: 'test'}, type: 'tool_end' as const},
      {data: {level: 'info' as const, message: 'test'}, type: 'log' as const},
      {data: {}, type: 'debug' as const},
      {data: 'error message', type: 'error' as const},
      {data: null, type: 'done' as const},
    ]

    for (const event of events) {
      expectSchemaToPass(StreamEventSchema, event)
    }
  })

  it('Playlist schema validates track relationships', () => {
    const playlist = {
      description: 'A test playlist',
      name: 'Test Playlist',
      tracks: [
        {
          artist: 'Artist 1',
          name: 'Track 1',
          query: 'Track 1 Artist 1',
          spotifyId: 'track1',
        },
        {
          artist: 'Artist 2',
          name: 'Track 2',
          query: 'Track 2 Artist 2',
          spotifyUri: 'spotify:track:track2',
        },
      ],
    }

    expectSchemaToPass(PlaylistSchema, playlist)
  })

  it('Track schema validates with minimal required fields', () => {
    const track = {
      artist: 'Artist',
      name: 'Song',
      query: 'Song Artist',
    }

    expectSchemaToPass(TrackSchema, track)
  })

  it('SpotifyRecommendationsResponse validates recommendation seeds', () => {
    const recommendations = {
      seeds: [
        {
          afterFilteringSize: 100,
          afterRelinkingSize: 100,
          href: 'https://api.spotify.com/v1/seeds',
          id: 'artist123',
          initialPoolSize: 500,
          type: 'artist' as const,
        },
      ],
      tracks: [],
    }

    expectSchemaToPass(SpotifyRecommendationsResponseSchema, recommendations)
  })
})

// ===== Type Inference Tests =====

describe('Schema Type Inference', () => {
  it('Inferred types match runtime values', () => {
    const chatRequest = {
      conversationHistory: [],
      message: 'test message',
    }

    const parsed = ChatRequestSchema.parse(chatRequest)
    expect(parsed.message).toBe('test message')
    expect(Array.isArray(parsed.conversationHistory)).toBe(true)
  })

  it('Optional fields are properly handled', () => {
    const user = {
      display_name: 'User',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user1',
      },
      href: 'https://api.spotify.com/v1/users/user1',
      id: 'user1',
      images: [],
      type: 'user' as const,
      uri: 'spotify:user:user1',
    }

    const parsed = SpotifyUserSchema.parse(user)
    expect(parsed.email).toBeUndefined()
    expect(parsed.followers).toBeUndefined()
  })

  it('Nullable fields preserve null values', () => {
    const playlist = {
      collaborative: false,
      description: null,
      external_urls: {
        spotify: 'https://open.spotify.com/playlist/playlist1',
      },
      followers: {
        href: null,
        total: 0,
      },
      href: 'https://api.spotify.com/v1/playlists/playlist1',
      id: 'playlist1',
      images: [],
      name: 'Playlist',
      owner: {
        display_name: null,
        external_urls: {
          spotify: 'https://open.spotify.com/user/user1',
        },
        href: 'https://api.spotify.com/v1/users/user1',
        id: 'user1',
        type: 'user' as const,
        uri: 'spotify:user:user1',
      },
      public: null,
      snapshot_id: 'snap1',
      tracks: {
        href: 'https://api.spotify.com/v1/playlists/playlist1/tracks',
        items: [],
        limit: 20,
        next: null,
        offset: 0,
        previous: null,
        total: 0,
      },
      type: 'playlist' as const,
      uri: 'spotify:playlist:playlist1',
    }

    const parsed = SpotifyPlaylistFullSchema.parse(playlist)
    expect(parsed.description).toBeNull()
    expect(parsed.public).toBeNull()
  })
})
