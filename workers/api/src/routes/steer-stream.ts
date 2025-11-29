/**
 * Streaming Vibe Steer Endpoint
 * Provides real-time progress feedback during vibe steering
 */

import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Env } from '../index'
import type { MixSession, QueuedTrack, VibeProfile } from '@dj/shared-types'
import { MixSessionService } from '../services/MixSessionService'
import { SuggestionEngine } from '../services/SuggestionEngine'
import { LastFmService } from '../services/LastFmService'
import { AudioEnrichmentService } from '../services/AudioEnrichmentService'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// TYPES
// =============================================================================

interface SteerEvent {
  type: 'ack' | 'thinking' | 'progress' | 'vibe_update' | 'suggestions' | 'queue_update' | 'error' | 'done'
  data: unknown
}

interface VibeAdjustments {
  energyLevel?: number
  energyDirection?: 'building' | 'steady' | 'winding_down'
  era?: { start: number; end: number }
  genres?: string[]
  mood?: string[]
  bpmRange?: { min: number; max: number }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TARGET_QUEUE_SIZE = 5

// DJ-style progress messages for different stages
const PROGRESS_TEMPLATES = {
  analyzing: [
    'Reading the room...',
    'Feeling out the vibe...',
    'Tuning into the energy...',
  ],
  adjusting: [
    'Dialing in the sound...',
    'Mixing in the new direction...',
    'Blending the vibes...',
  ],
  building: [
    'Building the perfect set...',
    'Curating fresh tracks...',
    'Finding the right groove...',
  ],
} as const

// =============================================================================
// SSE WRITER
// =============================================================================

class SteerSSEWriter {
  private closed = false
  private encoder: TextEncoder
  private writeQueue: Promise<void> = Promise.resolve()
  private writer: WritableStreamDefaultWriter

  constructor(writer: WritableStreamDefaultWriter) {
    this.writer = writer
    this.encoder = new TextEncoder()
  }

  async write(event: SteerEvent): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        getLogger()?.error('SteerSSE write error:', error)
        this.closed = true
      }
    })

    return this.writeQueue
  }

  async close(): Promise<void> {
    this.closed = true
    await this.writeQueue
    await this.writer.close()
  }
}

// =============================================================================
// HAIKU PROGRESS SUMMARIZER
// =============================================================================

async function summarizeThinkingWithHaiku(
  anthropic: Anthropic,
  thinking: string,
  direction: string,
  stage: 'analyzing' | 'adjusting' | 'building'
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250929',
      max_tokens: 100,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `You're a friendly DJ assistant. Write ONE short (5-10 words), conversational progress message about steering towards "${direction}".

Stage: ${stage}
${thinking ? `Context: ${thinking.slice(0, 200)}` : ''}

Be warm and DJ-like. No emojis. Examples:
- "Shifting into deeper house territory..."
- "Finding those perfect laid-back beats..."
- "Bringing in some vintage soul flavor..."

Just the message, no quotes or extra formatting.`
      }]
    })

    const textBlock = response.content.find(b => b.type === 'text')
    return textBlock?.text || getRandomTemplate(stage)
  } catch {
    return getRandomTemplate(stage)
  }
}

function getRandomTemplate(stage: keyof typeof PROGRESS_TEMPLATES): string {
  const templates = PROGRESS_TEMPLATES[stage]
  return templates[Math.floor(Math.random() * templates.length)]
}

// =============================================================================
// VIBE STEERING LOGIC
// =============================================================================

async function steerVibeWithThinking(
  anthropic: Anthropic,
  currentVibe: VibeProfile,
  direction: string,
  sseWriter: SteerSSEWriter
): Promise<{ vibe: VibeProfile; changes: string[] }> {
  const logger = getLogger()

  // Use Sonnet with extended thinking for deeper reasoning
  const prompt = buildSteerPrompt(currentVibe, direction)

  logger?.info('[steer-stream] Calling Claude with extended thinking...')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    thinking: {
      type: 'enabled',
      budget_tokens: 4000
    },
    messages: [{
      role: 'user',
      content: prompt
    }]
  })

  // Extract thinking and text
  let thinking = ''
  let adjustmentsJson = ''

  for (const block of response.content) {
    if (block.type === 'thinking') {
      thinking = block.thinking
      // Send thinking preview to client
      await sseWriter.write({
        type: 'thinking',
        data: { preview: thinking.slice(0, 500) + (thinking.length > 500 ? '...' : '') }
      })
    } else if (block.type === 'text') {
      adjustmentsJson = block.text
    }
  }

  // Parse adjustments
  const adjustments = parseVibeAdjustments(adjustmentsJson)

  // Apply adjustments
  const updatedVibe = applyVibeAdjustments(currentVibe, adjustments)

  // Calculate changes
  const changes = calculateChanges(currentVibe, updatedVibe)

  return { vibe: updatedVibe, changes }
}

