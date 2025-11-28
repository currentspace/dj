/**
 * SuggestionEngine
 * Generates track suggestions for Mix Sessions based on vibe profile and history
 * Uses AI/Claude for intelligent recommendations when no history exists
 */

import type { MixSession, PlayedTrack, Suggestion } from '@dj/shared-types'
import type { AudioEnrichmentService } from './AudioEnrichmentService'
import type { LastFmService } from './LastFmService'
import { AIService, createAIService } from '../lib/ai-service'
import { buildVibeDescription, buildInitialSuggestionsPrompt, SYSTEM_PROMPTS } from '../lib/ai-prompts'
import { getLogger } from '../utils/LoggerContext'

interface SpotifyTrack {
  id: string
  uri: string
  name: string
  artists: { name: string }[]
  album: {
    name: string
    images: { url: string }[]
    release_date: string
  }
  duration_ms: number
  popularity: number
  external_ids?: { isrc?: string }
}

export class SuggestionEngine {
  private aiService: AIService | null = null

  constructor(
    private lastFmService: LastFmService,
    private audioService: AudioEnrichmentService,
    private spotifyToken: string,
    anthropicApiKey?: string
  ) {
    if (anthropicApiKey) {
      this.aiService = createAIService({ apiKey: anthropicApiKey })
    }
  }

  /**
   * Generate suggestions based on current vibe
   */
  async generateSuggestions(session: MixSession, count: number = 5): Promise<Suggestion[]> {
    try {
      // If no history, use Spotify recommendations based on vibe genres
      if (session.history.length === 0) {
        getLogger()?.info('[SuggestionEngine] No history, using vibe-based recommendations')
        return this.generateInitialSuggestions(session, count)
      }

      // Find similar candidates using Last.fm
      const candidates = await this.findSimilarCandidates(session.history, count * 3)

      if (candidates.length === 0) {
        getLogger()?.info('[SuggestionEngine] No candidates found')
        return []
      }

      // Filter out tracks already in history or queue
      const filtered = this.filterAlreadyPlayed(candidates, session)

      if (filtered.length === 0) {
        getLogger()?.info('[SuggestionEngine] All candidates filtered out (already played/queued)')
        return []
      }

      // Enrich candidates with BPM data
      const enrichedCandidates = await Promise.all(
        filtered.map(async track => {
          const enrichment = await this.audioService.enrichTrack(track)
          return {
            track,
            bpm: enrichment.bpm,
            energy: null, // We don't have Spotify audio features API anymore
            genres: [], // Would need to extract from Last.fm tags
          }
        })
      )

      // Score each candidate
      const lastTrack = session.history[session.history.length - 1]
      const scoredSuggestions = enrichedCandidates.map(({ track, bpm, energy, genres }) => {
        const vibeScore = this.scoreSuggestion(track, session.vibe, lastTrack, bpm, energy, genres)
        const transitionScore = lastTrack
          ? this.scoreTransition(lastTrack, { bpm, energy })
          : 50

        // Build reason string
        const reasons: string[] = []
        if (bpm && session.vibe.bpmRange) {
          const bpmMatch = Math.abs(bpm - (session.vibe.bpmRange.min + session.vibe.bpmRange.max) / 2)
          if (bpmMatch < 10) {
            reasons.push(`BPM ${bpm} matches vibe`)
          }
        }
        if (genres.some(g => session.vibe.genres.includes(g))) {
          const matchedGenres = genres.filter(g => session.vibe.genres.includes(g))
          reasons.push(`Matches genres: ${matchedGenres.join(', ')}`)
        }
        if (transitionScore > 80) {
          reasons.push('Smooth transition')
        }
        if (reasons.length === 0) {
          reasons.push('Similar to recent tracks')
        }

        const suggestion: Suggestion = {
          trackId: track.id,
          trackUri: track.uri,
          name: track.name,
          artist: track.artists[0]?.name || 'Unknown Artist',
          albumArt: track.album.images[0]?.url,
          vibeScore: Math.round((vibeScore + transitionScore) / 2),
          reason: reasons.join(' • '),
          bpm,
        }

        return suggestion
      })

      // Sort by combined score and return top N
      const topSuggestions = scoredSuggestions
        .sort((a, b) => b.vibeScore - a.vibeScore)
        .slice(0, count)

      getLogger()?.info(`[SuggestionEngine] Generated ${topSuggestions.length} suggestions`)
      return topSuggestions
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate suggestions:', error)
      return []
    }
  }

