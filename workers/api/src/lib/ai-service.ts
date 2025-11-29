/**
 * AI Service - Centralized Claude/Anthropic integration
 *
 * Provides common utilities for AI-powered features across the app:
 * - Client management
 * - Response parsing
 * - Prompt templates
 */

import Anthropic from '@anthropic-ai/sdk'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// TYPES
// =============================================================================

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

export interface AIResponse<T> {
  data: T | null
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
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-5-20250929'
    this.defaultTemperature = config.defaultTemperature || 0.7
  }

  /**
   * Send a prompt to Claude and get a JSON response
   * Supports extended thinking when thinkingBudget is provided
   */
  async promptForJSON<T>(prompt: string, options: AIRequestOptions = {}): Promise<AIResponse<T>> {
    try {
      // Build request parameters
      const useThinking = options.thinkingBudget && options.thinkingBudget > 0
      const model = options.model || this.defaultModel

      // Extended thinking requires specific model and parameters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestParams: any = {
        model,
        max_tokens: options.maxTokens || 2000,
        messages: [{ role: 'user', content: prompt }],
      }

      if (useThinking) {
        // Extended thinking mode - no temperature, uses thinking block
        requestParams.thinking = {
          type: 'enabled',
          budget_tokens: options.thinkingBudget,
        }
        // System prompt goes in messages for thinking mode
        if (options.system) {
          requestParams.messages.unshift({
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
        } else if (block.type === 'thinking') {
          thinking += (block as { type: 'thinking'; thinking: string }).thinking
        }
      }

      // Parse JSON from response
      const data = this.extractJSON<T>(rawText)

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
   */
  extractJSON<T>(text: string): T | null {
    try {
      // Try to find JSON object or array
      const jsonMatch = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text)
      if (!jsonMatch) {
        getLogger()?.warn('[AIService] No JSON found in response')
        return null
      }

      return JSON.parse(jsonMatch[0]) as T
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
