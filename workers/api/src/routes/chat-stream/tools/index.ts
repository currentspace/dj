import type {Env} from '../../../index'
import type {ProgressNarrator} from '../../../lib/progress-narrator'
import type {SSEWriter} from '../streaming/sse-writer'
import type {NativeTool} from '../types'

import {createDiscoveryTools} from './discovery-tools'
import {createPlaybackTools} from './playback-tools'
import {createPlaylistTools} from './playlist-tools'
import {createSearchTools} from './search-tools'

export {createDiscoveryTools} from './discovery-tools'
export {createPlaybackTools} from './playback-tools'
export {createPlaylistTools} from './playlist-tools'
export {createSearchTools} from './search-tools'

/**
 * Create all streaming Spotify tools with callbacks
 */
export function createStreamingSpotifyTools(
  spotifyToken: string,
  sseWriter: SSEWriter,
  contextPlaylistId?: string,
  mode?: string,
  abortSignal?: AbortSignal,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[],
): NativeTool[] {
  const tools: NativeTool[] = [
    ...createSearchTools(spotifyToken, sseWriter, abortSignal, env),
    ...createPlaylistTools(
      spotifyToken,
      sseWriter,
      contextPlaylistId,
      mode,
      abortSignal,
      env,
      narrator,
      userRequest,
      recentMessages,
    ),
    ...createDiscoveryTools(sseWriter, abortSignal, env),
    ...createPlaybackTools(spotifyToken, sseWriter, abortSignal, env),
  ]

  return tools
}
