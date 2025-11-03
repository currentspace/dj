/**
 * Test Data Builders
 * Builder pattern for creating realistic test data
 */

import type {BPMEnrichment, EnrichmentCache} from '../../services/AudioEnrichmentService'
import type {LastFmSignals} from '../../services/LastFmService'

/**
 * Builder for BPM enrichment results
 */
export class EnrichmentResultBuilder {
  private data: BPMEnrichment = {
    bpm: 120,
    gain: -8.5,
    rank: 850000,
    release_date: '2023-01-15',
    source: 'deezer',
  }

  withBPM(bpm: null | number): this {
    this.data.bpm = bpm
    return this
  }

  withGain(gain: null | number): this {
    this.data.gain = gain
    return this
  }

  withRank(rank: null | number): this {
    this.data.rank = rank
    return this
  }

  withReleaseDate(date: null | string): this {
    this.data.release_date = date
    return this
  }

  withSource(source: 'deezer' | 'deezer-via-musicbrainz' | null): this {
    this.data.source = source
    return this
  }

  asNull(): this {
    this.data = {
      bpm: null,
      gain: null,
      rank: null,
      release_date: null,
      source: null,
    }
    return this
  }

  build(): BPMEnrichment {
    return {...this.data}
  }

  buildCached(ttl = 90 * 24 * 60 * 60, isMiss = false): EnrichmentCache {
    return {
      enrichment: this.build(),
      fetched_at: new Date().toISOString(),
      ttl,
      is_miss: isMiss,
    }
  }
}

/**
 * Builder for Last.fm signals
 */
export class LastFmSignalsBuilder {
  private data: LastFmSignals = {
    canonicalArtist: 'Test Artist',
    canonicalTrack: 'Test Track',
    url: 'https://www.last.fm/music/Test+Artist/_/Test+Track',
    mbid: 'track-mbid-123',
    listeners: 125000,
    playcount: 2500000,
    duration: 240,
    topTags: ['indie', 'alternative', 'rock'],
    similar: [
      {artist: 'Similar Artist 1', name: 'Similar Track 1', match: 0.95},
      {artist: 'Similar Artist 2', name: 'Similar Track 2', match: 0.85},
    ],
    album: {
      title: 'Test Album',
      artist: 'Test Artist',
      mbid: 'album-mbid-789',
      url: 'https://www.last.fm/music/Test+Artist/Test+Album',
      image: 'https://lastfm.freetls.fastly.net/i/u/174s/test.jpg',
    },
    wiki: {
      summary: 'Test track summary',
      content: 'Test track full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
    },
    artistInfo: {
      listeners: 500000,
      playcount: 10000000,
      tags: ['indie', 'alternative'],
      similar: [
        {name: 'Similar Artist 1', url: 'https://www.last.fm/music/Similar+Artist+1'},
        {name: 'Similar Artist 2', url: 'https://www.last.fm/music/Similar+Artist+2'},
      ],
      bio: {
        summary: 'Test artist bio summary',
        content: 'Test artist bio full content',
      },
      images: {
        small: 'https://lastfm.freetls.fastly.net/i/u/34s/artist.jpg',
        medium: 'https://lastfm.freetls.fastly.net/i/u/64s/artist.jpg',
        large: 'https://lastfm.freetls.fastly.net/i/u/174s/artist.jpg',
      },
    },
  }

  withCanonicalNames(artist: string, track: string): this {
    this.data.canonicalArtist = artist
    this.data.canonicalTrack = track
    return this
  }

  withListeners(listeners: number): this {
    this.data.listeners = listeners
    return this
  }

  withPlaycount(playcount: number): this {
    this.data.playcount = playcount
    return this
  }

  withTags(tags: string[]): this {
    this.data.topTags = tags
    return this
  }

  withSimilar(similar: {artist: string; name: string; match: number}[]): this {
    this.data.similar = similar
    return this
  }

  withArtistInfo(info: LastFmSignals['artistInfo']): this {
    this.data.artistInfo = info
    return this
  }

  withoutArtistInfo(): this {
    this.data.artistInfo = null
    return this
  }

  withoutWiki(): this {
    this.data.wiki = null
    return this
  }

  build(): LastFmSignals {
    return {...this.data}
  }
}

/**
 * Builder for playlist analysis results
 */
