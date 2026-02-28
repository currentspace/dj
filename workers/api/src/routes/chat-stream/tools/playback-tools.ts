import {z} from 'zod'

import type {Env} from '../../../index'
import type {SSEWriter} from '../streaming/sse-writer'
import type {NativeTool} from '../types'

import {executeSpotifyTool} from '../../../lib/spotify-tools'
import {isString} from '../streaming/anthropic-utils'

/**
 * Create playback-related Spotify tools (DJ mode)
 */
export function createPlaybackTools(
  spotifyToken: string,
  sseWriter: SSEWriter,
  abortSignal?: AbortSignal,
  env?: Env,
): NativeTool[] {
  return [
    {
      description: "Add a track to the user's playback queue. Use when user asks to queue a song or add something to play next.",
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'add_to_queue'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('add_to_queue', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

        await sseWriter.write({
          data: {result: 'Track added to queue', tool: 'add_to_queue'},
          type: 'tool_end',
        })

        return result
      },
      name: 'add_to_queue',
      schema: z.object({
        uri: z.string().describe('Spotify track URI (format: spotify:track:xxx)'),
      }),
    },
    {
      description: "Get what is currently playing on the user's Spotify. Returns track name, artist, progress.",
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'get_now_playing'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('get_now_playing', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

        await sseWriter.write({
          data: {result: 'Got current playback', tool: 'get_now_playing'},
          type: 'tool_end',
        })

        return result
      },
      name: 'get_now_playing',
      schema: z.object({}),
    },
    {
      description: "Get the user's current playback queue - shows what's playing now and upcoming tracks.",
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'get_queue'},
          type: 'tool_start',
        })

        const result = (await executeSpotifyTool('get_queue', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)) as {
          queue_length: number
        }

        await sseWriter.write({
          data: {result: `Queue has ${result.queue_length} tracks`, tool: 'get_queue'},
          type: 'tool_end',
        })

        return result
      },
      name: 'get_queue',
      schema: z.object({}),
    },
    {
      description: 'Control playback: play, pause, skip to next track, or go to previous track.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'control_playback'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('control_playback', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

        await sseWriter.write({
          data: {result: `Playback ${isString(args.action) ? args.action : 'action'} executed`, tool: 'control_playback'},
          type: 'tool_end',
        })

        return result
      },
      name: 'control_playback',
      schema: z.object({
        action: z.enum(['play', 'pause', 'next', 'previous']).describe('The playback action to perform'),
      }),
    },
  ]
}
