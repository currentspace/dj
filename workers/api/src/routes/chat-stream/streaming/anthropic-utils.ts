import type Anthropic from '@anthropic-ai/sdk'
import {z} from 'zod'

import type {NativeTool} from '../types'

// Type guards for runtime type checking of unknown values
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * Convert NativeTool to Anthropic tool format
 */
export function convertToAnthropicTools(tools: NativeTool[]): Anthropic.Tool[] {
  return tools.map(tool => {
    const jsonSchema = z.toJSONSchema(tool.schema) as Record<string, unknown>

    // Extract properties with type guard
    const properties = isObject(jsonSchema.properties) ? jsonSchema.properties : {}

    // Extract required with type guard
    const required = isStringArray(jsonSchema.required) ? jsonSchema.required : []

    return {
      description: tool.description,
      input_schema: {
        properties,
        required,
        type: 'object' as const,
      },
      name: tool.name,
    }
  })
}