export class PlaylistAnalysisBuilder {
  private data = {
    playlist_name: 'Test Playlist',
    playlist_description: 'A test playlist',
    total_tracks: 10,
    metadata_analysis: {
      avg_popularity: 75,
      avg_duration_ms: 240000,
      avg_duration_minutes: 4,
      explicit_tracks: 2,
      explicit_percentage: 20,
      top_genres: ['indie', 'alternative', 'rock'],
      release_year_range: {
        oldest: 2015,
        newest: 2023,
        average: 2019,
      },
      total_artists: 8,
    },
    deezer_analysis: {
      total_checked: 10,
      tracks_found: 7,
      bpm: {
        avg: 120,
        range: {min: 90, max: 150},
        sample_size: 7,
      },
      rank: {
        avg: 850000,
        range: {min: 500000, max: 1200000},
        sample_size: 7,
      },
      gain: {
        avg: -8.5,
        range: {min: -12, max: -6},
        sample_size: 7,
      },
      source: 'deezer' as const,
    },
    lastfm_analysis: {
      crowd_tags: [
        {tag: 'indie', count: 8},
        {tag: 'alternative', count: 6},
        {tag: 'rock', count: 5},
      ],
      avg_listeners: 125000,
      avg_playcount: 2500000,
      similar_tracks: ['Artist 1 - Track 1', 'Artist 2 - Track 2'],
      sample_size: 10,
      artists_enriched: 8,
      source: 'lastfm' as const,
    },
    track_ids: [
      'spotify:track:track1',
      'spotify:track:track2',
      'spotify:track:track3',
    ],
    message: 'Analysis complete',
  }

  withPlaylistName(name: string): this {
    this.data.playlist_name = name
    return this
  }

  withTotalTracks(count: number): this {
    this.data.total_tracks = count
    return this
  }

  withAvgPopularity(popularity: number): this {
    this.data.metadata_analysis.avg_popularity = popularity
    return this
  }

  withTopGenres(genres: string[]): this {
    this.data.metadata_analysis.top_genres = genres
    return this
  }

  withBPMStats(avg: number, min: number, max: number, sampleSize: number): this {
    this.data.deezer_analysis.bpm = {avg, range: {min, max}, sample_size: sampleSize}
    return this
  }

  withCrowdTags(tags: {tag: string; count: number}[]): this {
    this.data.lastfm_analysis.crowd_tags = tags
    return this
  }

  withoutDeezerAnalysis(): this {
    this.data.deezer_analysis = {
      total_checked: 0,
      tracks_found: 0,
      bpm: {avg: 0, range: {min: 0, max: 0}, sample_size: 0},
      rank: {avg: 0, range: {min: 0, max: 0}, sample_size: 0},
      gain: {avg: 0, range: {min: 0, max: 0}, sample_size: 0},
      source: 'deezer',
    }
    return this
  }

  withoutLastFmAnalysis(): this {
    this.data.lastfm_analysis = {
      crowd_tags: [],
      avg_listeners: 0,
      avg_playcount: 0,
      similar_tracks: [],
      sample_size: 0,
      artists_enriched: 0,
      source: 'lastfm',
    }
    return this
  }

  build() {
    return {...this.data}
  }
}

/**
 * Builder for SSE writer (mock WritableStreamDefaultWriter)
 */
export class SSEWriterBuilder {
  private chunks: string[] = []
  private closed = false

  build(): WritableStreamDefaultWriter<Uint8Array> {
    return {
      ready: Promise.resolve(),
      desiredSize: 1,
      closed: Promise.resolve(),
      write: async (chunk: Uint8Array) => {
        if (this.closed) {
          throw new Error('Writer is closed')
        }
        this.chunks.push(new TextDecoder().decode(chunk))
      },
      close: async () => {
        this.closed = true
      },
      abort: async () => {
        this.closed = true
      },
      releaseLock: () => {},
    }
  }

  getWrittenChunks(): string[] {
    return [...this.chunks]
  }

  getWrittenText(): string {
    return this.chunks.join('')
  }

  getSSEEvents(): {event?: string; data?: string}[] {
    const events: {event?: string; data?: string}[] = []
    const lines = this.getWrittenText().split('\n')

    let currentEvent: {event?: string; data?: string} = {}
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent.event = line.substring(6).trim()
      } else if (line.startsWith('data:')) {
        currentEvent.data = line.substring(5).trim()
      } else if (line === '') {
        if (currentEvent.event || currentEvent.data) {
          events.push(currentEvent)
          currentEvent = {}
        }
      }
    }

    return events
  }
}

/**
 * Faker-style data generation utilities
 */
