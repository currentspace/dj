import {describe, expect, it} from 'vitest'
import {
  PlaybackStateInitSchema,
  PlaybackTickEventSchema,
  PlaybackTrackEventSchema,
  PlaybackStateEventSchema,
  PlaybackDeviceEventSchema,
  PlaybackModesEventSchema,
  PlaybackVolumeEventSchema,
  PlaybackContextEventSchema,
  PlaybackIdleEventSchema,
  PlaybackConnectedEventSchema,
  PlaybackErrorEventSchema,
} from '../schemas/playback-event-schemas'

describe('Playback Event Schemas', () => {
  describe('PlaybackStateInitSchema', () => {
    it('validates a complete init event', () => {
      const init = {
        track: {
          id: '4uLU6hMCjMI75M1A2tKUQC',
          uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
          name: 'Bohemian Rhapsody',
          artist: 'Queen',
          albumArt: 'https://i.scdn.co/image/abc123',
          albumName: 'A Night at the Opera',
          duration: 354000,
          explicit: false,
          popularity: 91,
          isLocal: false,
          previewUrl: null,
        },
        device: {
          id: 'device123',
          name: 'My Speaker',
          type: 'speaker' as const,
          volumePercent: 75,
          supportsVolume: true,
          isPrivateSession: false,
          isRestricted: false,
        },
        context: {
          type: 'playlist' as const,
          uri: 'spotify:playlist:abc',
          name: 'My Playlist',
          href: null,
        },
        modes: {shuffle: false, repeat: 'off' as const},
        playingType: 'track' as const,
        isPlaying: true,
        progress: 45000,
        timestamp: Date.now(),
        seq: 1,
      }
      expect(PlaybackStateInitSchema.safeParse(init).success).toBe(true)
    })

    it('validates init with null track (nothing playing)', () => {
      const init = {
        track: null,
        device: {
          id: null,
          name: 'Unknown',
          type: 'unknown' as const,
          volumePercent: null,
          supportsVolume: false,
          isPrivateSession: false,
          isRestricted: false,
        },
        context: null,
        modes: {shuffle: false, repeat: 'off' as const},
        playingType: 'unknown' as const,
        isPlaying: false,
        progress: 0,
        timestamp: Date.now(),
        seq: 0,
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
        id: 'track123',
        uri: 'spotify:track:track123',
        name: 'Test Song',
        artist: 'Test Artist',
        albumArt: null,
        albumName: 'Test Album',
        duration: 200000,
        explicit: false,
        popularity: 50,
        isLocal: false,
        previewUrl: null,
        seq: 5,
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
        name: 'My Phone',
        type: 'smartphone' as const,
        volumePercent: 50,
        supportsVolume: true,
        isPrivateSession: false,
        isRestricted: false,
        seq: 2,
      }
      expect(PlaybackDeviceEventSchema.safeParse(device).success).toBe(true)
    })
  })

  describe('PlaybackModesEventSchema', () => {
    it('validates a modes change event', () => {
      expect(PlaybackModesEventSchema.safeParse({shuffle: true, repeat: 'context', seq: 1}).success).toBe(true)
    })

    it('rejects invalid repeat state', () => {
      expect(PlaybackModesEventSchema.safeParse({shuffle: true, repeat: 'invalid', seq: 1}).success).toBe(false)
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
        context: {type: 'album' as const, uri: 'spotify:album:abc', name: 'Test Album', href: null},
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
