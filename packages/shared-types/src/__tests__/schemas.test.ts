/**
 * Comprehensive Zod schema validation tests for all shared types
 * Tests 20 different schema categories across Spotify, SSE, external APIs, and internal APIs
 */

import {describe, expect, it} from 'vitest'
import {z} from 'zod'

// Import all schemas
import {
  SpotifyAudioFeaturesSchema,
  SpotifyTrackFullSchema,
  SpotifyPlaylistFullSchema,
  SpotifyUserSchema,
  SpotifyArtistFullSchema,
  SpotifyAlbumFullSchema,
  SpotifySearchResponseSchema,
  SpotifyRecommendationsResponseSchema,
} from '../schemas/spotify-schemas'

import {
  StreamContentEventSchema,
  StreamToolStartEventSchema,
  StreamToolEndEventSchema,
  StreamLogEventSchema,
  StreamDebugEventSchema,
  StreamErrorEventSchema,
  StreamDoneEventSchema,
  StreamThinkingEventSchema,
  StreamEventSchema,
} from '../schemas/sse-schemas'

import {
  DeezerTrackSchema,
  LastFmTrackInfoSchema,
  MusicBrainzRecordingSchema,
  LastFmSimilarTrackSchema,
  LastFmArtistInfoSchema,
  EnrichedTrackDataSchema,
} from '../schemas/external-api-schemas'

import {
  ChatRequestSchema,
  ChatResponseSchema,
  PlaylistSchema,
  TrackSchema,
  SavePlaylistResponseSchema,
  SpotifyAuthResponseSchema,
} from '../schemas/api-schemas'

// ===== Helper Functions =====

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

function expectSchemaToFail<T>(schema: z.ZodSchema<T>, data: unknown, description?: string) {
  const result = schema.safeParse(data)
  if (result.success) {
    throw new Error(
      `Schema validation should have failed${description ? `: ${description}` : ''}\nData: ${JSON.stringify(data)}`,
    )
  }
  expect(result.success).toBe(false)
}

// ===== 1. Spotify Schemas Tests (8 tests) =====

