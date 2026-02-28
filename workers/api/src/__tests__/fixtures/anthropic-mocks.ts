/**
 * Anthropic SDK Mocks
 * Mock the @anthropic-ai/sdk client for testing Claude interactions
 */

import type Anthropic from '@anthropic-ai/sdk'

/**
 * Mock streaming message response
 * Simulates a streaming Claude response with content blocks and tool calls
 */
export interface MockStreamEvent {
  content_block?: {
    id?: string
    input?: unknown
    name?: string
    text?: string
    type: 'text' | 'tool_use'
  }
  delta?: {
    partial_json?: string
    stop_reason?: null | string
    text?: string
    type: 'input_json_delta' | 'text_delta'
  }
  index?: number
  message?: {
    content: unknown[]
    id: string
    model: string
    role: 'assistant'
    stop_reason: null | string
    stop_sequence: null | string
    type: 'message'
    usage: {
      input_tokens: number
      output_tokens: number
    }
  }
  type: 'content_block_delta' | 'content_block_start' | 'content_block_stop' | 'message_delta' | 'message_start' | 'message_stop'
}

/**
 * Mock Anthropic client that returns pre-configured responses
 */
export class MockAnthropicClient {
  /**
   * Create a mock messages API
   */
  get messages(): {
    stream: (params: Anthropic.MessageCreateParams) => {
      [Symbol.asyncIterator](): AsyncIterator<MockStreamEvent>
      finalMessage: () => Promise<Anthropic.Message>
    }
  } {
    return {
      stream: (params: Anthropic.MessageCreateParams) => {
        // Find matching response based on last user message
        const lastUserMessage = params.messages
          .filter(m => m.role === 'user')
          .pop()

        let events: MockStreamEvent[] = []
        if (lastUserMessage && typeof lastUserMessage.content === 'string') {
          for (const [substring, responseEvents] of this.responses.entries()) {
            if (lastUserMessage.content.includes(substring)) {
              events = responseEvents
              break
            }
          }
        }

        // Default response if no match
        if (events.length === 0) {
          events = buildTextResponseStream('Default mock response')
        }

        const stream = createMockStream(events)

        return {
          finalMessage: async () => {
            // Build final message from events
            const content: Anthropic.ContentBlock[] = []
            let stopReason: null | string = null

            for (const event of events) {
              if (event.type === 'content_block_start' && event.content_block) {
                if (event.content_block.type === 'text') {
                  content.push({citations: [], text: '', type: 'text'})
                } else if (event.content_block.type === 'tool_use') {
                  content.push({
                    id: event.content_block.id!,
                    input: {},
                    name: event.content_block.name!,
                    type: 'tool_use',
                  } as Anthropic.ContentBlock)
                }
              } else if (event.type === 'content_block_delta' && event.delta) {
                const lastBlock = content[content.length - 1]
                if (event.delta.type === 'text_delta' && lastBlock?.type === 'text') {
                  lastBlock.text += event.delta.text ?? ''
                } else if (
                  event.delta.type === 'input_json_delta' &&
                  lastBlock?.type === 'tool_use'
                ) {
                  // Accumulate JSON and parse at the end
                  try {
                    lastBlock.input = JSON.parse(event.delta.partial_json ?? '{}')
                  } catch {
                    // Partial JSON, will be completed in next delta
                  }
                }
              } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                stopReason = event.delta.stop_reason
              }
            }

            return {
              container: null,
              content,
              id: 'msg_test123',
              model: 'claude-sonnet-4-6-20260219',
              role: 'assistant',
              stop_reason: stopReason as Anthropic.Message['stop_reason'],
              stop_sequence: null,
              type: 'message',
              usage: {
                cache_creation: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                inference_geo: null,
                input_tokens: 100,
                output_tokens: 50,
                server_tool_use: null,
                service_tier: null,
              },
            } as Anthropic.Message
          },
          [Symbol.asyncIterator](): AsyncIterator<MockStreamEvent> {
            return stream[Symbol.asyncIterator]()
          },
        }
      },
    }
  }

  private responses = new Map<string, MockStreamEvent[]>()

  /**
   * Set a response for a specific prompt
   */
  setResponse(promptSubstring: string, events: MockStreamEvent[]): void {
    this.responses.set(promptSubstring, events)
  }
}

/**
 * Build a content_block_stop event
 */
export function buildContentBlockStopEvent(index: number): MockStreamEvent {
  return {
    index,
    type: 'content_block_stop',
  }
}

/**
 * Build a message_delta event
 */
export function buildMessageDeltaEvent(stopReason: null | string = null): MockStreamEvent {
  return {
    delta: {
      stop_reason: stopReason,
      type: 'text_delta',
    },
    type: 'message_delta',
  }
}

/**
 * Build a message_start event
 */
export function buildMessageStartEvent(overrides?: {
  id?: string
  model?: string
}): MockStreamEvent {
  return {
    message: {
      content: [],
      id: overrides?.id ?? 'msg_test123',
      model: overrides?.model ?? 'claude-sonnet-4-6-20260219',
      role: 'assistant',
      stop_reason: null,
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 100,
        output_tokens: 0,
      },
    },
    type: 'message_start',
  }
}

