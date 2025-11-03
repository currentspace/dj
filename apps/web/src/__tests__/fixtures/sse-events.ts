/**
 * Server-Sent Events (SSE) Mock Infrastructure
 * Provides utilities for simulating SSE streams in tests
 */

import type {
  StreamContentEvent,
  StreamDebugEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  StreamLogEvent,
  StreamThinkingEvent,
  StreamToolEndEvent,
  StreamToolStartEvent,
} from '@dj/shared-types'

// ============================================================================
// TYPE-SAFE EVENT BUILDERS
// ============================================================================

/**
 * Create a content event (text response from Claude)
 */
export function mockContentEvent(content: string): StreamContentEvent {
  return {
    data: content,
    type: 'content',
  }
}

/**
 * Create a thinking event (Claude processing indicator)
 */
export function mockThinkingEvent(message: string): StreamThinkingEvent {
  return {
    data: message,
    type: 'thinking',
  }
}

/**
 * Create a tool_start event (tool execution begins)
 */
export function mockToolStartEvent(tool: string, args: Record<string, unknown>): StreamToolStartEvent {
  return {
    data: {
      args,
      tool,
    },
    type: 'tool_start',
  }
}

/**
 * Create a tool_end event (tool execution completes)
 */
export function mockToolEndEvent(tool: string, result: unknown): StreamToolEndEvent {
  return {
    data: {
      result,
      tool,
    },
    type: 'tool_end',
  }
}

/**
 * Create a log event (server logging)
 */
export function mockLogEvent(level: 'error' | 'info' | 'warn', message: string): StreamLogEvent {
  return {
    data: {
      level,
      message,
    },
    type: 'log',
  }
}

/**
 * Create a debug event (server debug info)
 */
export function mockDebugEvent(data: Record<string, unknown>): StreamDebugEvent {
  return {
    data,
    type: 'debug',
  }
}

/**
 * Create an error event (stream error)
 */
export function mockErrorEvent(error: string): StreamErrorEvent {
  return {
    data: error,
    type: 'error',
  }
}

/**
 * Create a done event (stream complete)
 */
export function mockDoneEvent(): StreamDoneEvent {
  return {
    data: null,
    type: 'done',
  }
}

// ============================================================================
// PRE-MADE EVENT SEQUENCES
// ============================================================================

/**
 * Common event sequences for testing different scenarios
 */
export const MOCK_EVENT_SEQUENCES = {
  /**
   * Simple chat response without tools
   */
  basicChat: [
    mockThinkingEvent('Processing your request...'),
    mockContentEvent('This is a '),
    mockContentEvent('simple '),
    mockContentEvent('response.'),
    mockDoneEvent(),
  ],

  /**
   * Chat with error
   */
  chatWithError: [
    mockThinkingEvent('Processing your request...'),
    mockErrorEvent('Failed to connect to Spotify API'),
    mockDoneEvent(),
  ],

  /**
   * Chat with tool execution
   */
  chatWithTool: [
    mockThinkingEvent('Analyzing your playlist...'),
    mockToolStartEvent('analyze_playlist', {playlist_id: 'test_playlist'}),
    mockLogEvent('info', 'Fetching playlist metadata'),
    mockToolEndEvent('analyze_playlist', {
      metadata_analysis: {avg_popularity: 75},
      playlist_name: 'Test Playlist',
      total_tracks: 10,
    }),
    mockContentEvent('Your playlist has an average popularity of 75.'),
    mockDoneEvent(),
  ],

  /**
   * Complex multi-tool sequence
   */
  multiTool: [
    mockThinkingEvent('Creating personalized recommendations...'),
    mockToolStartEvent('analyze_playlist', {playlist_id: 'test_playlist'}),
    mockToolEndEvent('analyze_playlist', {
      metadata_analysis: {avg_popularity: 75},
      playlist_name: 'Test Playlist',
      total_tracks: 10,
    }),
    mockToolStartEvent('extract_playlist_vibe', {analysis_data: {}}),
    mockToolEndEvent('extract_playlist_vibe', {vibe_profile: 'energetic electronic'}),
    mockToolStartEvent('get_recommendations', {seed_tracks: ['track1', 'track2']}),
    mockToolEndEvent('get_recommendations', {tracks: [{id: 'rec1', name: 'Recommended Track'}]}),
    mockContentEvent('I found some great recommendations for you!'),
    mockDoneEvent(),
  ],
}

// ============================================================================
// SSE STREAM SIMULATION
// ============================================================================

type SSEEvent =
  | StreamContentEvent
  | StreamDebugEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamLogEvent
  | StreamThinkingEvent
  | StreamToolEndEvent
  | StreamToolStartEvent

/**
 * Convert event objects to SSE format (data: {...}\n\n)
 */
export function formatSSEEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Create a mock SSE stream that emits events with delays
 * @param events - Array of events to emit
 * @param delayMs - Delay between events in milliseconds
 * @returns ReadableStream that emits SSE-formatted events
 */
