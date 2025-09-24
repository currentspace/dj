import { useState, useRef, useEffect } from 'react'
import { sendChatMessage, getUserPlaylists } from '../lib/api-client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Playlist {
  id: string
  name: string
  description: string | null
  images: Array<{ url: string }>
  tracks: { total: number }
  owner: { display_name: string }
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'analyze' | 'create' | 'edit'>('analyze') // Default to analyze to test
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log('[ChatInterface] Component initialized with mode:', mode)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Debug selectedPlaylistId changes
  useEffect(() => {
    console.log(`[ChatInterface] 🎯 selectedPlaylistId changed to: "${selectedPlaylistId}"`)
  }, [selectedPlaylistId])

  // Load user playlists when mode changes to analyze or edit
  useEffect(() => {
    console.log(`[ChatInterface] Mode changed to: ${mode}`)
    if (mode === 'analyze' || mode === 'edit') {
      console.log(`[ChatInterface] Mode requires playlists, loading...`)
      loadPlaylists()
    }
  }, [mode])

  const loadPlaylists = async () => {
    if (playlists.length > 0) {
      console.log('[ChatInterface] Playlists already loaded:', playlists.length)
      // Even if loaded, make sure we have a selection
      if (!selectedPlaylistId && playlists.length > 0) {
        const firstId = playlists[0].id
        console.log(`[ChatInterface] No playlist selected, auto-selecting: ${firstId}`)
        setSelectedPlaylistId(firstId)
      }
      return
    }

    console.log('[ChatInterface] Loading user playlists...')
    setLoadingPlaylists(true)
    try {
      const userPlaylists = await getUserPlaylists()
      console.log('[ChatInterface] API returned playlists:', userPlaylists)
      const items = userPlaylists.items || []
      console.log('[ChatInterface] Loaded playlists count:', items.length)

      if (items.length > 0) {
        console.log('[ChatInterface] First playlist:', items[0])
      }

      setPlaylists(items)

      // Auto-select first playlist if available
      if (items.length > 0) {
        const firstId = items[0].id
        console.log(`[ChatInterface] Setting selectedPlaylistId to: "${firstId}" - ${items[0].name}`)
        setSelectedPlaylistId(firstId)

        // Force a re-render to ensure state is updated
        setTimeout(() => {
          console.log(`[ChatInterface] Verify selectedPlaylistId after setState: "${selectedPlaylistId}"`)
        }, 100)
      } else {
        console.warn('[ChatInterface] No playlists available to select')
      }
    } catch (error) {
      console.error('[ChatInterface] Failed to load playlists:', error)
    } finally {
      setLoadingPlaylists(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    let userMessage = input.trim()

    // If analyzing or editing a playlist, include the playlist ID in the message
    console.log(`[ChatInterface] Pre-injection check - Mode: ${mode}, Selected ID: "${selectedPlaylistId}", Type: ${typeof selectedPlaylistId}`)

    if ((mode === 'analyze' || mode === 'edit') && selectedPlaylistId && selectedPlaylistId.trim() !== '') {
      // Inject playlist ID into the message for context
      userMessage = `[Playlist ID: ${selectedPlaylistId}] ${userMessage}`
      console.log(`[ChatInterface] ✅ Injecting playlist ID: ${selectedPlaylistId}`)
      console.log(`[ChatInterface] Full message: ${userMessage}`)
    } else {
      console.log(`[ChatInterface] ❌ No playlist ID to inject. Mode: ${mode}, Selected ID: "${selectedPlaylistId}"`)
      if (mode === 'analyze' || mode === 'edit') {
        console.warn(`[ChatInterface] WARNING: In ${mode} mode but no playlist selected!`)
      }
    }

    setInput('')
    setLoading(true)

    // Add user message to chat (without the injected ID for display)
    const displayMessage = input.trim()
    const newMessages = [...messages, { role: 'user' as const, content: displayMessage }]
    setMessages(newMessages)

    try {
      const response = await sendChatMessage(userMessage, messages, mode)

      // Check if this was a fallback response
      if (response.fallbackMode) {
        console.warn('Using fallback mode due to service overload')
      }

      // Add assistant response to chat
      setMessages([...newMessages, {
        role: 'assistant',
        content: response.message
      }])
    } catch (error) {
      console.error('Chat error:', error)

      let errorMessage = 'Sorry, I encountered an error.'
      let isRetryable = false

      // Check if it's an API response error with details
      if (error instanceof Error && error.message.includes('high demand')) {
        errorMessage = `🔄 **Service Temporarily Busy**\n\nThe AI service is experiencing high demand right now. This is temporary and usually resolves within a minute.\n\n**What you can do:**\n• Wait about 30 seconds and try again\n• Your message is saved above - just click Send again\n• This typically clears up quickly during peak times`
        isRetryable = true
      } else if (error instanceof Error) {
        if (error.message.includes('overloaded') || error.message.includes('503')) {
          errorMessage = `🔄 **Service Temporarily Unavailable**\n\nThe AI DJ is taking a quick break due to high demand.\n\n• Please try again in about 30 seconds\n• Your conversation is saved\n• This usually resolves quickly!`
          isRetryable = true
        } else if (error.message.includes('rate limit') || error.message.includes('429')) {
          errorMessage = '⏳ **Rate Limit Reached**\n\nYou\'re sending messages too quickly. Please wait about 10 seconds before trying again.'
          isRetryable = true
        } else if (error.message.includes('Authentication')) {
          errorMessage = '🔑 **Session Expired**\n\nYour Spotify session has expired. Please refresh the page and log in again.'
        } else {
          errorMessage = `Sorry, I encountered an error: ${error.message}`
        }
      }

      // Add retry hint if applicable
      if (isRetryable && !loading) {
        setTimeout(() => {
          // Re-enable the input after suggested wait time
          setLoading(false)
        }, 5000)
      }

      setMessages([...newMessages, {
        role: 'assistant',
        content: errorMessage
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>AI DJ Assistant</h2>
        <div className="mode-selector">
          <label>
            Mode:
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="analyze">Analyze Music</option>
              <option value="create">Create Playlist</option>
              <option value="edit">Edit Playlist</option>
            </select>
          </label>

          {(mode === 'analyze' || mode === 'edit') && (
            <label className="playlist-selector">
              Playlist:
              {loadingPlaylists ? (
                <span> Loading...</span>
              ) : playlists.length > 0 ? (
                <select
                  value={selectedPlaylistId || ''}
                  onChange={(e) => {
                    const newId = e.target.value
                    console.log(`[ChatInterface] Playlist selection changed to: ${newId}`)
                    setSelectedPlaylistId(newId)
                  }}
                >
                  {playlists.map(playlist => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name} ({playlist.tracks.total} tracks)
                    </option>
                  ))}
                </select>
              ) : (
                <span> No playlists found</span>
              )}
            </label>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>Hi! I'm your AI DJ assistant. I can help you:</p>
            <ul>
              <li>🎵 Analyze tracks and artists</li>
              <li>📝 Create custom playlists</li>
              <li>✏️ Edit existing playlists</li>
            </ul>
            <p>What kind of music are you in the mood for today?</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-role">
              {message.role === 'user' ? '👤' : '🎧'}
            </div>
            <div className="message-content">
              {message.content.includes('**') ? (
                <div dangerouslySetInnerHTML={{
                  __html: message.content
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br />')
                    .replace(/• /g, '&bull; ')
                }} />
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="message assistant loading">
            <div className="message-role">🎧</div>
            <div className="message-content">
              <span className="typing-indicator">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === 'create'
              ? "Describe the playlist you want to create..."
              : mode === 'analyze'
              ? "Ask me about any song, artist, or genre..."
              : "Tell me which playlist to edit and how..."
          }
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  )
}