function buildSteerPrompt(currentVibe: VibeProfile, direction: string): string {
  return `You are a DJ assistant interpreting a vibe steering request.

Current vibe profile:
- Energy: ${currentVibe.energyLevel}/10, direction: ${currentVibe.energyDirection}
- Genres: ${currentVibe.genres.length > 0 ? currentVibe.genres.join(', ') : 'none set'}
- Era: ${currentVibe.era.start}-${currentVibe.era.end}
- Mood: ${currentVibe.mood.length > 0 ? currentVibe.mood.join(', ') : 'none set'}
- BPM: ${currentVibe.bpmRange.min}-${currentVibe.bpmRange.max}

User's request: "${direction}"

Think deeply about what the user wants. Consider:
- What musical characteristics define this direction?
- How should energy, tempo, and mood shift?
- What genres/sub-genres fit this vibe?
- What era of music matches this feel?

Return ONLY a JSON object with the changes to make. Example:
{
  "energyLevel": 6,
  "genres": ["house", "deep house"],
  "mood": ["groovy", "uplifting"],
  "bpmRange": { "min": 118, "max": 128 }
}

Guidelines:
- energyLevel: 1-10 (absolute value)
- energyDirection: "building", "steady", or "winding_down"
- genres: array of relevant genres (replace, don't append)
- mood: array of mood descriptors (replace, don't append)
- era: { "start": YEAR, "end": YEAR }
- bpmRange: { "min": BPM, "max": BPM }
- Only include fields that should change

Return ONLY the JSON, no markdown or explanation.`
}

function parseVibeAdjustments(response: string): VibeAdjustments {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return {}
    return JSON.parse(jsonMatch[0])
  } catch {
    return {}
  }
}

function applyVibeAdjustments(currentVibe: VibeProfile, adjustments: VibeAdjustments): VibeProfile {
  const updated: VibeProfile = { ...currentVibe }

  if (typeof adjustments.energyLevel === 'number') {
    updated.energyLevel = Math.max(1, Math.min(10, Math.round(adjustments.energyLevel)))
  }

  if (adjustments.energyDirection) {
    updated.energyDirection = adjustments.energyDirection
  }

  if (adjustments.era) {
    updated.era = { ...adjustments.era }
  }

  if (adjustments.bpmRange) {
    updated.bpmRange = { ...adjustments.bpmRange }
  }

  if (adjustments.genres && adjustments.genres.length > 0) {
    updated.genres = adjustments.genres
  }

  if (adjustments.mood && adjustments.mood.length > 0) {
    updated.mood = adjustments.mood
  }

  return updated
}

function calculateChanges(oldVibe: VibeProfile, newVibe: VibeProfile): string[] {
  const changes: string[] = []

  if (newVibe.energyLevel !== oldVibe.energyLevel) {
    changes.push(`Energy: ${oldVibe.energyLevel}/10 → ${newVibe.energyLevel}/10`)
  }
  if (newVibe.energyDirection !== oldVibe.energyDirection) {
    changes.push(`Direction: ${oldVibe.energyDirection} → ${newVibe.energyDirection}`)
  }
  if (JSON.stringify(newVibe.era) !== JSON.stringify(oldVibe.era)) {
    changes.push(`Era: ${oldVibe.era.start}-${oldVibe.era.end} → ${newVibe.era.start}-${newVibe.era.end}`)
  }
  if (JSON.stringify(newVibe.bpmRange) !== JSON.stringify(oldVibe.bpmRange)) {
    changes.push(`BPM: ${oldVibe.bpmRange.min}-${oldVibe.bpmRange.max} → ${newVibe.bpmRange.min}-${newVibe.bpmRange.max}`)
  }
  if (JSON.stringify(newVibe.genres) !== JSON.stringify(oldVibe.genres)) {
    changes.push(`Genres: ${newVibe.genres.join(', ')}`)
  }
  if (JSON.stringify(newVibe.mood) !== JSON.stringify(oldVibe.mood)) {
    changes.push(`Mood: ${newVibe.mood.join(', ')}`)
  }

  return changes
}

// =============================================================================
// QUEUE REBUILDING
// =============================================================================

