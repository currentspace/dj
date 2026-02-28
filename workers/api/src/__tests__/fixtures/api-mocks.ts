/**
 * External API Mocks
 * Mock fetch responses for Deezer, Last.fm, MusicBrainz, and Spotify APIs
 */

import type {
  DeezerTrack,
  LastFmArtistInfo,
  LastFmTrackInfo,
  SpotifyPlaylistFull,
  SpotifyTrackFull,
} from '@dj/shared-types'

// ===== Mock Response Builders =====

/**
 * Build a realistic Deezer track response
 */
export function buildDeezerTrack(overrides?: Partial<DeezerTrack>): DeezerTrack {
  return {
    album: {
      cover: 'https://e-cdns-images.dzcdn.net/images/cover/test/500x500.jpg',
      cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/test/250x250.jpg',
      cover_small: 'https://e-cdns-images.dzcdn.net/images/cover/test/56x56.jpg',
      id: 54321,
      title: 'Test Album',
      type: 'album',
    },
    artist: {
      id: 98765,
      name: 'Test Artist',
      picture: 'https://e-cdns-images.dzcdn.net/images/artist/test/500x500.jpg',
      picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/test/250x250.jpg',
      picture_small: 'https://e-cdns-images.dzcdn.net/images/artist/test/56x56.jpg',
      type: 'artist',
    },
    bpm: 120,
    duration: 240,
    gain: -8.5,
    id: 12345678,
    isrc: 'USUM71234567',
    preview: 'https://cdns-preview-d.dzcdn.net/stream/test.mp3',
    rank: 850000,
    release_date: '2023-01-15',
    title: 'Test Track',
    type: 'track',
    ...overrides,
  }
}

/**
 * Build a realistic Last.fm artist info response
 */
export function buildLastFmArtistInfo(overrides?: Partial<LastFmArtistInfo>): LastFmArtistInfo {
  return {
    bio: {
      content: 'Test artist bio full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
      summary: 'Test artist bio summary',
    },
    image: [
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/34s/artist.jpg', size: 'small'},
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/64s/artist.jpg', size: 'medium'},
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/174s/artist.jpg', size: 'large'},
    ],
    mbid: 'artist-mbid-123',
    name: 'Test Artist',
    similar: {
      artist: [
        {name: 'Similar Artist 1', url: 'https://www.last.fm/music/Similar+Artist+1'},
        {name: 'Similar Artist 2', url: 'https://www.last.fm/music/Similar+Artist+2'},
      ],
    },
    stats: {
      listeners: 500000,
      playcount: 10000000,
    },
    tags: {
      tag: [
        {name: 'indie', url: 'https://www.last.fm/tag/indie'},
        {name: 'alternative', url: 'https://www.last.fm/tag/alternative'},
      ],
    },
    url: 'https://www.last.fm/music/Test+Artist',
    ...overrides,
  }
}

/**
 * Build a realistic Last.fm track info response
 */
export function buildLastFmTrack(overrides?: Partial<LastFmTrackInfo>): LastFmTrackInfo {
  return {
    album: {
      artist: 'Test Artist',
      image: [
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/34s/test.jpg', size: 'small'},
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/64s/test.jpg', size: 'medium'},
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/174s/test.jpg', size: 'large'},
      ],
      mbid: 'album-mbid-789',
      title: 'Test Album',
      url: 'https://www.last.fm/music/Test+Artist/Test+Album',
    },
    artist: {
      mbid: 'artist-mbid-123',
      name: 'Test Artist',
      url: 'https://www.last.fm/music/Test+Artist',
    },
    duration: 240000,
    listeners: 125000,
    mbid: 'track-mbid-456',
    name: 'Test Track',
    playcount: 2500000,
    toptags: {
      tag: [
        {name: 'indie', url: 'https://www.last.fm/tag/indie'},
        {name: 'alternative', url: 'https://www.last.fm/tag/alternative'},
        {name: 'rock', url: 'https://www.last.fm/tag/rock'},
      ],
    },
    url: 'https://www.last.fm/music/Test+Artist/_/Test+Track',
    wiki: {
      content: 'Test track full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
      summary: 'Test track summary',
    },
    ...overrides,
  }
}

