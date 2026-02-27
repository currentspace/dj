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
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop'
  message?: {
    id: string
    type: 'message'
    role: 'assistant'
    content: unknown[]
    model: string
    stop_reason: null | string
    stop_sequence: null | string
    usage: {
      input_tokens: number
      output_tokens: number
    }
  }
  index?: number
  content_block?: {
    type: 'text' | 'tool_use'
    text?: string
    id?: string
    name?: string
    input?: unknown
  }
  delta?: {
    type: 'text_delta' | 'input_json_delta'
    text?: string
    partial_json?: string
    stop_reason?: null | string
  }
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
 * Build a message_start event
 */
export function buildMessageStartEvent(overrides?: {
  id?: string
  model?: string
}): MockStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: overrides?.id ?? 'msg_test123',
      type: 'message',
      role: 'assistant',
      content: [],
      model: overrides?.model ?? 'claude-sonnet-4-6-20260219',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 0,
      },
    },
  }
}

/**
 * Build a content_block_start event for text
 */
export function buildTextBlockStartEvent(index: number): MockStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'text',
      text: '',
    },
  }
}

/**
 * Build a content_block_delta event for text
 */
export function buildTextDeltaEvent(index: number, text: string): MockStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: {
      type: 'text_delta',
      text,
    },
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
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id: toolId,
      name: toolName,
      input: {},
    },
  }
}

/**
 * Build a content_block_delta event for tool input
 */
export function buildToolInputDeltaEvent(index: number, partialJson: string): MockStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: {
      type: 'input_json_delta',
      partial_json: partialJson,
    },
  }
}

/**
 * Build a content_block_stop event
 */
export function buildContentBlockStopEvent(index: number): MockStreamEvent {
  return {
    type: 'content_block_stop',
    index,
  }
}

/**
 * Build a message_delta event
 */
export function buildMessageDeltaEvent(stopReason: null | string = null): MockStreamEvent {
  return {
    type: 'message_delta',
    delta: {
      type: 'text_delta',
      stop_reason: stopReason,
    },
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
 * Mock Anthropic client that returns pre-configured responses
 */
export class MockAnthropicClient {
  private responses: Map<string, MockStreamEvent[]> = new Map()

  /**
   * Set a response for a specific prompt
   */
  setResponse(promptSubstring: string, events: MockStreamEvent[]): void {
    this.responses.set(promptSubstring, events)
  }

  /**
   * Create a mock messages API
   */
  get messages(): {
    stream: (params: Anthropic.MessageCreateParams) => {
      finalMessage: () => Promise<Anthropic.Message>
      [Symbol.asyncIterator](): AsyncIterator<MockStreamEvent>
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
          [Symbol.asyncIterator](): AsyncIterator<MockStreamEvent> {
            return stream[Symbol.asyncIterator]()
          },
          finalMessage: async () => {
            // Build final message from events
            const content: Anthropic.ContentBlock[] = []
            let stopReason: null | string = null

            for (const event of events) {
              if (event.type === 'content_block_start' && event.content_block) {
                if (event.content_block.type === 'text') {
                  content.push({type: 'text', text: '', citations: []})
                } else if (event.content_block.type === 'tool_use') {
                  content.push({
                    type: 'tool_use',
                    id: event.content_block.id!,
                    name: event.content_block.name!,
                    input: {},
                  } as Anthropic.ContentBlock)
                }
              } else if (event.type === 'content_block_delta' && event.delta) {
                const lastBlock = content[content.length - 1]
                if (event.delta.type === 'text_delta' && lastBlock && lastBlock.type === 'text') {
                  lastBlock.text += event.delta.text ?? ''
                } else if (
                  event.delta.type === 'input_json_delta' &&
                  lastBlock &&
                  lastBlock.type === 'tool_use'
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
              id: 'msg_test123',
              type: 'message',
              role: 'assistant',
              content,
              container: null,
              model: 'claude-sonnet-4-6-20260219',
              stop_reason: stopReason as Anthropic.Message['stop_reason'],
              stop_sequence: null,
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                server_tool_use: null,
                service_tier: null,
                inference_geo: null,
              },
            } as Anthropic.Message
          },
        }
      },
    }
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
 * Mock simple non-streaming message creation
 */
export function mockMessageCreate(
  content: string | {type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; input?: unknown}[],
): Anthropic.Message {
  const contentBlocks: Anthropic.ContentBlock[] = []

  if (typeof content === 'string') {
    contentBlocks.push({type: 'text', text: content, citations: []})
  } else {
    for (const block of content) {
      if (block.type === 'text') {
        contentBlocks.push({type: 'text', text: block.text ?? '', citations: []})
      } else if (block.type === 'tool_use') {
        contentBlocks.push({
          type: 'tool_use',
          id: block.id ?? `toolu_${Math.random().toString(36).substring(7)}`,
          name: block.name ?? 'unknown_tool',
          input: block.input ?? {},
        } as Anthropic.ContentBlock)
      }
    }
  }

  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    container: null,
    model: 'claude-sonnet-4-6-20260219',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    },
  } as Anthropic.Message
}
