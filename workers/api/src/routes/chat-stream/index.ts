import Anthropic from '@anthropic-ai/sdk'
import {Hono} from 'hono'
import {z} from 'zod'

import type {Env} from '../../index'
import type {AnthropicToolCall} from './types'

import {LLM} from '../../constants'
import {ProgressNarrator} from '../../lib/progress-narrator'
import {getLogger, runWithLogger} from '../../utils/LoggerContext'
import {ServiceLogger} from '../../utils/ServiceLogger'
import {runWithSubrequestTracker, SubrequestTracker} from '../../utils/SubrequestTracker'
import {processAgenticLoop} from './agentic-loop'
import {buildDJSystemPrompt, buildStandardSystemPrompt} from './prompts'
import {convertToAnthropicTools, isString} from './streaming'
import {SSEWriter} from './streaming/sse-writer'
import {createStreamingSpotifyTools} from './tools'

// Request schema
const ChatRequestSchema = z.object({
  conversationHistory: z
    .array(
      z.object({
        content: z.string(),
        role: z.enum(['user', 'assistant']),
      }),
    )
    .max(20)
    .default([]),
  message: z.string().min(1).max(2000),
  mode: z.enum(['analyze', 'create', 'dj', 'edit']).default('analyze'),
})

const chatStreamRouter = new Hono<{Bindings: Env}>()

/**
 * Streaming chat endpoint using Server-Sent Events
 * Uses query token for auth since EventSource can't send headers
 */