  /**
   * Score how well a track fits the vibe (0-100)
   */
  scoreSuggestion(
    track: SpotifyTrack,
    vibe: MixSession['vibe'],
    _lastTrack?: PlayedTrack,
    bpm: number | null = null,
    energy: number | null = null,
    genres: string[] = []
  ): number {
    let score = 0

    // BPM match (0-30 points)
    if (bpm && vibe.bpmRange) {
      const targetBpm = (vibe.bpmRange.min + vibe.bpmRange.max) / 2
      const bpmDiff = Math.abs(bpm - targetBpm)

      if (bpmDiff <= 5) {
        score += 30 // Perfect match
      } else if (bpmDiff <= 10) {
        score += 24 // Very close
      } else if (bpmDiff <= 20) {
        score += 15 // Acceptable
      } else {
        score += 6 // Poor match
      }
    } else {
      // No BPM data, give neutral score
      score += 15
    }

    // Genre overlap (0-45 points, max 3 matches)
    const genreMatches = genres.filter(g => vibe.genres.includes(g))
    score += Math.min(genreMatches.length * 15, 45)

    // Energy match (0-30 points)
    if (energy !== null) {
      const targetEnergy = vibe.energyLevel / 10 // Convert 1-10 to 0-1
      const energyDiff = Math.abs(energy - targetEnergy)

      if (energyDiff <= 0.2) {
        score += 30
      } else if (energyDiff <= 0.4) {
        score += 15
      } else {
        score += 5
      }
    } else {
      // No energy data, give neutral score
      score += 15
    }

    // Era match (0-25 points)
    const releaseYear = parseInt(track.album.release_date.split('-')[0])
    if (releaseYear >= vibe.era.start && releaseYear <= vibe.era.end) {
      score += 25
    } else {
      // Penalize if way off
      const eraDiff = Math.min(
        Math.abs(releaseYear - vibe.era.start),
        Math.abs(releaseYear - vibe.era.end)
      )
      if (eraDiff <= 5) {
        score += 15
      } else if (eraDiff <= 10) {
        score += 5
      }
    }

    // Normalize to 0-100
    return Math.min(Math.max(Math.round(score), 0), 100)
  }

  /**
   * Score transition quality between two tracks (0-100)
   */
  scoreTransition(
    fromTrack: PlayedTrack,
    toTrack: { bpm: number | null; energy: number | null }
  ): number {
    // If either track lacks BPM, return neutral score
    if (!fromTrack.bpm || !toTrack.bpm) {
      return 50
    }

    const bpmDiff = Math.abs(fromTrack.bpm - toTrack.bpm)

    if (bpmDiff < 5) {
      return 100
    } else if (bpmDiff < 10) {
      return 80
    } else if (bpmDiff < 20) {
      return 60
    } else {
      return 30
    }
  }

  /**
   * Find candidates using Last.fm similar tracks
   */
  private async findSimilarCandidates(
    history: PlayedTrack[],
    limit: number
  ): Promise<SpotifyTrack[]> {
    try {
      // Get similar tracks from Last.fm for most recent tracks
      const recentTracks = history.slice(-3) // Last 3 tracks
      const allSimilar: Array<{ artist: string; name: string; match: number }> = []

      for (const track of recentTracks) {
        try {
          const signals = await this.lastFmService.getTrackSignals(
            { artist: track.artist, name: track.name },
            true // Skip artist info for performance
          )

          if (signals?.similar) {
            allSimilar.push(...signals.similar)
          }
        } catch (error) {
          getLogger()?.error(`[SuggestionEngine] Failed to get similar tracks for ${track.name}:`, error)
        }
      }

      if (allSimilar.length === 0) {
        return []
      }

      // Deduplicate and sort by match score
      const uniqueSimilar = Array.from(
        new Map(
          allSimilar.map(s => [`${s.artist}-${s.name}`.toLowerCase(), s])
        ).values()
      ).sort((a, b) => b.match - a.match)

      // Convert to Spotify tracks via search
      const candidates: SpotifyTrack[] = []
      for (const similar of uniqueSimilar.slice(0, limit)) {
        try {
          const spotifyTrack = await this.searchSpotifyTrack(similar.artist, similar.name)
          if (spotifyTrack) {
            candidates.push(spotifyTrack)
          }

          // Stop if we have enough candidates
          if (candidates.length >= limit) {
            break
          }
        } catch (error) {
          getLogger()?.error(`[SuggestionEngine] Failed to search for ${similar.name}:`, error)
        }
      }

      return candidates
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to find similar candidates:', error)
      return []
    }
  }