/**
 * Build a realistic MusicBrainz recording response
 */
export function buildMusicBrainzRecording(overrides?: {
  artist?: string
  isrc?: string
  score?: number
  title?: string
}): {
  'artist-credit': {artist: {name: string}}[]
  id: string
  isrcs: string[]
  score: number
  title: string
} {
  return {
    'artist-credit': [{artist: {name: overrides?.artist ?? 'Test Artist'}}],
    id: 'recording-id-123',
    isrcs: overrides?.isrc ? [overrides.isrc] : ['USUM71234567'],
    score: overrides?.score ?? 100,
    title: overrides?.title ?? 'Test Track',
  }
}

/**
 * Build a realistic Spotify playlist response
 */
export function buildSpotifyPlaylist(overrides?: Partial<SpotifyPlaylistFull>): SpotifyPlaylistFull {
  return {
    collaborative: false,
    description: 'A test playlist',
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
      {height: 640, url: 'https://mosaic.scdn.co/640/test.jpg', width: 640},
    ],
    name: 'Test Playlist',
    owner: {
      display_name: 'Test User',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user123',
      },
      href: 'https://api.spotify.com/v1/users/user123',
      id: 'user123',
      type: 'user',
      uri: 'spotify:user:user123',
    },
    public: true,
    snapshot_id: 'snapshot123',
    tracks: {
      href: 'https://api.spotify.com/v1/playlists/playlist123/tracks',
      items: [],
      limit: 100,
      next: null,
      offset: 0,
      previous: null,
      total: 0,
    },
    type: 'playlist',
    uri: 'spotify:playlist:playlist123',
    ...overrides,
  }
}

/**
 * Build a realistic Spotify track response
 */
export function buildSpotifyTrack(overrides?: Partial<SpotifyTrackFull>): SpotifyTrackFull {
  return {
    album: {
      album_type: 'album',
      artists: [
        {
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist123',
          },
          href: 'https://api.spotify.com/v1/artists/artist123',
          id: 'artist123',
          name: 'Test Artist',
          type: 'artist',
          uri: 'spotify:artist:artist123',
        },
      ],
      external_urls: {
        spotify: 'https://open.spotify.com/album/album123',
      },
      href: 'https://api.spotify.com/v1/albums/album123',
      id: 'album123',
      images: [
        {height: 640, url: 'https://i.scdn.co/image/test-640.jpg', width: 640},
        {height: 300, url: 'https://i.scdn.co/image/test-300.jpg', width: 300},
        {height: 64, url: 'https://i.scdn.co/image/test-64.jpg', width: 64},
      ],
      name: 'Test Album',
      release_date: '2023-01-15',
      release_date_precision: 'day',
      total_tracks: 12,
      type: 'album',
      uri: 'spotify:album:album123',
    },
    artists: [
      {
        external_urls: {
          spotify: 'https://open.spotify.com/artist/artist123',
        },
        href: 'https://api.spotify.com/v1/artists/artist123',
        id: 'artist123',
        name: 'Test Artist',
        type: 'artist',
        uri: 'spotify:artist:artist123',
      },
    ],
    disc_number: 1,
    duration_ms: 240000,
    explicit: false,
    external_ids: {
      isrc: 'USUM71234567',
    },
    external_urls: {
      spotify: 'https://open.spotify.com/track/track123',
    },
    href: 'https://api.spotify.com/v1/tracks/track123',
    id: 'track123',
    is_local: false,
    name: 'Test Track',
    popularity: 75,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    type: 'track',
    uri: 'spotify:track:track123',
    ...overrides,
  }
}

// ===== Mock Fetch Functions =====

/**
 * Mock global fetch for Deezer API calls
 * Call this in beforeEach to intercept Deezer requests
 */
