import {describe, expect, it} from 'vitest'

import {
  PlaybackConnectedEventSchema,
  PlaybackContextEventSchema,
  PlaybackDeviceEventSchema,
  PlaybackErrorEventSchema,
  PlaybackIdleEventSchema,
  PlaybackModesEventSchema,
  PlaybackStateEventSchema,
  PlaybackStateInitSchema,
  PlaybackTickEventSchema,
  PlaybackTrackEventSchema,
  PlaybackVolumeEventSchema,
} from '../schemas/playback-event-schemas'

describe('Playback Event Schemas', () => {
  describe('PlaybackStateInitSchema', () => {
    it('validates a complete init event', () => {
      const init = {
        context: {
          href: null,
          name: 'My Playlist',
          type: 'playlist' as const,
          uri: 'spotify:playlist:abc',
        },
        device: {
          id: 'device123',
          isPrivateSession: false,
          isRestricted: false,
          name: 'My Speaker',
          supportsVolume: true,
          type: 'speaker' as const,
          volumePercent: 75,
        },
        isPlaying: true,
        modes: {repeat: 'off' as const, shuffle: false},
        playingType: 'track' as const,
        progress: 45000,
        seq: 1,
        timestamp: Date.now(),
        track: {
          albumArt: 'https://i.scdn.co/image/abc123',
          albumName: 'A Night at the Opera',
          artist: 'Queen',
          duration: 354000,
          explicit: false,
          id: '4uLU6hMCjMI75M1A2tKUQC',
          isLocal: false,
          name: 'Bohemian Rhapsody',
          popularity: 91,
          previewUrl: null,
          uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
        },
      }
      expect(PlaybackStateInitSchema.safeParse(init).success).toBe(true)
    })

    it('validates init with null track (nothing playing)', () => {
      const init = {
        context: null,
        device: {
          id: null,
          isPrivateSession: false,
          isRestricted: false,
          name: 'Unknown',
          supportsVolume: false,
          type: 'unknown' as const,
          volumePercent: null,
        },
        isPlaying: false,
        modes: {repeat: 'off' as const, shuffle: false},
        playingType: 'unknown' as const,
        progress: 0,
        seq: 0,
        timestamp: Date.now(),
        track: null,
      }
      expect(PlaybackStateInitSchema.safeParse(init).success).toBe(true)
    })

    it('rejects init missing required fields', () => {
      const result = PlaybackStateInitSchema.safeParse({isPlaying: true})
      expect(result.success).toBe(false)
    })
  })

  describe('PlaybackTickEventSchema', () => {
    it('validates a tick event', () => {
      const tick = {p: 45000, ts: Date.now()}
      expect(PlaybackTickEventSchema.safeParse(tick).success).toBe(true)
    })

    it('rejects tick without progress', () => {
      expect(PlaybackTickEventSchema.safeParse({ts: 123}).success).toBe(false)
    })
  })

  describe('PlaybackTrackEventSchema', () => {
    it('validates a track change event', () => {
      const track = {
        albumArt: null,
        albumName: 'Test Album',
        artist: 'Test Artist',
        duration: 200000,
        explicit: false,
        id: 'track123',
        isLocal: false,
        name: 'Test Song',
        popularity: 50,
        previewUrl: null,
        seq: 5,
        uri: 'spotify:track:track123',
      }
      expect(PlaybackTrackEventSchema.safeParse(track).success).toBe(true)
    })
  })

  describe('PlaybackStateEventSchema', () => {
    it('validates a play/pause state event', () => {
      expect(PlaybackStateEventSchema.safeParse({isPlaying: true, seq: 3}).success).toBe(true)
      expect(PlaybackStateEventSchema.safeParse({isPlaying: false, seq: 4}).success).toBe(true)
    })
  })

  describe('PlaybackDeviceEventSchema', () => {
    it('validates a device change event', () => {
      const device = {
        id: 'dev123',
        isPrivateSession: false,
        isRestricted: false,
        name: 'My Phone',
        seq: 2,
        supportsVolume: true,
        type: 'smartphone' as const,
        volumePercent: 50,
      }
      expect(PlaybackDeviceEventSchema.safeParse(device).success).toBe(true)
    })
  })

  describe('PlaybackModesEventSchema', () => {
    it('validates a modes change event', () => {
      expect(PlaybackModesEventSchema.safeParse({repeat: 'context', seq: 1, shuffle: true}).success).toBe(true)
    })

    it('rejects invalid repeat state', () => {
      expect(PlaybackModesEventSchema.safeParse({repeat: 'invalid', seq: 1, shuffle: true}).success).toBe(false)
    })
  })

  describe('PlaybackVolumeEventSchema', () => {
    it('validates a volume change event', () => {
      expect(PlaybackVolumeEventSchema.safeParse({percent: 80, seq: 7}).success).toBe(true)
    })
  })

  describe('PlaybackContextEventSchema', () => {
    it('validates a context change event', () => {
      const ctx = {
        context: {href: null, name: 'Test Album', type: 'album' as const, uri: 'spotify:album:abc'},
        seq: 3,
      }
      expect(PlaybackContextEventSchema.safeParse(ctx).success).toBe(true)
    })

    it('validates context change to null', () => {
      expect(PlaybackContextEventSchema.safeParse({context: null, seq: 4}).success).toBe(true)
    })
  })

  describe('PlaybackIdleEventSchema', () => {
    it('validates an idle event', () => {
      expect(PlaybackIdleEventSchema.safeParse({seq: 10}).success).toBe(true)
    })
  })

  describe('PlaybackConnectedEventSchema', () => {
    it('validates a connected event', () => {
      expect(PlaybackConnectedEventSchema.safeParse({message: 'Connected'}).success).toBe(true)
      expect(PlaybackConnectedEventSchema.safeParse({}).success).toBe(true)
    })
  })

  describe('PlaybackErrorEventSchema', () => {
    it('validates an error event', () => {
      expect(PlaybackErrorEventSchema.safeParse({message: 'Rate limited', retriesRemaining: 3}).success).toBe(true)
      expect(PlaybackErrorEventSchema.safeParse({}).success).toBe(true)
    })
  })
})
