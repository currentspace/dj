/**
 * Vibe Steering AI
 * Interprets natural language vibe requests and preset buttons to adjust mix session vibes
 */

import type { VibeProfile } from '@dj/shared-types'

import Anthropic from '@anthropic-ai/sdk'

import { LLM } from '../constants'
import { getLogger } from '../utils/LoggerContext'

/**
 * Vibe adjustments that can be applied to a VibeProfile
 */
export interface VibePreset {
  bpmRange?: { max: number; min: number; }
  energyDirection?: 'building' | 'steady' | 'winding_down'
  energyLevel?: number // Relative adjustment (+2, -3, etc.) or absolute value
  era?: { end: number; start: number; }
  genres?: string[] // Genres to add
  mood?: string[] // Moods to add
}

/**
 * Preset mappings for common vibe steering requests
 */
export const PRESET_MAPPINGS: Record<string, VibePreset> = {
  '80s vibes': { era: { end: 1989, start: 1980 }, genres: ['synthpop', 'new wave'] },
  '90s throwback': { era: { end: 1999, start: 1990 } },
  'chill out': { energyDirection: 'winding_down', energyLevel: -2 },
  'chill vibes': { energyDirection: 'winding_down', energyLevel: -2, mood: ['chill', 'relaxed'] },
  'go retro': { era: { end: 1995, start: 1970 } },
  'indie mood': { genres: ['indie', 'indie rock', 'alternative'], mood: ['introspective'] },
  'late night': { energyDirection: 'winding_down', energyLevel: -1, mood: ['mellow', 'atmospheric'] },
  'modern hits': { era: { end: 2025, start: 2018 } },
  'more energy': { energyDirection: 'building', energyLevel: +2 },
  'party mode': { energyDirection: 'building', energyLevel: +3, mood: ['upbeat', 'energetic'] },
  'pump it up': { energyDirection: 'building', energyLevel: +3, mood: ['energetic', 'intense'] },
  'slow it down': { bpmRange: { max: 100, min: 60 }, energyLevel: -2 },
  'something fresh': { era: { end: 2025, start: 2020 } },
  'speed it up': { bpmRange: { max: 160, min: 120 }, energyLevel: +2 },
}

/**
 * Apply a vibe preset to the current vibe profile
 * @param currentVibe - Current vibe profile
 * @param preset - Preset adjustments to apply
 * @returns Updated vibe profile
 */
export function applyPreset(currentVibe: VibeProfile, preset: VibePreset): VibeProfile {
  const updated: VibeProfile = { ...currentVibe }

  // Energy level: if preset has energyLevel, add to current (if relative) or replace (if absolute)
  if (preset.energyLevel !== undefined) {
    // Determine if it's relative (starts with + or -) or absolute
    const isRelative = preset.energyLevel > -10 && preset.energyLevel < 10
    if (isRelative) {
      updated.energyLevel = clampEnergyLevel(currentVibe.energyLevel + preset.energyLevel)
    } else {
      updated.energyLevel = clampEnergyLevel(preset.energyLevel)
    }
  }

  // Energy direction: replace entirely
  if (preset.energyDirection !== undefined) {
    updated.energyDirection = preset.energyDirection
  }

  // Era: replace entirely
  if (preset.era !== undefined) {
    updated.era = { ...preset.era }
  }

  // BPM range: replace entirely (or could merge in future)
  if (preset.bpmRange !== undefined) {
    updated.bpmRange = { ...preset.bpmRange }
  }

  // Genres: merge and deduplicate
  if (preset.genres !== undefined && preset.genres.length > 0) {
    const combined = [...currentVibe.genres, ...preset.genres]
    updated.genres = Array.from(new Set(combined))
  }

  // Mood: merge and deduplicate
  if (preset.mood !== undefined && preset.mood.length > 0) {
    const combined = [...currentVibe.mood, ...preset.mood]
    updated.mood = Array.from(new Set(combined))
  }

  return updated
}

/**
 * Clamp energy level to valid range (1-10)
 */
export function clampEnergyLevel(level: number): number {
  return Math.max(1, Math.min(10, Math.round(level)))
}

/**
 * Find a matching preset from PRESET_MAPPINGS
 * Uses case-insensitive fuzzy matching
 */
export function findMatchingPreset(direction: string): null | VibePreset {
  const normalized = direction.toLowerCase().trim()

  // Exact match first
  // eslint-disable-next-line security/detect-object-injection -- safe: normalized is a lowercased/trimmed user string used as lookup key in a static const Record
  if (PRESET_MAPPINGS[normalized]) {
    // eslint-disable-next-line security/detect-object-injection -- safe: same lookup as guard above
    return PRESET_MAPPINGS[normalized]
  }

  // Fuzzy match: check if preset key is contained in direction or vice versa
  for (const [key, preset] of Object.entries(PRESET_MAPPINGS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return preset
    }
  }

  return null
}