describe('Spotify Schemas', () => {
  it('SpotifyTrackFull validates valid track object', () => {
    const track = {
      id: 'track123',
      name: 'Song Name',
      uri: 'spotify:track:track123',
      href: 'https://api.spotify.com/v1/tracks/track123',
      external_urls: {
        spotify: 'https://open.spotify.com/track/track123',
      },
      disc_number: 1,
      track_number: 1,
      type: 'track' as const,
      is_local: false,
      explicit: false,
      duration_ms: 180000,
      preview_url: 'https://example.com/preview.mp3',
      artists: [
        {
          id: 'artist1',
          name: 'Artist Name',
          type: 'artist' as const,
          uri: 'spotify:artist:artist1',
          href: 'https://api.spotify.com/v1/artists/artist1',
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist1',
          },
        },
      ],
      album: {
        id: 'album1',
        name: 'Album Name',
        type: 'album' as const,
        uri: 'spotify:album:album1',
        href: 'https://api.spotify.com/v1/albums/album1',
        external_urls: {
          spotify: 'https://open.spotify.com/album/album1',
        },
        album_type: 'album' as const,
        release_date: '2023-01-15',
        release_date_precision: 'day' as const,
        total_tracks: 12,
        artists: [
          {
            id: 'artist1',
            name: 'Artist Name',
            type: 'artist' as const,
            uri: 'spotify:artist:artist1',
            href: 'https://api.spotify.com/v1/artists/artist1',
            external_urls: {
              spotify: 'https://open.spotify.com/artist/artist1',
            },
          },
        ],
        images: [
          {
            url: 'https://example.com/image.jpg',
            height: 640,
            width: 640,
          },
        ],
      },
      external_ids: {
        isrc: 'USRC17607839',
      },
      popularity: 75,
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
      id: 'playlist123',
      name: 'My Playlist',
      uri: 'spotify:playlist:playlist123',
      href: 'https://api.spotify.com/v1/playlists/playlist123',
      external_urls: {
        spotify: 'https://open.spotify.com/playlist/playlist123',
      },
      type: 'playlist' as const,
      collaborative: false,
      description: 'A great playlist',
      public: true,
      snapshot_id: 'snapshot123',
      images: [
        {
          url: 'https://example.com/image.jpg',
          height: 640,
          width: 640,
        },
      ],
      owner: {
        id: 'user1',
        display_name: 'User Name',
        type: 'user' as const,
        uri: 'spotify:user:user1',
        href: 'https://api.spotify.com/v1/users/user1',
        external_urls: {
          spotify: 'https://open.spotify.com/user/user1',
        },
      },
      tracks: {
        href: 'https://api.spotify.com/v1/playlists/playlist123/tracks',
        total: 50,
        limit: 20,
        offset: 0,
        next: 'https://api.spotify.com/v1/playlists/playlist123/tracks?offset=20',
        previous: null,
        items: [],
      },
      followers: {
        href: null,
        total: 100,
      },
    }

    expectSchemaToPass(SpotifyPlaylistFullSchema, playlist)
  })

  it('SpotifyUser validates valid user object', () => {
    const user = {
      id: 'user123',
      display_name: 'John Doe',
      email: 'john@example.com',
      type: 'user' as const,
      uri: 'spotify:user:user123',
      href: 'https://api.spotify.com/v1/users/user123',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user123',
      },
      images: [
        {
          url: 'https://example.com/image.jpg',
          height: 300,
          width: 300,
        },
      ],
    }

    expectSchemaToPass(SpotifyUserSchema, user)
  })

  it('SpotifyAudioFeatures validates audio characteristics', () => {
    const features = {
      id: 'track123',
      type: 'audio_features' as const,
      uri: 'spotify:track:track123',
      track_href: 'https://api.spotify.com/v1/tracks/track123',
      analysis_url: 'https://api.spotify.com/v1/audio-analysis/track123',
      tempo: 120.5,
      energy: 0.8,
      danceability: 0.7,
      valence: 0.6,
      acousticness: 0.2,
      instrumentalness: 0.1,
      liveness: 0.15,
      speechiness: 0.05,
      loudness: -5.0,
      key: 0,
      mode: 1,
      time_signature: 4,
      duration_ms: 180000,
    }

    expectSchemaToPass(SpotifyAudioFeaturesSchema, features)
  })

  it('SpotifyArtistFull validates complete artist object', () => {
    const artist = {
      id: 'artist123',
      name: 'Artist Name',
      type: 'artist' as const,
      uri: 'spotify:artist:artist123',
      href: 'https://api.spotify.com/v1/artists/artist123',
      external_urls: {
        spotify: 'https://open.spotify.com/artist/artist123',
      },
      followers: {
        href: null,
        total: 1000000,
      },
      genres: ['rock', 'alternative'],
      images: [
        {
          url: 'https://example.com/image.jpg',
          height: 640,
          width: 640,
        },
      ],
      popularity: 85,
    }

    expectSchemaToPass(SpotifyArtistFullSchema, artist)
  })

  it('SpotifyAlbumFull validates complete album object', () => {
    const album = {
      id: 'album123',
      name: 'Album Name',
      type: 'album' as const,
      uri: 'spotify:album:album123',
      href: 'https://api.spotify.com/v1/albums/album123',
      external_urls: {
        spotify: 'https://open.spotify.com/album/album123',
      },
      album_type: 'album' as const,
      release_date: '2023-01-15',
      release_date_precision: 'day' as const,
      total_tracks: 12,
      images: [
        {
          url: 'https://example.com/image.jpg',
          height: 640,
          width: 640,
        },
      ],
      artists: [
        {
          id: 'artist1',
          name: 'Artist Name',
          type: 'artist' as const,
          uri: 'spotify:artist:artist1',
          href: 'https://api.spotify.com/v1/artists/artist1',
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist1',
          },
        },
      ],
      genres: ['rock'],
      popularity: 80,
      tracks: {
        href: 'https://api.spotify.com/v1/albums/album123/tracks',
        limit: 20,
        offset: 0,
        next: null,
        previous: null,
        total: 12,
        items: [],
      },
    }

    expectSchemaToPass(SpotifyAlbumFullSchema, album)
  })

  it('SpotifySearchResponse validates search results', () => {
    const searchResponse = {
      tracks: {
        href: 'https://api.spotify.com/v1/search?q=test&type=track',
        limit: 20,
        offset: 0,
        next: null,
        previous: null,
        total: 100,
        items: [],
      },
    }

    expectSchemaToPass(SpotifySearchResponseSchema, searchResponse)
  })
})

// ===== 2. SSE Event Schemas Tests (4 tests) =====