export function mockDeezerAPI(responses: Record<string, DeezerTrack | null>): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Deezer ISRC lookup
    const isrcMatch = /api\.deezer\.com\/track\/isrc:([A-Z0-9]+)/.exec(url)
    if (isrcMatch) {
      const isrc = isrcMatch[1]
      const track = responses[isrc]

      if (track) {
        return new Response(JSON.stringify(track), {
          headers: {'Content-Type': 'application/json'},
          status: 200,
        })
      } else {
        return new Response(JSON.stringify({error: {code: 800, message: 'Not found'}}), {
          headers: {'Content-Type': 'application/json'},
          status: 404,
        })
      }
    }

    // Fallback to original fetch
    return originalFetch(input as RequestInfo)
  }

  // Return cleanup function
  return () => {
    global.fetch = originalFetch
  }
}

/**
 * Mock global fetch for Last.fm API calls
 */
export function mockLastFmAPI(responses: {
  'artist.getInfo'?: Record<string, LastFmArtistInfo | null>
  'track.getCorrection'?: Record<string, null | {artist: string; name: string}>
  'track.getInfo'?: Record<string, LastFmTrackInfo | null>
  'track.getSimilar'?: Record<string, {artist: string; match: number; name: string;}[]>
  'track.getTopTags'?: Record<string, {count: number; name: string;}[]>
}): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Last.fm API
    if (url.includes('ws.audioscrobbler.com')) {
      const urlObj = new URL(url)
      const method = urlObj.searchParams.get('method')
      const artist = urlObj.searchParams.get('artist') ?? ''
      const track = urlObj.searchParams.get('track') ?? ''
      const key = `${artist}|${track}`

      switch (method) {
        case 'artist.getInfo': {
          const info = responses['artist.getInfo']?.[artist]
          if (info) {
            return new Response(JSON.stringify({artist: info}), {
              headers: {'Content-Type': 'application/json'},
              status: 200,
            })
          }
          break
        }
        case 'track.getCorrection': {
          const correction = responses['track.getCorrection']?.[key]
          if (correction) {
            return new Response(
              JSON.stringify({
                corrections: {
                  correction: {
                    track: {
                      artist: {name: correction.artist, url: 'https://www.last.fm/music/test'},
                      name: correction.name,
                      url: 'https://www.last.fm/music/test/_/test',
                    },
                  },
                },
              }),
              {
                headers: {'Content-Type': 'application/json'},
                status: 200,
              },
            )
          }
          break
        }
        case 'track.getInfo': {
          const info = responses['track.getInfo']?.[key]
          if (info) {
            return new Response(JSON.stringify({track: info}), {
              headers: {'Content-Type': 'application/json'},
              status: 200,
            })
          }
          break
        }
      }

      // Not found
      return new Response(JSON.stringify({error: 6, message: 'Track not found'}), {
        headers: {'Content-Type': 'application/json'},
        status: 404,
      })
    }

    // Fallback to original fetch
    return originalFetch(input as RequestInfo)
  }

  // Return cleanup function
  return () => {
    global.fetch = originalFetch
  }
}

/**
 * Mock global fetch for MusicBrainz API calls
 */
export function mockMusicBrainzAPI(
  responses: Record<string, null | {id: string; isrcs: string[]; score: number; title: string;}>,
): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // MusicBrainz recording search
    if (url.includes('musicbrainz.org/ws/2/recording')) {
      const urlObj = new URL(url)
      const query = urlObj.searchParams.get('query') ?? ''
      const artistMatch = /artist:"([^"]+)"/.exec(query)
      const recordingMatch = /recording:"([^"]+)"/.exec(query)

      if (artistMatch && recordingMatch) {
        const key = `${artistMatch[1]}|${recordingMatch[1]}`
        const recording = responses[key]

        if (recording) {
          return new Response(
            JSON.stringify({
              recordings: [
                {
                  'artist-credit': [{artist: {name: artistMatch[1]}}],
                  id: recording.id,
                  isrcs: recording.isrcs,
                  score: recording.score,
                  title: recording.title,
                },
              ],
            }),
            {
              headers: {'Content-Type': 'application/json'},
              status: 200,
            },
          )
        }
      }

      // Not found
      return new Response(JSON.stringify({recordings: []}), {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      })
    }

    // Fallback to original fetch
    return originalFetch(input as RequestInfo)
  }

  // Return cleanup function
  return () => {
    global.fetch = originalFetch
  }
}

