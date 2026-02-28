/**
 * MixSessionService Tests
 * Tests for Live DJ Mode mix session management
 */

import type {
  MixSession,
  PlayedTrack,
  QueuedTrack,
  SessionPreferences,
  VibeProfile,
} from '@dj/shared-types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MixSessionService } from '../../services/MixSessionService'
import { MockKVNamespace } from '../fixtures/cloudflare-mocks'

// Mock logger
vi.mock('../../utils/LoggerContext', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

/** Default fields for new MixSession properties (Phase 1-4) */
const newSessionDefaults: Pick<MixSession, 'conversation' | 'fallbackPool' | 'plan' | 'signals' | 'tasteModel'> = {
  conversation: [],
  fallbackPool: [],
  plan: null,
  signals: [],
  tasteModel: null,
}

/** Create a test MixSession with all required fields */
function createTestMixSession(overrides: Partial<MixSession> = {}): MixSession {
  return {
    createdAt: new Date().toISOString(),
    history: [],
    id: 'session-1',
    preferences: {
      autoFill: true,
      avoidGenres: [],
      bpmLock: null,
      favoriteArtists: [],
    },
    queue: [],
    updatedAt: new Date().toISOString(),
    userId: 'user-1',
    vibe: {
      bpmRange: {max: 140, min: 80},
      energyDirection: 'steady',
      energyLevel: 5,
      era: {end: 2025, start: 2000},
      genres: [],
      mood: [],
    },
    ...newSessionDefaults,
    ...overrides,
  }
}

describe('MixSessionService', () => {
  let service: MixSessionService
  let mockKV: MockKVNamespace

  beforeEach(() => {
    mockKV = new MockKVNamespace()
     
    service = new MixSessionService(mockKV as any)
  })

  describe('Session Lifecycle', () => {
    it('should create a new session with default preferences', async () => {
      const userId = 'user-123'
      const session = await service.createSession(userId)

      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(session.userId).toBe(userId)
      expect(session.createdAt).toBeDefined()
      expect(session.updatedAt).toBeDefined()
      expect(session.vibe).toEqual({
        bpmRange: { max: 140, min: 80 },
        energyDirection: 'steady',
        energyLevel: 5,
        era: { end: 2025, start: 2000 },
        genres: [],
        mood: [],
      })
      expect(session.history).toEqual([])
      expect(session.queue).toEqual([])
      expect(session.preferences).toEqual({
        autoFill: true,
        avoidGenres: [],
        bpmLock: null,
        favoriteArtists: [],
      })
    })

    it('should create session with custom preferences', async () => {
      const userId = 'user-456'
      const preferences: SessionPreferences = {
        autoFill: false,
        avoidGenres: ['country', 'metal'],
        bpmLock: { max: 130, min: 120 },
        favoriteArtists: ['Daft Punk', 'Caribou'],
      }

      const session = await service.createSession(userId, preferences)

      expect(session.preferences).toEqual(preferences)
    })

    it('should store session in KV with 8-hour TTL', async () => {
      const userId = 'user-789'
      await service.createSession(userId)

      const stored = await mockKV.get(`mix:${userId}`, 'json')
      expect(stored).toBeDefined()

      // Verify TTL (8 hours = 28800 seconds)
      const storeEntry = mockKV.getStore().get(`mix:${userId}`)
      expect(storeEntry?.expiration).toBeGreaterThan(Date.now())
      // TTL should be approximately 8 hours from now
      const ttlMs = storeEntry!.expiration! - Date.now()
      expect(ttlMs).toBeGreaterThan(28700 * 1000) // Within 100 seconds of 8 hours
      expect(ttlMs).toBeLessThanOrEqual(28800 * 1000)
    })

    it('should retrieve existing session', async () => {
      const userId = 'user-get'
      const created = await service.createSession(userId)

      const retrieved = await service.getSession(userId)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent session', async () => {
      const session = await service.getSession('non-existent-user')
      expect(session).toBeNull()
    })

    it('should update existing session', async () => {
      const userId = 'user-update'
      const session = await service.createSession(userId)

      // Modify session
      session.vibe.energyLevel = 8
      session.vibe.energyDirection = 'building'

      await service.updateSession(session)

      const retrieved = await service.getSession(userId)
      expect(retrieved?.vibe.energyLevel).toBe(8)
      expect(retrieved?.vibe.energyDirection).toBe('building')
    })

    it('should update session timestamp on update', async () => {
      const userId = 'user-timestamp'
      const session = await service.createSession(userId)
      const originalTimestamp = session.updatedAt

      // Wait a tiny bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10))

      await service.updateSession(session)

      const retrieved = await service.getSession(userId)
      expect(retrieved?.updatedAt).not.toBe(originalTimestamp)
    })

    it('should end session and return stats', async () => {
      const userId = 'user-end'
      const session = await service.createSession(userId)

      // Add some played tracks
      const track1: PlayedTrack = {
        artist: 'Artist 1',
        bpm: 120,
        energy: 0.8,
        name: 'Track 1',
        playedAt: new Date().toISOString(),
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
      }
      const track2: PlayedTrack = {
        artist: 'Artist 2',
        bpm: 125,
        energy: 0.7,
        name: 'Track 2',
        playedAt: new Date(Date.now() + 200000).toISOString(),
        trackId: 'track-2',
        trackUri: 'spotify:track:2',
      }

      service.addToHistory(session, track1)
      service.addToHistory(session, track2)
      await service.updateSession(session)

      const stats = await service.endSession(userId)

      expect(stats.tracksPlayed).toBe(2)
      expect(stats.sessionDuration).toBeGreaterThanOrEqual(0)

      // Verify session is deleted
      const deleted = await service.getSession(userId)
      expect(deleted).toBeNull()
    })

    it('should return zero stats when ending non-existent session', async () => {
      const stats = await service.endSession('non-existent-user')

      expect(stats.tracksPlayed).toBe(0)
      expect(stats.sessionDuration).toBe(0)
    })
  })

  describe('Vibe Management', () => {
    it('should update vibe from track with BPM and energy', () => {
      const session = createTestMixSession()

      const track: PlayedTrack = {
        artist: 'DJ Artist',
        bpm: 130,
        energy: 0.9,
        name: 'High Energy Track',
        playedAt: new Date().toISOString(),
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
      }

      const updatedVibe = service.updateVibeFromTrack(session, track)

      // Energy level should be influenced by track energy (0.9 = level 9)
      expect(updatedVibe.energyLevel).toBeGreaterThan(5)
      // BPM range should expand to include track BPM
      expect(updatedVibe.bpmRange.min).toBeLessThanOrEqual(130)
      expect(updatedVibe.bpmRange.max).toBeGreaterThanOrEqual(130)
    })

    it('should detect building energy direction from history', () => {
      const session = createTestMixSession({
        history: [
          {
            artist: 'Artist 1',
            bpm: 100,
            energy: 0.5,
            name: 'Track 1',
            playedAt: new Date(Date.now() - 600000).toISOString(),
            trackId: 'track-1',
            trackUri: 'spotify:track:1',
          },
          {
            artist: 'Artist 2',
            bpm: 120,
            energy: 0.7,
            name: 'Track 2',
            playedAt: new Date(Date.now() - 300000).toISOString(),
            trackId: 'track-2',
            trackUri: 'spotify:track:2',
          },
        ],
        vibe: {
          bpmRange: { max: 140, min: 100 },
          energyDirection: 'steady',
          energyLevel: 5,
          era: { end: 2025, start: 2000 },
          genres: [],
          mood: [],
        },
      })

      const track: PlayedTrack = {
        artist: 'DJ Artist',
        bpm: 135,
        energy: 0.9,
        name: 'High Energy Track',
        playedAt: new Date().toISOString(),
        trackId: 'track-3',
        trackUri: 'spotify:track:3',
      }

      const updatedVibe = service.updateVibeFromTrack(session, track)

      expect(updatedVibe.energyDirection).toBe('building')
    })

    it('should detect winding down energy direction', () => {
      const session = createTestMixSession({
        history: [
          {
            artist: 'Artist 1',
            bpm: 140,
            energy: 0.9,
            name: 'Track 1',
            playedAt: new Date(Date.now() - 600000).toISOString(),
            trackId: 'track-1',
            trackUri: 'spotify:track:1',
          },
          {
            artist: 'Artist 2',
            bpm: 120,
            energy: 0.6,
            name: 'Track 2',
            playedAt: new Date(Date.now() - 300000).toISOString(),
            trackId: 'track-2',
            trackUri: 'spotify:track:2',
          },
        ],
        vibe: {
          bpmRange: { max: 140, min: 100 },
          energyDirection: 'steady',
          energyLevel: 8,
          era: { end: 2025, start: 2000 },
          genres: [],
          mood: [],
        },
      })

      const track: PlayedTrack = {
        artist: 'Artist',
        bpm: 90,
        energy: 0.3,
        name: 'Low Energy Track',
        playedAt: new Date().toISOString(),
        trackId: 'track-3',
        trackUri: 'spotify:track:3',
      }

      const updatedVibe = service.updateVibeFromTrack(session, track)

      expect(updatedVibe.energyDirection).toBe('winding_down')
    })

    it('should blend vibes using weighted average (70% current, 30% new)', () => {
      const currentVibe: VibeProfile = {
        bpmRange: { max: 130, min: 120 },
        energyDirection: 'steady',
        energyLevel: 6,
        era: { end: 2025, start: 2000 },
        genres: ['house'],
        mood: ['energetic'],
      }

      const trackVibe: Partial<VibeProfile> = {
        energyLevel: 9,
      }

      const blended = service.blendVibes(currentVibe, trackVibe)

      // 70% of 6 + 30% of 9 = 4.2 + 2.7 = 6.9 ≈ 7
      expect(blended.energyLevel).toBeGreaterThan(6)
      expect(blended.energyLevel).toBeLessThanOrEqual(7)
    })

    it('should use custom weight in vibe blending', () => {
      const currentVibe: VibeProfile = {
        bpmRange: { max: 130, min: 120 },
        energyDirection: 'steady',
        energyLevel: 5,
        era: { end: 2025, start: 2000 },
        genres: [],
        mood: [],
      }

      const trackVibe: Partial<VibeProfile> = {
        energyLevel: 10,
      }

      // Use 50% weight instead of default 30%
      const blended = service.blendVibes(currentVibe, trackVibe, 0.5)

      // 50% of 5 + 50% of 10 = 2.5 + 5 = 7.5 ≈ 8 (rounded)
      expect(blended.energyLevel).toBe(8)
    })

    it('should add new moods up to 5 total', () => {
      const currentVibe: VibeProfile = {
        bpmRange: { max: 130, min: 120 },
        energyDirection: 'steady',
        energyLevel: 7,
        era: { end: 2025, start: 2000 },
        genres: [],
        mood: ['energetic', 'uplifting'],
      }

      const trackVibe: Partial<VibeProfile> = {
        mood: ['happy', 'groovy'],
      }

      const blended = service.blendVibes(currentVibe, trackVibe)

      expect(blended.mood).toContain('energetic')
      expect(blended.mood).toContain('uplifting')
      expect(blended.mood).toContain('happy')
      expect(blended.mood).toContain('groovy')
      expect(blended.mood.length).toBe(4)
    })

    it('should limit moods to 5', () => {
      const currentVibe: VibeProfile = {
        bpmRange: { max: 130, min: 120 },
        energyDirection: 'steady',
        energyLevel: 7,
        era: { end: 2025, start: 2000 },
        genres: [],
        mood: ['energetic', 'uplifting', 'happy', 'groovy'],
      }

      const trackVibe: Partial<VibeProfile> = {
        mood: ['chill', 'relaxed', 'mellow'],
      }

      const blended = service.blendVibes(currentVibe, trackVibe)

      expect(blended.mood.length).toBe(5)
    })

    it('should add new genres up to 5 total', () => {
      const currentVibe: VibeProfile = {
        bpmRange: { max: 130, min: 120 },
        energyDirection: 'steady',
        energyLevel: 7,
        era: { end: 2025, start: 2000 },
        genres: ['house', 'techno'],
        mood: [],
      }

      const trackVibe: Partial<VibeProfile> = {
        genres: ['electronic', 'dance'],
      }

      const blended = service.blendVibes(currentVibe, trackVibe)

      expect(blended.genres).toContain('house')
      expect(blended.genres).toContain('techno')
      expect(blended.genres).toContain('electronic')
      expect(blended.genres).toContain('dance')
      expect(blended.genres.length).toBe(4)
    })
  })

  describe('Queue Management', () => {
    let session: MixSession

    beforeEach(() => {
      session = createTestMixSession()
    })

    it('should add track to queue at end', () => {
      const track: QueuedTrack = {
        addedBy: 'user',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 85,
      }

      service.addToQueue(session, track)

      expect(session.queue).toHaveLength(1)
      expect(session.queue[0]).toEqual({ ...track, position: 0 })
    })

    it('should maintain position order when adding tracks', () => {
      const track1: QueuedTrack = {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      }

      const track2: QueuedTrack = {
        addedBy: 'user',
        artist: 'Artist 2',
        name: 'Track 2',
        position: 1,
        trackId: 'track-2',
        trackUri: 'spotify:track:2',
        vibeScore: 75,
      }

      service.addToQueue(session, track1)
      service.addToQueue(session, track2)

      expect(session.queue).toHaveLength(2)
      expect(session.queue[0].position).toBe(0)
      expect(session.queue[1].position).toBe(1)
    })

    it('should enforce max 10 tracks in queue', () => {
      // Add 10 tracks
      for (let i = 0; i < 10; i++) {
        service.addToQueue(session, {
          addedBy: 'ai',
          artist: `Artist ${i}`,
          name: `Track ${i}`,
          position: i,
          trackId: `track-${i}`,
          trackUri: `spotify:track:${i}`,
          vibeScore: 80,
        })
      }

      expect(session.queue).toHaveLength(10)

      // Try to add 11th track
      service.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 11',
        name: 'Track 11',
        position: 10,
        trackId: 'track-11',
        trackUri: 'spotify:track:11',
        vibeScore: 95,
      })

      // Should still be 10
      expect(session.queue).toHaveLength(10)
    })

    it('should remove track from queue by position', () => {
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      })
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 2',
        name: 'Track 2',
        position: 1,
        trackId: 'track-2',
        trackUri: 'spotify:track:2',
        vibeScore: 85,
      })
      service.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 3',
        name: 'Track 3',
        position: 2,
        trackId: 'track-3',
        trackUri: 'spotify:track:3',
        vibeScore: 80,
      })

      service.removeFromQueue(session, 1)

      expect(session.queue).toHaveLength(2)
      expect(session.queue[0].trackId).toBe('track-1')
      expect(session.queue[1].trackId).toBe('track-3')
      // Positions should be updated
      expect(session.queue[0].position).toBe(0)
      expect(session.queue[1].position).toBe(1)
    })

    it('should handle removing from empty queue gracefully', () => {
      service.removeFromQueue(session, 0)
      expect(session.queue).toHaveLength(0)
    })

    it('should handle removing invalid position gracefully', () => {
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      })

      service.removeFromQueue(session, 5)

      expect(session.queue).toHaveLength(1)
    })

    it('should reorder queue tracks', () => {
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      })
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 2',
        name: 'Track 2',
        position: 1,
        trackId: 'track-2',
        trackUri: 'spotify:track:2',
        vibeScore: 85,
      })
      service.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 3',
        name: 'Track 3',
        position: 2,
        trackId: 'track-3',
        trackUri: 'spotify:track:3',
        vibeScore: 80,
      })

      // Move track at position 2 to position 0
      service.reorderQueue(session, 2, 0)

      expect(session.queue[0].trackId).toBe('track-3')
      expect(session.queue[1].trackId).toBe('track-1')
      expect(session.queue[2].trackId).toBe('track-2')
      // Verify positions are updated
      expect(session.queue[0].position).toBe(0)
      expect(session.queue[1].position).toBe(1)
      expect(session.queue[2].position).toBe(2)
    })

    it('should handle reordering to same position', () => {
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      })

      service.reorderQueue(session, 0, 0)

      expect(session.queue[0].trackId).toBe('track-1')
      expect(session.queue).toHaveLength(1)
    })

    it('should handle invalid reorder positions gracefully', () => {
      service.addToQueue(session, {
        addedBy: 'ai',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
        vibeScore: 90,
      })

      // Try to reorder with invalid positions
      service.reorderQueue(session, 5, 0)
      service.reorderQueue(session, 0, 10)

      // Queue should remain unchanged
      expect(session.queue).toHaveLength(1)
      expect(session.queue[0].trackId).toBe('track-1')
    })
  })

  describe('History Management', () => {
    let session: MixSession

    beforeEach(() => {
      session = createTestMixSession()
    })

    it('should add track to history', () => {
      const track: PlayedTrack = {
        artist: 'Artist 1',
        bpm: 120,
        energy: 0.8,
        name: 'Track 1',
        playedAt: new Date().toISOString(),
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
      }

      service.addToHistory(session, track)

      expect(session.history).toHaveLength(1)
      expect(session.history[0]).toEqual(track)
    })

    it('should maintain chronological order (newest first)', () => {
      const track1: PlayedTrack = {
        artist: 'Artist 1',
        bpm: 120,
        energy: 0.8,
        name: 'Track 1',
        playedAt: new Date(Date.now() - 10000).toISOString(),
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
      }

      const track2: PlayedTrack = {
        artist: 'Artist 2',
        bpm: 125,
        energy: 0.7,
        name: 'Track 2',
        playedAt: new Date().toISOString(),
        trackId: 'track-2',
        trackUri: 'spotify:track:2',
      }

      service.addToHistory(session, track1)
      service.addToHistory(session, track2)

      // Most recent should be first
      expect(session.history[0].trackId).toBe('track-2')
      expect(session.history[1].trackId).toBe('track-1')
    })

    it('should limit history to 20 tracks', () => {
      // Add 25 tracks
      for (let i = 0; i < 25; i++) {
        service.addToHistory(session, {
          artist: `Artist ${i}`,
          bpm: 120,
          energy: 0.7,
          name: `Track ${i}`,
          playedAt: new Date(Date.now() - (25 - i) * 1000).toISOString(),
          trackId: `track-${i}`,
          trackUri: `spotify:track:${i}`,
        })
      }

      // Should only keep most recent 20
      expect(session.history).toHaveLength(20)
      // Most recent should be track-24
      expect(session.history[0].trackId).toBe('track-24')
      // Oldest in history should be track-5 (tracks 0-4 removed)
      expect(session.history[19].trackId).toBe('track-5')
    })

    it('should remove oldest tracks when exceeding 20', () => {
      // Add 20 tracks
      for (let i = 0; i < 20; i++) {
        service.addToHistory(session, {
          artist: `Artist ${i}`,
          bpm: 120,
          energy: 0.7,
          name: `Track ${i}`,
          playedAt: new Date(Date.now() - (20 - i) * 1000).toISOString(),
          trackId: `track-${i}`,
          trackUri: `spotify:track:${i}`,
        })
      }

      expect(session.history).toHaveLength(20)

      // Add one more
      service.addToHistory(session, {
        artist: 'Artist 20',
        bpm: 130,
        energy: 0.9,
        name: 'Track 20',
        playedAt: new Date().toISOString(),
        trackId: 'track-20',
        trackUri: 'spotify:track:20',
      })

      // Should still be 20, oldest removed
      expect(session.history).toHaveLength(20)
      expect(session.history[0].trackId).toBe('track-20')
      expect(session.history[19].trackId).toBe('track-1')
      // track-0 should be removed
      expect(session.history.find(t => t.trackId === 'track-0')).toBeUndefined()
    })

    it('should handle tracks with null BPM and energy', () => {
      const track: PlayedTrack = {
        artist: 'Artist',
        bpm: null,
        energy: null,
        name: 'Track without data',
        playedAt: new Date().toISOString(),
        trackId: 'track-1',
        trackUri: 'spotify:track:1',
      }

      service.addToHistory(session, track)

      expect(session.history).toHaveLength(1)
      expect(session.history[0].bpm).toBeNull()
      expect(session.history[0].energy).toBeNull()
    })
  })
})