export const faker = {
  /**
   * Generate a random ISRC code
   */
  isrc(): string {
    const country = ['US', 'GB', 'DE', 'FR', 'JP'][Math.floor(Math.random() * 5)]
    const registrant = Math.random().toString(36).substring(2, 5).toUpperCase()
    const year = (Math.floor(Math.random() * 50) + 70).toString().padStart(2, '0')
    const designation = Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, '0')
    return `${country}${registrant}${year}${designation}`
  },

  /**
   * Generate a random Spotify ID
   */
  spotifyId(): string {
    return Math.random().toString(36).substring(2, 24)
  },

  /**
   * Generate a random artist name
   */
  artistName(): string {
    const prefixes = ['The', 'A', 'Los', 'Big', 'Little']
    const words = ['Sun', 'Moon', 'Star', 'Ocean', 'Mountain', 'River', 'Forest', 'Desert']
    const suffixes = ['Band', 'Project', 'Collective', 'Orchestra', 'Ensemble']

    const hasPrefix = Math.random() > 0.5
    const hasSuffix = Math.random() > 0.3

    let name = words[Math.floor(Math.random() * words.length)]
    if (hasPrefix) {
      name = `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${name}`
    }
    if (hasSuffix) {
      name = `${name} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`
    }

    return name
  },

  /**
   * Generate a random track name
   */
  trackName(): string {
    const adjectives = ['Lost', 'Broken', 'Golden', 'Silent', 'Wild', 'Eternal']
    const nouns = ['Dreams', 'Hearts', 'Lights', 'Roads', 'Nights', 'Days']

    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`
  },

  /**
   * Generate a random BPM
   */
  bpm(): number {
    return Math.floor(Math.random() * 130) + 60 // 60-190 BPM
  },

  /**
   * Generate a random popularity score
   */
  popularity(): number {
    return Math.floor(Math.random() * 100)
  },

  /**
   * Generate a random duration in milliseconds
   */
  durationMs(): number {
    return Math.floor(Math.random() * 300000) + 120000 // 2-7 minutes
  },

  /**
   * Generate a random release year
   */
  releaseYear(): number {
    return Math.floor(Math.random() * 50) + 1974 // 1974-2024
  },

  /**
   * Generate a random genre
   */
  genre(): string {
    const genres = [
      'indie',
      'rock',
      'pop',
      'electronic',
      'hip hop',
      'jazz',
      'classical',
      'folk',
      'metal',
      'punk',
    ]
    return genres[Math.floor(Math.random() * genres.length)]
  },
}

/**
 * Convenience functions for common builders
 */
export function buildEnrichmentResult(overrides?: Partial<BPMEnrichment>): BPMEnrichment {
  const builder = new EnrichmentResultBuilder()
  if (overrides) {
    if (overrides.bpm !== undefined) builder.withBPM(overrides.bpm)
    if (overrides.gain !== undefined) builder.withGain(overrides.gain)
    if (overrides.rank !== undefined) builder.withRank(overrides.rank)
    if (overrides.release_date !== undefined) builder.withReleaseDate(overrides.release_date)
    if (overrides.source !== undefined) builder.withSource(overrides.source)
  }
  return builder.build()
}

export function buildLastFmSignals(overrides?: Partial<LastFmSignals>): LastFmSignals {
  const builder = new LastFmSignalsBuilder()
  if (overrides) {
    if (overrides.canonicalArtist && overrides.canonicalTrack) {
      builder.withCanonicalNames(overrides.canonicalArtist, overrides.canonicalTrack)
    }
    if (overrides.listeners !== undefined) builder.withListeners(overrides.listeners)
    if (overrides.playcount !== undefined) builder.withPlaycount(overrides.playcount)
    if (overrides.topTags) builder.withTags(overrides.topTags)
    if (overrides.similar) builder.withSimilar(overrides.similar)
    if (overrides.artistInfo !== undefined) builder.withArtistInfo(overrides.artistInfo)
  }
  return builder.build()
}

export function buildPlaylistAnalysis() {
  return new PlaylistAnalysisBuilder()
}

export function buildSSEWriter() {
  return new SSEWriterBuilder()
}

/**
 * Build a mock Spotify track
 */
export function buildSpotifyTrack(overrides?: {
  id?: string
  name?: string
  artists?: { name: string }[]
  duration_ms?: number
  external_ids?: { isrc?: string }
}): {
  id: string
  name: string
  artists: { name: string }[]
  duration_ms: number
  external_ids?: { isrc?: string }
} {
  return {
    id: overrides?.id ?? 'track123',
    name: overrides?.name ?? 'Test Track',
    artists: overrides?.artists ?? [{ name: 'Test Artist' }],
    duration_ms: overrides?.duration_ms ?? 180000, // 3 minutes
    external_ids: overrides?.external_ids,
  }
}

/**
 * Build a mock Deezer track response
 */
export function buildDeezerTrack(overrides?: {
  id?: number
  title?: string
  duration?: number
  bpm?: number | null
  gain?: number | null
  rank?: number | null
  release_date?: string | null
}) {
  return {
    id: overrides?.id ?? 12345,
    title: overrides?.title ?? 'Test Track',
    duration: overrides?.duration ?? 180, // seconds
    bpm: overrides?.bpm ?? 120,
    gain: overrides?.gain ?? -8.5,
    rank: overrides?.rank ?? 500000,
    release_date: overrides?.release_date ?? '2023-01-15',
  }
}

/**
 * Build a mock MusicBrainz recording
 */
export function buildMusicBrainzRecording(overrides?: {
  id?: string
  title?: string
  length?: number
  isrcs?: string[]
  'artist-credit'?: { name: string }[]
}) {
  return {
    id: overrides?.id ?? 'mbid-12345',
    title: overrides?.title ?? 'Test Track',
    length: overrides?.length ?? 180000, // milliseconds
    isrcs: overrides?.isrcs ?? ['USRC12345678'],
    'artist-credit': overrides?.['artist-credit'] ?? [{ name: 'Test Artist' }],
  }
}

/**
 * Build a mock Last.fm track
 */
export function buildLastFmTrack(overrides?: {
  artist?: string
  name?: string
  duration_ms?: number
}): {
  artist: string
  name: string
  duration_ms?: number
} {
  return {
    artist: overrides?.artist ?? 'Test Artist',
    name: overrides?.name ?? 'Test Track',
    duration_ms: overrides?.duration_ms,
  }
}

/**
 * Build a mock Last.fm track info response
 */
export function buildLastFmTrackInfo(overrides?: {
  listeners?: number
  playcount?: number
  mbid?: string | null
  url?: string
  duration?: number | null
  album?: {
    artist: string
    title: string
    mbid: string | null
    url: string
    image: { '#text': string; size: string }[]
  }
  wiki?: {
    summary: string
    content: string
    published: string
  }
}) {
  return {
    track: {
      name: 'Test Track',
      mbid: overrides?.mbid ?? 'mbid-12345',
      url: overrides?.url ?? 'https://last.fm/music/test',
      duration: overrides?.duration ?? 180000,
      listeners: overrides?.listeners ?? 10000,
      playcount: overrides?.playcount ?? 50000,
      artist: {
        name: 'Test Artist',
        mbid: 'artist-mbid',
        url: 'https://last.fm/music/test+artist',
      },
      album: overrides?.album ?? {
        artist: 'Test Artist',
        title: 'Test Album',
        mbid: 'album-mbid',
        url: 'https://last.fm/music/test+album',
        image: [
          { '#text': 'http://example.com/small.jpg', size: 'small' },
          { '#text': 'http://example.com/medium.jpg', size: 'medium' },
          { '#text': 'http://example.com/large.jpg', size: 'large' },
        ],
      },
      wiki: overrides?.wiki ?? null,
    },
  }
}

/**
 * Build a mock Last.fm top tags response
 */
export function buildLastFmTopTags(tags: string[]) {
  return {
    toptags: {
      tag: tags.map(name => ({ name, count: 100, url: `https://last.fm/tag/${name}` })),
    },
  }
}

