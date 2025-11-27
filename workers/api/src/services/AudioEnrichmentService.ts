/**
 * Audio Enrichment Service
 * Uses free catalog APIs (Deezer + MusicBrainz) to enrich tracks with BPM data
 *
 * Strategy:
 * 1. Use Spotify ISRC from track.external_ids.isrc
 * 2. Query Deezer by ISRC to get BPM and gain
 * 3. If no ISRC, fallback to MusicBrainz to find ISRC, then retry Deezer
 */

import {
  DeezerSearchResponseSchema,
  type DeezerTrack,
  DeezerTrackSchema,
  type MusicBrainzRecording,
  MusicBrainzSearchResponseSchema,
} from '@dj/shared-types'

import {BPM_RANGE, CACHE_TTL, DURATION_MATCH} from '../constants'
import {safeParse} from '../lib/guards'
import {getLogger} from '../utils/LoggerContext'
import {getGlobalOrchestrator, rateLimitedDeezerCall} from '../utils/RateLimitedAPIClients'

export interface BPMEnrichment {
  bpm: null | number
  gain: null | number
  rank: null | number // Deezer popularity rank (higher = more popular)
  release_date: null | string // Full release date from Deezer
  source: 'deezer' | 'deezer-via-musicbrainz' | null
}

export interface EnrichmentCache {
  enrichment: BPMEnrichment
  fetched_at: string
  is_miss?: boolean // Track if this was a cache miss (null result)
  ttl: number
}

interface SpotifyTrack {
  artists: {name: string}[]
  duration_ms: number
  external_ids?: {isrc?: string}
  id: string
  name: string
}

export class AudioEnrichmentService {
  private cache: KVNamespace | null
  private cacheTTL: number = CACHE_TTL.DEEZER_HIT_SECONDS
  private missCacheTTL: number = CACHE_TTL.MISS_SECONDS

  constructor(cache?: KVNamespace) {
    this.cache = cache ?? null
  }

  /**
   * Validate BPM value (reject suspicious values)
   */
  static isValidBPM(bpm: null | number): boolean {
    if (bpm === null) return false
    return bpm >= BPM_RANGE.MIN && bpm <= BPM_RANGE.MAX
  }

  /**
   * Batch enrich multiple tracks
   * Rate limiting is handled by the orchestrator via continuous queue processing
   */
  async batchEnrichTracks(tracks: SpotifyTrack[]): Promise<Map<string, BPMEnrichment>> {
    const results = new Map<string, BPMEnrichment>()

    // Process all tracks in parallel - orchestrator controls concurrency and rate
    const promises = tracks.map(async track => {
      const enrichment = await this.enrichTrack(track)
      results.set(track.id, enrichment)
    })

    await Promise.all(promises)

    return results
  }

