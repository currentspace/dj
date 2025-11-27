import {z} from 'zod'

import {executeSpotifyTool} from '../../../lib/spotify-tools'
import type {SSEWriter} from '../streaming/sse-writer'
import type {NativeTool} from '../types'
import type {Env} from '../../../index'

/**
 * Create search-related Spotify tools
 */
export function createSearchTools(
  spotifyToken: string,
  sseWriter: SSEWriter,
  abortSignal?: AbortSignal,
  env?: Env,
): NativeTool[] {
  return [
    {
      description:
        'Search Spotify catalog for tracks by query string. Returns compact track info (name, artists, album, popularity, URI). Use for finding specific songs, artists, or exploring genre searches. Query can include track names, artist names, album names, or genre filters.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'search_spotify_tracks'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

        await sseWriter.write({
          data: {
            result: Array.isArray(result) ? `Found ${result.length} tracks` : 'Search complete',
            tool: 'search_spotify_tracks',
          },
          type: 'tool_end',
        })

        return result
      },
      name: 'search_spotify_tracks',
      schema: z.object({
        limit: z.number().min(1).max(50).default(10),
        query: z.string(),
      }),
    },
  ]
}
