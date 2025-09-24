/**
 * Internal MCP Client that uses direct function calls instead of HTTP
 * This avoids the Cloudflare Workers limitation where workers cannot fetch their own URLs
 */

import { executeSpotifyTool, spotifyTools } from './spotify-tools';
import type { Env } from '../index';

export interface InternalMCPTool {
  name: string;
  description: string;
  parameters: any;
  func: (args: any) => Promise<any>;
}

/**
 * Creates internal MCP tools that can be used with LangChain
 * These tools bypass HTTP and call the functions directly
 */
export function createInternalMCPTools(spotifyToken: string): InternalMCPTool[] {
  return Object.entries(spotifyTools).map(([name, definition]) => ({
    name,
    description: definition.description,
    parameters: definition.inputSchema,
    func: async (args: any) => {
      console.log(`[InternalMCP] Executing tool: ${name}`);
      console.log(`[InternalMCP] Arguments:`, args);

      try {
        const result = await executeSpotifyTool(name, args, spotifyToken);
        console.log(`[InternalMCP] Tool ${name} completed successfully`);
        return result;
      } catch (error) {
        console.error(`[InternalMCP] Tool ${name} failed:`, error);
        throw error;
      }
    }
  }));
}

/**
 * Convert internal MCP tools to LangChain-compatible tools
 */
export function toLangChainTools(internalTools: InternalMCPTool[]): any[] {
  return internalTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    schema: tool.parameters,
    func: tool.func,
    // LangChain expects these properties
    call: tool.func,
    invoke: tool.func,
    _call: tool.func
  }));
}