  /**
   * Enrich a single track with BPM data
   */
  async enrichTrack(track: SpotifyTrack): Promise<BPMEnrichment> {
    const cacheKey = track.id

    // Debug: Log incoming track structure
    getLogger()?.info(`[BPMEnrichment] enrichTrack called for "${track.name}" by ${track.artists[0]?.name}`, {
      external_ids: track.external_ids,
      has_external_ids: !!track.external_ids,
      track_keys: Object.keys(track),
    })

    // Try cache first
    let existingEnrichment: BPMEnrichment | null = null
    if (this.cache) {
      const cached = await this.getCached(cacheKey)
      if (cached) {
        // If this is a complete hit (has BPM), return it
        if (cached.enrichment.bpm !== null) {
          getLogger()?.info(`[DeezerEnrichment] ✅ Cache hit for ${track.id}:`, {
            bpm: cached.enrichment.bpm,
            gain: cached.enrichment.gain,
            rank: cached.enrichment.rank,
            release_date: cached.enrichment.release_date,
          })
          return cached.enrichment
        }

        // If this is a recent miss (less than 5 minutes old), return the miss
        const age = Date.now() - new Date(cached.fetched_at).getTime()
        if (cached.is_miss && age < this.missCacheTTL * 1000) {
          getLogger()?.info(`[DeezerEnrichment] 🔄 Recent miss cached for ${track.id}, age: ${Math.round(age / 1000 / 60)}m`)
          return cached.enrichment
        }

        // Store existing partial data for merging
        existingEnrichment = cached.enrichment
        getLogger()?.info(`[DeezerEnrichment] 🔄 Retrying old miss for ${track.id}`)
      }
    }

    // Get ISRC from Spotify track
    const isrc = track.external_ids?.isrc

    getLogger()?.info(`[BPMEnrichment] Track "${track.name}" ISRC: ${isrc ?? 'NOT FOUND'}`)

    let enrichment: BPMEnrichment

    if (isrc) {
      getLogger()?.info(`[BPMEnrichment] Querying Deezer with ISRC: ${isrc}`)
      enrichment = await this.enrichByISRC(isrc, track.duration_ms)
      getLogger()?.info(`[BPMEnrichment] Deezer result for ${isrc}: BPM=${enrichment.bpm}`)
    } else {
      // Fallback: Try to get ISRC from MusicBrainz, then retry
      getLogger()?.info(`[BPMEnrichment] No ISRC for "${track.name}", trying MusicBrainz`)
      const mbIsrc = await this.findISRCViaMusicBrainz(track.name, track.artists[0]?.name ?? '', track.duration_ms)

      if (mbIsrc) {
        getLogger()?.info(`[BPMEnrichment] MusicBrainz found ISRC: ${mbIsrc}, querying Deezer`)
        enrichment = await this.enrichByISRC(mbIsrc, track.duration_ms)
        if (enrichment.bpm) {
          enrichment.source = 'deezer-via-musicbrainz'
        }
        getLogger()?.info(`[BPMEnrichment] Deezer result via MusicBrainz: BPM=${enrichment.bpm}`)
      } else {
        getLogger()?.info(`[DeezerEnrichment] MusicBrainz found no ISRC for "${track.name}"`)
        enrichment = {
          bpm: null,
          gain: null,
          rank: null,
          release_date: null,
          source: null,
        }
      }
    }

    // Merge with existing enrichment data (additive)
    if (existingEnrichment) {
      enrichment = {
        bpm: enrichment.bpm ?? existingEnrichment.bpm,
        gain: enrichment.gain ?? existingEnrichment.gain,
        rank: enrichment.rank ?? existingEnrichment.rank,
        release_date: enrichment.release_date ?? existingEnrichment.release_date,
        source: enrichment.source ?? existingEnrichment.source,
      }
      getLogger()?.info(`[DeezerEnrichment] 🔗 Merged with existing data for ${track.id}`)
    }

    // Cache the result with appropriate TTL
    if (this.cache) {
      const isMiss = enrichment.bpm === null
      await this.setCached(cacheKey, enrichment, isMiss)
      getLogger()?.info(`[DeezerEnrichment] Cached ${isMiss ? 'miss' : 'hit'} for ${track.id}`)
    }

    return enrichment
  }

