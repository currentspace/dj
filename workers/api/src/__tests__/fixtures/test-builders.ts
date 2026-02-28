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
      is_miss: isMiss,
      ttl,
    }
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
}

/**
 * Builder for Last.fm signals
 */
export class LastFmSignalsBuilder {
  private data: LastFmSignals = {
    album: {
      artist: 'Test Artist',
      image: 'https://lastfm.freetls.fastly.net/i/u/174s/test.jpg',
      mbid: 'album-mbid-789',
      title: 'Test Album',
      url: 'https://www.last.fm/music/Test+Artist/Test+Album',
    },
    artistInfo: {
      bio: {
        content: 'Test artist bio full content',
        summary: 'Test artist bio summary',
      },
      images: {
        large: 'https://lastfm.freetls.fastly.net/i/u/174s/artist.jpg',
        medium: 'https://lastfm.freetls.fastly.net/i/u/64s/artist.jpg',
        small: 'https://lastfm.freetls.fastly.net/i/u/34s/artist.jpg',
      },
      listeners: 500000,
      playcount: 10000000,
      similar: [
        {name: 'Similar Artist 1', url: 'https://www.last.fm/music/Similar+Artist+1'},
        {name: 'Similar Artist 2', url: 'https://www.last.fm/music/Similar+Artist+2'},
      ],
      tags: ['indie', 'alternative'],
    },
    canonicalArtist: 'Test Artist',
    canonicalTrack: 'Test Track',
    duration: 240,
    listeners: 125000,
    mbid: 'track-mbid-123',
    playcount: 2500000,
    similar: [
      {artist: 'Similar Artist 1', match: 0.95, name: 'Similar Track 1'},
      {artist: 'Similar Artist 2', match: 0.85, name: 'Similar Track 2'},
    ],
    topTags: ['indie', 'alternative', 'rock'],
    url: 'https://www.last.fm/music/Test+Artist/_/Test+Track',
    wiki: {
      content: 'Test track full content',
      published: 'Sat, 1 Jan 2023 00:00:00 +0000',
      summary: 'Test track summary',
    },
  }

  build(): LastFmSignals {
    return {...this.data}
  }

  withArtistInfo(info: LastFmSignals['artistInfo']): this {
    this.data.artistInfo = info
    return this
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

  withoutArtistInfo(): this {
    this.data.artistInfo = null
    return this
  }

  withoutWiki(): this {
    this.data.wiki = null
    return this
  }

  withPlaycount(playcount: number): this {
    this.data.playcount = playcount
    return this
  }

  withSimilar(similar: {artist: string; match: number; name: string;}[]): this {
    this.data.similar = similar
    return this
  }

  withTags(tags: string[]): this {
    this.data.topTags = tags
    return this
  }
}

/**
 * Builder for playlist analysis results
 */
export class PlaylistAnalysisBuilder {
  private data = {
    deezer_analysis: {
      bpm: {
        avg: 120,
        range: {max: 150, min: 90},
        sample_size: 7,
      },
      gain: {
        avg: -8.5,
        range: {max: -6, min: -12},
        sample_size: 7,
      },
      rank: {
        avg: 850000,
        range: {max: 1200000, min: 500000},
        sample_size: 7,
      },
      source: 'deezer' as const,
      total_checked: 10,
      tracks_found: 7,
    },
    lastfm_analysis: {
      artists_enriched: 8,
      avg_listeners: 125000,
      avg_playcount: 2500000,
      crowd_tags: [
        {count: 8, tag: 'indie'},
        {count: 6, tag: 'alternative'},
        {count: 5, tag: 'rock'},
      ],
      sample_size: 10,
      similar_tracks: ['Artist 1 - Track 1', 'Artist 2 - Track 2'],
      source: 'lastfm' as const,
    },
    message: 'Analysis complete',
    metadata_analysis: {
      avg_duration_minutes: 4,
      avg_duration_ms: 240000,
      avg_popularity: 75,
      explicit_percentage: 20,
      explicit_tracks: 2,
      release_year_range: {
        average: 2019,
        newest: 2023,
        oldest: 2015,
      },
      top_genres: ['indie', 'alternative', 'rock'],
      total_artists: 8,
    },
    playlist_description: 'A test playlist',
    playlist_name: 'Test Playlist',
    total_tracks: 10,
    track_ids: [
      'spotify:track:track1',
      'spotify:track:track2',
      'spotify:track:track3',
    ],
  }

