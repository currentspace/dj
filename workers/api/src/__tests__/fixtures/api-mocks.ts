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
    id: 12345678,
    title: 'Test Track',
    duration: 240,
    rank: 850000,
    bpm: 120,
    gain: -8.5,
    isrc: 'USUM71234567',
    release_date: '2023-01-15',
    preview: 'https://cdns-preview-d.dzcdn.net/stream/test.mp3',
    artist: {
      id: 98765,
      name: 'Test Artist',
      picture: 'https://e-cdns-images.dzcdn.net/images/artist/test/500x500.jpg',
      picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/test/250x250.jpg',
      picture_small: 'https://e-cdns-images.dzcdn.net/images/artist/test/56x56.jpg',
      type: 'artist',
    },
    album: {
      id: 54321,
      title: 'Test Album',
      cover: 'https://e-cdns-images.dzcdn.net/images/cover/test/500x500.jpg',
      cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/test/250x250.jpg',
      cover_small: 'https://e-cdns-images.dzcdn.net/images/cover/test/56x56.jpg',
      type: 'album',
    },
    type: 'track',
    ...overrides,
  }
}

/**
 * Build a realistic Last.fm track info response
 */
export function buildLastFmTrack(overrides?: Partial<LastFmTrackInfo>): LastFmTrackInfo {
  return {
    name: 'Test Track',
    artist: {
      name: 'Test Artist',
      mbid: 'artist-mbid-123',
      url: 'https://www.last.fm/music/Test+Artist',
    },
    url: 'https://www.last.fm/music/Test+Artist/_/Test+Track',
    duration: 240000,
    listeners: 125000,
    playcount: 2500000,
    mbid: 'track-mbid-456',
    album: {
      artist: 'Test Artist',
      title: 'Test Album',
      mbid: 'album-mbid-789',
      url: 'https://www.last.fm/music/Test+Artist/Test+Album',
      image: [
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/34s/test.jpg', size: 'small'},
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/64s/test.jpg', size: 'medium'},
        {'#text': 'https://lastfm.freetls.fastly.net/i/u/174s/test.jpg', size: 'large'},
      ],
    },
    toptags: {
      tag: [
        {name: 'indie', url: 'https://www.last.fm/tag/indie'},
        {name: 'alternative', url: 'https://www.last.fm/tag/alternative'},
        {name: 'rock', url: 'https://www.last.fm/tag/rock'},
      ],
    },
    wiki: {
      summary: 'Test track summary',
      content: 'Test track full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
    },
    ...overrides,
  }
}

/**
 * Build a realistic Last.fm artist info response
 */
export function buildLastFmArtistInfo(overrides?: Partial<LastFmArtistInfo>): LastFmArtistInfo {
  return {
    name: 'Test Artist',
    mbid: 'artist-mbid-123',
    url: 'https://www.last.fm/music/Test+Artist',
    image: [
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/34s/artist.jpg', size: 'small'},
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/64s/artist.jpg', size: 'medium'},
      {'#text': 'https://lastfm.freetls.fastly.net/i/u/174s/artist.jpg', size: 'large'},
    ],
    stats: {
      listeners: 500000,
      playcount: 10000000,
    },
    similar: {
      artist: [
        {name: 'Similar Artist 1', url: 'https://www.last.fm/music/Similar+Artist+1'},
        {name: 'Similar Artist 2', url: 'https://www.last.fm/music/Similar+Artist+2'},
      ],
    },
    tags: {
      tag: [
        {name: 'indie', url: 'https://www.last.fm/tag/indie'},
        {name: 'alternative', url: 'https://www.last.fm/tag/alternative'},
      ],
    },
    bio: {
      summary: 'Test artist bio summary',
      content: 'Test artist bio full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
    },
    ...overrides,
  }
}

/**
 * Build a realistic MusicBrainz recording response
 */
export function buildMusicBrainzRecording(overrides?: {
  isrc?: string
  title?: string
  artist?: string
  score?: number
}): {
  id: string
  title: string
  'artist-credit': {artist: {name: string}}[]
  isrcs: string[]
  score: number
} {
  return {
    id: 'recording-id-123',
    title: overrides?.title ?? 'Test Track',
    'artist-credit': [{artist: {name: overrides?.artist ?? 'Test Artist'}}],
    isrcs: overrides?.isrc ? [overrides.isrc] : ['USUM71234567'],
    score: overrides?.score ?? 100,
  }
}