/**
 * Build a mock Last.fm similar tracks response
 */
export function buildLastFmSimilarTracks(
  tracks: { artist: string; name: string; match: number }[],
) {
  return {
    similartracks: {
      track: tracks.map(t => ({
        name: t.name,
        match: t.match,
        artist: { name: t.artist },
        url: `https://last.fm/music/${t.artist}/${t.name}`,
      })),
    },
  }
}

/**
 * Build a mock Last.fm artist info response
 */
export function buildLastFmArtistInfo(overrides?: {
  listeners?: number
  playcount?: number
  tags?: string[]
  similar?: { name: string; url: string }[]
  bio?: { summary: string; content: string }
  images?: { '#text': string; size: string }[]
}) {
  return {
    artist: {
      name: 'Test Artist',
      mbid: 'artist-mbid',
      url: 'https://last.fm/music/test+artist',
      image: overrides?.images ?? [
        { '#text': 'http://example.com/small.jpg', size: 'small' },
        { '#text': 'http://example.com/medium.jpg', size: 'medium' },
        { '#text': 'http://example.com/large.jpg', size: 'large' },
      ],
      stats: {
        listeners: overrides?.listeners ?? 100000,
        playcount: overrides?.playcount ?? 500000,
      },
      similar: {
        artist:
          overrides?.similar?.map(s => ({
            name: s.name,
            url: s.url,
          })) ?? [],
      },
      tags: {
        tag: overrides?.tags?.map(name => ({ name })) ?? [],
      },
      bio: overrides?.bio ?? {
        summary: 'Test artist bio summary',
        content: 'Test artist bio content',
      },
    },
  }
}

/**
 * Build a mock Last.fm track correction response
 */
export function buildLastFmCorrection(overrides?: {
  artist?: string
  track?: string
} | null) {
  if (overrides === null) {
    return {
      corrections: {
        correction: null,
      },
    }
  }

  return {
    corrections: {
      correction: {
        track: {
          name: overrides?.track ?? 'Corrected Track',
          artist: {
            name: overrides?.artist ?? 'Corrected Artist',
          },
        },
      },
    },
  }
}