chatStreamRouter.post('/message', async c => {
  const requestId = crypto.randomUUID().substring(0, 8)
  getLogger()?.info(`[Stream:${requestId}] ========== NEW STREAMING REQUEST ==========`)
  getLogger()?.info(`[Stream:${requestId}] Method: ${c.req.method}`)
  getLogger()?.info(`[Stream:${requestId}] URL: ${c.req.url}`)
  getLogger()?.info(`[Stream:${requestId}] Headers:`, Object.fromEntries(c.req.raw.headers.entries()))

  // Create abort controller for client disconnect handling
  const abortController = new AbortController()
  const onAbort = () => {
    getLogger()?.info(`[Stream:${requestId}] Client disconnected, aborting...`)
    abortController.abort()
  }

  // Listen for client disconnect
  c.req.raw.signal.addEventListener('abort', onAbort)

  // Create a TransformStream for proper SSE handling in Cloudflare Workers
  // Use highWaterMark to prevent memory bloat during slow client consumption
  const {readable, writable} = new TransformStream(undefined, {highWaterMark: 10})
  const writer = writable.getWriter()
  const sseWriter = new SSEWriter(writer)

  // Set proper SSE headers for Cloudflare
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  // Get request body, authorization, and environment before starting async processing
  let requestBody
  try {
    requestBody = await c.req.json()
    getLogger()?.info(`[Stream:${requestId}] Request body parsed:`, {body: JSON.stringify(requestBody).slice(0, 200)})
  } catch (error) {
    getLogger()?.error(`[Stream:${requestId}] Failed to parse request body:`, error)
    return c.text('Invalid JSON', 400)
  }

  // Get auth token from header (we'll migrate to query param later)
  const authorization = c.req.header('Authorization')
  const env = c.env

  getLogger()?.info(`[Stream:${requestId}] Auth header present: ${!!authorization}`)
  getLogger()?.info(`[Stream:${requestId}] Env keys:`, {keys: Object.keys(env)})

  // Initialize logger for this request
  const streamLogger = new ServiceLogger(`Stream:${requestId}`, sseWriter)

  // Process the request and stream responses (wrapped in AsyncLocalStorage context)
  const processStream = async () => {
    await runWithLogger(streamLogger, async () => {
      const logger = getLogger()!
      logger.info('Starting async stream processing')
      logger.info('SSEWriter created, starting heartbeat')

      // Initialize subrequest tracker to stay within Cloudflare Workers limits (PAID TIER)
      const subrequestTracker = new SubrequestTracker({
        enableLogging: true,
        maxSubrequests: 950, // Safety margin below paid tier limit of 1000
        warningThreshold: 0.8,
      })
      logger.info('[SubrequestTracker] Initialized with paid tier limit: 950')

      // Wrap execution in subrequest tracker context (nested AsyncLocalStorage)
      await runWithSubrequestTracker(subrequestTracker, async () => {
        // Heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          if (abortController.signal.aborted) {
            clearInterval(heartbeatInterval)
            return
          }
          getLogger()?.info(`[Stream:${requestId}] Sending heartbeat`)
          void sseWriter.writeHeartbeat()
        }, 15000)

        try {
          // Check abort signal early
          if (abortController.signal.aborted) {
            throw new Error('Request aborted')
          }

          getLogger()?.info(`[Stream:${requestId}] Sending initial debug event`)
          // Send debug info as first event
          await sseWriter.write({
            data: {
              buildInfo: {
                branch: 'main',
                buildTime: new Date().toISOString(),
                commitHash: 'current',
                version: '1.0.0',
              },
              requestId,
              serverTime: new Date().toISOString(),
            },
            type: 'debug',
          })

          // Parse request
          const body = requestBody
          await sseWriter.write({
            data: {
              level: 'info',
              message: `[${requestId}] Request received - Body size: ${JSON.stringify(body).length} bytes`,
            },
            type: 'log',
          })

          const request = ChatRequestSchema.parse(body)

          await sseWriter.write({
            data: {
              historyLength: request.conversationHistory.length,
              messageLength: request.message.length,
              mode: request.mode,
              rawMessage: request.message.substring(0, 100),
              requestId,
            },
            type: 'debug',
          })

          // Extract playlist ID if present
          let playlistId: null | string = null
          let actualMessage = request.message
          const playlistIdMatch = /^\[Playlist ID: ([^\]]+)\] (.+)$/.exec(request.message)

          if (playlistIdMatch) {
            playlistId = playlistIdMatch[1]
            actualMessage = playlistIdMatch[2]
            await sseWriter.write({
              data: {
                level: 'info',
                message: `[${requestId}] Playlist ID extracted: ${playlistId}`,
              },
              type: 'log',
            })
          } else {
            await sseWriter.write({
              data: {
                level: 'warn',
                message: `[${requestId}] No playlist ID found in message: "${request.message.substring(0, 50)}..."`,
              },
              type: 'log',
            })
          }

          // Get Spotify token
          if (!authorization?.startsWith('Bearer ')) {
            await sseWriter.write({
              data: 'Unauthorized - Missing or invalid Authorization header',
              type: 'error',
            })
            return
          }
          const spotifyToken = authorization.replace('Bearer ', '')

          await sseWriter.write({
            data: {
              level: 'info',
              message: `[${requestId}] Auth token present`,
            },
            type: 'log',
          })

          // Initialize progress narrator with Haiku
          const narratorLogger = new ServiceLogger('ProgressNarrator', sseWriter)
          const narrator = new ProgressNarrator(env.ANTHROPIC_API_KEY, narratorLogger)
          const recentMessages: string[] = []

          // Send initial thinking message with dynamic narration
          const initialMessage = await narrator.generateMessage({
            eventType: 'started',
            userRequest: request.message,
          })
          recentMessages.push(initialMessage)
          sseWriter.writeAsync({data: initialMessage, type: 'thinking'})

          // Create tools with streaming callbacks
          const tools = createStreamingSpotifyTools(
            spotifyToken,
            sseWriter,
            playlistId ?? undefined,
            request.mode,
            abortController.signal,
            env,
            narrator,
            request.message,
            recentMessages,
          )

          // Initialize Claude with streaming
          if (!env.ANTHROPIC_API_KEY) {
            getLogger()?.error(`[Stream:${requestId}] CRITICAL: ANTHROPIC_API_KEY is not set`)
            throw new Error('Anthropic API key is not configured')
          }

          getLogger()?.info(`[Stream:${requestId}] Initializing Claude with API key`)

          // Initialize Anthropic client
          const anthropic = new Anthropic({
            apiKey: env.ANTHROPIC_API_KEY,
          })

          // Convert tools to Anthropic format
          const anthropicTools = convertToAnthropicTools(tools)

          // DJ Mode: Fetch current playback context for real-time DJ assistant
          let djContext: null | {nowPlaying?: {artist: string; progress: string; track: string}; queueDepth?: number} =
            null
          if (request.mode === 'dj') {
            djContext = await fetchDJContext(spotifyToken)
          }

          // Build system prompt
          const systemPrompt =
            request.mode === 'dj'
              ? buildDJSystemPrompt(djContext)
              : buildStandardSystemPrompt(playlistId)

          await sseWriter.write({
            data: {
              level: 'info',
              message: `[${requestId}] System prompt includes playlist: ${playlistId ? 'YES' : 'NO'}`,
            },
            type: 'log',
          })

          await sseWriter.write({
            data: {
              hasPlaylistContext: !!playlistId,
              playlistId: playlistId,
              systemPromptLength: systemPrompt.length,
            },
            type: 'debug',
          })

          // Build messages in Anthropic format
          const messages: Anthropic.MessageParam[] = [
            ...request.conversationHistory.map(m => ({
              content: m.content,
              role: m.role,
            })),
            {
              content: actualMessage,
              role: 'user' as const,
            },
          ]

          await sseWriter.write({
            data: {
              level: 'info',
              message: `[${requestId}] Messages prepared: ${messages.length} total, sending to Claude...`,
            },
            type: 'log',
          })
          getLogger()?.info(`[Stream:${requestId}] User message: "${actualMessage}"`)

          // Stream the response using Anthropic SDK
          let fullResponse = ''
          const toolCalls: AnthropicToolCall[] = []

          getLogger()?.info(`[Stream:${requestId}] Starting Claude streaming with Anthropic SDK...`)
          sseWriter.writeAsync({
            data: 'Analyzing your request...',
            type: 'thinking',
          })

          // Check for abort before API call
          if (abortController.signal.aborted) {
            throw new Error('Request aborted')
          }

          try {
            getLogger()?.info(
              `[Stream:${requestId}] Calling anthropic.messages.stream() with ${messages.length} messages`,
            )

            // Create stream with Anthropic SDK
            // Extended thinking enabled: temperature 1.0, budget 5000 tokens
            const stream = anthropic.messages.stream({
              max_tokens: 10000, // 5000 for thinking + 5000 for response
              messages: messages,
              model: LLM.MODEL,
              system: [
                {
                  cache_control: {type: 'ephemeral' as const},
                  text: systemPrompt,
                  type: 'text' as const,
                },
              ],
              temperature: 1.0, // Required for extended thinking
              thinking: {
                budget_tokens: 5000,
                type: 'enabled' as const,
              },
              tools: anthropicTools,
            })

            getLogger()?.info(`[Stream:${requestId}] Claude stream initialized`)

            // Process streaming events
            let eventCount = 0
            const contentBlocks: Anthropic.ContentBlock[] = []
            let currentBlockIndex = -1

            for await (const event of stream) {
              if (abortController.signal.aborted) {
                throw new Error('Request aborted')
              }

              eventCount++

              if (event.type === 'content_block_start') {
                currentBlockIndex = event.index
                const blockCopy = {...event.content_block}
                if (event.content_block.type === 'tool_use') {
                  ;(blockCopy as Anthropic.ToolUseBlock).input = '' // Force string type for JSON accumulation
                  getLogger()?.info(`[Stream:${requestId}] Tool use started: ${event.content_block.name}`)
                }
                // eslint-disable-next-line security/detect-object-injection
                contentBlocks[currentBlockIndex] = blockCopy
              } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  const text = event.delta.text
                  fullResponse += text
                  await sseWriter.write({data: text, type: 'content'})
                } else if (event.delta.type === 'input_json_delta') {
                  // eslint-disable-next-line security/detect-object-injection
                  const currentBlock = contentBlocks[currentBlockIndex]
                  if (currentBlock?.type === 'tool_use') {
                    if (typeof currentBlock.input !== 'string') {
                      currentBlock.input = ''
                    }
                    currentBlock.input += event.delta.partial_json
                  }
                }
              } else if (event.type === 'content_block_stop') {
                const block = contentBlocks[event.index]
                if (block?.type === 'tool_use' && block.id && block.name) {
                  const inputStr = isString(block.input) ? block.input : '{}'
                  try {
                    const input = JSON.parse(inputStr)
                    toolCalls.push({
                      args: input,
                      id: block.id,
                      name: block.name,
                    })
                    getLogger()?.info(`[Stream:${requestId}] Tool use complete: ${block.name}`)
                  } catch (parseError) {
                    getLogger()?.error(`[Stream:${requestId}] Failed to parse tool input for ${block.name}`, parseError)
                    toolCalls.push({
                      args: {},
                      id: block.id,
                      name: block.name,
                    })
                  }
                }
              }
            }

            getLogger()?.info(
              `[Stream:${requestId}] Initial streaming complete. Events: ${eventCount}, Tool calls: ${toolCalls.length}, Content length: ${fullResponse.length}`,
            )
          } catch (apiError) {
            if (abortController.signal.aborted) {
              throw new Error('Request aborted')
            }
            getLogger()?.error(`[Stream:${requestId}] Anthropic API call failed:`, apiError)
            const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error'
            throw new Error(`Claude API failed: ${errorMessage}`)
          }

          // Process agentic loop with tool calls
          fullResponse = await processAgenticLoop({
            abortController,
            anthropic,
            anthropicTools,
            fullResponse,
            initialToolCalls: toolCalls,
            messages,
            requestId,
            sseWriter,
            systemPrompt,
            tools,
          })

          // If still no response after everything, provide useful feedback
          if (fullResponse.length === 0) {
            getLogger()?.error(`[Stream:${requestId}] WARNING: No content received from Claude!`)
            await sseWriter.write({
              data: 'I encountered an issue processing your request. Please try rephrasing or simplifying your request.',
              type: 'content',
            })
          }

          // Stream processing complete - done event sent in finally block
          getLogger()?.info(`[Stream:${requestId}] Stream processing complete - all events sent`)
        } catch (error) {
          const logger = getLogger()!
          if (error instanceof Error && error.message === 'Request aborted') {
            logger.info('Request was aborted by client')
          } else {
            logger.error('Stream processing error', error, {
              errorMessage: error instanceof Error ? error.message : String(error),
              errorType: error?.constructor?.name,
            })
            await sseWriter.write({
              data: error instanceof Error ? error.message : 'An error occurred',
              type: 'error',
            })
          }
        } finally {
          const logger = getLogger()!
          // CRITICAL: Always send done event so client knows stream is complete
          logger.info(`[Stream:${requestId}] Sending done event in finally`)
          await sseWriter.write({data: null, type: 'done'})
          clearInterval(heartbeatInterval)
          c.req.raw.signal.removeEventListener('abort', onAbort)
          logger.info('Closing writer...')
          await sseWriter.close()
          logger.info('Stream cleanup complete, heartbeat cleared')
        }
      }) // End runWithSubrequestTracker
    }) // End runWithLogger
  }

  // Start processing without blocking the response
  processStream().catch(error => {
    // Logger context may not be available here, use direct streamLogger
    streamLogger.error('Unhandled error in processStream', error)
  })

  // Return the SSE response immediately
  getLogger()?.info(`[Stream:${requestId}] Returning Response with SSE headers`)
  const response = new Response(readable, {headers})
  getLogger()?.info(`[Stream:${requestId}] Response created, headers:`, Object.fromEntries(headers.entries()))
  return response
})