/**
 * Build a message_stop event
 */
export function buildMessageStopEvent(): MockStreamEvent {
  return {
    type: 'message_stop',
  }
}

/**
 * Build a mixed response stream (text + tool call)
 */
export function buildMixedResponseStream(
  text: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): MockStreamEvent[] {
  const toolId = `toolu_${Math.random().toString(36).substring(7)}`
  const inputJson = JSON.stringify(toolInput)

  return [
    buildMessageStartEvent(),
    buildTextBlockStartEvent(0),
    buildTextDeltaEvent(0, text),
    buildContentBlockStopEvent(0),
    buildToolUseBlockStartEvent(1, toolId, toolName),
    buildToolInputDeltaEvent(1, inputJson),
    buildContentBlockStopEvent(1),
    buildMessageDeltaEvent('tool_use'),
    buildMessageStopEvent(),
  ]
}

/**
 * Build a content_block_start event for text
 */
export function buildTextBlockStartEvent(index: number): MockStreamEvent {
  return {
    content_block: {
      text: '',
      type: 'text',
    },
    index,
    type: 'content_block_start',
  }
}

/**
 * Build a content_block_delta event for text
 */
export function buildTextDeltaEvent(index: number, text: string): MockStreamEvent {
  return {
    delta: {
      text,
      type: 'text_delta',
    },
    index,
    type: 'content_block_delta',
  }
}

/**
 * Build a complete text response stream
 */
export function buildTextResponseStream(text: string): MockStreamEvent[] {
  const chunks = text.match(/.{1,10}/g) ?? [text] // Split into ~10 char chunks
  const events: MockStreamEvent[] = [
    buildMessageStartEvent(),
    buildTextBlockStartEvent(0),
  ]

  for (const chunk of chunks) {
    events.push(buildTextDeltaEvent(0, chunk))
  }

  events.push(
    buildContentBlockStopEvent(0),
    buildMessageDeltaEvent('end_turn'),
    buildMessageStopEvent(),
  )

  return events
}

/**
 * Build a tool call response stream
 */
export function buildToolCallResponseStream(
  toolName: string,
  toolInput: Record<string, unknown>,
): MockStreamEvent[] {
  const toolId = `toolu_${Math.random().toString(36).substring(7)}`
  const inputJson = JSON.stringify(toolInput)
  const chunks = inputJson.match(/.{1,20}/g) ?? [inputJson] // Split into ~20 char chunks

  const events: MockStreamEvent[] = [
    buildMessageStartEvent(),
    buildToolUseBlockStartEvent(0, toolId, toolName),
  ]

  for (const chunk of chunks) {
    events.push(buildToolInputDeltaEvent(0, chunk))
  }

  events.push(
    buildContentBlockStopEvent(0),
    buildMessageDeltaEvent('tool_use'),
    buildMessageStopEvent(),
  )

  return events
}

/**
 * Build a content_block_delta event for tool input
 */
export function buildToolInputDeltaEvent(index: number, partialJson: string): MockStreamEvent {
  return {
    delta: {
      partial_json: partialJson,
      type: 'input_json_delta',
    },
    index,
    type: 'content_block_delta',
  }
}

/**
 * Build a content_block_start event for tool use
 */
export function buildToolUseBlockStartEvent(
  index: number,
  toolId: string,
  toolName: string,
): MockStreamEvent {
  return {
    content_block: {
      id: toolId,
      input: {},
      name: toolName,
      type: 'tool_use',
    },
    index,
    type: 'content_block_start',
  }
}

/**
 * Create a mock Anthropic client with preset responses
 */
export function createMockAnthropicClient(
  responses?: Record<string, MockStreamEvent[]>,
): MockAnthropicClient {
  const client = new MockAnthropicClient()

  if (responses) {
    for (const [prompt, events] of Object.entries(responses)) {
      client.setResponse(prompt, events)
    }
  }

  return client
}

/**
 * Create a mock streaming response from events
 */
export function createMockStream(events: MockStreamEvent[]): AsyncIterable<MockStreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
  }
}

/**
 * Mock simple non-streaming message creation
 */
export function mockMessageCreate(
  content: string | {id?: string; input?: unknown; name?: string; text?: string; type: 'text' | 'tool_use';}[],
): Anthropic.Message {
  const contentBlocks: Anthropic.ContentBlock[] = []

  if (typeof content === 'string') {
    contentBlocks.push({citations: [], text: content, type: 'text'})
  } else {
    for (const block of content) {
      if (block.type === 'text') {
        contentBlocks.push({citations: [], text: block.text ?? '', type: 'text'})
      } else if (block.type === 'tool_use') {
        contentBlocks.push({
          id: block.id ?? `toolu_${Math.random().toString(36).substring(7)}`,
          input: block.input ?? {},
          name: block.name ?? 'unknown_tool',
          type: 'tool_use',
        } as Anthropic.ContentBlock)
      }
    }
  }

  return {
    container: null,
    content: contentBlocks,
    id: 'msg_test123',
    model: 'claude-sonnet-4-6-20260219',
    role: 'assistant',
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 100,
      output_tokens: 50,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message
}