  build() {
    return {...this.data}
  }

  withAvgPopularity(popularity: number): this {
    this.data.metadata_analysis.avg_popularity = popularity
    return this
  }

  withBPMStats(avg: number, min: number, max: number, sampleSize: number): this {
    this.data.deezer_analysis.bpm = {avg, range: {max, min}, sample_size: sampleSize}
    return this
  }

  withCrowdTags(tags: {count: number; tag: string;}[]): this {
    this.data.lastfm_analysis.crowd_tags = tags
    return this
  }

  withoutDeezerAnalysis(): this {
    this.data.deezer_analysis = {
      bpm: {avg: 0, range: {max: 0, min: 0}, sample_size: 0},
      gain: {avg: 0, range: {max: 0, min: 0}, sample_size: 0},
      rank: {avg: 0, range: {max: 0, min: 0}, sample_size: 0},
      source: 'deezer',
      total_checked: 0,
      tracks_found: 0,
    }
    return this
  }

  withoutLastFmAnalysis(): this {
    this.data.lastfm_analysis = {
      artists_enriched: 0,
      avg_listeners: 0,
      avg_playcount: 0,
      crowd_tags: [],
      sample_size: 0,
      similar_tracks: [],
      source: 'lastfm',
    }
    return this
  }

  withPlaylistName(name: string): this {
    this.data.playlist_name = name
    return this
  }

  withTopGenres(genres: string[]): this {
    this.data.metadata_analysis.top_genres = genres
    return this
  }

  withTotalTracks(count: number): this {
    this.data.total_tracks = count
    return this
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
      abort: async () => {
        this.closed = true
      },
      close: async () => {
        this.closed = true
      },
      closed: Promise.resolve(),
      desiredSize: 1,
      ready: Promise.resolve(),
      releaseLock: () => { /* noop */ },
      write: async (chunk: Uint8Array) => {
        if (this.closed) {
          throw new Error('Writer is closed')
        }
        this.chunks.push(new TextDecoder().decode(chunk))
      },
    }
  }

