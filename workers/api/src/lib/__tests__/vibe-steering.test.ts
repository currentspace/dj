/**
 * Tests for Vibe Steering AI
 */

import type { VibeProfile } from '@dj/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyPreset,
  clampEnergyLevel,
  findMatchingPreset,
  PRESET_MAPPINGS,
  steerVibe,
  type VibePreset,
} from '../vibe-steering'

// Hoist the mock using vi.hoisted()
const { mockCreate } = vi.hoisted(() => {
  return {
    mockCreate: vi.fn(),
  }
})

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const Anthropic = vi.fn()
  Anthropic.prototype.messages = {
    create: mockCreate,
  }
  return {
    default: Anthropic,
  }
})

// Mock logger
vi.mock('../../utils/LoggerContext', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('Vibe Steering AI', () => {
  const defaultVibe: VibeProfile = {
    mood: ['upbeat'],
    genres: ['indie rock', 'alt pop'],
    era: { start: 2010, end: 2020 },
    bpmRange: { min: 110, max: 130 },
    energyLevel: 6,
    energyDirection: 'steady',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('clampEnergyLevel', () => {
    it('clamps values below 1 to 1', () => {
      expect(clampEnergyLevel(-5)).toBe(1)
      expect(clampEnergyLevel(0)).toBe(1)
      expect(clampEnergyLevel(0.5)).toBe(1)
    })

    it('clamps values above 10 to 10', () => {
      expect(clampEnergyLevel(11)).toBe(10)
      expect(clampEnergyLevel(15)).toBe(10)
      expect(clampEnergyLevel(100)).toBe(10)
    })

    it('keeps valid values unchanged', () => {
      expect(clampEnergyLevel(1)).toBe(1)
      expect(clampEnergyLevel(5)).toBe(5)
      expect(clampEnergyLevel(10)).toBe(10)
    })

    it('rounds decimal values', () => {
      expect(clampEnergyLevel(5.4)).toBe(5)
      expect(clampEnergyLevel(5.5)).toBe(6)
      expect(clampEnergyLevel(5.6)).toBe(6)
    })
  })

  describe('findMatchingPreset', () => {
    it('matches exact preset names (case-insensitive)', () => {
      expect(findMatchingPreset('more energy')).toEqual(PRESET_MAPPINGS['more energy'])
      expect(findMatchingPreset('MORE ENERGY')).toEqual(PRESET_MAPPINGS['more energy'])
      expect(findMatchingPreset('More Energy')).toEqual(PRESET_MAPPINGS['more energy'])
    })

    it('matches preset names with extra whitespace', () => {
      expect(findMatchingPreset('  more energy  ')).toEqual(PRESET_MAPPINGS['more energy'])
    })

    it('matches fuzzy substring matches', () => {
      expect(findMatchingPreset('make it more energy please')).toEqual(
        PRESET_MAPPINGS['more energy']
      )
      expect(findMatchingPreset('lets go retro baby')).toEqual(PRESET_MAPPINGS['go retro'])
    })

    it('returns null for no match', () => {
      expect(findMatchingPreset('quantum vibe shift')).toBeNull()
      expect(findMatchingPreset('xyz123')).toBeNull()
    })

    it('matches all defined presets', () => {
      Object.keys(PRESET_MAPPINGS).forEach(key => {
        expect(findMatchingPreset(key)).toEqual(PRESET_MAPPINGS[key])
      })
    })
  })

  describe('applyPreset', () => {
    it('applies relative energy level adjustments', () => {
      const preset: VibePreset = { energyLevel: +2 }
      const result = applyPreset(defaultVibe, preset)
      expect(result.energyLevel).toBe(8) // 6 + 2
    })

    it('applies negative energy level adjustments', () => {
      const preset: VibePreset = { energyLevel: -3 }
      const result = applyPreset(defaultVibe, preset)
      expect(result.energyLevel).toBe(3) // 6 - 3
    })

    it('clamps energy level to 1-10 bounds', () => {
      const preset1: VibePreset = { energyLevel: +10 }
      expect(applyPreset(defaultVibe, preset1).energyLevel).toBe(10)

      const preset2: VibePreset = { energyLevel: -10 }
      expect(applyPreset(defaultVibe, preset2).energyLevel).toBe(1)
    })

    it('replaces energy direction', () => {
      const preset: VibePreset = { energyDirection: 'winding_down' }
      const result = applyPreset(defaultVibe, preset)
      expect(result.energyDirection).toBe('winding_down')
    })

    it('replaces era entirely', () => {
      const preset: VibePreset = { era: { start: 1980, end: 1989 } }
      const result = applyPreset(defaultVibe, preset)
      expect(result.era).toEqual({ start: 1980, end: 1989 })
    })

    it('replaces BPM range entirely', () => {
      const preset: VibePreset = { bpmRange: { min: 60, max: 100 } }
      const result = applyPreset(defaultVibe, preset)
      expect(result.bpmRange).toEqual({ min: 60, max: 100 })
    })

    it('merges and deduplicates genres', () => {
      const preset: VibePreset = { genres: ['synthpop', 'indie rock', 'new wave'] }
      const result = applyPreset(defaultVibe, preset)
      // Should have: indie rock, alt pop, synthpop, new wave (indie rock deduplicated)
      expect(result.genres).toContain('indie rock')
      expect(result.genres).toContain('alt pop')
      expect(result.genres).toContain('synthpop')
      expect(result.genres).toContain('new wave')
      expect(result.genres.length).toBe(4) // Deduplicated
    })

    it('merges and deduplicates moods', () => {
      const preset: VibePreset = { mood: ['upbeat', 'energetic', 'nostalgic'] }
      const result = applyPreset(defaultVibe, preset)
      // Should have: upbeat, energetic, nostalgic (upbeat deduplicated)
      expect(result.mood).toContain('upbeat')
      expect(result.mood).toContain('energetic')
      expect(result.mood).toContain('nostalgic')
      expect(result.mood.length).toBe(3) // Deduplicated
    })

    it('applies multiple preset properties at once', () => {
      const preset: VibePreset = {
        energyLevel: +2,
        energyDirection: 'building',
        genres: ['synthpop'],
        mood: ['nostalgic'],
        era: { start: 1980, end: 1989 },
      }
      const result = applyPreset(defaultVibe, preset)
      expect(result.energyLevel).toBe(8)
      expect(result.energyDirection).toBe('building')
      expect(result.genres).toContain('synthpop')
      expect(result.mood).toContain('nostalgic')
      expect(result.era).toEqual({ start: 1980, end: 1989 })
    })

    it('leaves unchanged fields untouched', () => {
      const preset: VibePreset = { energyLevel: +1 }
      const result = applyPreset(defaultVibe, preset)
      expect(result.genres).toEqual(defaultVibe.genres)
      expect(result.mood).toEqual(defaultVibe.mood)
      expect(result.era).toEqual(defaultVibe.era)
      expect(result.bpmRange).toEqual(defaultVibe.bpmRange)
    })

    it('handles empty preset gracefully', () => {
      const preset: VibePreset = {}
      const result = applyPreset(defaultVibe, preset)
      expect(result).toEqual(defaultVibe)
    })
  })

  describe('steerVibe', () => {
    it('uses preset for matching direction', async () => {
      const result = await steerVibe(defaultVibe, 'more energy', 'fake-api-key')
      expect(result.energyLevel).toBe(8) // 6 + 2
      expect(result.energyDirection).toBe('building')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('uses preset for fuzzy matching direction', async () => {
      const result = await steerVibe(defaultVibe, 'lets chill out', 'fake-api-key')
      expect(result.energyLevel).toBe(4) // 6 - 2
      expect(result.energyDirection).toBe('winding_down')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('calls Claude for non-preset directions', async () => {
      // Mock Claude response
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              energyLevel: +3,
              genres: ['electronic', 'dance'],
              mood: ['euphoric'],
            }),
          },
        ],
      })

      const result = await steerVibe(
        defaultVibe,
        'add some electronic dance vibes',
        'fake-api-key'
      )

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-20250929',
          max_tokens: 500,
          temperature: 0.3,
        })
      )

      expect(result.energyLevel).toBe(9) // 6 + 3
      expect(result.genres).toContain('electronic')
      expect(result.genres).toContain('dance')
      expect(result.mood).toContain('euphoric')
    })

    it('handles Claude response with markdown code blocks', async () => {
      // Mock Claude response with markdown
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '```json\n{"energyLevel": -2, "mood": ["calm"]}\n```',
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'calm it down', 'fake-api-key')

      expect(result.energyLevel).toBe(4) // 6 - 2
      expect(result.mood).toContain('calm')
    })

    it('returns unchanged vibe on Claude API error', async () => {
      mockCreate.mockRejectedValue(new Error('API error'))

      const result = await steerVibe(defaultVibe, 'unknown request', 'fake-api-key')

      expect(result).toEqual(defaultVibe)
    })

    it('returns unchanged vibe on invalid Claude response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'This is not JSON',
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'unknown request', 'fake-api-key')

      expect(result).toEqual(defaultVibe)
    })

    it('handles partial Claude responses gracefully', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              energyLevel: +1,
              // Missing other fields
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'slight boost', 'fake-api-key')

      expect(result.energyLevel).toBe(7) // 6 + 1
      // Other fields should remain unchanged
      expect(result.genres).toEqual(defaultVibe.genres)
      expect(result.mood).toEqual(defaultVibe.mood)
    })

    it('validates and filters invalid genre types from Claude', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              genres: ['valid', 123, null, 'also valid'],
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'add genres', 'fake-api-key')

      expect(result.genres).toContain('valid')
      expect(result.genres).toContain('also valid')
      expect(result.genres).not.toContain(123)
      expect(result.genres).not.toContain(null)
    })

    it('validates energy direction from Claude', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              energyDirection: 'winding_down',
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'wind down', 'fake-api-key')

      expect(result.energyDirection).toBe('winding_down')
    })

    it('ignores invalid energy direction from Claude', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              energyDirection: 'invalid_value',
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'do something', 'fake-api-key')

      expect(result.energyDirection).toBe(defaultVibe.energyDirection)
    })

    it('validates era structure from Claude', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              era: { start: 2000, end: 2010 },
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'early 2000s', 'fake-api-key')

      expect(result.era).toEqual({ start: 2000, end: 2010 })
    })

    it('validates BPM range structure from Claude', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              bpmRange: { min: 80, max: 120 },
            }),
          },
        ],
      })

      const result = await steerVibe(defaultVibe, 'slower tempo', 'fake-api-key')

      expect(result.bpmRange).toEqual({ min: 80, max: 120 })
    })
  })

  describe('Preset Integration Tests', () => {
    it('applies "more energy" preset correctly', () => {
      const result = applyPreset(defaultVibe, PRESET_MAPPINGS['more energy'])
      expect(result.energyLevel).toBe(8)
      expect(result.energyDirection).toBe('building')
    })

    it('applies "chill out" preset correctly', () => {
      const result = applyPreset(defaultVibe, PRESET_MAPPINGS['chill out'])
      expect(result.energyLevel).toBe(4)
      expect(result.energyDirection).toBe('winding_down')
    })

    it('applies "80s vibes" preset correctly', () => {
      const result = applyPreset(defaultVibe, PRESET_MAPPINGS['80s vibes'])
      expect(result.era).toEqual({ start: 1980, end: 1989 })
      expect(result.genres).toContain('synthpop')
      expect(result.genres).toContain('new wave')
    })

    it('applies "party mode" preset correctly', () => {
      const result = applyPreset(defaultVibe, PRESET_MAPPINGS['party mode'])
      expect(result.energyLevel).toBe(9) // 6 + 3
      expect(result.energyDirection).toBe('building')
      expect(result.mood).toContain('upbeat')
      expect(result.mood).toContain('energetic')
    })

    it('applies "late night" preset correctly', () => {
      const result = applyPreset(defaultVibe, PRESET_MAPPINGS['late night'])
      expect(result.energyLevel).toBe(5) // 6 - 1
      expect(result.energyDirection).toBe('winding_down')
      expect(result.mood).toContain('mellow')
      expect(result.mood).toContain('atmospheric')
    })
  })
})
