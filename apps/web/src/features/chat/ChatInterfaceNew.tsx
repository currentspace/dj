import { useState, useRef, use, Suspense, useCallback, useTransition, startTransition } from 'react'
import { sendChatMessage } from '../../lib/api-client'
import { createPlaylistResource } from '../../lib/playlist-resource'
import { flushSync } from 'react-dom'

interface Message {
  role: 'user' | 'assistant'
  content: string
}


// Playlist selector component that uses Suspense
function PlaylistSelector({
  mode,
  selectedId,
  onSelect
}: {
  mode: string
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (mode !== 'analyze' && mode !== 'edit') {
    return null
  }

  const playlistData = use(createPlaylistResource().promise)
  const playlists = playlistData.items || []

  // Auto-select first playlist if none selected
  if (!selectedId && playlists.length > 0) {
    // Use startTransition to avoid blocking the UI
    startTransition(() => {
      onSelect(playlists[0].id)
    })
  }

  return (
    <label className="playlist-selector">
      Playlist:
      {playlists.length > 0 ? (
        <select
          value={selectedId || ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {playlists.map((playlist: any) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name} ({playlist.tracks.total} tracks)
            </option>
          ))}
        </select>
      ) : (
        <span> No playlists found</span>
      )}
    </label>
  )
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'analyze' | 'create' | 'edit'>('analyze')
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Imperative scroll function - called after state updates
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleModeChange = useCallback((newMode: 'analyze' | 'create' | 'edit') => {
    startTransition(() => {
      setMode(newMode)
      // Reset playlist selection when switching away from analyze/edit
      if (newMode === 'create') {
        setSelectedPlaylistId(null)
      }
    })
  }, [])

  const handlePlaylistSelect = useCallback((id: string) => {
    console.log(`[ChatInterface] Playlist selected: ${id}`)
    setSelectedPlaylistId(id)
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    let userMessage = input.trim()

    // Inject playlist ID for analyze/edit modes
    if ((mode === 'analyze' || mode === 'edit') && selectedPlaylistId) {
      userMessage = `[Playlist ID: ${selectedPlaylistId}] ${userMessage}`
      console.log(`[ChatInterface] Message with playlist: ${userMessage}`)
    }

    const displayMessage = input.trim()

    // Clear input immediately
    setInput('')
    setLoading(true)

    // Update messages and scroll in a single flush for better UX
    flushSync(() => {
      setMessages(prev => [...prev, { role: 'user', content: displayMessage }])
    })
    scrollToBottom()

    try {
      const response = await sendChatMessage(userMessage, messages, mode)

      // Update with response and scroll
      flushSync(() => {
        setMessages(prev => [...prev, { role: 'assistant', content: response.message }])
      })
      scrollToBottom()
    } catch (error) {
      console.error('Chat error:', error)

      let errorMessage = 'Sorry, I encountered an error.'
      if (error instanceof Error) {
        if (error.message.includes('high demand') || error.message.includes('overloaded')) {
          errorMessage = '🔄 Service temporarily busy. Please try again in a moment.'
        } else if (error.message.includes('rate limit')) {
          errorMessage = '⏳ Rate limit reached. Please wait a moment.'
        } else if (error.message.includes('Authentication')) {
          errorMessage = '🔑 Session expired. Please refresh and log in again.'
        } else {
          errorMessage = `Error: ${error.message}`
        }
      }

      flushSync(() => {
        setMessages(prev => [...prev, { role: 'assistant', content: errorMessage }])
      })
      scrollToBottom()
    } finally {
      setLoading(false)
    }
  }, [input, loading, mode, selectedPlaylistId, messages, scrollToBottom])

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>AI DJ Assistant</h2>
        <div className="mode-selector">
          <label>
            Mode:
            <select value={mode} onChange={(e) => handleModeChange(e.target.value as typeof mode)}>
              <option value="analyze">Analyze Music</option>
              <option value="create">Create Playlist</option>
              <option value="edit">Edit Playlist</option>
            </select>
          </label>

          <Suspense fallback={<span className="playlist-selector"> Loading playlists...</span>}>
            <PlaylistSelector
              mode={mode}
              selectedId={selectedPlaylistId}
              onSelect={handlePlaylistSelect}
            />
          </Suspense>
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
          disabled={loading || isPending}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  )
}