describe('SSE Event Schemas', () => {
  it('StreamContentEvent validates content events', () => {
    const event = {
      type: 'content' as const,
      data: 'Hello world, this is streaming content',
    }

    expectSchemaToPass(StreamContentEventSchema, event)
  })

  it('StreamToolStartEvent validates tool execution start', () => {
    const event = {
      type: 'tool_start' as const,
      data: {
        tool: 'analyze_playlist',
        args: {
          playlist_id: 'abc123',
        },
      },
    }

    expectSchemaToPass(StreamToolStartEventSchema, event)
  })

  it('StreamErrorEvent validates error events', () => {
    const event = {
      type: 'error' as const,
      data: 'Something went wrong during processing',
    }

    expectSchemaToPass(StreamErrorEventSchema, event)
  })

  it('StreamEventSchema rejects invalid event types', () => {
    const invalid = {
      type: 'invalid_type',
      data: 'test',
    }

    expectSchemaToFail(StreamEventSchema, invalid)
  })
})

// ===== 3. External API Schemas Tests (6 tests) =====

describe('External API Schemas', () => {
  it('DeezerTrack validates Deezer track response', () => {
    const track = {
      id: 123456,
      title: 'Song Name',
      duration: 180,
      bpm: 120,
      rank: 500000,
      gain: -8.5,
      release_date: '2023-01-15',
      type: 'track' as const,
      artist: {
        id: 1,
        name: 'Artist Name',
        type: 'artist' as const,
      },
      album: {
        id: 1,
        title: 'Album Name',
        type: 'album' as const,
      },
    }

    expectSchemaToPass(DeezerTrackSchema, track)
  })

  it('LastFmTrackInfo validates Last.fm track response', () => {
    const track = {
      name: 'Song',
      url: 'https://www.last.fm/music/Artist/Song',
      artist: {
        name: 'Artist',
        url: 'https://www.last.fm/music/Artist',
      },
      listeners: 1000000,
      playcount: 5000000,
      toptags: {
        tag: [
          {
            name: 'rock',
            url: 'https://www.last.fm/tag/rock',
          },
        ],
      },
    }

    expectSchemaToPass(LastFmTrackInfoSchema, track)
  })

  it('MusicBrainzRecording validates recording response', () => {
    const recording = {
      id: 'mbid123',
      title: 'Song',
      isrcs: ['USRC17607839'],
    }

    expectSchemaToPass(MusicBrainzRecordingSchema, recording)
  })

  it('External API schemas handle missing optional fields', () => {
    const deezerTrack = {
      id: 123,
      title: 'Song',
      duration: 180,
      bpm: null,
      rank: null,
      gain: null,
    }

    expectSchemaToPass(DeezerTrackSchema, deezerTrack)
  })

  it('LastFmSimilarTrack validates similar track data', () => {
    const similarTrack = {
      name: 'Similar Song',
      url: 'https://www.last.fm/music/Similar+Artist/Similar+Song',
      match: 0.95,
      artist: {
        name: 'Similar Artist',
        url: 'https://www.last.fm/music/Similar+Artist',
      },
    }

    expectSchemaToPass(LastFmSimilarTrackSchema, similarTrack)
  })

  it('EnrichedTrackData validates enrichment result', () => {
    const enrichment = {
      bpm: 120,
      rank: 500000,
      gain: -8.5,
      release_date: '2023-01-15',
      source: 'deezer' as const,
      listeners: null,
      playcount: null,
    }

    expectSchemaToPass(EnrichedTrackDataSchema, enrichment)
  })
})

// ===== 4. API Request/Response Schemas Tests (4 tests) =====

describe('API Request/Response Schemas', () => {
  it('ChatRequest validates chat message requests', () => {
    const request = {
      message: 'Analyze my playlist',
      conversationHistory: [
        {
          role: 'user' as const,
          content: 'Hello',
        },
        {
          role: 'assistant' as const,
          content: 'Hi there!',
        },
      ],
      mode: 'analyze' as const,
    }

    expectSchemaToPass(ChatRequestSchema, request)
  })

  it('ChatRequest requires message field', () => {
    const invalid = {
      mode: 'analyze',
      conversationHistory: [],
    }

    expectSchemaToFail(ChatRequestSchema, invalid)
  })

  it('ChatRequest validates with empty history', () => {
    const request = {
      message: 'Create a playlist',
      conversationHistory: [],
    }

    expectSchemaToPass(ChatRequestSchema, request)
  })

  it('SavePlaylistResponse validates save result', () => {
    const response = {
      success: true,
      playlistId: 'playlist123',
      playlistUrl: 'https://open.spotify.com/playlist/playlist123',
    }

    expectSchemaToPass(SavePlaylistResponseSchema, response)
  })
})