  /**
   * Query Deezer by ISRC (search endpoint)
   */
  private async deezerSearchByISRC(isrc: string): Promise<DeezerTrack[]> {
    try {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(`isrc:${isrc}`)}`
      getLogger()?.info(`[BPMEnrichment] Deezer search URL: ${url}`)

      const response = await rateLimitedDeezerCall(() => fetch(url), undefined, `search:${isrc}`)

      getLogger()?.info(`[BPMEnrichment] Deezer search response status: ${response?.status ?? 'null'}`)
      if (!response?.ok) {
        return []
      }

      const json = await response.json()
      const parseResult = safeParse(DeezerSearchResponseSchema, json)

      if (!parseResult.success) {
        getLogger()?.error('[BPMEnrichment] Deezer search response validation failed:', parseResult.error.issues)
        return []
      }

      const results = parseResult.data.data
      getLogger()?.info(`[BPMEnrichment] Deezer search results: ${results.length} tracks found`)
      return results
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] Deezer search failed:', error)
      return []
    }
  }

  /**
   * Get single Deezer track by ISRC
   */
  private async deezerSingleByISRC(isrc: string): Promise<DeezerTrack | null> {
    try {
      const url = `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`
      getLogger()?.info(`[BPMEnrichment] Deezer direct ISRC URL: ${url}`)

      const response = await rateLimitedDeezerCall(() => fetch(url), undefined, `isrc:${isrc}`)

      getLogger()?.info(`[BPMEnrichment] Deezer direct ISRC response status: ${response?.status ?? 'null'}`)
      if (!response?.ok) {
        return null
      }

      const json = await response.json()
      const parseResult = safeParse(DeezerTrackSchema, json)

      if (!parseResult.success) {
        getLogger()?.error('[BPMEnrichment] Deezer ISRC response validation failed:', parseResult.error.issues)
        return null
      }

      const data = parseResult.data
      const hasTrack = !!data.id
      const hasBPM = !!data.bpm
      getLogger()?.info(
        `[BPMEnrichment] Deezer direct result: hasTrack=${hasTrack}, hasBPM=${hasBPM}, BPM=${data.bpm ?? 'N/A'}`,
      )
      return data
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] Deezer ISRC lookup failed:', error)
      return null
    }
  }

  /**
   * Get full Deezer track details by ID (to ensure BPM is included)
   */
  private async deezerTrackById(id: number): Promise<DeezerTrack | null> {
    try {
      const url = `https://api.deezer.com/track/${id}`
      getLogger()?.info(`[BPMEnrichment] Fetching Deezer track by ID: ${url}`)

      const response = await rateLimitedDeezerCall(() => fetch(url), undefined, `track:${id}`)

      getLogger()?.info(`[BPMEnrichment] Deezer track by ID response status: ${response?.status ?? 'null'}`)
      if (!response?.ok) {
        return null
      }

      const json = await response.json()
      const parseResult = safeParse(DeezerTrackSchema, json)

      if (!parseResult.success) {
        getLogger()?.error('[BPMEnrichment] Deezer track by ID validation failed:', parseResult.error.issues)
        return null
      }

      const data = parseResult.data
      const hasTrack = !!data.id
      const hasBPM = !!data.bpm
      getLogger()?.info(
        `[BPMEnrichment] Deezer track by ID result: hasTrack=${hasTrack}, hasBPM=${hasBPM}, BPM=${data.bpm ?? 'N/A'}`,
      )
      return data
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] Deezer track fetch EXCEPTION:', error)
      return null
    }
  }

  /**
   * Enrich using ISRC via Deezer
   */
  private async enrichByISRC(isrc: string, durationMs: number): Promise<BPMEnrichment> {
    try {
      getLogger()?.info(`[BPMEnrichment] enrichByISRC called with ISRC: ${isrc}, duration: ${durationMs}ms`)

      // Try direct ISRC endpoint first
      getLogger()?.info(`[BPMEnrichment] Attempting direct Deezer ISRC lookup...`)
      const directTrack = await this.deezerSingleByISRC(isrc)

      if (directTrack) {
        getLogger()?.info(`[DeezerEnrichment] ✅ Direct ISRC lookup succeeded:`, {
          bpm: directTrack.bpm,
          gain: directTrack.gain,
          rank: directTrack.rank,
          release_date: directTrack.release_date,
        })
        return {
          bpm: directTrack.bpm ?? null,
          gain: directTrack.gain ?? null,
          rank: directTrack.rank ?? null,
          release_date: directTrack.release_date ?? null,
          source: 'deezer',
        }
      } else {
        getLogger()?.info(`[DeezerEnrichment] Direct ISRC lookup failed, trying search...`)
      }

      // Fallback to search endpoint with duration matching
      getLogger()?.info(`[BPMEnrichment] Attempting Deezer search by ISRC...`)
      const searchResults = await this.deezerSearchByISRC(isrc)

      getLogger()?.info(`[BPMEnrichment] Deezer search returned ${searchResults.length} results`)
      if (searchResults.length === 0) {
        getLogger()?.info(`[BPMEnrichment] No search results for ISRC: ${isrc}`)
        return {
          bpm: null,
          gain: null,
          rank: null,
          release_date: null,
          source: null,
        }
      }

      // Find best match by duration
      const targetSec = Math.round(durationMs / 1000)
      getLogger()?.info(`[BPMEnrichment] Searching for best duration match (target: ${targetSec}s)`)
      const sorted = searchResults
        .map(t => ({
          diff: Math.abs((t.duration ?? 0) - targetSec),
          track: t,
        }))
        .sort((a, b) => a.diff - b.diff)

      const bestMatch = sorted[0]?.track

      if (bestMatch) {
        getLogger()?.info(`[BPMEnrichment] Best match: Deezer ID ${bestMatch.id}, duration diff: ${sorted[0].diff}s`)
        // Fetch full track details to get BPM (may not be in search results)
        getLogger()?.info(`[BPMEnrichment] Fetching full track details for Deezer ID ${bestMatch.id}...`)
        const fullTrack = await this.deezerTrackById(bestMatch.id)

        if (fullTrack) {
          getLogger()?.info(`[DeezerEnrichment] ✅ Successfully got full track details:`, {
            bpm: fullTrack.bpm,
            gain: fullTrack.gain,
            rank: fullTrack.rank,
            release_date: fullTrack.release_date,
          })
          return {
            bpm: fullTrack.bpm ?? null,
            gain: fullTrack.gain ?? null,
            rank: fullTrack.rank ?? null,
            release_date: fullTrack.release_date ?? null,
            source: 'deezer',
          }
        } else {
          getLogger()?.info(`[DeezerEnrichment] ❌ Full track details lookup failed`)
        }
      } else {
        getLogger()?.info(`[BPMEnrichment] ❌ No best match found in search results`)
      }

      getLogger()?.info(`[DeezerEnrichment] ❌ Returning null - no data found via any method`)
      return {
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      }
    } catch (error) {
      getLogger()?.error('[DeezerEnrichment] ❌ Deezer fetch EXCEPTION:', error)
      return {
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      }
    }
  }

  /**
   * Find ISRC via MusicBrainz recording search
   */
  private async findISRCViaMusicBrainz(
    trackName: string,
    artistName: string,
    durationMs: number,
  ): Promise<null | string> {
    const MUSICBRAINZ_CACHE_TTL = CACHE_TTL.MUSICBRAINZ_SECONDS

    // Create cache key from track name, artist, and duration
    const cacheKey = `musicbrainz:isrc:${trackName}:${artistName}:${Math.floor(durationMs / 1000)}s`

    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'text')
      if (cached !== null) {
        if (cached === 'null') {
          getLogger()?.info(`[BPMEnrichment] MusicBrainz cache hit (no ISRC): ${trackName}`)
          return null
        }
        getLogger()?.info(`[BPMEnrichment] MusicBrainz cache hit: ${cached}`)
        return cached
      }
    }

    try {
      const query = `recording:"${trackName}" AND artist:"${artistName}"`
      const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`

      const orchestrator = getGlobalOrchestrator()
      const response = await orchestrator.execute(() =>
        fetch(url, {
          headers: {
            'User-Agent': 'DJApp/1.0 (https://dj.current.space)',
          },
        }),
      )

      if (!response?.ok) {
        getLogger()?.error(`[BPMEnrichment] MusicBrainz error: ${response?.status ?? 'null'}`)
        return null
      }

      const json = await response.json()
      const parseResult = safeParse(MusicBrainzSearchResponseSchema, json)

      if (!parseResult.success) {
        getLogger()?.error('[BPMEnrichment] MusicBrainz response validation failed:', parseResult.error.issues)
        return null
      }

      const recordings = parseResult.data.recordings

      if (recordings.length === 0) {
        // Cache null result
        if (this.cache) {
          await this.cache.put(cacheKey, 'null', {expirationTtl: MUSICBRAINZ_CACHE_TTL})
        }
        return null
      }

      // Find best match by duration
      const targetMs = durationMs
      const withDuration = recordings
        .filter((r: MusicBrainzRecording) => r.length && r.isrcs && r.isrcs.length > 0)
        .map((r: MusicBrainzRecording) => ({
          diff: Math.abs((r.length ?? 0) - targetMs),
          isrc: r.isrcs![0],
          recording: r,
        }))
        .sort((a, b) => a.diff - b.diff)

      const best = withDuration[0]

      let result: null | string = null

      if (best && best.diff < DURATION_MATCH.TOLERANCE_MS) {
        // Within tolerance
        getLogger()?.info(`[BPMEnrichment] Found ISRC via MusicBrainz: ${best.isrc}`)
        result = best.isrc
      } else {
        // If no duration match, just return first ISRC
        const firstWithISRC = recordings.find((r: MusicBrainzRecording) => r.isrcs && r.isrcs.length > 0)
        result = firstWithISRC?.isrcs?.[0] ?? null
      }

      // Cache the result
      if (this.cache) {
        await this.cache.put(cacheKey, result ?? 'null', {expirationTtl: MUSICBRAINZ_CACHE_TTL})
        getLogger()?.info(`[BPMEnrichment] Cached MusicBrainz ISRC: ${result ?? 'null'}`)
      }

      return result
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] MusicBrainz fetch failed:', error)
      return null
    }
  }

  /**
   * Get cached enrichment
   */
  private async getCached(trackId: string): Promise<EnrichmentCache | null> {
    if (!this.cache) return null

    try {
      const cached = await this.cache.get(`bpm:${trackId}`, 'json')
      if (!cached) return null

      const enrichment = cached as EnrichmentCache

      // Check if cache is stale
      const fetchedAt = new Date(enrichment.fetched_at).getTime()
      const now = Date.now()
      const age = now - fetchedAt

      if (age > enrichment.ttl * 1000) {
        getLogger()?.info(`[BPMEnrichment] Cache expired for ${trackId}`)
        return null
      }

      return enrichment
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] Cache read error:', error)
      return null
    }
  }

  /**
   * Cache enrichment data
   */
  private async setCached(trackId: string, enrichment: BPMEnrichment, isMiss = false): Promise<void> {
    if (!this.cache) return

    try {
      const ttl = isMiss ? this.missCacheTTL : this.cacheTTL
      const cacheData: EnrichmentCache = {
        enrichment,
        fetched_at: new Date().toISOString(),
        is_miss: isMiss,
        ttl,
      }

      await this.cache.put(`bpm:${trackId}`, JSON.stringify(cacheData), {
        expirationTtl: ttl,
      })

      const ttlDisplay = isMiss ? `${Math.round(ttl / 60)}m` : `${Math.round(ttl / 86400)}d`
      getLogger()?.info(`[BPMEnrichment] Cached ${isMiss ? 'miss' : 'hit'} for ${trackId} (TTL: ${ttlDisplay})`)
    } catch (error) {
      getLogger()?.error('[BPMEnrichment] Cache write error:', error)
    }
  }
}
