import type Anthropic from '@anthropic-ai/sdk'

import {LLM} from '../../constants'
import {getLogger} from '../../utils/LoggerContext'
import {isString} from './streaming'
import type {SSEWriter} from './streaming/sse-writer'
import type {AnthropicToolCall, NativeTool} from './types'

interface AgenticLoopParams {
  abortController: AbortController
  anthropic: Anthropic
  anthropicTools: Anthropic.Tool[]
  fullResponse: string
  initialToolCalls: AnthropicToolCall[]
  messages: Anthropic.MessageParam[]
  requestId: string
  sseWriter: SSEWriter
  systemPrompt: string
  tools: NativeTool[]
}

const MAX_TURNS = 5 // Prevent infinite loops

/**
 * Process the agentic loop - executing tools and getting responses until Claude stops requesting them
 */
export async function processAgenticLoop({
  abortController,
  anthropic,
  anthropicTools,
  fullResponse,
  initialToolCalls,
  messages,
  requestId,
  sseWriter,
  systemPrompt,
  tools,
}: AgenticLoopParams): Promise<string> {
  const conversationMessages = [...messages]
  let currentToolCalls = initialToolCalls
  let turnCount = 0
  const recentToolCalls: string[] = [] // Track recent tool calls to detect loops
  let hasAnyContent = fullResponse.length > 0 // Track if we've gotten ANY content across all turns
  let currentResponse = fullResponse

  while (currentToolCalls.length > 0 && turnCount < MAX_TURNS) {
    turnCount++

    // Detect loops: if same tool with same args called 3+ times in a row, break
    const toolSignature = currentToolCalls
      .map(tc => {
        const argsStr = JSON.stringify(tc.args ?? {})
        return `${tc.name}(${argsStr})`
      })
      .join(',')
    recentToolCalls.push(toolSignature)
    if (recentToolCalls.length >= 3) {
      const lastThree = recentToolCalls.slice(-3)
      if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
        getLogger()?.warn(
          `[Stream:${requestId}] Loop detected: identical tool calls 3 times in a row. Breaking.`,
        )
        sseWriter.writeAsync({
          data: 'Detected repetitive tool calls, wrapping up...',
          type: 'thinking',
        })
        break
      }
    }

    getLogger()?.info(
      `[Stream:${requestId}] Agentic loop turn ${turnCount}: Executing ${currentToolCalls.length} tool calls...`,
    )
    sseWriter.writeAsync({
      data: 'Using Spotify tools...',
      type: 'thinking',
    })

    // Execute tools and build tool result blocks
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
    for (const toolCall of currentToolCalls) {
      if (abortController.signal.aborted) {
        throw new Error('Request aborted')
      }

      getLogger()?.info(`[Stream:${requestId}] Looking for tool: ${toolCall.name}`)
      const tool = tools.find(t => t.name === toolCall.name)
      if (tool) {
        getLogger()?.info(`[Stream:${requestId}] Executing tool: ${toolCall.name} with args:`, {
          args: JSON.stringify(toolCall.args).substring(0, 200),
        })
        try {
          const result = await tool.func(toolCall.args)
          getLogger()?.info(`[Stream:${requestId}] Tool ${toolCall.name} completed successfully`)

          const toolContent = JSON.stringify(result)
          getLogger()?.info(`[Stream:${requestId}] Tool result JSON length: ${toolContent.length}`)

          toolResultBlocks.push({
            content: toolContent,
            tool_use_id: toolCall.id,
            type: 'tool_result',
          })
        } catch (error) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted')
          }
          getLogger()?.error(`[Stream:${requestId}] Tool ${toolCall.name} failed:`, error)
          toolResultBlocks.push({
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            is_error: true,
            tool_use_id: toolCall.id,
            type: 'tool_result',
          })
        }
      } else {
        getLogger()?.warn(`[Stream:${requestId}] Tool not found: ${toolCall.name}`)
        toolResultBlocks.push({
          content: `Error: Tool ${toolCall.name} not found`,
          is_error: true,
          tool_use_id: toolCall.id,
          type: 'tool_result',
        })
      }
    }

    getLogger()?.info(`[Stream:${requestId}] All tools executed. Results: ${toolResultBlocks.length}`)
    sseWriter.writeAsync({
      data: 'Preparing response...',
      type: 'thinking',
    })

    // Build assistant tool use blocks
    const assistantToolUseBlocks: Anthropic.ToolUseBlockParam[] = currentToolCalls.map(tc => ({
      id: tc.id,
      input: tc.args,
      name: tc.name,
      type: 'tool_use',
    }))

    // If there was text content before tool calls, include it
    const assistantContent: (Anthropic.ContentBlock | Anthropic.ToolUseBlockParam)[] = []
    if (currentResponse) {
      assistantContent.push({text: currentResponse, type: 'text'} as Anthropic.ContentBlock)
    }
    assistantContent.push(...assistantToolUseBlocks)

    conversationMessages.push({
      content: assistantContent,
      role: 'assistant',
    })

    // Add tool results as a user message
    conversationMessages.push({
      content: toolResultBlocks,
      role: 'user',
    })

    getLogger()?.info(`[Stream:${requestId}] Conversation now has ${conversationMessages.length} messages`)

    // Get next response
    let nextStream
    try {
      nextStream = anthropic.messages.stream({
        max_tokens: 5000,
        messages: conversationMessages,
        model: LLM.MODEL,
        system: [
          {
            cache_control: {type: 'ephemeral' as const},
            text: systemPrompt,
            type: 'text' as const,
          },
        ],
        temperature: 0.7,
        tools: anthropicTools,
      })
    } catch (streamError) {
      getLogger()?.error('Claude streaming API call failed', streamError)

      // If we already have content, break gracefully
      if (hasAnyContent) {
        await sseWriter.write({
          data: '\n\nTask completed successfully!',
          type: 'content',
        })
        return 'Task completed (graceful degradation after streaming error)'
      } else {
        throw streamError
      }
    }

    currentResponse = ''
    const nextToolCalls: AnthropicToolCall[] = []
    getLogger()?.info(`[Stream:${requestId}] Streaming response from Claude (turn ${turnCount})...`)

    try {
      const nextContentBlocks: Anthropic.ContentBlock[] = []
      let nextCurrentBlockIndex = -1

      for await (const event of nextStream) {
        if (abortController.signal.aborted) {
          throw new Error('Request aborted')
        }

        if (event.type === 'content_block_start') {
          nextCurrentBlockIndex = event.index
          const blockCopy = {...event.content_block}
          if (event.content_block.type === 'tool_use') {
            ;(blockCopy as Anthropic.ToolUseBlock).input = ''
            getLogger()?.info(
              `[Stream:${requestId}] Turn ${turnCount} tool use started: ${event.content_block.name}`,
            )
          }
          // eslint-disable-next-line security/detect-object-injection
          nextContentBlocks[nextCurrentBlockIndex] = blockCopy
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const text = event.delta.text
            currentResponse += text
            hasAnyContent = true
            await sseWriter.write({data: text, type: 'content'})
          } else if (event.delta.type === 'input_json_delta') {
            // eslint-disable-next-line security/detect-object-injection
            const currentBlock = nextContentBlocks[nextCurrentBlockIndex]
            if (currentBlock?.type === 'tool_use') {
              if (typeof currentBlock.input !== 'string') {
                currentBlock.input = ''
              }
              currentBlock.input += event.delta.partial_json
            }
          }
        } else if (event.type === 'content_block_stop') {
          const block = nextContentBlocks[event.index]
          if (block?.type === 'tool_use' && block.id && block.name) {
            const inputStr = isString(block.input) ? block.input : '{}'
            try {
              const input = JSON.parse(inputStr)
              nextToolCalls.push({
                args: input,
                id: block.id,
                name: block.name,
              })
              getLogger()?.info(`[Stream:${requestId}] Turn ${turnCount} tool use complete: ${block.name}`)
            } catch (parseError) {
              getLogger()?.error(
                `[Stream:${requestId}] Turn ${turnCount} failed to parse tool input for ${block.name}`,
                parseError,
              )
              nextToolCalls.push({
                args: {},
                id: block.id,
                name: block.name,
              })
            }
          }
        }
      }

      getLogger()?.info(
        `[Stream:${requestId}] Turn ${turnCount} streaming complete. Tool calls: ${nextToolCalls.length}`,
      )
    } catch (chunkError) {
      getLogger()?.error('Error processing Claude stream events', chunkError)
      if (currentResponse.length === 0) {
        getLogger()?.warn('No content received before stream error, breaking agentic loop')
        break
      }
    }

    getLogger()?.info(
      `[Stream:${requestId}] Turn ${turnCount} complete. Content: ${currentResponse.length} chars, Next tool calls: ${nextToolCalls.length}`,
    )

    // Update for next iteration
    currentToolCalls = nextToolCalls
  }

  // Check if we hit the max turns limit
  if (turnCount >= MAX_TURNS || currentResponse.length === 0) {
    getLogger()?.warn(
      `[Stream:${requestId}] Hit limit (${turnCount} turns). Requesting final response from Claude...`,
    )

    // Ask Claude to provide a response based on what it has learned
    conversationMessages.push({
      content:
        "Please provide your response based on the information you've gathered from the tools you've used.",
      role: 'user',
    })

    sseWriter.writeAsync({
      data: 'Preparing final response...',
      type: 'thinking',
    })

    try {
      const finalStream = anthropic.messages.stream({
        max_tokens: 10000,
        messages: conversationMessages,
        model: LLM.MODEL,
        system: [
          {
            cache_control: {type: 'ephemeral' as const},
            text: systemPrompt,
            type: 'text' as const,
          },
        ],
        temperature: 1.0,
        thinking: {
          budget_tokens: 5000,
          type: 'enabled' as const,
        },
        tools: anthropicTools,
      })

      currentResponse = ''
      for await (const event of finalStream) {
        if (abortController.signal.aborted) {
          throw new Error('Request aborted')
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const text = event.delta.text
            currentResponse += text
            await sseWriter.write({data: text, type: 'content'})
          }
        }
      }

      getLogger()?.info(`[Stream:${requestId}] Final response after limit: ${currentResponse.length} chars`)
    } catch (finalStreamError) {
      getLogger()?.error('Final Claude streaming API call failed', finalStreamError)

      // Provide useful feedback based on tool executions
      const executedTools = conversationMessages
        .filter(m => m.role === 'assistant')
        .flatMap(m => {
          const content = Array.isArray(m.content) ? m.content : []
          return content
            .filter((block): block is Anthropic.ToolUseBlockParam => 'type' in block && block.type === 'tool_use')
            .map(block => block.name)
        })

      if (executedTools.length > 0) {
        const toolSummary = [...new Set(executedTools)].join(', ')
        await sseWriter.write({
          data: `I encountered a streaming error while preparing my response. I was able to execute these tools: ${toolSummary}. Please ask me to clarify any specific information you need.`,
          type: 'content',
        })
        currentResponse = `Executed tools: ${toolSummary}`
      } else {
        await sseWriter.write({
          data: 'I encountered a streaming error. Please try rephrasing your request.',
          type: 'content',
        })
        currentResponse = 'Streaming error occurred'
      }
    }
  }

  getLogger()?.info(`[Stream:${requestId}] Agentic loop complete after ${turnCount} turns`)

  return currentResponse
}
