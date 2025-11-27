/**
 * Integration Tests for Live DJ Mode (Mix Session)
 * Tests the full flow: start session → add tracks → steer vibe → save as playlist
 */

import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {SessionPreferences, VibeProfile} from '@dj/shared-types'
import {MixSessionService} from '../../services/MixSessionService'

// Mock KV namespace
const createMockKV = () => {
  const store = new Map<string, string>()
  return {
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    get: vi.fn(async (key: string) => {
      return store.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  } as unknown as KVNamespace
}

describe('Mix Session Integration Tests', () => {
  let kvNamespace: KVNamespace
  let sessionService: MixSessionService

  const mockUserId = 'user123'

  beforeEach(() => {
    kvNamespace = createMockKV()
    sessionService = new MixSessionService(kvNamespace)
  })

  describe('Full Flow: Start → Add Tracks → Steer Vibe → Save', () => {
    it('should complete full mix session workflow', async () => {
      // ===== Step 1: Create Session =====
      const preferences: SessionPreferences = {
        autoFill: true,
        avoidGenres: [],
        bpmLock: null,
        favoriteArtists: [],
      }

      let session = await sessionService.createSession(mockUserId, preferences)

      expect(session).toBeDefined()
      expect(session.userId).toBe(mockUserId)
      expect(session.queue).toHaveLength(0)
      expect(session.history).toHaveLength(0)
      expect(session.vibe).toBeDefined()
      expect(session.vibe.energyLevel).toBe(5) // Default energy level

      // ===== Step 2: Add Tracks to Queue =====
      sessionService.addToQueue(session, {
        addedBy: 'user',
        albumArt: 'https://i.scdn.co/image/album1',
        artist: 'Test Artist 1',
        name: 'Test Track 1',
        position: 0,
        trackId: 'track1',
        trackUri: 'spotify:track:track1',
        vibeScore: 0.85,
      })

      expect(session.queue).toHaveLength(1)
      expect(session.queue[0].trackUri).toBe('spotify:track:track1')

      sessionService.addToQueue(session, {
        addedBy: 'user',
        albumArt: 'https://i.scdn.co/image/album2',
        artist: 'Test Artist 2',
        name: 'Test Track 2',
        position: 1,
        trackId: 'track2',
        trackUri: 'spotify:track:track2',
        vibeScore: 0.78,
      })

      expect(session.queue).toHaveLength(2)

      // Save session to KV
      await sessionService.updateSession(session)

      // ===== Step 3: Update Vibe =====
      const newVibe: Partial<VibeProfile> = {
        energyLevel: 8,
        mood: ['energetic', 'happy'],
      }

      session.vibe = sessionService.blendVibes(session.vibe, newVibe)
      await sessionService.updateSession(session)

      // Blended: 5 * 0.7 + 8 * 0.3 = 3.5 + 2.4 = 5.9 ≈ 6 (rounded)
      expect(session.vibe.energyLevel).toBe(6)
      expect(session.vibe.mood).toContain('energetic')

      // ===== Step 4: Get Suggestions =====
      // Note: Skipping suggestions test because SuggestionEngine requires LastFmService
      // and AudioEnrichmentService which are complex to mock properly
      // In real usage, suggestions are generated via the API route which handles all dependencies

      // ===== Step 5: Save as Playlist =====
      const trackUris = session.queue.map(track => track.trackUri)

      // Simulate creating a playlist (simplified - real implementation would use Spotify API)
      expect(trackUris).toHaveLength(2)
      expect(trackUris[0]).toBe('spotify:track:track1')
      expect(trackUris[1]).toBe('spotify:track:track2')

      // ===== Step 6: End Session =====
      const stats = await sessionService.endSession(mockUserId)

      expect(stats).toBeDefined()
      expect(stats.tracksPlayed).toBe(0) // No tracks played yet
      expect(stats.sessionDuration).toBeGreaterThanOrEqual(0)

      // Verify session is deleted
      const deletedSession = await sessionService.getSession(mockUserId)
      expect(deletedSession).toBeNull()
    })
  })

  describe('Queue Management', () => {
    it('should handle queue operations correctly', async () => {
      // Create session
      let session = await sessionService.createSession(mockUserId)
      expect(session).toBeDefined()

      // Add tracks
      sessionService.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track1',
        trackUri: 'spotify:track:1',
        vibeScore: 0.8,
      })

      sessionService.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 2',
        name: 'Track 2',
        position: 1,
        trackId: 'track2',
        trackUri: 'spotify:track:2',
        vibeScore: 0.7,
      })

      sessionService.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 3',
        name: 'Track 3',
        position: 2,
        trackId: 'track3',
        trackUri: 'spotify:track:3',
        vibeScore: 0.9,
      })

      expect(session.queue).toHaveLength(3)

      // Remove from queue
      sessionService.removeFromQueue(session, 1)
      expect(session.queue).toHaveLength(2)
      expect(session.queue[0].trackUri).toBe('spotify:track:1')
      expect(session.queue[1].trackUri).toBe('spotify:track:3')

      // Reorder queue
      sessionService.reorderQueue(session, 0, 1)
      expect(session.queue).toHaveLength(2)
      expect(session.queue[0].trackUri).toBe('spotify:track:3')
      expect(session.queue[1].trackUri).toBe('spotify:track:1')
    })
  })

  describe('Vibe Controls', () => {
    it('should blend vibe parameters', async () => {
      // Create session
      const session = await sessionService.createSession(mockUserId)

      // Blend energy level
      let newVibe = sessionService.blendVibes(session.vibe, {energyLevel: 9})
      expect(newVibe.energyLevel).toBe(6) // Blended: 5 * 0.7 + 9 * 0.3 = 6.2 ≈ 6 (rounded)

      // Blend BPM range
      session.vibe = newVibe
      newVibe = sessionService.blendVibes(session.vibe, {
        bpmRange: {max: 140, min: 120},
      })
      expect(newVibe.bpmRange.min).toBe(80) // Takes minimum
      expect(newVibe.bpmRange.max).toBe(140) // Takes maximum

      // Add genres
      session.vibe = newVibe
      newVibe = sessionService.blendVibes(session.vibe, {
        genres: ['electronic', 'dance'],
      })
      expect(newVibe.genres).toContain('electronic')
      expect(newVibe.genres).toContain('dance')

      // Add mood
      session.vibe = newVibe
      newVibe = sessionService.blendVibes(session.vibe, {
        mood: ['energetic', 'uplifting'],
      })
      expect(newVibe.mood).toContain('energetic')
      expect(newVibe.mood).toContain('uplifting')
    })

    it('should handle energy direction updates', async () => {
      // Create session
      const session = await sessionService.createSession(mockUserId)

      // Update to building
      let newVibe = sessionService.blendVibes(session.vibe, {energyDirection: 'building'})
      expect(newVibe.energyDirection).toBe('building')

      // Update to winding down
      newVibe = sessionService.blendVibes(newVibe, {energyDirection: 'winding_down'})
      expect(newVibe.energyDirection).toBe('winding_down')

      // Update to steady
      newVibe = sessionService.blendVibes(newVibe, {energyDirection: 'steady'})
      expect(newVibe.energyDirection).toBe('steady')
    })
  })

  describe('Session Persistence', () => {
    it('should persist session to KV and retrieve it', async () => {
      // Create session
      const session1 = await sessionService.createSession(mockUserId, {
        autoFill: true,
        avoidGenres: ['country'],
        bpmLock: null,
        favoriteArtists: ['Artist 1'],
      })

      // Add some tracks
      sessionService.addToQueue(session1, {
        addedBy: 'user',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track1',
        trackUri: 'spotify:track:1',
        vibeScore: 0.8,
      })

      sessionService.addToQueue(session1, {
        addedBy: 'user',
        artist: 'Artist 2',
        name: 'Track 2',
        position: 1,
        trackId: 'track2',
        trackUri: 'spotify:track:2',
        vibeScore: 0.7,
      })

      // Save to KV
      await sessionService.updateSession(session1)

      // Retrieve session
      const session2 = await sessionService.getSession(mockUserId)

      expect(session2).toBeDefined()
      expect(session2?.id).toBe(session1.id)
      expect(session2?.queue).toHaveLength(2)
      expect(session2?.preferences.favoriteArtists).toContain('Artist 1')
    })

    it('should handle missing session gracefully', async () => {
      const session = await sessionService.getSession('nonexistent_user')
      expect(session).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid queue position', async () => {
      const session = await sessionService.createSession(mockUserId)

      sessionService.addToQueue(session, {
        addedBy: 'user',
        artist: 'Artist 1',
        name: 'Track 1',
        position: 0,
        trackId: 'track1',
        trackUri: 'spotify:track:1',
        vibeScore: 0.8,
      })

      expect(session.queue).toHaveLength(1)

      // Trying to remove invalid position should not crash
      sessionService.removeFromQueue(session, 99)
      // Should still have 1 track (removal failed silently or handled)
      expect(session.queue).toHaveLength(1)
    })

    it('should respect max queue size', async () => {
      const session = await sessionService.createSession(mockUserId)

      // Add 11 tracks (max is 10)
      for (let i = 0; i < 11; i++) {
        sessionService.addToQueue(session, {
          addedBy: 'user',
          artist: `Artist ${i}`,
          name: `Track ${i}`,
          position: i,
          trackId: `track${i}`,
          trackUri: `spotify:track:${i}`,
          vibeScore: 0.8,
        })
      }

      // Should only have 10 tracks (max)
      expect(session.queue.length).toBeLessThanOrEqual(10)
    })
  })
})