  getSSEEvents(): {data?: string; event?: string;}[] {
    const events: {data?: string; event?: string;}[] = []
    const lines = this.getWrittenText().split('\n')

    let currentEvent: {data?: string; event?: string;} = {}
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

  getWrittenChunks(): string[] {
    return [...this.chunks]
  }

  getWrittenText(): string {
    return this.chunks.join('')
  }
}

/**
 * Faker-style data generation utilities
 */
export const faker = {
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
   * Generate a random BPM
   */
  bpm(): number {
    return Math.floor(Math.random() * 130) + 60 // 60-190 BPM
  },

  /**
   * Generate a random duration in milliseconds
   */
  durationMs(): number {
    return Math.floor(Math.random() * 300000) + 120000 // 2-7 minutes
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
   * Generate a random popularity score
   */
  popularity(): number {
    return Math.floor(Math.random() * 100)
  },

  /**
   * Generate a random release year
   */
  releaseYear(): number {
    return Math.floor(Math.random() * 50) + 1974 // 1974-2024
  },

  /**
   * Generate a random Spotify ID
   */
  spotifyId(): string {
    return Math.random().toString(36).substring(2, 24)
  },

  /**
   * Generate a random track name
   */
  trackName(): string {
    const adjectives = ['Lost', 'Broken', 'Golden', 'Silent', 'Wild', 'Eternal']
    const nouns = ['Dreams', 'Hearts', 'Lights', 'Roads', 'Nights', 'Days']

    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`
  },
}

/**
 * Build a mock Deezer track response
 * Must match DeezerTrackSchema from shared-types
 * NOTE: Use explicit undefined check for nullable fields to allow passing null
 */
export function buildDeezerTrack(overrides?: {
  bpm?: null | number
  duration?: number
  gain?: null | number
  id?: number
  rank?: null | number
  release_date?: null | string
  title?: string
}) {
  return {
    // Use undefined check (not ??) to allow explicit null to pass through
    bpm: overrides?.bpm !== undefined ? overrides.bpm : 120,
    duration: overrides?.duration ?? 180, // seconds
    gain: overrides?.gain !== undefined ? overrides.gain : -8.5,
    id: overrides?.id ?? 12345,
    rank: overrides?.rank !== undefined ? overrides.rank : 500000,
    release_date: overrides?.release_date !== undefined ? overrides.release_date : '2023-01-15',
    title: overrides?.title ?? 'Test Track',
  }
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

/**
 * Build a mock Last.fm artist info response
 */
export function buildLastFmArtistInfo(overrides?: {
  bio?: { content: string; summary: string; }
  images?: { '#text': string; size: string }[]
  listeners?: number
  playcount?: number
  similar?: { name: string; url: string }[]
  tags?: string[]
}) {
  return {
    artist: {
      bio: overrides?.bio ?? {
        content: 'Test artist bio content',
        summary: 'Test artist bio summary',
      },
      image: overrides?.images ?? [
        { '#text': 'http://example.com/small.jpg', size: 'small' },
        { '#text': 'http://example.com/medium.jpg', size: 'medium' },
        { '#text': 'http://example.com/large.jpg', size: 'large' },
      ],
      mbid: 'artist-mbid',
      name: 'Test Artist',
      similar: {
        artist:
          overrides?.similar?.map(s => ({
            name: s.name,
            url: s.url,
          })) ?? [],
      },
      stats: {
        listeners: overrides?.listeners ?? 100000,
        playcount: overrides?.playcount ?? 500000,
      },
      tags: {
        tag: overrides?.tags?.map(name => ({ name })) ?? [],
      },
      url: 'https://last.fm/music/test+artist',
    },
  }
}

/**
 * Build a mock Last.fm track correction response
 * Must match LastFmTrackCorrectionResponseSchema from shared-types
 */
export function buildLastFmCorrection(overrides?: null | {
  artist?: string
  track?: string
}) {
  if (overrides === null) {
    // No correction available - schema allows null
    return {
      corrections: {
        correction: null,
      },
    }
  }

  const artistName = overrides?.artist ?? 'Corrected Artist'
  const trackName = overrides?.track ?? 'Corrected Track'

  return {
    corrections: {
      correction: {
        track: {
          artist: {
            name: artistName,
            url: `https://www.last.fm/music/${encodeURIComponent(artistName)}`,
          },
          name: trackName,
          url: `https://www.last.fm/music/${encodeURIComponent(artistName)}/_/${encodeURIComponent(trackName)}`,
        },
      },
    },
  }
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

/**
 * Build a mock Last.fm similar tracks response
 * Must match LastFmTrackSimilarResponseSchema from shared-types
 */
export function buildLastFmSimilarTracks(
  tracks: { artist: string; match: number; name: string; }[],
) {
  return {
    similartracks: {
      track: tracks.map(t => ({
        // artist must include url (required by LastFmArtistSchema)
        artist: {
          name: t.artist,
          url: `https://www.last.fm/music/${encodeURIComponent(t.artist)}`,
        },
        match: t.match,
        name: t.name,
        url: `https://www.last.fm/music/${encodeURIComponent(t.artist)}/_/${encodeURIComponent(t.name)}`,
      })),
    },
  }
}

/**
 * Build a mock Last.fm top tags response
 */
export function buildLastFmTopTags(tags: string[]) {
  return {
    toptags: {
      tag: tags.map(name => ({ count: 100, name, url: `https://last.fm/tag/${name}` })),
    },
  }
}

/**
 * Build a mock Last.fm track
 */
