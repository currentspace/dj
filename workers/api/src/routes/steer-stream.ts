/**
 * Streaming Vibe Steer Endpoint
 * Provides real-time progress feedback during vibe steering
 */

import type { MixSession, QueuedTrack, Suggestion, VibeProfile } from '@dj/shared-types'

import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Env } from '../index'

import { LLM } from '../constants'
import { buildSteeringSuggestionsPrompt, buildVibeDescription, SYSTEM_PROMPTS } from '../lib/ai-prompts'
import { createAIService } from '../lib/ai-service'
import { MixSessionService } from '../services/MixSessionService'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// TYPES
// =============================================================================

interface SteerEvent {
  data: unknown
  type: 'ack' | 'done' | 'error' | 'progress' | 'queue_update' | 'suggestions' | 'thinking' | 'vibe_update'
}

interface VibeAdjustments {
  bpmRange?: { max: number; min: number; }
  energyDirection?: 'building' | 'steady' | 'winding_down'
  energyLevel?: number
  era?: { end: number; start: number; }
  genres?: string[]
  mood?: string[]
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TARGET_QUEUE_SIZE = 5

// DJ-style progress messages for different stages
const PROGRESS_TEMPLATES = {
  adjusting: [
    'Dialing in the sound...',
    'Mixing in the new direction...',
    'Blending the vibes...',
  ],
  analyzing: [
    'Reading the room...',
    'Feeling out the vibe...',
    'Tuning into the energy...',
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

  async close(): Promise<void> {
    this.closed = true
    await this.writeQueue
    await this.writer.close()
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
}

// =============================================================================
// HAIKU PROGRESS SUMMARIZER
// =============================================================================

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

// =============================================================================
// VIBE STEERING LOGIC
// =============================================================================

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

/**
 * Generate suggestions specifically for steering - prioritizes new vibe while
 * lightly considering recent tracks for smooth transitions
 */
async function generateSteeringSuggestions(
  env: Env,
  token: string,
  session: MixSession,
  direction: string,
  count: number
): Promise<Suggestion[]> {
  const logger = getLogger()

  if (!env.ANTHROPIC_API_KEY) {
    logger?.warn('[steer-stream] No AI service available for steering suggestions')
    return []
  }

  const aiService = createAIService({ apiKey: env.ANTHROPIC_API_KEY })

  // Build the steering prompt with the new vibe and recent history context
  const vibeDescription = buildVibeDescription(session.vibe)
  const recentTracks = session.history.slice(-5).map(t => ({ artist: t.artist, name: t.name }))
  const prompt = buildSteeringSuggestionsPrompt(vibeDescription, direction, recentTracks, count)

  logger?.info('[steer-stream] Asking AI for steering suggestions...', {
    direction,
    recentTracksCount: recentTracks.length,
  })

  const AITrackSuggestionsSchema = z.object({
    tracks: z.array(z.object({
      artist: z.string(),
      name: z.string(),
      reason: z.string(),
    })),
  })

  const response = await aiService.promptForJSON(prompt, {
    system: SYSTEM_PROMPTS.DJ,
    temperature: 0.8,
  })

  const parsed = AITrackSuggestionsSchema.safeParse(response.data)
  if (response.error || !parsed.success) {
    logger?.error('[steer-stream] AI steering request failed:', response.error)
    return []
  }

  const aiSuggestions = parsed.data

  if (aiSuggestions.tracks.length === 0) {
    logger?.info('[steer-stream] AI returned no steering suggestions')
    return []
  }

  logger?.info(`[steer-stream] AI suggested ${aiSuggestions.tracks.length} steering tracks, searching Spotify...`)

  // Search Spotify for each suggested track
  const suggestions: Suggestion[] = []

  for (const suggestion of aiSuggestions.tracks) {
    const track = await searchSpotifyTrack(token, suggestion.artist, suggestion.name)
    if (track) {
      // Skip enrichment for steering - focus on getting the right tracks quickly
      suggestions.push({
        albumArt: track.album.images[0]?.url,
        artist: track.artists[0]?.name || 'Unknown Artist',
        bpm: null,
        name: track.name,
        reason: suggestion.reason,
        trackId: track.id,
        trackUri: track.uri,
        vibeScore: 80, // High score since AI specifically picked these for the new vibe
      })
    }
    if (suggestions.length >= count) break
  }

  logger?.info(`[steer-stream] Generated ${suggestions.length} steering suggestions`)
  return suggestions
}

function getRandomTemplate(stage: keyof typeof PROGRESS_TEMPLATES): string {
  // eslint-disable-next-line security/detect-object-injection -- safe: stage is typed as keyof typeof PROGRESS_TEMPLATES (a const object)
  const templates = PROGRESS_TEMPLATES[stage]
  return templates[Math.floor(Math.random() * templates.length)]
}

function parseVibeAdjustments(response: string): VibeAdjustments {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(response)
    if (!jsonMatch) return {}
    return JSON.parse(jsonMatch[0])
  } catch {
    return {}
  }
}

async function rebuildQueue(
  env: Env,
  token: string,
  session: MixSession,
  direction: string,
  sessionService: MixSessionService,
  sseWriter: SteerSSEWriter
): Promise<QueuedTrack[]> {
  const logger = getLogger()

  // Clear existing queue
  sessionService.clearQueue(session)

  const tracksNeeded = TARGET_QUEUE_SIZE

  try {
    // Generate steering-specific suggestions using AI
    logger?.info('[steer-stream] Generating steering suggestions towards:', { direction })
    const suggestions = await generateSteeringSuggestions(
      env,
      token,
      session,
      direction,
      tracksNeeded + 3
    )

    if (suggestions.length === 0) {
      logger?.info('[steer-stream] No suggestions generated')
      return []
    }

    // Filter duplicates
    const existingUris = new Set([
      ...session.history.map(t => t.trackUri),
      ...session.queue.map(t => t.trackUri),
    ])
    const available = suggestions.filter(s => !existingUris.has(s.trackUri))
    const toAdd = available.slice(0, tracksNeeded)

    // Add to queue
    for (const suggestion of toAdd) {
      const queuedTrack: QueuedTrack = {
        addedBy: 'ai',
        albumArt: suggestion.albumArt,
        artist: suggestion.artist,
        name: suggestion.name,
        position: session.queue.length,
        reason: suggestion.reason,
        trackId: suggestion.trackId,
        trackUri: suggestion.trackUri,
        vibeScore: suggestion.vibeScore,
      }
      sessionService.addToQueue(session, queuedTrack)

      // Stream each track addition
      await sseWriter.write({
        data: { queueSize: session.queue.length, track: queuedTrack },
        type: 'queue_update'
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
// STEERING SUGGESTIONS
// =============================================================================

/**
 * Search for a track on Spotify
 */
async function searchSpotifyTrack(
  token: string,
  artist: string,
  track: string
): Promise<null | { album: { images: { url: string }[] }; artists: { name: string }[]; id: string; name: string; uri: string; }> {
  try {
    const query = `artist:${artist} track:${track}`
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      return null
    }

    const SpotifySearchHitSchema = z.object({
      tracks: z.object({
        items: z.array(z.object({
          album: z.object({ images: z.array(z.object({ url: z.string() })) }),
          artists: z.array(z.object({ name: z.string() })),
          id: z.string(),
          name: z.string(),
          uri: z.string(),
        })),
      }).optional(),
    })
    const json: unknown = await response.json()
    const parsed = SpotifySearchHitSchema.safeParse(json)
    if (!parsed.success) return null
    return parsed.data.tracks?.items?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Start playback with ALL tracks as the context
 * This creates a proper playback context that Spotify will play through
 */
async function startPlaybackWithTracks(
  token: string,
  trackUris: string[]
): Promise<boolean> {
  const logger = getLogger()

  if (trackUris.length === 0) {
    logger?.warn('[steer-stream] No tracks to play')
    return false
  }

  try {
    logger?.info('[steer-stream] Starting playback with context:', {
      trackCount: trackUris.length,
      uris: trackUris
    })

    // Play ALL tracks at once - this creates a proper context that Spotify will play through
    const playResponse = await fetch('https://api.spotify.com/v1/me/player/play', {
      body: JSON.stringify({
        uris: trackUris,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    if (!playResponse.ok) {
      const text = await playResponse.text()
      logger?.warn('[steer-stream] Failed to start playback:', { status: playResponse.status, text })
      return false
    }

    logger?.info('[steer-stream] Playback started with all tracks in context')
    return true
  } catch (error) {
    logger?.error('[steer-stream] Error starting playback:', error)
    return false
  }
}

// =============================================================================
// SPOTIFY PLAYBACK
// =============================================================================

async function steerVibeWithThinking(
  anthropic: Anthropic,
  currentVibe: VibeProfile,
  direction: string,
  sseWriter: SteerSSEWriter
): Promise<{ changes: string[]; vibe: VibeProfile; }> {
  const logger = getLogger()

  // Use Sonnet with extended thinking for deeper reasoning
  const prompt = buildSteerPrompt(currentVibe, direction)

  logger?.info('[steer-stream] Calling Claude with extended thinking...')

  const response = await anthropic.messages.create({
    max_tokens: 16000,
    messages: [{
      content: prompt,
      role: 'user'
    }],
    model: LLM.MODEL,
    thinking: {
      budget_tokens: 4000,
      type: 'enabled'
    }
  })

  // Extract thinking and text
  let thinking = ''
  let adjustmentsJson = ''

  for (const block of response.content) {
    if (block.type === 'thinking') {
      thinking = block.thinking
      // Send thinking preview to client
      await sseWriter.write({
        data: { preview: thinking.slice(0, 500) + (thinking.length > 500 ? '...' : '') },
        type: 'thinking'
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

  return { changes, vibe: updatedVibe }
}

// =============================================================================
// QUEUE REBUILDING
// =============================================================================

async function summarizeThinkingWithHaiku(
  anthropic: Anthropic,
  thinking: string,
  direction: string,
  stage: 'adjusting' | 'analyzing' | 'building'
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      max_tokens: 100,
      messages: [{
        content: `You're a friendly DJ assistant. Write ONE short (5-10 words), conversational progress message about steering towards "${direction}".

Stage: ${stage}
${thinking ? `Context: ${thinking.slice(0, 200)}` : ''}

Be warm and DJ-like. No emojis. Examples:
- "Shifting into deeper house territory..."
- "Finding those perfect laid-back beats..."
- "Bringing in some vintage soul flavor..."

Just the message, no quotes or extra formatting.`,
        role: 'user'
      }],
      model: LLM.MODEL_HAIKU,
      temperature: 0.7
    })

    const textBlock = response.content.find(b => b.type === 'text')
    return textBlock?.text ?? getRandomTemplate(stage)
  } catch {
    return getRandomTemplate(stage)
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
  const userJson: unknown = await userResponse.json()
  const userParsed = z.object({ id: z.string() }).safeParse(userJson)
  if (!userParsed.success) {
    return c.json({ error: 'Failed to parse user data' }, 500)
  }
  const userId = userParsed.data.id

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
        data: { direction, message: `Got it! Steering towards "${direction}"...` },
        type: 'ack'
      })

      // 2. First progress message
      await sseWriter.write({
        data: { message: getRandomTemplate('analyzing'), stage: 'analyzing' },
        type: 'progress'
      })

      // 3. Steer vibe with thinking
      const { changes, vibe: updatedVibe } = await steerVibeWithThinking(
        anthropic,
        session.vibe,
        direction,
        sseWriter
      )

      // 4. Send vibe update
      await sseWriter.write({
        data: { changes, vibe: updatedVibe },
        type: 'vibe_update'
      })

      // Update session
      session.vibe = updatedVibe

      // 5. Progress: adjusting
      const adjustingMsg = await summarizeThinkingWithHaiku(anthropic, '', direction, 'adjusting')
      await sseWriter.write({
        data: { message: adjustingMsg, stage: 'adjusting' },
        type: 'progress'
      })

      // 6. Progress: building queue
      const buildingMsg = await summarizeThinkingWithHaiku(anthropic, '', direction, 'building')
      await sseWriter.write({
        data: { message: buildingMsg, stage: 'building' },
        type: 'progress'
      })

      // 7. Rebuild queue with steering-aware suggestions
      const queue = await rebuildQueue(c.env, token, session, direction, sessionService, sseWriter)

      // 7.5. Start playback with the new queue (replaces Spotify's old queue)
      if (queue.length > 0) {
        const trackUris = queue.map(t => t.trackUri)
        const playbackStarted = await startPlaybackWithTracks(token, trackUris)
        if (playbackStarted) {
          await sseWriter.write({
            data: { message: 'Starting your new mix...', stage: 'playing' },
            type: 'progress'
          })
        }
      }

      // 8. Send suggestions
      await sseWriter.write({
        data: { count: queue.length },
        type: 'suggestions'
      })

      // 9. Done
      await sseWriter.write({
        data: {
          changes,
          message: `Vibes adjusted! ${queue.length} new tracks in your queue.`,
          queue,
          vibe: updatedVibe
        },
        type: 'done'
      })

      logger?.info(`[steer-stream:${requestId}] Complete - ${changes.length} changes, ${queue.length} tracks`)
    } catch (error) {
      logger?.error(`[steer-stream:${requestId}] Error:`, error)
      await sseWriter.write({
        data: { message: error instanceof Error ? error.message : 'Failed to steer vibe' },
        type: 'error'
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