async function rebuildQueue(
  env: Env,
  token: string,
  session: MixSession,
  sessionService: MixSessionService,
  sseWriter: SteerSSEWriter
): Promise<QueuedTrack[]> {
  const logger = getLogger()

  // Clear existing queue
  sessionService.clearQueue(session)

  const tracksNeeded = TARGET_QUEUE_SIZE

  try {
    const lastFmService = new LastFmService(env.LASTFM_API_KEY || '', env.AUDIO_FEATURES_CACHE)
    const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
    const suggestionEngine = new SuggestionEngine(lastFmService, audioService, token, env.ANTHROPIC_API_KEY, true)

    const suggestions = await suggestionEngine.generateSuggestions(session, tracksNeeded + 3)

    if (suggestions.length === 0) {
      logger?.info('[steer-stream] No suggestions generated')
      return []
    }

    // Filter duplicates
    const existingUris = new Set([
      ...session.queue.map(t => t.trackUri),
      ...session.history.map(t => t.trackUri),
    ])
    const available = suggestions.filter(s => !existingUris.has(s.trackUri))
    const toAdd = available.slice(0, tracksNeeded)

    // Add to queue
    for (const suggestion of toAdd) {
      const queuedTrack: QueuedTrack = {
        trackId: suggestion.trackId,
        trackUri: suggestion.trackUri,
        name: suggestion.name,
        artist: suggestion.artist,
        albumArt: suggestion.albumArt,
        addedBy: 'ai',
        vibeScore: suggestion.vibeScore,
        reason: suggestion.reason,
        position: session.queue.length,
      }
      sessionService.addToQueue(session, queuedTrack)

      // Stream each track addition
      await sseWriter.write({
        type: 'queue_update',
        data: { track: queuedTrack, queueSize: session.queue.length }
      })
    }

    // Save session
    await sessionService.updateSession(session)

    return session.queue
  } catch (error) {
    logger?.error('[steer-stream] Queue rebuild error:', error)
    return []
  }
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

const SteerRequestSchema = z.object({
  direction: z.string().min(1).max(500),
})

export const steerStreamRouter = new Hono<{ Bindings: Env }>()

steerStreamRouter.post('/steer-stream', async c => {
  const logger = getLogger()
  const requestId = crypto.randomUUID().substring(0, 8)
  logger?.info(`[steer-stream:${requestId}] New streaming steer request`)

  // Parse request
  let body: { direction: string }
  try {
    body = SteerRequestSchema.parse(await c.req.json())
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }

  const { direction } = body
  logger?.info(`[steer-stream:${requestId}] Direction: "${direction}"`)

  // Get auth
  const token = c.req.header('authorization')?.replace('Bearer ', '')
  if (!token) {
    return c.json({ error: 'No authorization token' }, 401)
  }

  // Get user ID
  const userResponse = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!userResponse.ok) {
    return c.json({ error: 'Invalid authorization token' }, 401)
  }
  const userData = await userResponse.json() as { id: string }
  const userId = userData.id

  // Check requirements
  if (!c.env.MIX_SESSIONS) {
    return c.json({ error: 'Mix sessions not available' }, 500)
  }
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI not available' }, 500)
  }

  // Get session
  const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
  const session = await sessionService.getSession(userId)
  if (!session) {
    return c.json({ error: 'No active session' }, 404)
  }

  // Create SSE stream
  const { readable, writable } = new TransformStream(undefined, { highWaterMark: 10 })
  const writer = writable.getWriter()
  const sseWriter = new SteerSSEWriter(writer)

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  // Process async
  const processSteer = async () => {
    const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY })

    try {
      // 1. Acknowledge
      await sseWriter.write({
        type: 'ack',
        data: { message: `Got it! Steering towards "${direction}"...`, direction }
      })

      // 2. First progress message
      await sseWriter.write({
        type: 'progress',
        data: { message: getRandomTemplate('analyzing'), stage: 'analyzing' }
      })

      // 3. Steer vibe with thinking
      const { vibe: updatedVibe, changes } = await steerVibeWithThinking(
        anthropic,
        session.vibe,
        direction,
        sseWriter
      )

      // 4. Send vibe update
      await sseWriter.write({
        type: 'vibe_update',
        data: { vibe: updatedVibe, changes }
      })

      // Update session
      session.vibe = updatedVibe

      // 5. Progress: adjusting
      const adjustingMsg = await summarizeThinkingWithHaiku(anthropic, '', direction, 'adjusting')
      await sseWriter.write({
        type: 'progress',
        data: { message: adjustingMsg, stage: 'adjusting' }
      })

      // 6. Progress: building queue
      const buildingMsg = await summarizeThinkingWithHaiku(anthropic, '', direction, 'building')
      await sseWriter.write({
        type: 'progress',
        data: { message: buildingMsg, stage: 'building' }
      })

      // 7. Rebuild queue
      const queue = await rebuildQueue(c.env, token, session, sessionService, sseWriter)

      // 8. Send suggestions
      await sseWriter.write({
        type: 'suggestions',
        data: { count: queue.length }
      })

      // 9. Done
      await sseWriter.write({
        type: 'done',
        data: {
          vibe: updatedVibe,
          changes,
          queue,
          message: `Vibes adjusted! ${queue.length} new tracks in your queue.`
        }
      })

      logger?.info(`[steer-stream:${requestId}] Complete - ${changes.length} changes, ${queue.length} tracks`)
    } catch (error) {
      logger?.error(`[steer-stream:${requestId}] Error:`, error)
      await sseWriter.write({
        type: 'error',
        data: { message: error instanceof Error ? error.message : 'Failed to steer vibe' }
      })
    } finally {
      await sseWriter.close()
    }
  }

  // Start processing without awaiting
  c.executionCtx.waitUntil(processSteer())

  return new Response(readable, { headers })
})

export default steerStreamRouter