/**
 * GET endpoint for SSE with query token authentication
 * This allows EventSource to work since it can't send custom headers
 */
chatStreamRouter.get('/events', async c => {
  const token = c.req.query('token')

  if (!token) {
    return c.text('Unauthorized', 401)
  }

  const requestId = crypto.randomUUID().substring(0, 8)
  getLogger()?.info(`[SSE:${requestId}] EventSource connection established`)

  // Create abort controller for client disconnect
  const abortController = new AbortController()
  const onAbort = () => {
    getLogger()?.info(`[SSE:${requestId}] Client disconnected`)
    abortController.abort()
  }

  c.req.raw.signal.addEventListener('abort', onAbort)

  // Create SSE stream
  const {readable, writable} = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Set proper SSE headers
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  // Simple heartbeat to demonstrate connection
  const processStream = async () => {
    const heartbeatInterval = setInterval(() => {
      if (abortController.signal.aborted) {
        clearInterval(heartbeatInterval)
        return
      }
      try {
        void writer.write(encoder.encode(': heartbeat\n\n'))
      } catch {
        clearInterval(heartbeatInterval)
      }
    }, 15000)

    try {
      // Send initial event
      await writer.write(encoder.encode(`data: {"type":"connected","requestId":"${requestId}"}\n\n`))

      // Keep connection open until client disconnects
      await new Promise(resolve => {
        abortController.signal.addEventListener('abort', resolve)
      })
    } finally {
      clearInterval(heartbeatInterval)
      c.req.raw.signal.removeEventListener('abort', onAbort)
      await writer.close()
    }
  }

  processStream().catch(console.error)

  return new Response(readable, {headers})
})

