const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function sendChatMessage(
  message: string,
  history: Message[],
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

export async function getUserPlaylists() {
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

  return response.json()
}

export async function streamChatMessage(
  message: string,
  history: Message[],
  mode: 'analyze' | 'create' | 'edit',
  onEvent: (event: any) => void
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