  /**
   * Search for a track on Spotify
   */
  private async searchSpotifyTrack(artist: string, track: string): Promise<SpotifyTrack | null> {
    try {
      const query = `artist:${artist} track:${track}`
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.spotifyToken}`,
        },
      })

      if (!response.ok) {
        getLogger()?.error(`[SuggestionEngine] Spotify search failed: ${response.status}`)
        return null
      }

      const data = await response.json() as { tracks?: { items?: SpotifyTrack[] } }
      const tracks = data.tracks?.items || []

      if (tracks.length === 0) {
        return null
      }

      return tracks[0] as SpotifyTrack
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Spotify search error:', error)
      return null
    }
  }

  /**
   * Deduplicate against history and queue
   */
  private filterAlreadyPlayed(
    candidates: SpotifyTrack[],
    session: MixSession
  ): SpotifyTrack[] {
    const playedIds = new Set(session.history.map(t => t.trackId))
    const queuedIds = new Set(session.queue.map(t => t.trackId))

    return candidates.filter(track => {
      return !playedIds.has(track.id) && !queuedIds.has(track.id)
    })
  }

  /**
   * Generate initial suggestions using AI when no history exists
   * Uses Claude to suggest tracks that match the vibe profile
   */
  private async generateInitialSuggestions(
    session: MixSession,
    count: number
  ): Promise<Suggestion[]> {
    try {
      const { vibe } = session

      if (!this.aiService) {
        getLogger()?.warn('[SuggestionEngine] No AI service available, cannot generate suggestions')
        return []
      }

      // Build prompt using common prompts module
      const vibeDescription = buildVibeDescription(vibe)
      const prompt = buildInitialSuggestionsPrompt(vibeDescription, count * 2)

      getLogger()?.info('[SuggestionEngine] Asking AI for initial track suggestions...')

      // Use common AI service for the request
      const response = await this.aiService.promptForJSON<{
        tracks: Array<{ artist: string; name: string; reason: string }>
      }>(prompt, {
        temperature: 0.8, // Higher temperature for creative suggestions
        system: SYSTEM_PROMPTS.DJ,
      })

      if (response.error || !response.data?.tracks) {
        getLogger()?.error('[SuggestionEngine] AI request failed:', response.error)
        return []
      }

      const aiSuggestions = response.data

      if (aiSuggestions.tracks.length === 0) {
        getLogger()?.info('[SuggestionEngine] AI returned no track suggestions')
        return []
      }

      getLogger()?.info(`[SuggestionEngine] AI suggested ${aiSuggestions.tracks.length} tracks, searching Spotify...`)

      // Search Spotify for each suggested track
      const spotifyTracks: SpotifyTrack[] = []
      for (const suggestion of aiSuggestions.tracks) {
        const track = await this.searchSpotifyTrack(suggestion.artist, suggestion.name)
        if (track) {
          spotifyTracks.push(track)
        }
        if (spotifyTracks.length >= count) break
      }

      if (spotifyTracks.length === 0) {
        getLogger()?.info('[SuggestionEngine] No Spotify tracks found for AI suggestions')
        return []
      }

      // Filter out any tracks already in queue
      const filtered = this.filterAlreadyPlayed(spotifyTracks, session)

      // Build suggestions with AI-provided reasons
      const suggestions: Suggestion[] = await Promise.all(
        filtered.slice(0, count).map(async (track, index) => {
          const enrichment = await this.audioService.enrichTrack(track)
          const vibeScore = this.scoreSuggestion(track, vibe, undefined, enrichment.bpm, null, [])
          const aiReason = aiSuggestions.tracks[index]?.reason || 'AI-recommended for your vibe'

          return {
            trackId: track.id,
            trackUri: track.uri,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist',
            albumArt: track.album.images[0]?.url,
            vibeScore,
            reason: aiReason,
            bpm: enrichment.bpm,
          }
        })
      )

      // Sort by vibe score
      suggestions.sort((a, b) => b.vibeScore - a.vibeScore)

      getLogger()?.info(`[SuggestionEngine] Generated ${suggestions.length} AI-powered initial suggestions`)
      return suggestions
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate AI suggestions:', error)
      return []
    }
  }
}
