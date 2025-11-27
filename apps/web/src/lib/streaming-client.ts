// SSE streaming client for real-time chat responses
import type {StreamDebugData, StreamLogData, StreamToolData, StreamToolResult} from '@dj/shared-types'

import {HTTP_STATUS, LIMITS} from '../constants'
import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

export interface StreamCallbacks {
  onContent?: (content: string) => void
  onDebug?: (data: StreamDebugData) => void
  onDone?: () => void
  onError?: (error: string) => void
  onLog?: (level: 'error' | 'info' | 'warn', message: string) => void
  onThinking?: (message: string) => void
  onToolEnd?: (tool: string, result: unknown) => void
  onToolStart?: (tool: string, args: Record<string, unknown>) => void
}

export type StreamEvent =
  | {data: null; type: 'done'}
  | {data: StreamDebugData; type: 'debug'}
  | {data: StreamLogData; type: 'log'}
  | {data: StreamToolData; type: 'tool_start'}
  | {data: StreamToolResult; type: 'tool_end'}
  | {data: string; type: 'content'}
  | {data: string; type: 'error'}
  | {data: string; type: 'thinking'}

export class ChatStreamClient {
  private static readonly MAX_BUFFER_SIZE = LIMITS.MAX_BUFFER_SIZE
  private abortController: AbortController | null = null

  close() {
    if (this.abortController) {
      this.abortController.abort('Client requested close')
      this.abortController = null
    }
  }

  async streamMessage(
    message: string,
    conversationHistory: {content: string; role: 'assistant' | 'user'}[],
    mode: 'analyze' | 'create' | 'dj' | 'edit',
    callbacks: StreamCallbacks,
    options?: {signal?: AbortSignal},
  ): Promise<{close: () => void}> {
    // Get auth token from centralized storage
    const tokenData = storage.get<null | {expiresAt: null | number; token: string}>(
      STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
      null,
    )
    if (!tokenData?.token) {
      callbacks.onError?.('Not authenticated')
      return {
        close: () => {
          /* empty */
        },
      } // Return no-op handle
    }

    const token = tokenData.token

    // Close any existing connection
    this.close()

    // Use fetch with ReadableStream for better control
    await this.streamWithFetch(message, conversationHistory, mode, token, callbacks, options)

    // Return handle for cancellation
    return {
      close: () => this.close(),
    }
  }

  private clearToken(): void {
    storage.remove(STORAGE_KEYS.SPOTIFY_TOKEN_DATA)
    storage.remove(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY)
  }

  private handleEvent(event: StreamEvent, callbacks: StreamCallbacks) {
    try {
      // Log ALL events clearly
      console.log(`%c[SSE Event] ${event.type}`, 'color: #00d4ff; font-weight: bold', event.data)

      switch (event.type) {
        case 'content':
          callbacks.onContent?.(event.data)
          break
        case 'debug':
          // Log debug info (now visible due to line 75)
          console.log('[Server Debug]', event.data)
          break
        case 'done':
          callbacks.onDone?.()
          break
        case 'error':
          console.error('[Server Error]', event.data)
          callbacks.onError?.(formatUserFriendlyError(event.data))
          break
        case 'log': {
          // Log to browser console with better formatting
          const logColor =
            event.data.level === 'error' ? 'color: red' : event.data.level === 'warn' ? 'color: orange' : 'color: blue'
          console.log(`%c[Server ${event.data.level}]`, logColor, event.data.message)
          break
        }
        case 'thinking':
          callbacks.onThinking?.(event.data)
          break
        case 'tool_end':
          console.log(`[Tool Complete] ${event.data.tool}`, event.data.result)
          callbacks.onToolEnd?.(event.data.tool, event.data.result)
          break
        case 'tool_start':
          console.log(`[Tool Start] ${event.data.tool}`, event.data.args)
          callbacks.onToolStart?.(event.data.tool, event.data.args)
          break
      }
    } catch (error) {
      console.error('[ChatStream] Error handling event:', event, error)
    }
  }

