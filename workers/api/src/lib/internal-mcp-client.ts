/**
 * Internal MCP Client that uses direct function calls instead of HTTP
 * This avoids the Cloudflare Workers limitation where workers cannot fetch their own URLs
 */

import { DynamicStructuredTool } from '@langchain/core/tools'

import type { Env } from '../index'

import { executeSpotifyTool, spotifyTools } from './spotify-tools'

export interface InternalMCPTool {
  description: string
  func: (args: any) => Promise<any>
  name: string
  parameters: any
}

/**
 * Creates internal MCP tools that can be used with LangChain
 * These tools bypass HTTP and call the functions directly
 */
export function createInternalMCPTools(spotifyToken: string): InternalMCPTool[] {
  return Object.entries(spotifyTools).map(([name, definition]) => ({
    description: definition.description,
    func: async (args: any) => {
      console.log(`[InternalMCP] Executing tool: ${name}`)
      console.log(`[InternalMCP] Arguments:`, args)

      try {
        const result = await executeSpotifyTool(name, args, spotifyToken)
        console.log(`[InternalMCP] Tool ${name} completed successfully`)
        return result
      } catch (error) {
        console.error(`[InternalMCP] Tool ${name} failed:`, error)
        throw error
      }
    },
    name,
    parameters: definition.inputSchema,
  }))
}

/**
 * Convert internal MCP tools to LangChain-compatible tools
 */
export function toLangChainTools(internalTools: InternalMCPTool[]): any[] {
  return internalTools.map(
    tool =>
      new DynamicStructuredTool({
        description: tool.description,
        func: tool.func,
        name: tool.name,
        // Add required properties
        returnDirect: false,
        schema: tool.parameters,
        verbose: false,
      }),
  )
}
