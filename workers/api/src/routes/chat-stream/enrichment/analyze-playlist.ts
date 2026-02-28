import {
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  type SpotifyTrackFull,
} from '@dj/shared-types'
import {z} from 'zod'

import type {Env} from '../../../index'
import type {ProgressNarrator} from '../../../lib/progress-narrator'
import type {SSEWriter} from '../streaming/sse-writer'
import type {AnalysisResult} from '../types'

import {getLogger} from '../../../utils/LoggerContext'
import {ProgressMessageThrottler} from '../../../utils/ProgressMessageThrottler'
import {rateLimitedSpotifyCall} from '../../../utils/RateLimitedAPIClients'
import {performDeezerEnrichment} from './deezer'
import {performLastFmEnrichment} from './lastfm'

/**
 * Execute analyze_playlist with progress streaming and enrichment
 */
export async function executeAnalyzePlaylist(
  args: Record<string, unknown>,
  token: string,
  sseWriter: SSEWriter,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[],
): Promise<AnalysisResult> {
  const {playlist_id} = args

  // Create throttler for progress messages (5 second minimum interval)
  const progressThrottler = new ProgressMessageThrottler({minInterval: 5000})

  // Send initial message (throttled to avoid spam at start)
  if (narrator && progressThrottler.shouldSend()) {
    const startMessage = await narrator.generateMessage({
      eventType: 'enrichment_analysis',
      metadata: {
        phase: 'initialization',
      },
      milestone: 'starting',
      previousMessages: recentMessages,
      userRequest,
    })
    sseWriter.writeAsync({data: startMessage, type: 'thinking'})
  }

  // Step 1: Get playlist details
  getLogger()?.info(`[SpotifyAPI] Fetching playlist details: ${playlist_id}`)
  const playlistResponse = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/playlists/${playlist_id}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    getLogger(),
    `get playlist ${playlist_id}`,
  )

  getLogger()?.info(`[SpotifyAPI] Playlist response status: ${playlistResponse?.status}`)
  if (!playlistResponse?.ok) {
    throw new Error(`Failed to get playlist: ${playlistResponse?.status || 'null response'}`)
  }

  const rawPlaylist = await playlistResponse.json()
  const playlist = SpotifyPlaylistFullSchema.parse(rawPlaylist)
  getLogger()?.info(`[SpotifyAPI] Playlist loaded: "${playlist.name}" with ${playlist.tracks.total} tracks`)

  // Step 2: Get tracks
  getLogger()?.info(`[SpotifyAPI] Fetching tracks from playlist: ${playlist_id}`)
  const tracksResponse = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    getLogger(),
    `get tracks for playlist ${playlist_id}`,
  )

  getLogger()?.info(`[SpotifyAPI] Tracks response status: ${tracksResponse?.status}`)
  if (!tracksResponse?.ok) {
    const errorBody = tracksResponse ? await tracksResponse.text() : 'null response'
    getLogger()?.error(`[SpotifyAPI] Tracks fetch failed: ${tracksResponse?.status || 'null'} - ${errorBody}`)
    throw new Error(`Failed to get tracks: ${tracksResponse?.status || 'null response'}`)
  }

  const rawTracksData = await tracksResponse.json()
  const tracksData = SpotifyPlaylistTracksResponseSchema.parse(rawTracksData)
  const tracks = tracksData.items
    .map(item => item.track)
    .filter((track): track is SpotifyTrackFull => track !== null)
  const trackIds = tracks.map(t => t.id)

  getLogger()?.info(`[SpotifyAPI] Loaded ${tracks.length} tracks from playlist`)

  // Debug: Log first 3 tracks' structure to see what fields Spotify returns
  if (tracks.length > 0) {
    getLogger()?.info(`[SpotifyAPI] ========== TRACK STRUCTURE DEBUG ==========`)
    tracks.slice(0, 3).forEach((track, idx) => {
      getLogger()?.info(`[SpotifyAPI] Track ${idx + 1}: "${track.name}" by ${track.artists[0]?.name}`)
      getLogger()?.info(`[SpotifyAPI]   - ID: ${track.id}`)
      getLogger()?.info(`[SpotifyAPI]   - has external_ids: ${!!track.external_ids}`)
      getLogger()?.info(`[SpotifyAPI]   - external_ids value:`, track.external_ids)
      getLogger()?.info(`[SpotifyAPI]   - ISRC: ${track.external_ids.isrc ?? 'NOT PRESENT'}`)
      getLogger()?.info(`[SpotifyAPI]   - Available fields:`, {fields: Object.keys(track).join(', ')})
    })
    getLogger()?.info(`[SpotifyAPI] ========== END TRACK STRUCTURE DEBUG ==========`)
  }

  // Send throttled message after track loading
  if (narrator && progressThrottler.shouldSend()) {
    const message = await narrator.generateMessage({
      eventType: 'enrichment_analysis',
      metadata: {
        phase: 'metadata',
        playlistName: playlist.name,
        trackCount: tracks.length,
      },
      milestone: 'starting',
      previousMessages: recentMessages,
      progressPercent: 15,
      userRequest,
    })
    sseWriter.writeAsync({data: message, type: 'thinking'})
  }

  // Calculate metadata-based statistics
  const validTracks = tracks // All tracks are now guaranteed to have required fields
  const avgPopularity =
    validTracks.length > 0 ? validTracks.reduce((sum, t) => sum + t.popularity, 0) / validTracks.length : 0

  const avgDuration =
    validTracks.length > 0 ? validTracks.reduce((sum, t) => sum + t.duration_ms, 0) / validTracks.length : 0

  const explicitCount = validTracks.filter(t => t.explicit).length
  const explicitPercentage = validTracks.length > 0 ? (explicitCount / validTracks.length) * 100 : 0

  // Extract unique artists for genre analysis
  const artistIds = new Set<string>()
  validTracks.forEach(t => {
    t.artists.forEach(artist => {
      artistIds.add(artist.id)
    })
  })

  // Step 3: Fetch artist genres (batch request, limit to 50 artists)
  const artistIdsArray = Array.from(artistIds).slice(0, 50)
  let genres: string[] = []

  if (artistIdsArray.length > 0) {
    const artistsResponse = await rateLimitedSpotifyCall(
      () =>
        fetch(`https://api.spotify.com/v1/artists?ids=${artistIdsArray.join(',')}`, {
          headers: {Authorization: `Bearer ${token}`},
        }),
      getLogger(),
      `get ${artistIdsArray.length} artists`,
    )

    if (artistsResponse?.ok) {
      const rawArtistsData = await artistsResponse.json()
      const BatchArtistsSchema = z.object({
        artists: z.array(
          z
            .object({
              genres: z.array(z.string()),
              id: z.string(),
              name: z.string(),
            })
            .nullable(),
        ),
      })
      const artistsData = BatchArtistsSchema.parse(rawArtistsData)
      const genreMap = new Map<string, number>()

      artistsData.artists.forEach(artist => {
        if (artist?.genres) {
          artist.genres.forEach((genre: string) => {
            genreMap.set(genre, (genreMap.get(genre) ?? 0) + 1)
          })
        }
      })

      // Get top genres sorted by frequency
      genres = Array.from(genreMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([genre]) => genre)
    }
  }

  // Flush after metadata + genre analysis
  await sseWriter.flush()

  // Step 4: Analyze release dates
  const releaseDates = validTracks.map(t => t.album.release_date).filter((date): date is string => !!date)

  const releaseYears = releaseDates
    .map((date: string) => parseInt(date.split('-')[0]))
    .filter((year: number) => !isNaN(year))

  const avgReleaseYear =
    releaseYears.length > 0
      ? Math.round(releaseYears.reduce((sum: number, year: number) => sum + year, 0) / releaseYears.length)
      : null

  const oldestYear = releaseYears.length > 0 ? Math.min(...releaseYears) : null
  const newestYear = releaseYears.length > 0 ? Math.max(...releaseYears) : null

  // Step 5: Deezer enrichment (BPM often null, but rank/gain/release_date are valuable)
  let deezerData = null
  if (env?.AUDIO_FEATURES_CACHE) {
    const deezerResult = await performDeezerEnrichment(
      validTracks,
      env,
      sseWriter,
      progressThrottler,
      narrator,
      playlist.name,
      userRequest,
      recentMessages,
    )
    deezerData = deezerResult.data
  }

  // Flush after Deezer enrichment
  await sseWriter.flush()

  // Step 6: Last.fm enrichment (tracks + unique artists separately)
  let lastfmData = null
  if (env?.LASTFM_API_KEY && env?.AUDIO_FEATURES_CACHE) {
    const lastfmResult = await performLastFmEnrichment(
      validTracks,
      env,
      sseWriter,
      progressThrottler,
      narrator,
      playlist.name,
      userRequest,
      recentMessages,
    )
    lastfmData = lastfmResult.data
  }

  // Flush any pending narrator messages before final analysis
  await sseWriter.flush()

  // Send final throttled message for completion
  if (narrator && progressThrottler.shouldSend()) {
    const message = await narrator.generateMessage({
      eventType: 'enrichment_complete',
      metadata: {
        deezerDataAvailable: !!deezerData,
        lastfmDataAvailable: !!lastfmData,
        playlistName: playlist.name,
        trackCount: tracks.length,
      },
      milestone: 'complete',
      previousMessages: recentMessages,
      progressPercent: 95,
      userRequest,
    })
    sseWriter.writeAsync({data: message, type: 'thinking'})
  }

  const analysis: AnalysisResult = {
    deezer_analysis: deezerData ?? undefined, // Deezer BPM, rank, gain if available
    lastfm_analysis: lastfmData ?? undefined, // Last.fm tags and popularity if available
    message: (() => {
      const sources = [
        deezerData
          ? `Deezer (${[
              deezerData.bpm ? 'BPM' : null,
              deezerData.rank ? 'rank' : null,
              deezerData.gain ? 'gain' : null,
            ]
              .filter(Boolean)
              .join(', ')})`
          : null,
        lastfmData ? 'Last.fm (tags, popularity)' : null,
      ].filter(Boolean)
      return sources.length > 0
        ? `Enriched with ${sources.join(' + ')}! Use get_playlist_tracks for track details.`
        : 'Use get_playlist_tracks to fetch track details in batches, or get_track_details for specific tracks.'
    })(),
    metadata_analysis: {
      avg_duration_minutes: Math.round((avgDuration / 60000) * 10) / 10,
      avg_duration_ms: Math.round(avgDuration),
      avg_popularity: Math.round(avgPopularity),
      explicit_percentage: Math.round(explicitPercentage),
      explicit_tracks: explicitCount,
      release_year_range:
        oldestYear && newestYear
          ? {
              average: avgReleaseYear ?? Math.round((oldestYear + newestYear) / 2),
              newest: newestYear,
              oldest: oldestYear,
            }
          : null,
      top_genres: genres,
      total_artists: artistIdsArray.length,
    },
    playlist_description: playlist.description,
    playlist_name: playlist.name,
    total_tracks: tracks.length,
    track_ids: trackIds,
  }

  sseWriter.writeAsync({
    data: `Analysis complete for "${analysis.playlist_name}"!`,
    type: 'thinking',
  })

  // Log data size for debugging
  const analysisJson = JSON.stringify(analysis)
  getLogger()?.info(`[Tool] analyze_playlist completed successfully`)
  getLogger()?.info(
    `[Tool] Analysis JSON size: ${analysisJson.length} bytes (${(analysisJson.length / 1024).toFixed(1)}KB)`,
  )
  getLogger()?.info(`[Tool] Returning metadata analysis with ${trackIds.length} track IDs`)

  return analysis
}
