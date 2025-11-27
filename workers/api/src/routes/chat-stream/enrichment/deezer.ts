import type {SpotifyTrackFull} from '@dj/shared-types'

import type {Env} from '../../../index'
import type {ProgressNarrator} from '../../../lib/progress-narrator'
import {AudioEnrichmentService} from '../../../services/AudioEnrichmentService'
import {getChildLogger, getLogger} from '../../../utils/LoggerContext'
import {ProgressMessageThrottler} from '../../../utils/ProgressMessageThrottler'
import {getSubrequestTracker} from '../../../utils/SubrequestTracker'
import type {SSEWriter} from '../streaming/sse-writer'
import type {DeezerAnalysisData} from '../types'

// Enrichment limits to stay within Cloudflare Workers subrequest cap (1000 on paid tier)
export const MAX_DEEZER_ENRICHMENT = 500

interface DeezerEnrichmentResult {
  data: DeezerAnalysisData | null
  bpmResults: number[]
  rankResults: number[]
  gainResults: number[]
}

/**
 * Perform Deezer enrichment for playlist tracks
 */
export async function performDeezerEnrichment(
  validTracks: SpotifyTrackFull[],
  env: Env,
  sseWriter: SSEWriter,
  progressThrottler: ProgressMessageThrottler,
  narrator?: ProgressNarrator,
  playlistName?: string,
  userRequest?: string,
  recentMessages?: string[],
): Promise<DeezerEnrichmentResult> {
  const result: DeezerEnrichmentResult = {
    data: null,
    bpmResults: [],
    rankResults: [],
    gainResults: [],
  }

  if (!env?.AUDIO_FEATURES_CACHE) {
    return result
  }

  try {
    getLogger()?.info(`[DeezerEnrichment] ========== STARTING DEEZER ENRICHMENT ==========`)
    getLogger()?.info(`[DeezerEnrichment] KV Cache available: YES`)
    const enrichmentService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)

    // Step 1: Check cache status for tracks (cache lookups don't count as subrequests)
    const candidateTracks = validTracks.slice(0, MAX_DEEZER_ENRICHMENT)
    const cachedTracks: typeof candidateTracks = []
    const uncachedTracks: typeof candidateTracks = []

    getLogger()?.info(`[DeezerEnrichment] Checking cache status for ${candidateTracks.length} tracks...`)
    for (const track of candidateTracks) {
      const cacheKey = `bpm:${track.id}`
      const cached = await env.AUDIO_FEATURES_CACHE.get(cacheKey, 'json')
      if (cached) {
        cachedTracks.push(track)
      } else {
        uncachedTracks.push(track)
      }
    }

    const cacheHitRate = (cachedTracks.length / candidateTracks.length) * 100
    getLogger()?.info(
      `[DeezerEnrichment] Cache status: ${cachedTracks.length} cached, ${uncachedTracks.length} uncached (${cacheHitRate.toFixed(1)}% hit rate)`,
    )

    // Step 2: Calculate how many uncached tracks we can enrich based on remaining budget
    let tracksToEnrich: typeof uncachedTracks
    const subrequestTracker = getSubrequestTracker()
    if (subrequestTracker) {
      const remaining = subrequestTracker.remaining()
      // Reserve some budget for other operations (Spotify, Last.fm, etc.)
      const availableBudget = Math.max(0, remaining - 10)
      // Deezer makes 1 call per track (plus potential MusicBrainz fallback, so estimate 2 per track to be safe)
      const deezerBudget = Math.floor(availableBudget * 0.5) // Use 50% of remaining budget for Deezer
      tracksToEnrich = uncachedTracks.slice(0, Math.min(uncachedTracks.length, deezerBudget))

      getLogger()?.info(
        `[DeezerEnrichment] Budget: ${remaining} remaining, ${availableBudget} available, ${deezerBudget} for Deezer -> enriching ${tracksToEnrich.length}/${uncachedTracks.length} uncached tracks`,
      )
    } else {
      // Fallback to fixed limits if no tracker available
      tracksToEnrich = uncachedTracks.slice(0, MAX_DEEZER_ENRICHMENT)
      getLogger()?.info(
        `[DeezerEnrichment] No subrequest tracker, using fixed limit -> enriching ${tracksToEnrich.length}/${uncachedTracks.length} uncached tracks`,
      )
    }

    let enrichedCount = 0

    getLogger()?.info(`[DeezerEnrichment] Will attempt to enrich ${tracksToEnrich.length} uncached tracks`)

    // Send throttled message for Deezer enrichment start
    if (narrator && progressThrottler.shouldSend()) {
      const message = await narrator.generateMessage({
        eventType: 'enrichment_deezer',
        metadata: {
          cacheHitRate,
          cachedCount: cachedTracks.length,
          enrichCount: tracksToEnrich.length,
          playlistName,
        },
        milestone: 'midpoint',
        progressPercent: 35,
        previousMessages: recentMessages,
        userRequest,
      })
      sseWriter.writeAsync({data: message, type: 'thinking'})
    }

    // Debug: Check if tracks have external_ids
    const tracksWithISRC = tracksToEnrich.filter(t => t.external_ids?.isrc).length
    getLogger()?.info(
      `[BPMEnrichment] Pre-enrichment ISRC check: ${tracksWithISRC}/${tracksToEnrich.length} tracks have ISRC`,
    )

    // Debug: Log first 3 tracks to see their structure in detail
    if (tracksToEnrich.length > 0) {
      getLogger()?.info(`[BPMEnrichment] ========== ENRICHMENT TRACK STRUCTURE DEBUG ==========`)
      tracksToEnrich.slice(0, 3).forEach((track, idx) => {
        getLogger()?.info(`[BPMEnrichment] Track ${idx + 1}: "${track.name}" by ${track.artists?.[0]?.name}`)
        getLogger()?.info(`[BPMEnrichment]   - ID: ${track.id}`)
        getLogger()?.info(`[BPMEnrichment]   - Duration: ${track.duration_ms}ms`)
        getLogger()?.info(`[BPMEnrichment]   - has external_ids: ${!!track.external_ids}`)
        getLogger()?.info(`[BPMEnrichment]   - external_ids type: ${typeof track.external_ids}`)
        getLogger()?.info(`[BPMEnrichment]   - external_ids value:`, {value: JSON.stringify(track.external_ids)})
        getLogger()?.info(`[BPMEnrichment]   - ISRC: ${track.external_ids?.isrc ?? 'NOT PRESENT'}`)
        getLogger()?.info(`[BPMEnrichment]   - Track object keys:`, {keys: Object.keys(track).join(', ')})
      })
      getLogger()?.info(`[BPMEnrichment] ========== END ENRICHMENT TRACK STRUCTURE DEBUG ==========`)
    }

    if (tracksWithISRC === 0) {
      getLogger()?.warn(`[BPMEnrichment] WARNING: No tracks have ISRC in external_ids`)
      getLogger()?.warn(`[BPMEnrichment] Will need to fetch full track details from Spotify /tracks API`)
      sseWriter.writeAsync({
        data: 'Tracks missing ISRC data - fetching from Spotify API...',
        type: 'thinking',
      })
    } else {
      getLogger()?.info(`[BPMEnrichment] Found ${tracksWithISRC} tracks with ISRC, proceeding with enrichment`)
    }

    // Convert tracks to SpotifyTrack format for batch enrichment
    const spotifyTracks = tracksToEnrich.map(track => ({
      artists: track.artists ?? [],
      duration_ms: track.duration_ms,
      external_ids: track.external_ids,
      id: track.id,
      name: track.name,
    }))

    getLogger()?.info(`[BPMEnrichment] Starting PARALLEL enrichment for ${spotifyTracks.length} tracks`)

    // Use batchEnrichTracks for parallel processing (up to 10 concurrent via Deezer lane)
    const enrichmentResults = await enrichmentService.batchEnrichTracks(spotifyTracks)

    // Process results
    for (const [, deezerResult] of enrichmentResults.entries()) {
      // Track subrequests (enrichTrack makes 1-2 API calls: Deezer + maybe MusicBrainz)
      const tracker = getSubrequestTracker()
      if (tracker) {
        tracker.record(deezerResult.source === 'deezer-via-musicbrainz' ? 2 : 1)
      }

      // Collect all available Deezer data
      if (deezerResult.bpm && AudioEnrichmentService.isValidBPM(deezerResult.bpm)) {
        result.bpmResults.push(deezerResult.bpm)
      }
      if (deezerResult.rank !== null && deezerResult.rank > 0) {
        result.rankResults.push(deezerResult.rank)
      }
      if (deezerResult.gain !== null) {
        result.gainResults.push(deezerResult.gain)
      }

      if (deezerResult.source) {
        enrichedCount++
      }
    }

    getLogger()?.info(
      `[BPMEnrichment] Parallel enrichment complete: ${enrichedCount}/${tracksToEnrich.length} tracks enriched`,
    )

    getLogger()?.info(`[DeezerEnrichment] ========== ENRICHMENT COMPLETE ==========`)
    getLogger()?.info(`[DeezerEnrichment] Cache efficiency:`)
    getLogger()?.info(`[DeezerEnrichment]   - Total candidates: ${candidateTracks.length}`)
    getLogger()?.info(`[DeezerEnrichment]   - Cached: ${cachedTracks.length} (${cacheHitRate.toFixed(1)}%)`)
    getLogger()?.info(`[DeezerEnrichment]   - Uncached: ${uncachedTracks.length}`)
    getLogger()?.info(`[DeezerEnrichment]   - Enriched (new): ${tracksToEnrich.length}`)
    getLogger()?.info(`[DeezerEnrichment] Enrichment results:`)
    getLogger()?.info(`[DeezerEnrichment]   - Tracks with Deezer match: ${enrichedCount}/${tracksToEnrich.length}`)
    getLogger()?.info(`[DeezerEnrichment]   - BPM results: ${result.bpmResults.length}`)
    getLogger()?.info(`[DeezerEnrichment]   - Rank results: ${result.rankResults.length}`)
    getLogger()?.info(`[DeezerEnrichment]   - Gain results: ${result.gainResults.length}`)
    const finalTracker = getSubrequestTracker()
    if (finalTracker) {
      getLogger()?.info(
        `[DeezerEnrichment] Subrequest tracking: ${finalTracker.getSummary().count}/${finalTracker.getSummary().max} used (${finalTracker.getSummary().percentage.toFixed(1)}%)`,
      )
    }

    if (enrichedCount > 0) {
      result.data = {
        source: 'deezer',
        total_checked: tracksToEnrich.length,
        tracks_found: enrichedCount,
      }

      // Add BPM stats if available
      if (result.bpmResults.length > 0) {
        const avgBPM = result.bpmResults.reduce((sum, bpm) => sum + bpm, 0) / result.bpmResults.length
        result.data.bpm = {
          avg: Math.round(avgBPM),
          range: {
            max: Math.max(...result.bpmResults),
            min: Math.min(...result.bpmResults),
          },
          sample_size: result.bpmResults.length,
        }
      }

      // Add rank stats if available
      if (result.rankResults.length > 0) {
        const avgRank = result.rankResults.reduce((sum, rank) => sum + rank, 0) / result.rankResults.length
        result.data.rank = {
          avg: Math.round(avgRank),
          range: {
            max: Math.max(...result.rankResults),
            min: Math.min(...result.rankResults),
          },
          sample_size: result.rankResults.length,
        }
      }

      // Add gain stats if available
      if (result.gainResults.length > 0) {
        const avgGain = result.gainResults.reduce((sum, gain) => sum + gain, 0) / result.gainResults.length
        result.data.gain = {
          avg: parseFloat(avgGain.toFixed(1)),
          range: {
            max: Math.max(...result.gainResults),
            min: Math.min(...result.gainResults),
          },
          sample_size: result.gainResults.length,
        }
      }

      const dataTypes = [
        result.bpmResults.length > 0 ? 'BPM' : null,
        result.rankResults.length > 0 ? 'rank' : null,
        result.gainResults.length > 0 ? 'gain' : null,
      ]
        .filter(Boolean)
        .join(', ')

      getLogger()?.info(
        `[DeezerEnrichment] Complete! Found ${dataTypes} for ${enrichedCount}/${tracksToEnrich.length} tracks`,
      )
    } else {
      // Keep warning message unthrottled
      sseWriter.writeAsync({
        data: 'No Deezer data available for these tracks',
        type: 'thinking',
      })
    }
  } catch (error) {
    getChildLogger('DeezerEnrichment').error('Enrichment failed', error)
    sseWriter.writeAsync({
      data: 'Deezer enrichment unavailable - continuing with metadata only',
      type: 'thinking',
    })
  }

  return result
}
