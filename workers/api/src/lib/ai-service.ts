/**
 * AI Service - Centralized Claude/Anthropic integration
 *
 * Provides common utilities for AI-powered features across the app:
 * - Client management
 * - Response parsing
 * - Prompt templates
 */

import Anthropic from '@anthropic-ai/sdk'
import { LLM } from '../constants'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// TYPE GUARDS
// =============================================================================

/** Type guard for thinking blocks in Claude's response */
function isThinkingBlock(block: Anthropic.ContentBlock): block is Anthropic.ContentBlock & { type: 'thinking'; thinking: string } {
  return block.type === 'thinking' && 'thinking' in block && typeof (block as unknown as Record<string, unknown>).thinking === 'string'
}

// =============================================================================
// TYPES
// =============================================================================

/** Request parameters for Anthropic messages API with optional thinking */
interface AnthropicRequestParams {
  model: string
  max_tokens: number
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  temperature?: number
  system?: string
  thinking?: {
    type: 'enabled'
    budget_tokens: number
  }
}

export interface AIServiceConfig {
  apiKey: string
  defaultModel?: string
  defaultTemperature?: number
}

export interface AIRequestOptions {
  /** Override the default model */
  model?: string
  /** Temperature for response creativity (0-1) */
  temperature?: number
  /** Maximum tokens in response */
  maxTokens?: number
  /** System prompt */
  system?: string
  /** Enable extended thinking (budget tokens for reasoning) */
  thinkingBudget?: number
}

export interface AIResponse {
  data: unknown
  error: string | null
  rawText: string
  /** Extended thinking content (if enabled) */
  thinking?: string
  /** Token usage stats */
  usage?: {
    inputTokens: number
    outputTokens: number
    thinkingTokens?: number
  }
}

// =============================================================================
// AI SERVICE CLASS
// =============================================================================

export class AIService {
  private client: Anthropic
  private defaultModel: string
  private defaultTemperature: number

  constructor(config: AIServiceConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
    this.defaultModel = config.defaultModel || LLM.MODEL
    this.defaultTemperature = config.defaultTemperature || 0.7
  }

  /**
   * Send a prompt to Claude and get a JSON response
   * Supports extended thinking when thinkingBudget is provided
   */
  async promptForJSON(prompt: string, options: AIRequestOptions = {}): Promise<AIResponse> {
    try {
      // Build request parameters
      const useThinking = options.thinkingBudget && options.thinkingBudget > 0
      const model = options.model || this.defaultModel

      // Build request parameters with proper typing
      const messages: AnthropicRequestParams['messages'] = [{ role: 'user', content: prompt }]

      const requestParams: AnthropicRequestParams = {
        model,
        max_tokens: options.maxTokens || 2000,
        messages,
      }

      if (useThinking) {
        // Extended thinking mode - no temperature, uses thinking block
        requestParams.thinking = {
          type: 'enabled',
          budget_tokens: options.thinkingBudget!,
        }
        // System prompt goes in messages for thinking mode
        if (options.system) {
          messages.unshift({
            role: 'user',
            content: `[System]: ${options.system}`,
          })
        }
      } else {
        // Standard mode
        requestParams.temperature = options.temperature ?? this.defaultTemperature
        requestParams.system = options.system || 'You are an AI assistant. Return only valid JSON.'
      }

      const response = await this.client.messages.create(requestParams)

      // Extract text and thinking from response blocks
      let rawText = ''
      let thinking = ''

      for (const block of response.content) {
        if (block.type === 'text') {
          rawText += block.text
        } else if (isThinkingBlock(block)) {
          thinking += block.thinking
        }
      }

      // Parse JSON from response
      const data = this.extractJSON(rawText)

      // Build usage stats
      const usage = {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        thinkingTokens: thinking ? thinking.split(/\s+/).length : undefined,
      }

      // Log thinking if enabled (for prompt optimization analysis)
      if (thinking) {
        getLogger()?.info('[AIService] Extended thinking captured', {
          thinkingLength: thinking.length,
          thinkingTokens: usage.thinkingTokens,
        })
      }

      return {
        data,
        error: data === null ? 'Failed to parse JSON from response' : null,
        rawText,
        thinking: thinking || undefined,
        usage,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      getLogger()?.error('[AIService] API call failed:', errorMessage)

      return {
        data: null,
        error: errorMessage,
        rawText: '',
      }
    }
  }

  /**
   * Send a prompt and get a text response (no JSON parsing)
   */
  async promptForText(prompt: string, options: AIRequestOptions = {}): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || 2000,
        temperature: options.temperature ?? this.defaultTemperature,
        system: options.system || 'You are an AI assistant.',
        messages: [{ role: 'user', content: prompt }],
      })

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')
    } catch (error) {
      getLogger()?.error('[AIService] API call failed:', error)
      return ''
    }
  }

  /**
   * Extract JSON from a text response (handles markdown code blocks, etc.)
   *
   * Returns `unknown` — callers MUST validate with Zod schemas before use.
   */
  extractJSON(text: string): unknown {
    try {
      const jsonMatch = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text)
      if (!jsonMatch) {
        getLogger()?.warn('[AIService] No JSON found in response')
        return null
      }

      return JSON.parse(jsonMatch[0]) as unknown
    } catch (error) {
      getLogger()?.error('[AIService] JSON parse error:', error)
      return null
    }
  }
}

// =============================================================================
// SINGLETON FACTORY
// =============================================================================

let aiServiceInstance: AIService | null = null

/**
 * Get or create the AI service instance
 */
export function getAIService(apiKey?: string): AIService | null {
  if (aiServiceInstance) {
    return aiServiceInstance
  }

  if (!apiKey) {
    return null
  }

  aiServiceInstance = new AIService({ apiKey })
  return aiServiceInstance
}

/**
 * Create a new AI service instance (for when you need fresh config)
 */
export function createAIService(config: AIServiceConfig): AIService {
  return new AIService(config)
}