/**
 * Build a realistic Spotify track response
 */
export function buildSpotifyTrack(overrides?: Partial<SpotifyTrackFull>): SpotifyTrackFull {
  return {
    id: 'track123',
    name: 'Test Track',
    uri: 'spotify:track:track123',
    type: 'track',
    href: 'https://api.spotify.com/v1/tracks/track123',
    external_urls: {
      spotify: 'https://open.spotify.com/track/track123',
    },
    artists: [
      {
        id: 'artist123',
        name: 'Test Artist',
        uri: 'spotify:artist:artist123',
        type: 'artist',
        href: 'https://api.spotify.com/v1/artists/artist123',
        external_urls: {
          spotify: 'https://open.spotify.com/artist/artist123',
        },
      },
    ],
    album: {
      id: 'album123',
      name: 'Test Album',
      uri: 'spotify:album:album123',
      type: 'album',
      album_type: 'album',
      href: 'https://api.spotify.com/v1/albums/album123',
      external_urls: {
        spotify: 'https://open.spotify.com/album/album123',
      },
      artists: [
        {
          id: 'artist123',
          name: 'Test Artist',
          uri: 'spotify:artist:artist123',
          type: 'artist',
          href: 'https://api.spotify.com/v1/artists/artist123',
          external_urls: {
            spotify: 'https://open.spotify.com/artist/artist123',
          },
        },
      ],
      images: [
        {url: 'https://i.scdn.co/image/test-640.jpg', width: 640, height: 640},
        {url: 'https://i.scdn.co/image/test-300.jpg', width: 300, height: 300},
        {url: 'https://i.scdn.co/image/test-64.jpg', width: 64, height: 64},
      ],
      release_date: '2023-01-15',
      release_date_precision: 'day',
      total_tracks: 12,
    },
    duration_ms: 240000,
    explicit: false,
    popularity: 75,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    disc_number: 1,
    is_local: false,
    external_ids: {
      isrc: 'USUM71234567',
    },
    ...overrides,
  }
}

/**
 * Build a realistic Spotify playlist response
 */
export function buildSpotifyPlaylist(overrides?: Partial<SpotifyPlaylistFull>): SpotifyPlaylistFull {
  return {
    id: 'playlist123',
    name: 'Test Playlist',
    uri: 'spotify:playlist:playlist123',
    type: 'playlist',
    href: 'https://api.spotify.com/v1/playlists/playlist123',
    external_urls: {
      spotify: 'https://open.spotify.com/playlist/playlist123',
    },
    description: 'A test playlist',
    public: true,
    collaborative: false,
    snapshot_id: 'snapshot123',
    owner: {
      id: 'user123',
      display_name: 'Test User',
      uri: 'spotify:user:user123',
      type: 'user',
      href: 'https://api.spotify.com/v1/users/user123',
      external_urls: {
        spotify: 'https://open.spotify.com/user/user123',
      },
    },
    images: [
      {url: 'https://mosaic.scdn.co/640/test.jpg', width: 640, height: 640},
    ],
    tracks: {
      href: 'https://api.spotify.com/v1/playlists/playlist123/tracks',
      items: [],
      limit: 100,
      next: null,
      offset: 0,
      previous: null,
      total: 0,
    },
    followers: {
      href: null,
      total: 100,
    },
    ...overrides,
  }
}

// ===== Mock Fetch Functions =====

/**
 * Mock global fetch for Deezer API calls
 * Call this in beforeEach to intercept Deezer requests
 */