export function buildLastFmTrack(overrides?: {
  artist?: string
  duration_ms?: number
  name?: string
}): {
  artist: string
  duration_ms?: number
  name: string
} {
  return {
    artist: overrides?.artist ?? 'Test Artist',
    duration_ms: overrides?.duration_ms,
    name: overrides?.name ?? 'Test Track',
  }
}

/**
 * Build a mock Last.fm track info response
 * Must match LastFmTrackInfoResponseSchema from shared-types
 * Note: wiki field is optional() not nullable(), so omit it when not provided
 */
export function buildLastFmTrackInfo(overrides?: {
  album?: {
    artist: string
    image: { '#text': string; size: string }[]
    mbid: null | string
    title: string
    url: string
  }
  duration?: null | number
  listeners?: number
  mbid?: null | string
  playcount?: number
  url?: string
  wiki?: {
    content: string
    published: string
    summary: string
  }
}) {
  // Build base track object
  const track: Record<string, unknown> = {
    album: overrides?.album ?? {
      artist: 'Test Artist',
      image: [
        { '#text': 'https://lastfm.freetls.fastly.net/i/u/34s/small.jpg', size: 'small' },
        { '#text': 'https://lastfm.freetls.fastly.net/i/u/64s/medium.jpg', size: 'medium' },
        { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/large.jpg', size: 'large' },
      ],
      mbid: 'album-mbid',
      title: 'Test Album',
      url: 'https://www.last.fm/music/test+album',
    },
    artist: {
      mbid: 'artist-mbid',
      name: 'Test Artist',
      url: 'https://www.last.fm/music/test+artist',
    },
    duration: overrides?.duration ?? 180000,
    listeners: overrides?.listeners ?? 10000,
    mbid: overrides?.mbid ?? 'mbid-12345',
    name: 'Test Track',
    playcount: overrides?.playcount ?? 50000,
    url: overrides?.url ?? 'https://www.last.fm/music/test',
  }

  // Only include wiki if explicitly provided (schema says optional(), not nullable())
  if (overrides?.wiki) {
    track.wiki = overrides.wiki
  }

  return { track }
}

/**
 * Build a mock MusicBrainz recording
 * Must match MusicBrainzRecordingSchema from shared-types
 */
export function buildMusicBrainzRecording(overrides?: {
  'artist-credit'?: { artist: { id: string; name: string }; name: string }[]
  id?: string
  isrcs?: string[]
  length?: number
  title?: string
}) {
  return {
    // artist-credit must match MusicBrainzArtistCreditSchema
    'artist-credit': overrides?.['artist-credit'] ?? [{
      artist: { id: 'artist-mbid-123', name: 'Test Artist' },
      name: 'Test Artist',
    }],
    id: overrides?.id ?? 'mbid-12345',
    isrcs: overrides?.isrcs ?? ['USRC12345678'],
    length: overrides?.length ?? 180000, // milliseconds
    title: overrides?.title ?? 'Test Track',
  }
}

/**
 * Build a mock MusicBrainz search response
 * Must match MusicBrainzSearchResponseSchema from shared-types
 * The schema requires count and offset fields, not just recordings!
 */
export function buildMusicBrainzSearchResponse(recordings: ReturnType<typeof buildMusicBrainzRecording>[]) {
  return {
    count: recordings.length,
    offset: 0,
    recordings,
  }
}

export function buildPlaylistAnalysis() {
  return new PlaylistAnalysisBuilder()
}

/**
 * Build a mock Spotify track
 */
export function buildSpotifyTrack(overrides?: {
  artists?: { name: string }[]
  duration_ms?: number
  external_ids?: { isrc?: string }
  id?: string
  name?: string
}): {
  artists: { name: string }[]
  duration_ms: number
  external_ids?: { isrc?: string }
  id: string
  name: string
} {
  return {
    artists: overrides?.artists ?? [{ name: 'Test Artist' }],
    duration_ms: overrides?.duration_ms ?? 180000, // 3 minutes
    external_ids: overrides?.external_ids,
    id: overrides?.id ?? 'track123',
    name: overrides?.name ?? 'Test Track',
  }
}

export function buildSSEWriter() {
  return new SSEWriterBuilder()
}
