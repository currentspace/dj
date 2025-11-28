/**
 * MixSessionService
 * Manages Live DJ Mode mix sessions with vibe tracking, queue, and history
 */

import { randomUUID } from 'node:crypto'
import type {
  MixSession,
  PlayedTrack,
  QueuedTrack,
  SessionPreferences,
  VibeProfile,
} from '@dj/shared-types'
import { MixSessionSchema } from '@dj/shared-types'
import { getLogger } from '../utils/LoggerContext'

const logger = getLogger()

/**
 * Service for managing mix sessions in KV storage
 */
export class MixSessionService {
  private readonly SESSION_TTL = 8 * 60 * 60 // 8 hours in seconds
  private readonly MAX_HISTORY = 20
  private readonly MAX_QUEUE = 10

  constructor(private kv: KVNamespace) {}

  /**
   * Create a new mix session for a user
   */
  async createSession(
    userId: string,
    preferences?: SessionPreferences,
  ): Promise<MixSession> {
    const now = new Date().toISOString()

    const session: MixSession = {
      id: randomUUID(),
      userId,
      createdAt: now,
      updatedAt: now,
      vibe: {
        mood: [],
        genres: [],
        era: { start: 2000, end: 2025 },
        bpmRange: { min: 80, max: 140 },
        energyLevel: 5,
        energyDirection: 'steady',
      },
      history: [],
      queue: [],
      preferences: preferences ?? {
        avoidGenres: [],
        favoriteArtists: [],
        bpmLock: null,
        autoFill: true,
      },
    }

    // Validate with Zod schema
    const validated = MixSessionSchema.parse(session)

    // Store in KV with 8-hour TTL
    await this.kv.put(`mix:${userId}`, JSON.stringify(validated), {
      expirationTtl: this.SESSION_TTL,
    })

    logger?.info(`Created mix session for user ${userId}`, { sessionId: session.id })

    return validated
  }

  /**
   * Retrieve existing session for a user
   */
  async getSession(userId: string): Promise<MixSession | null> {
    const stored = await this.kv.get(`mix:${userId}`, 'text')

    if (!stored) {
      return null
    }

    try {
      const parsed = JSON.parse(stored)
      return MixSessionSchema.parse(parsed)
    } catch (error) {
      logger?.error('Failed to parse session from KV', { userId, error })
      return null
    }
  }

  /**
   * Update existing session in KV
   */
  async updateSession(session: MixSession): Promise<void> {
    // Update timestamp
    session.updatedAt = new Date().toISOString()

    // Validate before storing
    const validated = MixSessionSchema.parse(session)

    await this.kv.put(`mix:${session.userId}`, JSON.stringify(validated), {
      expirationTtl: this.SESSION_TTL,
    })
  }

  /**
   * End session and return stats
   */
  async endSession(userId: string): Promise<{ tracksPlayed: number; sessionDuration: number }> {
    const session = await this.getSession(userId)

    if (!session) {
      return { tracksPlayed: 0, sessionDuration: 0 }
    }

    const tracksPlayed = session.history.length
    const createdAt = new Date(session.createdAt).getTime()
    const endedAt = Date.now()
    const sessionDuration = Math.floor((endedAt - createdAt) / 1000) // in seconds

    // Delete session from KV
    await this.kv.delete(`mix:${userId}`)

    logger?.info(`Ended mix session for user ${userId}`, {
      sessionId: session.id,
      tracksPlayed,
      sessionDuration,
    })

    return { tracksPlayed, sessionDuration }
  }

  /**
   * Update vibe profile from a played track
   */
  updateVibeFromTrack(session: MixSession, track: PlayedTrack): VibeProfile {
    const currentVibe = session.vibe

    // Convert track energy (0-1) to energy level (1-10)
    const trackEnergyLevel = track.energy !== null ? Math.round(track.energy * 10) : null

    // Blend energy levels if we have track energy
    let newEnergyLevel = currentVibe.energyLevel
    if (trackEnergyLevel !== null) {
      // Use weighted average: 70% current, 30% new
      newEnergyLevel = Math.round(currentVibe.energyLevel * 0.7 + trackEnergyLevel * 0.3)
      // Clamp to valid range
      newEnergyLevel = Math.max(1, Math.min(10, newEnergyLevel))
    }

    // Detect energy direction from recent history
    const energyDirection = this.detectEnergyDirection(session, track)

    // Update BPM range to include new track
    let bpmRange = { ...currentVibe.bpmRange }
    if (track.bpm !== null) {
      bpmRange = {
        min: Math.min(currentVibe.bpmRange.min, track.bpm),
        max: Math.max(currentVibe.bpmRange.max, track.bpm),
      }
    }

    const updatedVibe: VibeProfile = {
      ...currentVibe,
      energyLevel: newEnergyLevel,
      energyDirection,
      bpmRange,
    }

    // Update session vibe
    session.vibe = updatedVibe

    return updatedVibe
  }