// ===== Integration Tests (5 additional tests for edge cases) =====

describe('Schema Integration and Edge Cases', () => {
  it('Audio features validates boundary values', () => {
    const features = {
      id: 'track123',
      type: 'audio_features' as const,
      uri: 'spotify:track:track123',
      track_href: 'https://api.spotify.com/v1/tracks/track123',
      analysis_url: 'https://api.spotify.com/v1/audio-analysis/track123',
      tempo: 0,
      energy: 0,
      danceability: 1,
      valence: 1,
      acousticness: 0.5,
      instrumentalness: 0.5,
      liveness: 0.5,
      speechiness: 0.5,
      loudness: -60,
      key: -1,
      mode: 0,
      time_signature: 1,
      duration_ms: 1,
    }

    expectSchemaToPass(SpotifyAudioFeaturesSchema, features)
  })

  it('Stream event discriminated union validates all types', () => {
    const events = [
      {type: 'content' as const, data: 'text'},
      {type: 'thinking' as const, data: 'thinking...'},
      {type: 'tool_start' as const, data: {tool: 'test', args: {}}},
      {type: 'tool_end' as const, data: {tool: 'test', result: {}}},
      {type: 'log' as const, data: {level: 'info' as const, message: 'test'}},
      {type: 'debug' as const, data: {}},
      {type: 'error' as const, data: 'error message'},
      {type: 'done' as const, data: null},
    ]

    for (const event of events) {
      expectSchemaToPass(StreamEventSchema, event)
    }
  })

  it('Playlist schema validates track relationships', () => {
    const playlist = {
      name: 'Test Playlist',
      description: 'A test playlist',
      tracks: [
        {
          name: 'Track 1',
          artist: 'Artist 1',
          query: 'Track 1 Artist 1',
          spotifyId: 'track1',
        },
        {
          name: 'Track 2',
          artist: 'Artist 2',
          query: 'Track 2 Artist 2',
          spotifyUri: 'spotify:track:track2',
        },
      ],
    }

    expectSchemaToPass(PlaylistSchema, playlist)
  })

  it('Track schema validates with minimal required fields', () => {
    const track = {
      name: 'Song',
      artist: 'Artist',
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
      message: 'test message',
      conversationHistory: [],
    }

    const parsed = ChatRequestSchema.parse(chatRequest)
    expect(parsed.message).toBe('test message')
    expect(Array.isArray(parsed.conversationHistory)).toBe(true)
  })

  it('Optional fields are properly handled', () => {
    const user = {
      id: 'user1',
      display_name: 'User',
      type: 'user' as const,
      uri: 'spotify:user:user1',
      href: 'https://api.spotify.com/v1/users/user1',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user1',
      },
      images: [],
    }

    const parsed = SpotifyUserSchema.parse(user)
    expect(parsed.email).toBeUndefined()
    expect(parsed.followers).toBeUndefined()
  })

  it('Nullable fields preserve null values', () => {
    const playlist = {
      id: 'playlist1',
      name: 'Playlist',
      uri: 'spotify:playlist:playlist1',
      href: 'https://api.spotify.com/v1/playlists/playlist1',
      external_urls: {
        spotify: 'https://open.spotify.com/playlist/playlist1',
      },
      type: 'playlist' as const,
      collaborative: false,
      description: null,
      public: null,
      snapshot_id: 'snap1',
      images: [],
      owner: {
        id: 'user1',
        display_name: null,
        type: 'user' as const,
        uri: 'spotify:user:user1',
        href: 'https://api.spotify.com/v1/users/user1',
        external_urls: {
          spotify: 'https://open.spotify.com/user/user1',
        },
      },
      tracks: {
        href: 'https://api.spotify.com/v1/playlists/playlist1/tracks',
        total: 0,
        limit: 20,
        offset: 0,
        next: null,
        previous: null,
        items: [],
      },
      followers: {
        href: null,
        total: 0,
      },
    }

    const parsed = SpotifyPlaylistFullSchema.parse(playlist)
    expect(parsed.description).toBeNull()
    expect(parsed.public).toBeNull()
  })
})