  private async streamWithFetch(
    message: string,
    conversationHistory: {content: string; role: 'assistant' | 'user'}[],
    mode: 'analyze' | 'create' | 'dj' | 'edit',
    token: string,
    callbacks: StreamCallbacks,
    options?: {signal?: AbortSignal},
  ): Promise<void> {
    // Create abort controller for fetch
    this.abortController = new AbortController()
    let finished = false

    // Link external abort signal if provided
    if (options?.signal) {
      options.signal.addEventListener('abort', () => this.abortController?.abort())
    }

    try {
      console.log('[ChatStream] Starting stream request to /api/chat-stream/message')
      console.log('[ChatStream] Request body:', {
        conversationHistory,
        message,
        mode,
      })

      const response = await fetch('/api/chat-stream/message', {
        body: JSON.stringify({
          conversationHistory,
          message,
          mode,
        }),
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: this.abortController.signal,
      })

      console.log('[ChatStream] Response status:', response.status, response.statusText)
      console.log('[ChatStream] Response headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        // Special handling for 401 - clear token and notify
        if (response.status === HTTP_STATUS.UNAUTHORIZED) {
          console.error('[ChatStream] 401 Unauthorized - clearing token')
          this.clearToken()
          callbacks.onError?.('Authentication expired. Please log in again.')
          return
        }

        // Try to get error details from response
        const errorText = await response.text().catch(() => '')
        console.error('[ChatStream] Error response:', errorText)
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, LIMITS.ERROR_TEXT_SLICE_LENGTH)}` : ''}`,
        )
      }

      // Validate content-type
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        // Try to get error details if server sent JSON
        const errorText = await response.text().catch(() => '')
        try {
          const json = JSON.parse(errorText) as {
            error?: string
            message?: string
          }
          const errorMessage = json.error ?? json.message ?? JSON.stringify(json)
          throw new Error(errorMessage)
        } catch {
          throw new Error(
            `Unexpected content-type: ${contentType}${errorText ? `. Response: ${errorText.slice(0, LIMITS.ERROR_TEXT_SLICE_LENGTH)}` : ''}`,
          )
        }
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Read the stream
      console.log('[ChatStream] Starting to read stream...')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let chunkCount = 0

      // Helper to process complete SSE events (events are separated by blank lines)
      const processSSEEvents = (): boolean => {
        // Normalize CRLF to LF and split by double-newline (event boundary)
        const normalizedBuffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const events = normalizedBuffer.split('\n\n')

        // Keep the last incomplete event in the buffer
        buffer = events.pop() ?? ''

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue

          // Parse the event block
          const lines = eventBlock.split('\n')
          // let eventType = 'message'; // Reserved for future use when we need event types
          const dataLines: string[] = []
          // let eventId: string | undefined; // Reserved for future use when we need event IDs

          for (const line of lines) {
            // Skip comments (lines starting with ':')
            if (line.startsWith(':') || !line.trim()) continue

            if (line.startsWith('event:')) {
              // eventType = line.slice(6).trim(); // Reserved for future use
              continue
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart())
            } else if (line.startsWith('id:')) {
              // eventId = line.slice(3).trim(); // Reserved for future use
              continue
            }
          }

          // Process the collected data lines
          if (dataLines.length > 0) {
            const dataStr = dataLines.join('\n')

            // Handle heartbeat messages
            if (dataStr.trim() === '') {
              continue // Skip empty data (heartbeats)
            }

            try {
              const parsed = JSON.parse(dataStr) as unknown

              // Handle our event format: {type: string, data: any}
              if (typeof parsed === 'object' && parsed && 'type' in parsed) {
                const event = parsed as StreamEvent
                console.log('[ChatStream] Parsed event:', event.type, event.data)

                // Check for done event
                if (event.type === 'done') {
                  if (!finished) {
                    callbacks.onDone?.()
                    finished = true
                  }
                  return true // Signal to stop processing
                }

                // Check for error event - terminate stream
                if (event.type === 'error') {
                  const rawMessage = typeof event.data === 'string' ? event.data : 'Stream error'
                  callbacks.onError?.(formatUserFriendlyError(rawMessage))
                  finished = true
                  this.abortController?.abort('Server error')
                  return true // Signal to stop processing
                }

                // Handle the event
                this.handleEvent(event, callbacks)
              } else {
                // Fallback for non-standard events
                console.warn('Unexpected SSE event format:', parsed)
              }
            } catch (error) {
              console.error('Failed to parse SSE data:', error, dataStr)
            }
          }
        }

        return false // Continue processing
      }

      // Read and process the stream
      while (true) {
        const {done, value} = await reader.read()
        chunkCount++

        if (done) {
          // Process any remaining buffered data
          if (buffer.trim()) {
            processSSEEvents()
          }
          break
        }

        const chunk = decoder.decode(value, {stream: true})
        console.log(
          `%c[SSE Chunk #${chunkCount}]`,
          'color: #888; font-size: 10px',
          `${chunk.length} bytes:`,
          chunk.slice(0, LIMITS.CHUNK_PREVIEW_LENGTH),
        )
        buffer += chunk

        // Safety cap on buffer size to prevent memory issues
        if (buffer.length > ChatStreamClient.MAX_BUFFER_SIZE) {
          console.warn('[ChatStream] Buffer size exceeded limit, truncating...')
          // Keep the last portion of the buffer
          buffer = buffer.slice(-ChatStreamClient.MAX_BUFFER_SIZE)
        }

        // Process complete events in the buffer
        if (processSSEEvents()) {
          // Done or error event received, stop processing
          break
        }
      }

      // Call onDone if not already called
      if (!finished) {
        console.log(`%c[ChatStream] ✅ Stream complete (${chunkCount} chunks)`, 'color: green; font-weight: bold')
        callbacks.onDone?.()
      } else {
        console.log(`%c[ChatStream] ✅ Stream already finished (${chunkCount} chunks)`, 'color: green')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was intentionally aborted
        console.log('[ChatStream] Stream aborted')
        if (!finished) {
          callbacks.onError?.('Stream cancelled')
        }
        return
      }
      console.error('[ChatStream] Stream error:', error)
      if (!finished) {
        const rawMessage = error instanceof Error ? error.message : 'Stream failed'
        callbacks.onError?.(formatUserFriendlyError(rawMessage))
      }
    } finally {
      this.abortController = null
    }
  }
}

/**
 * Convert technical error messages into user-friendly versions.
 */
function formatUserFriendlyError(message: string): string {
  // Network errors
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('Network') ||
    message.includes('Failed to fetch')
  ) {
    return 'Unable to connect to the server. Please check your internet connection.'
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit') || message.includes('Too Many')) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  // Server errors
  if (message.includes('500') || message.includes('Internal Server')) {
    return 'Something went wrong on our end. Please try again later.'
  }

  // Bad gateway / service unavailable
  if (
    message.includes('502') ||
    message.includes('503') ||
    message.includes('Bad Gateway') ||
    message.includes('Service Unavailable')
  ) {
    return 'The service is temporarily unavailable. Please try again in a few moments.'
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('Timeout') || message.includes('ETIMEDOUT')) {
    return 'The request took too long. Please try again.'
  }

  // Stream cancelled (user action, keep as-is)
  if (message === 'Stream cancelled') {
    return message
  }

  // Return original if no transformation needed, but truncate if too long
  if (message.length > 150) {
    return message.slice(0, 147) + '...'
  }

  return message
}

// Singleton instance
export const chatStreamClient = new ChatStreamClient()