  /**
   * Blend two vibe profiles using weighted average
   * @param current Current vibe profile
   * @param trackVibe New track vibe (partial)
   * @param weight Weight for new vibe (0-1), defaults to 0.3 (30%)
   */
  blendVibes(
    current: VibeProfile,
    trackVibe: Partial<VibeProfile>,
    weight: number = 0.3,
  ): VibeProfile {
    const blended: VibeProfile = { ...current }

    // Blend energy level if provided
    if (trackVibe.energyLevel !== undefined) {
      blended.energyLevel = Math.round(
        current.energyLevel * (1 - weight) + trackVibe.energyLevel * weight,
      )
      blended.energyLevel = Math.max(1, Math.min(10, blended.energyLevel))
    }

    // Blend energy direction if provided
    if (trackVibe.energyDirection !== undefined) {
      blended.energyDirection = trackVibe.energyDirection
    }

    // Add new moods (up to 5 total)
    if (trackVibe.mood) {
      const combinedMoods = [...current.mood, ...trackVibe.mood]
      const uniqueMoods = Array.from(new Set(combinedMoods))
      blended.mood = uniqueMoods.slice(0, 5)
    }

    // Add new genres (up to 5 total)
    if (trackVibe.genres) {
      const combinedGenres = [...current.genres, ...trackVibe.genres]
      const uniqueGenres = Array.from(new Set(combinedGenres))
      blended.genres = uniqueGenres.slice(0, 5)
    }

    // Blend BPM range if provided
    if (trackVibe.bpmRange) {
      blended.bpmRange = {
        min: Math.min(current.bpmRange.min, trackVibe.bpmRange.min),
        max: Math.max(current.bpmRange.max, trackVibe.bpmRange.max),
      }
    }

    // Blend era if provided
    if (trackVibe.era) {
      blended.era = {
        start: Math.min(current.era.start, trackVibe.era.start),
        end: Math.max(current.era.end, trackVibe.era.end),
      }
    }

    return blended
  }

  /**
   * Add track to queue (max 10 tracks)
   */
  addToQueue(session: MixSession, track: QueuedTrack): void {
    if (session.queue.length >= this.MAX_QUEUE) {
      logger?.debug('Queue is full, cannot add more tracks', { userId: session.userId })
      return
    }

    // Set position to end of queue
    track.position = session.queue.length

    session.queue.push(track)
  }

  /**
   * Remove track from queue by position
   */
  removeFromQueue(session: MixSession, position: number): void {
    if (position < 0 || position >= session.queue.length) {
      logger?.debug('Invalid queue position', { position, queueLength: session.queue.length })
      return
    }

    // Remove track
    session.queue.splice(position, 1)

    // Update positions for remaining tracks
    this.reindexQueue(session)
  }

  /**
   * Reorder queue by moving track from one position to another
   */
  reorderQueue(session: MixSession, from: number, to: number): void {
    if (from < 0 || from >= session.queue.length || to < 0 || to >= session.queue.length) {
      logger?.debug('Invalid reorder positions', { from, to, queueLength: session.queue.length })
      return
    }

    if (from === to) {
      return // Nothing to do
    }

    // Remove track from old position
    const [track] = session.queue.splice(from, 1)

    // Insert at new position
    session.queue.splice(to, 0, track)

    // Update all positions
    this.reindexQueue(session)
  }

  /**
   * Clear all tracks from queue
   */
  clearQueue(session: MixSession): void {
    session.queue = []
    logger?.debug('Cleared queue', { userId: session.userId })
  }

  /**
   * Add track to history (max 20 tracks, newest first)
   */
  addToHistory(session: MixSession, track: PlayedTrack): void {
    // Add to beginning (newest first)
    session.history.unshift(track)

    // Limit to 20 tracks
    if (session.history.length > this.MAX_HISTORY) {
      session.history = session.history.slice(0, this.MAX_HISTORY)
    }
  }

  /**
   * Detect energy direction from recent history
   * @private
   */
  private detectEnergyDirection(
    session: MixSession,
    newTrack: PlayedTrack,
  ): 'building' | 'steady' | 'winding_down' {
    // Need at least 2 previous tracks to detect trend
    if (session.history.length < 2) {
      return 'steady'
    }

    // Get last 3 tracks (most recent 2 from history + new track)
    const recentTracks = [newTrack, ...session.history.slice(0, 2)]

    // Extract energy values (filter out nulls)
    const energyValues = recentTracks
      .map(t => t.energy)
      .filter((e): e is number => e !== null)

    if (energyValues.length < 3) {
      return 'steady'
    }

    // Calculate trend: compare newest to oldest
    const oldest = energyValues[energyValues.length - 1]
    const newest = energyValues[0]
    const diff = newest - oldest

    // Threshold for detecting direction (10% change)
    const threshold = 0.1

    if (diff > threshold) {
      return 'building'
    } else if (diff < -threshold) {
      return 'winding_down'
    }

    return 'steady'
  }

  /**
   * Reindex queue positions to ensure they're sequential from 0
   * @private
   */
  private reindexQueue(session: MixSession): void {
    session.queue.forEach((track, index) => {
      track.position = index
    })
  }
}