export function createMockSSEStream(events: SSEEvent[], delayMs: number = 10): ReadableStream<Uint8Array> {
  let eventIndex = 0
  const encoder = new TextEncoder()

  return new ReadableStream({
    async pull(controller) {
      if (eventIndex >= events.length) {
        controller.close()
        return
      }

      // Add delay between events to simulate real streaming
      if (eventIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      const event = events[eventIndex]
      const formatted = formatSSEEvent(event)
      controller.enqueue(encoder.encode(formatted))

      eventIndex++
    },
    start(controller) {
      // Emit initial heartbeat
      controller.enqueue(encoder.encode(': heartbeat\n\n'))
    },
  })
}

/**
 * Create a mock Response object with SSE stream
 * @param events - Array of events to stream
 * @param delayMs - Delay between events
 */
export function createMockSSEResponse(events: SSEEvent[], delayMs: number = 10): Response {
  const stream = createMockSSEStream(events, delayMs)

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
    status: 200,
  })
}

// ============================================================================
// MOCK EVENT SOURCE (for non-fetch SSE)
// ============================================================================

/**
 * Mock EventSource for testing legacy SSE implementations
 */
export class MockEventSource implements EventSource {
  CLOSED = 2 as const
  CONNECTING = 0 as const
  OPEN = 1 as const
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  readyState: 0 | 1 | 2 = 0
  url: string
  withCredentials = false

  private listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map()
  private events: SSEEvent[]
  private eventIndex = 0
  private intervalId: number | null = null

  constructor(url: string, events: SSEEvent[] = []) {
    this.url = url
    this.events = events

    // Simulate connection opening
    setTimeout(() => {
      this.readyState = 1
      const openEvent = new Event('open')
      if (this.onopen) {
        this.onopen.call(this as unknown as EventSource, openEvent)
      }
      this.startEmitting()
    }, 10)
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | ((this: EventSource, event: MessageEvent) => unknown),
    _options?: AddEventListenerOptions | boolean,
  ): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener as EventListenerOrEventListenerObject)
  }

  close(): void {
    this.readyState = 2
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type)
    if (listeners) {
      listeners.forEach(listener => {
        if (typeof listener === 'function') {
          listener(event)
        } else {
          listener.handleEvent(event)
        }
      })
    }
    return true
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | ((this: EventSource, event: MessageEvent) => unknown),
    _options?: EventListenerOptions | boolean,
  ): void {
    const listeners = this.listeners.get(type)
    if (listeners) {
      listeners.delete(listener as EventListenerOrEventListenerObject)
    }
  }

  /**
   * Add an event to emit
   */
  addEvent(event: SSEEvent): void {
    this.events.push(event)
  }

  /**
   * Clear all pending events
   */
  clearEvents(): void {
    this.events = []
    this.eventIndex = 0
  }

  /**
   * Trigger an error
   */
  triggerError(_errorMessage: string = 'Connection failed'): void {
    this.readyState = 2
    const errorEvent = new Event('error')
    if (this.onerror) {
      this.onerror.call(this as unknown as EventSource, errorEvent)
    }
    this.dispatchEvent(errorEvent)
  }

  private startEmitting(): void {
    this.intervalId = window.setInterval(() => {
      if (this.eventIndex >= this.events.length) {
        this.close()
        return
      }

      const event = this.events[this.eventIndex]
      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(event),
      })

      if (this.onmessage) {
        this.onmessage.call(this as unknown as EventSource, messageEvent)
      }
      this.dispatchEvent(messageEvent)

      this.eventIndex++
    }, 50)
  }
}

/**
 * Create a mock EventSource with pre-defined events
 */
export function createMockEventSource(url: string, events: SSEEvent[] = []): MockEventSource {
  return new MockEventSource(url, events)
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Parse SSE stream from Response into events
 * Useful for testing actual SSE parsing logic
 */
export async function parseSSEStream(response: Response): Promise<SSEEvent[]> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No body in response')

  const decoder = new TextDecoder()
  const events: SSEEvent[] = []
  let buffer = ''

  while (true) {
    const {done, value} = await reader.read()
    if (done) break

    buffer += decoder.decode(value, {stream: true})

    // Split by double newline (SSE event boundary)
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || '' // Keep incomplete event in buffer

    for (const part of parts) {
      if (part.startsWith(': heartbeat')) continue // Skip heartbeats
      if (part.startsWith('data: ')) {
        const json = part.slice(6) // Remove "data: " prefix
        try {
          events.push(JSON.parse(json))
        } catch (error) {
          console.error('Failed to parse SSE event:', json, error)
        }
      }
    }
  }

  return events
}

/**
 * Wait for a specific event type in the stream
 * Useful for integration tests
 */
export function waitForSSEEvent(
  events: SSEEvent[],
  predicate: (event: SSEEvent) => boolean,
  timeoutMs: number = 5000,
): Promise<SSEEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for SSE event after ${timeoutMs}ms`))
    }, timeoutMs)

    const checkEvents = () => {
      const found = events.find(predicate)
      if (found) {
        clearTimeout(timeout)
        resolve(found)
      } else {
        setTimeout(checkEvents, 10)
      }
    }

    checkEvents()
  })
}
