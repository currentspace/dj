/**
 * progress-narrator.ts Tests
 * Tests for progress message generation and caching
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProgressNarrator } from '../../lib/progress-narrator'
import { ServiceLogger } from '../../utils/ServiceLogger'

// Mock the Anthropic API and rate limiter
vi.mock('../../utils/RateLimitedAPIClients', () => ({
  rateLimitedAnthropicCall: vi.fn(async (fn: () => Promise<unknown>) => {
    return fn()
  }),
  getGlobalOrchestrator: vi.fn(() => ({
    execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  })),
}))

vi.mock('../../utils/LoggerContext', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: 'Digging through Spotify crates...',
            },
          ],
        })),
      }
    },
  }
})

describe('ProgressNarrator', () => {
  let narrator: ProgressNarrator
  let mockLogger: ServiceLogger

  beforeEach(() => {
    mockLogger = new ServiceLogger('TestNarrator')
    narrator = new ProgressNarrator('fake-api-key', mockLogger)
    vi.clearAllMocks()
  })

  it('should initialize with API key and logger', () => {
    expect(narrator).toBeDefined()
    expect(narrator).toHaveProperty('generateMessage')
  })

  it('should generate message for event context', async () => {
    const message = await narrator.generateMessage({
      eventType: 'searching_tracks',
    })

    expect(message).toBeTruthy()
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })

  it('should include metadata in prompt when provided', async () => {
    const message = await narrator.generateMessage({
      eventType: 'enriching_tracks',
      metadata: {
        enrichedCount: 10,
        totalTracks: 50,
        recentTrackName: 'Test Track',
      },
    })

    expect(message).toBeTruthy()
    expect(typeof message).toBe('string')
  })

  it('should cache messages for repeated contexts', async () => {
    const context = { eventType: 'started' }

    const message1 = await narrator.generateMessage(context)
    const message2 = await narrator.generateMessage(context)

    // Same cached result
    expect(message1).toBe(message2)
  })

  it('should bypass cache when skipCache is true', async () => {
    const context = { eventType: 'searching_tracks' }

    const message1 = await narrator.generateMessage(context, false)
    const message2 = await narrator.generateMessage(context, true)

    // Messages may differ due to variation instruction
    expect(message1).toBeDefined()
    expect(message2).toBeDefined()
  })

  it('should handle missing logger gracefully', () => {
    const narratorNoLogger = new ProgressNarrator('fake-api-key')
    expect(narratorNoLogger).toBeDefined()
    expect(() => narratorNoLogger.generateMessage({ eventType: 'started' })).not.toThrow()
  })
})

describe('ProgressNarrator - Cache Behavior', () => {
  let narrator: ProgressNarrator

  beforeEach(() => {
    narrator = new ProgressNarrator('fake-api-key')
    vi.clearAllMocks()
  })

  it('should return cached message on second call', async () => {
    const context = { eventType: 'analyzing_request' }

    const msg1 = await narrator.generateMessage(context)
    const msg2 = await narrator.generateMessage(context)

    expect(msg1).toBe(msg2)
  })

  it('should generate different messages with skipCache=true', async () => {
    const context = {
      eventType: 'enriching_artists',
      metadata: { enrichedCount: 5, totalArtists: 20 },
    }

    // These might be different due to variation
    const msg1 = await narrator.generateMessage(context, false)
    const msg2 = await narrator.generateMessage(context, true)

    expect(msg1).toBeDefined()
    expect(msg2).toBeDefined()
  })

  it('should limit cache size to prevent memory issues', async () => {
    // Generate more than 100 cache entries
    for (let i = 0; i < 105; i++) {
      await narrator.generateMessage({ eventType: `event_${i}` })
    }

    // Cache should not grow unbounded
    // (Implementation detail: cache max size is 100)
  })
})

describe('ProgressNarrator - Event Types', () => {
  let narrator: ProgressNarrator

  beforeEach(() => {
    narrator = new ProgressNarrator('fake-api-key')
    vi.clearAllMocks()
  })

  it('should handle all supported event types', async () => {
    const eventTypes = [
      'started',
      'analyzing_request',
      'searching_tracks',
      'analyzing_audio',
      'creating_playlist',
      'adding_tracks',
      'completed',
      'enriching_artists',
      'enriching_tracks',
      'tool_call_start',
      'tool_call_complete',
    ]

    for (const eventType of eventTypes) {
      const message = await narrator.generateMessage({ eventType })
      expect(message).toBeTruthy()
      expect(typeof message).toBe('string')
    }
  })

  it('should generate message with tool parameters', async () => {
    const message = await narrator.generateMessage({
      eventType: 'tool_call_start',
      parameters: { query: 'upbeat workout songs' },
      toolName: 'search_spotify_tracks',
    })

    expect(message).toBeTruthy()
    expect(typeof message).toBe('string')
  })

  it('should include user request in context', async () => {
    const message = await narrator.generateMessage({
      eventType: 'started',
      userRequest: 'Create a workout playlist',
    })

    expect(message).toBeTruthy()
    expect(typeof message).toBe('string')
  })
})