export function mockDeezerAPI(responses: {
  [isrc: string]: DeezerTrack | null
}): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Deezer ISRC lookup
    const isrcMatch = url.match(/api\.deezer\.com\/track\/isrc:([A-Z0-9]+)/)
    if (isrcMatch) {
      const isrc = isrcMatch[1]
      const track = responses[isrc]

      if (track) {
        return new Response(JSON.stringify(track), {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        })
      } else {
        return new Response(JSON.stringify({error: {code: 800, message: 'Not found'}}), {
          status: 404,
          headers: {'Content-Type': 'application/json'},
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
  'track.getInfo'?: Record<string, LastFmTrackInfo | null>
  'track.getCorrection'?: Record<string, {artist: string; name: string} | null>
  'track.getSimilar'?: Record<string, {artist: string; name: string; match: number}[]>
  'track.getTopTags'?: Record<string, {name: string; count: number}[]>
  'artist.getInfo'?: Record<string, LastFmArtistInfo | null>
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
        case 'track.getInfo': {
          const info = responses['track.getInfo']?.[key]
          if (info) {
            return new Response(JSON.stringify({track: info}), {
              status: 200,
              headers: {'Content-Type': 'application/json'},
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
                      name: correction.name,
                      artist: {name: correction.artist, url: 'https://www.last.fm/music/test'},
                      url: 'https://www.last.fm/music/test/_/test',
                    },
                  },
                },
              }),
              {
                status: 200,
                headers: {'Content-Type': 'application/json'},
              },
            )
          }
          break
        }
        case 'artist.getInfo': {
          const info = responses['artist.getInfo']?.[artist]
          if (info) {
            return new Response(JSON.stringify({artist: info}), {
              status: 200,
              headers: {'Content-Type': 'application/json'},
            })
          }
          break
        }
      }

      // Not found
      return new Response(JSON.stringify({error: 6, message: 'Track not found'}), {
        status: 404,
        headers: {'Content-Type': 'application/json'},
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
  responses: {
    [artistTrack: string]: {id: string; title: string; isrcs: string[]; score: number} | null
  },
): () => void {
  const originalFetch = global.fetch

  global.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // MusicBrainz recording search
    if (url.includes('musicbrainz.org/ws/2/recording')) {
      const urlObj = new URL(url)
      const query = urlObj.searchParams.get('query') ?? ''
      const artistMatch = query.match(/artist:"([^"]+)"/)
      const recordingMatch = query.match(/recording:"([^"]+)"/)

      if (artistMatch && recordingMatch) {
        const key = `${artistMatch[1]}|${recordingMatch[1]}`
        const recording = responses[key]

        if (recording) {
          return new Response(
            JSON.stringify({
              recordings: [
                {
                  id: recording.id,
                  title: recording.title,
                  'artist-credit': [{artist: {name: artistMatch[1]}}],
                  isrcs: recording.isrcs,
                  score: recording.score,
                },
              ],
            }),
            {
              status: 200,
              headers: {'Content-Type': 'application/json'},
            },
          )
        }
      }

      // Not found
      return new Response(JSON.stringify({recordings: []}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
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
  'GET /v1/tracks/:id'?: Record<string, SpotifyTrackFull | null>
  'GET /v1/playlists/:id'?: Record<string, SpotifyPlaylistFull | null>
  'GET /v1/playlists/:id/tracks'?: Record<string, {items: unknown[]; total: number}>
  'GET /v1/search'?: (query: string) => SpotifyTrackFull[]
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
      const trackMatch = path.match(/^\/v1\/tracks\/([^/]+)$/)
      if (trackMatch && init?.method !== 'POST') {
        const trackId = trackMatch[1]
        const track = responses['GET /v1/tracks/:id']?.[trackId]
        if (track) {
          return new Response(JSON.stringify(track), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
      }

      // GET /v1/playlists/:id
      const playlistMatch = path.match(/^\/v1\/playlists\/([^/]+)$/)
      if (playlistMatch && init?.method !== 'POST') {
        const playlistId = playlistMatch[1]
        const playlist = responses['GET /v1/playlists/:id']?.[playlistId]
        if (playlist) {
          return new Response(JSON.stringify(playlist), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
      }

      // GET /v1/playlists/:id/tracks
      const playlistTracksMatch = path.match(/^\/v1\/playlists\/([^/]+)\/tracks$/)
      if (playlistTracksMatch && init?.method !== 'POST') {
        const playlistId = playlistTracksMatch[1]
        const tracks = responses['GET /v1/playlists/:id/tracks']?.[playlistId]
        if (tracks) {
          return new Response(JSON.stringify(tracks), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
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
              status: 200,
              headers: {'Content-Type': 'application/json'},
            },
          )
        }
      }

      // POST /v1/playlists/:id/tracks
      const addTracksMatch = path.match(/^\/v1\/playlists\/([^/]+)\/tracks$/)
      if (addTracksMatch && init?.method === 'POST') {
        const addFn = responses['POST /v1/playlists/:id/tracks']
        if (addFn) {
          const result = addFn()
          return new Response(JSON.stringify(result), {
            status: 201,
            headers: {'Content-Type': 'application/json'},
          })
        }
      }

      // Not found
      return new Response(JSON.stringify({error: {status: 404, message: 'Not found'}}), {
        status: 404,
        headers: {'Content-Type': 'application/json'},
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
