import type {SpotifyTrackFull} from '@dj/shared-types'

import type {Env} from '../../../index'
import type {ProgressNarrator} from '../../../lib/progress-narrator'
import type {SSEWriter} from '../streaming/sse-writer'

import {LastFmService} from '../../../services/LastFmService'
import {getChildLogger, getLogger} from '../../../utils/LoggerContext'
import {ProgressMessageThrottler} from '../../../utils/ProgressMessageThrottler'
import {getSubrequestTracker} from '../../../utils/SubrequestTracker'

// Enrichment limits to stay within Cloudflare Workers subrequest cap (1000 on paid tier)
// Last.fm makes 4 API calls per track (correction, info, tags, similar)
export const MAX_LASTFM_ENRICHMENT = 200

interface LastFmAnalysisData {
  artists_enriched: number
  avg_listeners: number
  avg_playcount: number
  crowd_tags: {count: number; tag: string}[]
  sample_size: number
  similar_tracks: string[]
  source: string
}

interface LastFmEnrichmentResult {
  data: LastFmAnalysisData | null
}

/**
 * Perform Last.fm enrichment for playlist tracks
 */
export async function performLastFmEnrichment(
  validTracks: SpotifyTrackFull[],
  env: Env,
  sseWriter: SSEWriter,
  progressThrottler: ProgressMessageThrottler,
  narrator?: ProgressNarrator,
  playlistName?: string,
  userRequest?: string,
  recentMessages?: string[],
): Promise<LastFmEnrichmentResult> {
  const result: LastFmEnrichmentResult = {
    data: null,
  }

  if (!env?.LASTFM_API_KEY || !env?.AUDIO_FEATURES_CACHE) {
    return result
  }

  try {
    const lastfmService = new LastFmService(env.LASTFM_API_KEY, env.AUDIO_FEATURES_CACHE)

    // Step 1: Check cache status and calculate budget
    const candidateLastFmTracks = validTracks.slice(0, MAX_LASTFM_ENRICHMENT)
    const cachedLastFmTracks: typeof candidateLastFmTracks = []
    const uncachedLastFmTracks: typeof candidateLastFmTracks = []

    getLogger()?.info(`[LastFmEnrichment] Checking cache status for ${candidateLastFmTracks.length} tracks...`)
    for (const track of candidateLastFmTracks) {
      const artist = track.artists?.[0]?.name ?? 'Unknown'
      const cacheKey = lastfmService.generateCacheKey(artist, track.name)
      const cached = await env.AUDIO_FEATURES_CACHE.get(`lastfm:${cacheKey}`, 'json')
      if (cached) {
        cachedLastFmTracks.push(track)
      } else {
        uncachedLastFmTracks.push(track)
      }
    }

    const lastfmCacheHitRate = (cachedLastFmTracks.length / candidateLastFmTracks.length) * 100
    getLogger()?.info(
      `[LastFmEnrichment] Cache status: ${cachedLastFmTracks.length} cached, ${uncachedLastFmTracks.length} uncached (${lastfmCacheHitRate.toFixed(1)}% hit rate)`,
    )

    // Calculate how many tracks to enrich based on remaining budget
    // Last.fm makes 4 API calls per track (correction, info, tags, similar)
    let tracksForLastFm: typeof uncachedLastFmTracks
    const lastfmTracker = getSubrequestTracker()
    if (lastfmTracker) {
      const remainingAfterDeezer = lastfmTracker.remaining()
      const availableForLastFm = Math.max(0, remainingAfterDeezer - 5) // Reserve 5 for other calls
      const lastfmBudget = Math.floor(availableForLastFm / 4) // 4 calls per track
      tracksForLastFm = uncachedLastFmTracks.slice(0, Math.min(uncachedLastFmTracks.length, lastfmBudget))

      getLogger()?.info(
        `[LastFmEnrichment] Budget: ${remainingAfterDeezer} remaining, ${availableForLastFm} available, ${lastfmBudget} tracks -> enriching ${tracksForLastFm.length}/${uncachedLastFmTracks.length} uncached tracks`,
      )
    } else {
      // Fallback to fixed limits if no tracker available
      tracksForLastFm = uncachedLastFmTracks.slice(0, MAX_LASTFM_ENRICHMENT)
      getLogger()?.info(
        `[LastFmEnrichment] No subrequest tracker, using fixed limit -> enriching ${tracksForLastFm.length}/${uncachedLastFmTracks.length} uncached tracks`,
      )
    }

    const signalsMap = new Map()

    // Step 2: Get track signals (4 API calls per track for uncached) - PARALLEL processing
    getLogger()?.info(`[LastFmEnrichment] Starting PARALLEL enrichment for ${tracksForLastFm.length} tracks`)

    // Send throttled message for Last.fm enrichment start
    if (narrator && progressThrottler.shouldSend()) {
      const message = await narrator.generateMessage({
        eventType: 'enrichment_lastfm',
        metadata: {
          cachedCount: cachedLastFmTracks.length,
          cacheHitRate: lastfmCacheHitRate,
          enrichCount: tracksForLastFm.length,
          playlistName,
        },
        milestone: 'finishing',
        previousMessages: recentMessages,
        progressPercent: 65,
        userRequest,
      })
      sseWriter.writeAsync({data: message, type: 'thinking'})
    }

    // Convert to LastFmTrack format
    const lastfmTracks = tracksForLastFm.map(track => ({
      artist: track.artists?.[0]?.name ?? 'Unknown',
      duration_ms: track.duration_ms,
      name: track.name,
    }))

    // Use batchGetSignals for parallel processing (up to 10 concurrent via Last.fm lane)
    const batchSignals = await lastfmService.batchGetSignals(lastfmTracks, true)

    // Track subrequests (getTrackSignals makes 4 API calls per track for uncached)
    const signalTracker = getSubrequestTracker()
    if (signalTracker) {
      // Estimate: 4 calls per track (correction, info, tags, similar)
      signalTracker.record(tracksForLastFm.length * 4)
    }

    // Map results by track ID for consistency with previous implementation
    for (let i = 0; i < tracksForLastFm.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const track = tracksForLastFm[i]
      // eslint-disable-next-line security/detect-object-injection
      const lastfmTrack = lastfmTracks[i]

      const cacheKey = lastfmService.generateCacheKey(lastfmTrack.artist, lastfmTrack.name)
      const signals = batchSignals.get(cacheKey)

      if (signals) {
        const key = `${track.id}`
        signalsMap.set(key, signals)
      }
    }

    getLogger()?.info(`[LastFmEnrichment] Parallel enrichment complete: ${signalsMap.size} tracks processed`)

    // Step 3: Get unique artists and fetch artist info separately (cached + rate-limited queue)
    const uniqueArtists = [...new Set(tracksForLastFm.map(t => t.artists?.[0]?.name).filter(Boolean))]

    const artistInfoMap = await lastfmService.batchGetArtistInfo(uniqueArtists, (current, total) => {
      // Report progress every 10 artists with simple message
      // Note: Narrator calls disabled here - concurrent ChatAnthropic instance creation fails
      if (current % 10 === 0 || current === total) {
        // Fire and forget - don't await, just queue the write
        void sseWriter.writeAsync({
          data: `Enriched ${current}/${total} artists...`,
          type: 'thinking',
        })
      }
    })

    // Track artist info subrequests (1 API call per artist, but some are cached)
    // Estimate based on the number of artists actually enriched
    const artistTracker = getSubrequestTracker()
    if (artistTracker) {
      artistTracker.record(artistInfoMap.size)
    }

    getLogger()?.info(`[LastFmEnrichment] ========== ENRICHMENT COMPLETE ==========`)
    getLogger()?.info(`[LastFmEnrichment] Cache efficiency:`)
    getLogger()?.info(`[LastFmEnrichment]   - Total candidates: ${candidateLastFmTracks.length}`)
    getLogger()?.info(`[LastFmEnrichment]   - Cached: ${cachedLastFmTracks.length} (${lastfmCacheHitRate.toFixed(1)}%)`)
    getLogger()?.info(`[LastFmEnrichment]   - Uncached: ${uncachedLastFmTracks.length}`)
    getLogger()?.info(`[LastFmEnrichment]   - Enriched (new): ${tracksForLastFm.length}`)
    getLogger()?.info(`[LastFmEnrichment] Enrichment results:`)
    getLogger()?.info(`[LastFmEnrichment]   - Track signals: ${signalsMap.size}`)
    getLogger()?.info(`[LastFmEnrichment]   - Unique artists: ${uniqueArtists.length}`)
    getLogger()?.info(`[LastFmEnrichment]   - Artists enriched: ${artistInfoMap.size}`)
    const finalLastfmTracker = getSubrequestTracker()
    if (finalLastfmTracker) {
      getLogger()?.info(
        `[LastFmEnrichment] Subrequest tracking: ${finalLastfmTracker.getSummary().count}/${finalLastfmTracker.getSummary().max} used (${finalLastfmTracker.getSummary().percentage.toFixed(1)}%)`,
      )
    }

    // Step 4: Attach artist info to track signals and update cache
    for (const [_trackId, signals] of signalsMap.entries()) {
      const artistKey = signals.canonicalArtist.toLowerCase()
      if (artistInfoMap.has(artistKey)) {
        signals.artistInfo = artistInfoMap.get(artistKey)

        // Update cache with complete signals including artist info
        const cacheKey = lastfmService.generateCacheKey(signals.canonicalArtist, signals.canonicalTrack)
        await lastfmService.updateCachedSignals(cacheKey, signals)
      }
    }

    if (signalsMap.size > 0) {
      // Aggregate tags across all tracks
      const aggregatedTags = LastFmService.aggregateTags(signalsMap)

      // Calculate average popularity
      const popularity = LastFmService.calculateAveragePopularity(signalsMap)

      // Get some similar tracks from the first few tracks
      const similarTracks = new Set<string>()
      let count = 0
      for (const signals of signalsMap.values()) {
        if (count >= 3) break // Only get similar from first 3 tracks
        signals.similar.slice(0, 3).forEach((s: {artist: string; name: string}) => {
          similarTracks.add(`${s.artist} - ${s.name}`)
        })
        count++
      }

      result.data = {
        artists_enriched: artistInfoMap.size,
        avg_listeners: popularity.avgListeners,
        avg_playcount: popularity.avgPlaycount,
        crowd_tags: aggregatedTags.slice(0, 10),
        sample_size: signalsMap.size,
        similar_tracks: Array.from(similarTracks).slice(0, 10),
        source: 'lastfm',
      }

      getLogger()?.info(
        `[LastFmEnrichment] Complete! Enriched ${signalsMap.size} tracks + ${artistInfoMap.size} artists`,
      )
    }
  } catch (error) {
    getChildLogger('LastFm').error('Enrichment failed', error)
    sseWriter.writeAsync({
      data: 'Last.fm enrichment unavailable - continuing without tags',
      type: 'thinking',
    })
  }

  return result
}
