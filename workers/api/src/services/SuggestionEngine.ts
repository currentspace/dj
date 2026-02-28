/**
 * SuggestionEngine
 * Generates track suggestions for Mix Sessions based on vibe profile and history
 * Uses AI/Claude for intelligent recommendations when no history exists
 */

import type { MixSession, PlayedTrack, Suggestion } from '@dj/shared-types'
import type { AudioEnrichmentService } from './AudioEnrichmentService'
import type { LastFmService } from './LastFmService'
import { z } from 'zod'
import { AIService, createAIService } from '../lib/ai-service'
import { buildVibeDescription, buildInitialSuggestionsPrompt, buildNextTrackPrompt, SYSTEM_PROMPTS } from '../lib/ai-prompts'
import { safeParse } from '../lib/guards'
import { scoreBpmCompatibility, scoreEnergyFlow } from './TransitionScorer'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/** Zod schema for Spotify track from search API */
const SpotifyTrackSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({
    name: z.string(),
    images: z.array(z.object({ url: z.string() })),
    release_date: z.string(),
  }),
  duration_ms: z.number(),
  popularity: z.number(),
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
})

/** Zod schema for Spotify search response */
const SpotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(SpotifyTrackSchema),
  }).optional(),
})

/** Zod schema for AI track suggestion response */
const AITrackSuggestionsSchema = z.object({
  tracks: z.array(z.object({
    artist: z.string(),
    name: z.string(),
    reason: z.string(),
  })),
})

type AITrackSuggestions = z.infer<typeof AITrackSuggestionsSchema>

