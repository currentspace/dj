import type {StreamDebugData, StreamLogData, StreamToolData, StreamToolResult} from '@dj/shared-types'
import type {z} from 'zod'

// Native tool definition (replaces DynamicStructuredTool)
export interface NativeTool {
  description: string
  func: (args: Record<string, unknown>) => Promise<unknown>
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>
}

// Analysis result types
export interface AnalysisResult {
  deezer_analysis?: {
    bpm?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    gain?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    rank?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    source: string
    total_checked: number
    tracks_found: number
  }
  lastfm_analysis?: {
    artists_enriched: number
    avg_listeners: number
    avg_playcount: number
    crowd_tags: {count: number; tag: string}[]
    sample_size: number
    similar_tracks: string[]
    source: string
  }
  message: string
  metadata_analysis: {
    avg_duration_minutes: number
    avg_duration_ms: number
    avg_popularity: number
    explicit_percentage: number
    explicit_tracks: number
    release_year_range: null | {
      average: number
      newest: number
      oldest: number
    }
    top_genres: string[]
    total_artists: number
  }
  playlist_description: null | string
  playlist_name: string
  total_tracks: number
  track_ids: string[]
}

export interface CreatePlaylistResult {
  id: string
  name: string
  snapshot_id: string
  url: string
}

// SSE message types
export type StreamEvent =
  | {data: null; type: 'done'}
  | {data: StreamDebugData; type: 'debug'}
  | {data: StreamLogData; type: 'log'}
  | {data: StreamToolData; type: 'tool_start'}
  | {data: StreamToolResult; type: 'tool_end'}
  | {data: string; type: 'content'}
  | {data: string; type: 'error'}
  | {data: string; type: 'thinking'}

// Deezer analysis data structure
export interface DeezerAnalysisData {
  bpm?: {
    avg: number
    range: {max: number; min: number}
    sample_size: number
  }
  gain?: {
    avg: number
    range: {max: number; min: number}
    sample_size: number
  }
  rank?: {
    avg: number
    range: {max: number; min: number}
    sample_size: number
  }
  source: string
  total_checked: number
  tracks_found: number
}

// Tool call structure from Anthropic
export interface AnthropicToolCall {
  args: Record<string, unknown>
  id: string
  name: string
}
