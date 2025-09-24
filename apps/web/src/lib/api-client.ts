import type { ChatMessage } from '@dj/shared-types'
import { z } from 'zod'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

// Zod schemas for runtime validation
const SpotifyPlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  external_urls: z.object({ spotify: z.string() }),
  images: z.array(z.object({
    url: z.string(),
    height: z.number(),
    width: z.number()
  })),
  tracks: z.object({ total: z.number() }),
  public: z.boolean(),
  owner: z.object({ display_name: z.string() })
})

const PlaylistsResponseSchema = z.object({
  items: z.array(SpotifyPlaylistSchema)
})

type PlaylistsResponse = z.infer<typeof PlaylistsResponseSchema>

export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
  mode: 'analyze' | 'create' | 'edit'
) {
  const token = localStorage.getItem('spotify_token')

  const response = await fetch(`${API_BASE}/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    body: JSON.stringify({
      message,
      mode,
      history
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || `Chat failed: ${response.statusText}`)
  }

  return response.json()
}

export async function getUserPlaylists(): Promise<PlaylistsResponse> {
  const token = localStorage.getItem('spotify_token')

  if (!token) {
    throw new Error('Not authenticated with Spotify')
  }

  const response = await fetch(`${API_BASE}/spotify/playlists`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch playlists: ${response.statusText}`)
  }

  const data = await response.json()
  return PlaylistsResponseSchema.parse(data)
}

interface StreamEvent {
  type: string;
  data: unknown;
}

export async function streamChatMessage(
  message: string,
  history: ChatMessage[],
  mode: 'analyze' | 'create' | 'edit',
  onEvent: (event: StreamEvent) => void
) {
  const token = localStorage.getItem('spotify_token')

  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    body: JSON.stringify({
      message,
      mode,
      history
    })
  })

  if (!response.ok) {
    throw new Error(`Stream failed: ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')

    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') {
          return
        }
        try {
          const event = JSON.parse(data)
          onEvent(event)
        } catch (e) {
          console.error('Failed to parse SSE event:', e)
        }
      }
    }
  }
}