/**
 * Main function to steer vibe based on natural language direction
 * @param currentVibe - Current vibe profile
 * @param direction - Natural language request or preset name
 * @param anthropicKey - Anthropic API key for Claude Haiku
 * @returns Updated vibe profile
 */
export async function steerVibe(
  currentVibe: VibeProfile,
  direction: string,
  anthropicKey: string
): Promise<VibeProfile> {
  const logger = getLogger()

  // Step 1: Check if direction matches a preset (case-insensitive, fuzzy match)
  const preset = findMatchingPreset(direction)
  if (preset) {
    logger?.info('Matched vibe steering preset', { direction, preset })
    return applyPreset(currentVibe, preset)
  }

  // Step 2: Use Claude Haiku to interpret natural language
  logger?.info('Using Claude Haiku for vibe steering', { direction })

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const prompt = buildVibeSteeringPrompt(currentVibe, direction)

    const response = await anthropic.messages.create({
      max_tokens: 500,
      messages: [
        {
          content: prompt,
          role: 'user',
        },
      ],
      model: LLM.MODEL_HAIKU,
      temperature: 0.3, // Lower temperature for more consistent parsing
    })

    // Parse response
    const vibeAdjustments = parseVibeResponse(response)
    logger?.info('Parsed vibe adjustments from Claude', { vibeAdjustments })

    return applyPreset(currentVibe, vibeAdjustments)
  } catch (error) {
    logger?.error('Failed to steer vibe with Claude', error)
    // On error, return current vibe unchanged
    return currentVibe
  }
}

/**
 * Build prompt for Claude to interpret vibe request
 */
function buildVibeSteeringPrompt(currentVibe: VibeProfile, direction: string): string {
  return `Current vibe profile:
- Energy: ${currentVibe.energyLevel}/10, ${currentVibe.energyDirection}
- Genres: ${currentVibe.genres.length > 0 ? currentVibe.genres.join(', ') : 'none'}
- Era: ${currentVibe.era.start}-${currentVibe.era.end}
- Mood: ${currentVibe.mood.length > 0 ? currentVibe.mood.join(', ') : 'none'}
- BPM: ${currentVibe.bpmRange.min}-${currentVibe.bpmRange.max}

User request: "${direction}"

Return ONLY a JSON object with the changes to make. Example format:
{
  "energyLevel": 2,
  "genres": ["synthpop", "synthwave"],
  "era": { "start": 1980, "end": 1989 },
  "mood": ["nostalgic"]
}

Guidelines:
- For energyLevel: Use relative values (-3 to +3) to adjust current level, or absolute values (1-10) to set directly
- For energyDirection: Use "building", "steady", or "winding_down"
- For genres: Add new genres as an array (don't remove existing ones)
- For mood: Add new moods as an array (don't remove existing ones)
- For era: Provide { "start": YEAR, "end": YEAR } to replace era
- For bpmRange: Provide { "min": BPM, "max": BPM } to replace BPM range
- Only include fields that should change. Do not include fields that should stay the same.

Return ONLY the JSON object, no explanations or markdown.`
}

/**
 * Parse Claude's response into VibePreset adjustments
 */
function parseVibeResponse(response: Anthropic.Message): VibePreset {
  const logger = getLogger()

  try {
    // Extract text from response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )

    if (textBlocks.length === 0) {
      logger?.warn('No text blocks in Claude response')
      return {}
    }

    const text = textBlocks[0].text.trim()

    // Try to extract JSON from response (remove markdown code blocks if present)
    const jsonMatch = /\{[\s\S]*\}/.exec(text)
    if (!jsonMatch) {
      logger?.warn('No JSON found in Claude response', { text })
      return {}
    }

    const parsed = JSON.parse(jsonMatch[0])
    logger?.debug('Parsed vibe adjustments', { parsed })

    // Validate and return
    const preset: VibePreset = {}

    if (typeof parsed.energyLevel === 'number') {
      preset.energyLevel = parsed.energyLevel
    }

    if (
      parsed.energyDirection === 'building' ||
      parsed.energyDirection === 'steady' ||
      parsed.energyDirection === 'winding_down'
    ) {
      preset.energyDirection = parsed.energyDirection
    }

    if (parsed.era && typeof parsed.era.start === 'number' && typeof parsed.era.end === 'number') {
      preset.era = { end: parsed.era.end, start: parsed.era.start }
    }

    if (
      parsed.bpmRange &&
      typeof parsed.bpmRange.min === 'number' &&
      typeof parsed.bpmRange.max === 'number'
    ) {
      preset.bpmRange = { max: parsed.bpmRange.max, min: parsed.bpmRange.min }
    }

    if (Array.isArray(parsed.genres)) {
      preset.genres = parsed.genres.filter((g: unknown): g is string => typeof g === 'string')
    }

    if (Array.isArray(parsed.mood)) {
      preset.mood = parsed.mood.filter((m: unknown): m is string => typeof m === 'string')
    }

    return preset
  } catch (error) {
    logger?.error('Failed to parse Claude response', error)
    return {}
  }
}