/**
 * Mock global fetch for Spotify API calls
 */
export function mockSpotifyAPI(responses: {
  'GET /v1/playlists/:id'?: Record<string, null | SpotifyPlaylistFull>
  'GET /v1/playlists/:id/tracks'?: Record<string, {items: unknown[]; total: number}>
  'GET /v1/search'?: (query: string) => SpotifyTrackFull[]
  'GET /v1/tracks/:id'?: Record<string, null | SpotifyTrackFull>
  'POST /v1/playlists/:id/tracks'?: () => {snapshot_id: string}
}): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Spotify API
    if (url.includes('api.spotify.com')) {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      // GET /v1/tracks/:id
      const trackMatch = /^\/v1\/tracks\/([^/]+)$/.exec(path)
      if (trackMatch && init?.method !== 'POST') {
        const trackId = trackMatch[1]
        const track = responses['GET /v1/tracks/:id']?.[trackId]
        if (track) {
          return new Response(JSON.stringify(track), {
            headers: {'Content-Type': 'application/json'},
            status: 200,
          })
        }
      }

      // GET /v1/playlists/:id
      const playlistMatch = /^\/v1\/playlists\/([^/]+)$/.exec(path)
      if (playlistMatch && init?.method !== 'POST') {
        const playlistId = playlistMatch[1]
        const playlist = responses['GET /v1/playlists/:id']?.[playlistId]
        if (playlist) {
          return new Response(JSON.stringify(playlist), {
            headers: {'Content-Type': 'application/json'},
            status: 200,
          })
        }
      }

      // GET /v1/playlists/:id/tracks
      const playlistTracksMatch = /^\/v1\/playlists\/([^/]+)\/tracks$/.exec(path)
      if (playlistTracksMatch && init?.method !== 'POST') {
        const playlistId = playlistTracksMatch[1]
        const tracks = responses['GET /v1/playlists/:id/tracks']?.[playlistId]
        if (tracks) {
          return new Response(JSON.stringify(tracks), {
            headers: {'Content-Type': 'application/json'},
            status: 200,
          })
        }
      }

      // GET /v1/search
      if (path === '/v1/search' && init?.method !== 'POST') {
        const query = urlObj.searchParams.get('q') ?? ''
        const searchFn = responses['GET /v1/search']
        if (searchFn) {
          const tracks = searchFn(query)
          return new Response(
            JSON.stringify({
              tracks: {
                items: tracks,
                total: tracks.length,
              },
            }),
            {
              headers: {'Content-Type': 'application/json'},
              status: 200,
            },
          )
        }
      }

      // POST /v1/playlists/:id/tracks
      const addTracksMatch = /^\/v1\/playlists\/([^/]+)\/tracks$/.exec(path)
      if (addTracksMatch && init?.method === 'POST') {
        const addFn = responses['POST /v1/playlists/:id/tracks']
        if (addFn) {
          const result = addFn()
          return new Response(JSON.stringify(result), {
            headers: {'Content-Type': 'application/json'},
            status: 201,
          })
        }
      }

      // Not found
      return new Response(JSON.stringify({error: {message: 'Not found', status: 404}}), {
        headers: {'Content-Type': 'application/json'},
        status: 404,
      })
    }

    // Fallback to original fetch
    return originalFetch(input as RequestInfo, init)
  }

  // Return cleanup function
  return () => {
    global.fetch = originalFetch
  }
}