/**
 * Fetch DJ context (current playback and queue)
 */
async function fetchDJContext(
  spotifyToken: string,
): Promise<null | {nowPlaying?: {artist: string; progress: string; track: string}; queueDepth?: number}> {
  try {
    const [nowPlayingRes, queueRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {Authorization: `Bearer ${spotifyToken}`},
      }),
      fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {Authorization: `Bearer ${spotifyToken}`},
      }),
    ])

    let djContext: null | {nowPlaying?: {artist: string; progress: string; track: string}; queueDepth?: number} = null

    const NowPlayingSchema = z.object({
      item: z.object({
        artists: z.array(z.object({name: z.string()})).optional(),
        duration_ms: z.number().optional(),
        name: z.string().optional(),
      }).optional(),
      progress_ms: z.number().optional(),
    }).passthrough()

    const QueueSchema = z.object({
      queue: z.array(z.unknown()).optional(),
    }).passthrough()

    if (nowPlayingRes.ok && nowPlayingRes.status !== 204) {
      const npParsed = NowPlayingSchema.safeParse(await nowPlayingRes.json())
      if (npParsed.success) {
        const npData = npParsed.data
        const progress = npData.progress_ms ?? 0
        const duration = npData.item?.duration_ms ?? 0
        djContext = {
          nowPlaying: {
            artist: npData.item?.artists?.map((a) => a.name).join(', ') ?? 'Unknown',
            progress: `${Math.floor(progress / 1000)}s / ${Math.floor(duration / 1000)}s`,
            track: npData.item?.name ?? 'Unknown',
          },
        }
      }
    }

    if (queueRes.ok) {
      const qParsed = QueueSchema.safeParse(await queueRes.json())
      if (qParsed.success) {
        djContext = {...djContext, queueDepth: qParsed.data.queue?.length ?? 0}
      }
    }

    return djContext
  } catch (e) {
    getLogger()?.warn(`Failed to fetch DJ context:`, {error: e instanceof Error ? e.message : String(e)})
    return null
  }
}

export {chatStreamRouter}