// =============================================================================
// TYPES
// =============================================================================

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
  private enableThinking: boolean

  constructor(
    private lastFmService: LastFmService,
    private audioService: AudioEnrichmentService,
    private spotifyToken: string,
    anthropicApiKey?: string,
    /** Enable extended thinking for deeper AI reasoning (costs more tokens) */
    enableThinking = false
  ) {
    if (anthropicApiKey) {
      this.aiService = createAIService({ apiKey: anthropicApiKey })
    }
    this.enableThinking = enableThinking
  }

  /**
   * Last thinking content captured (for debugging/analysis)
   */
  public lastThinking: string | null = null

  /**
   * Generate suggestions based on current vibe
   * Uses AI for both initial suggestions (no history) and context-aware suggestions (with history)
   */
  async generateSuggestions(session: MixSession, count: number = 5): Promise<Suggestion[]> {
    try {
      // If no history, use AI to generate initial suggestions based on vibe
      if (session.history.length === 0) {
        getLogger()?.info('[SuggestionEngine] No history, using AI for initial vibe-based recommendations')
        return this.generateInitialSuggestions(session, count)
      }

      // With history, use AI to generate context-aware suggestions based on vibe AND recent tracks
      getLogger()?.info('[SuggestionEngine] Has history, using AI for context-aware recommendations')
      return this.generateContextAwareSuggestions(session, count)
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate suggestions:', error)
      return []
    }
  }

  /**
   * Generate context-aware suggestions using AI when there's play history
   * Uses vibe profile AND recent tracks to suggest what comes next
   */
  private async generateContextAwareSuggestions(
    session: MixSession,
    count: number
  ): Promise<Suggestion[]> {
    try {
      const { vibe, history } = session

      if (!this.aiService) {
        getLogger()?.warn('[SuggestionEngine] No AI service available, falling back to Last.fm similarity')
        return this.generateLastFmFallbackSuggestions(session, count)
      }

      // Build prompt using vibe, recent history, and taste model (Phase 4d)
      const vibeDescription = buildVibeDescription(vibe)
      const recentTracks = history.slice(-5).map(t => ({ name: t.name, artist: t.artist }))

      // Extract taste context from taste model if available
      let tasteContext: { likedGenres: string[]; dislikedGenres: string[]; skippedArtists: string[] } | undefined
      if (session.tasteModel) {
        const likedGenres = Object.entries(session.tasteModel.genreWeights)
          .filter(([_, w]) => w > 0.2).map(([g]) => g)
        const dislikedGenres = Object.entries(session.tasteModel.genreWeights)
          .filter(([_, w]) => w < -0.2).map(([g]) => g)
        const skippedArtists = session.tasteModel.skipPatterns.slice(-5)
        if (likedGenres.length > 0 || dislikedGenres.length > 0 || skippedArtists.length > 0) {
          tasteContext = { likedGenres, dislikedGenres, skippedArtists }
        }
      }

      const prompt = buildNextTrackPrompt(vibeDescription, recentTracks, count * 2, tasteContext)

      getLogger()?.info('[SuggestionEngine] Asking AI for context-aware track suggestions...', {
        enableThinking: this.enableThinking,
      })

      // Use AI service for the request
      // When thinking is enabled, we get deeper reasoning about track selection
      const response = await this.aiService.promptForJSON(prompt, {
        temperature: this.enableThinking ? undefined : 0.8, // No temp with thinking
        system: SYSTEM_PROMPTS.DJ,
        thinkingBudget: this.enableThinking ? 2000 : undefined,
      })

      // Capture thinking for analysis
      if (response.thinking) {
        this.lastThinking = response.thinking
        getLogger()?.info('[SuggestionEngine] Extended thinking captured', {
          thinkingPreview: response.thinking.slice(0, 500) + '...',
          usage: response.usage,
        })
      }

      const parsed = AITrackSuggestionsSchema.safeParse(response.data)
      if (response.error || !parsed.success) {
        getLogger()?.error('[SuggestionEngine] AI request failed:', response.error)
        // Fallback to Last.fm-based suggestions
        return this.generateLastFmFallbackSuggestions(session, count)
      }

      const aiSuggestions: AITrackSuggestions = parsed.data

      if (aiSuggestions.tracks.length === 0) {
        getLogger()?.info('[SuggestionEngine] AI returned no track suggestions')
        return this.generateLastFmFallbackSuggestions(session, count)
      }

      getLogger()?.info(`[SuggestionEngine] AI suggested ${aiSuggestions.tracks.length} tracks, searching Spotify...`)

      // Search Spotify for each suggested track
      const spotifyTracks: SpotifyTrack[] = []
      for (const suggestion of aiSuggestions.tracks) {
        const track = await this.searchSpotifyTrack(suggestion.artist, suggestion.name)
        if (track) {
          spotifyTracks.push(track)
        }
        if (spotifyTracks.length >= count * 2) break
      }

      if (spotifyTracks.length === 0) {
        getLogger()?.info('[SuggestionEngine] No Spotify tracks found for AI suggestions, falling back to Last.fm')
        return this.generateLastFmFallbackSuggestions(session, count)
      }

      // Filter out tracks already in queue/history
      const filtered = this.filterAlreadyPlayed(spotifyTracks, session)

      // Build suggestions with AI-provided reasons and enrichment data
      const lastTrack = history[history.length - 1]
      const suggestions: Suggestion[] = await Promise.all(
        filtered.slice(0, count).map(async (track, index) => {
          const enrichment = await this.audioService.enrichTrack(track)
          const vibeScore = this.scoreSuggestion(track, vibe, lastTrack, enrichment.bpm, null, [])
          const transitionScore = lastTrack ? this.scoreTransition(lastTrack, { bpm: enrichment.bpm, energy: null }) : 50
          const aiReason = aiSuggestions.tracks[index]?.reason || 'AI-recommended for your vibe and recent tracks'

          return {
            trackId: track.id,
            trackUri: track.uri,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist',
            albumArt: track.album.images[0]?.url,
            vibeScore: Math.round((vibeScore + transitionScore) / 2),
            reason: aiReason,
            bpm: enrichment.bpm,
          }
        })
      )

      // Sort by vibe score
      suggestions.sort((a, b) => b.vibeScore - a.vibeScore)

      getLogger()?.info(`[SuggestionEngine] Generated ${suggestions.length} AI-powered context-aware suggestions`)
      return suggestions
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate AI context-aware suggestions:', error)
      return this.generateLastFmFallbackSuggestions(session, count)
    }
  }

  /**
   * Fallback to Last.fm similarity-based suggestions when AI is unavailable
   */
  private async generateLastFmFallbackSuggestions(
    session: MixSession,
    count: number
  ): Promise<Suggestion[]> {
    try {
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
            energy: null,
            genres: [],
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

      getLogger()?.info(`[SuggestionEngine] Generated ${topSuggestions.length} Last.fm fallback suggestions`)
      return topSuggestions
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate Last.fm fallback suggestions:', error)
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
   * Uses TransitionScorer for BPM + energy-aware scoring.
   */
  scoreTransition(
    fromTrack: PlayedTrack,
    toTrack: { bpm: number | null; energy: number | null },
    targetEnergy?: number,
  ): number {
    const bpmScore = scoreBpmCompatibility(fromTrack.bpm, toTrack.bpm)
    const energyTarget = targetEnergy ?? 0.5
    const energyScore = scoreEnergyFlow(toTrack.energy ?? 0.5, energyTarget)

    // Weighted: 60% BPM, 40% energy
    return Math.round((bpmScore * 0.6 + energyScore * 0.4) * 100)
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

      const rawData: unknown = await response.json()
      const parseResult = safeParse(SpotifySearchResponseSchema, rawData)

      if (!parseResult.success) {
        getLogger()?.warn('[SuggestionEngine] Invalid Spotify search response:', {error: parseResult.error.message})
        return null
      }

      const tracks = parseResult.data.tracks?.items ?? []

      if (tracks.length === 0) {
        return null
      }

      return tracks[0]
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

      getLogger()?.info('[SuggestionEngine] Asking AI for initial track suggestions...', {
        enableThinking: this.enableThinking,
      })

      // Use common AI service for the request
      // When thinking is enabled, we get deeper reasoning about vibe interpretation
      const response = await this.aiService.promptForJSON(prompt, {
        temperature: this.enableThinking ? undefined : 0.8, // No temp with thinking
        system: SYSTEM_PROMPTS.DJ,
        thinkingBudget: this.enableThinking ? 2000 : undefined,
      })

      // Capture thinking for analysis
      if (response.thinking) {
        this.lastThinking = response.thinking
        getLogger()?.info('[SuggestionEngine] Extended thinking captured (initial)', {
          thinkingPreview: response.thinking.slice(0, 500) + '...',
          usage: response.usage,
        })
      }

      const parsed = AITrackSuggestionsSchema.safeParse(response.data)
      if (response.error || !parsed.success) {
        getLogger()?.error('[SuggestionEngine] AI request failed:', response.error)
        return []
      }

      const aiSuggestions: AITrackSuggestions = parsed.data

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
