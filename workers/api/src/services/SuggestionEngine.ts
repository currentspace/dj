/**
 * SuggestionEngine
 * Generates track suggestions for Mix Sessions based on vibe profile and history
 */

import type { MixSession, PlayedTrack, Suggestion } from '@dj/shared-types'
import type { AudioEnrichmentService } from './AudioEnrichmentService'
import type { LastFmService } from './LastFmService'
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
  constructor(
    private lastFmService: LastFmService,
    private audioService: AudioEnrichmentService,
    private spotifyToken: string
  ) {}

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
   * Generate initial suggestions using Spotify recommendations when no history exists
   * Uses vibe genres, energy level, and BPM range as seeds
   */
  private async generateInitialSuggestions(
    session: MixSession,
    count: number
  ): Promise<Suggestion[]> {
    try {
      const { vibe } = session

      // Build Spotify recommendations URL with vibe parameters
      const params = new URLSearchParams({
        limit: String(count * 2), // Request extra to account for filtering
      })

      // Use vibe genres as seeds (Spotify allows up to 5 seed genres)
      if (vibe.genres.length > 0) {
        // Spotify genre seeds need to be lowercase with hyphens
        const seedGenres = vibe.genres
          .slice(0, 5)
          .map(g => g.toLowerCase().replace(/\s+/g, '-'))
          .join(',')
        params.set('seed_genres', seedGenres)
      } else {
        // Fallback to broad genres based on mood (use first mood if available)
        const primaryMood = vibe.mood[0] || 'energetic'
        params.set('seed_genres', this.getMoodBasedGenres(primaryMood))
      }

      // Target energy (Spotify uses 0-1 scale, vibe uses 1-10)
      const targetEnergy = vibe.energyLevel / 10
      params.set('target_energy', String(targetEnergy))
      params.set('min_energy', String(Math.max(0, targetEnergy - 0.2)))
      params.set('max_energy', String(Math.min(1, targetEnergy + 0.2)))

      // BPM range
      if (vibe.bpmRange) {
        params.set('min_tempo', String(vibe.bpmRange.min))
        params.set('max_tempo', String(vibe.bpmRange.max))
        params.set('target_tempo', String((vibe.bpmRange.min + vibe.bpmRange.max) / 2))
      }

      const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`
      getLogger()?.info(`[SuggestionEngine] Fetching initial recommendations: ${url}`)

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.spotifyToken}`,
        },
      })

      if (!response.ok) {
        getLogger()?.error(`[SuggestionEngine] Recommendations failed: ${response.status}`)
        return []
      }

      const data = await response.json() as { tracks?: SpotifyTrack[] }
      const tracks = data.tracks || []

      if (tracks.length === 0) {
        getLogger()?.info('[SuggestionEngine] No recommendations returned')
        return []
      }

      // Filter out any tracks already in queue
      const filtered = this.filterAlreadyPlayed(tracks, session)

      // Enrich with BPM data and build suggestions
      const suggestions: Suggestion[] = await Promise.all(
        filtered.slice(0, count).map(async (track) => {
          const enrichment = await this.audioService.enrichTrack(track)
          const vibeScore = this.scoreSuggestion(track, vibe, undefined, enrichment.bpm, null, [])

          return {
            trackId: track.id,
            trackUri: track.uri,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist',
            albumArt: track.album.images[0]?.url,
            vibeScore,
            reason: this.buildInitialReason(vibe, enrichment.bpm),
            bpm: enrichment.bpm,
          }
        })
      )

      // Sort by vibe score
      suggestions.sort((a, b) => b.vibeScore - a.vibeScore)

      getLogger()?.info(`[SuggestionEngine] Generated ${suggestions.length} initial suggestions`)
      return suggestions
    } catch (error) {
      getLogger()?.error('[SuggestionEngine] Failed to generate initial suggestions:', error)
      return []
    }
  }

  /**
   * Build a reason string for initial suggestions
   */
  private buildInitialReason(vibe: MixSession['vibe'], bpm: number | null): string {
    const reasons: string[] = []

    if (vibe.genres.length > 0) {
      reasons.push(`Matches ${vibe.genres.slice(0, 2).join(', ')} vibe`)
    }

    if (bpm && vibe.bpmRange) {
      const targetBpm = (vibe.bpmRange.min + vibe.bpmRange.max) / 2
      if (Math.abs(bpm - targetBpm) < 10) {
        reasons.push(`${bpm} BPM`)
      }
    }

    const energyDesc = vibe.energyLevel <= 3 ? 'chill' : vibe.energyLevel <= 6 ? 'medium' : 'high'
    reasons.push(`${energyDesc} energy`)

    return reasons.join(' • ') || 'Matches your vibe'
  }

  /**
   * Get fallback genres based on mood when no genres are specified
   * Returns comma-separated string ready for Spotify API
   */
  private getMoodBasedGenres(mood: string): string {
    const moodGenreMap: Record<string, string> = {
      chill: 'chill,ambient,acoustic',
      energetic: 'dance,electronic,pop',
      happy: 'pop,funk,disco',
      sad: 'acoustic,indie,singer-songwriter',
      focused: 'ambient,classical,electronic',
      party: 'dance,edm,hip-hop',
      romantic: 'r-n-b,soul,jazz',
      workout: 'hip-hop,electronic,rock',
    }

    return moodGenreMap[mood.toLowerCase()] || 'pop,rock,indie'
  }
}
