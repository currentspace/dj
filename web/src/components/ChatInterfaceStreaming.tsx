import { useState, useRef, use, Suspense, useCallback, useTransition, startTransition } from 'react'
import { chatStreamClient } from '../lib/streaming-client'
import { createPlaylistResource } from '../lib/playlist-resource'
import { flushSync } from 'react-dom'

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

interface StreamingStatus {
  isStreaming: boolean
  currentAction?: string
  currentTool?: string
  toolsUsed: string[]
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
  )
}

// Tool status display component
function StreamingStatusDisplay({ status }: { status: StreamingStatus }) {
  if (!status.isStreaming) return null

  return (
    <div className="streaming-status">
      {status.currentAction && (
        <div className="status-action">
          <span className="status-icon">💭</span>
          <span>{status.currentAction}</span>
        </div>
      )}
      {status.currentTool && (
        <div className="status-tool">
          <span className="status-icon">🔧</span>
          <span>Using: {status.currentTool}</span>
        </div>
      )}
      {status.toolsUsed.length > 0 && (
        <div className="status-tools-used">
          <span className="status-icon">✅</span>
          <span>Completed: {status.toolsUsed.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

export function ChatInterfaceStreaming() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'analyze' | 'create' | 'edit'>('analyze')
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>({
    isStreaming: false,
    toolsUsed: []
  })
  const [currentStreamContent, setCurrentStreamContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleModeChange = useCallback((newMode: 'analyze' | 'create' | 'edit') => {
    startTransition(() => {
      setMode(newMode)
      if (newMode === 'create') {
        setSelectedPlaylistId(null)
      }
    })
  }, [])

  const handlePlaylistSelect = useCallback((id: string) => {
    setSelectedPlaylistId(id)
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || streamingStatus.isStreaming) return

    let userMessage = input.trim()

    // Inject playlist ID for analyze/edit modes
    if ((mode === 'analyze' || mode === 'edit') && selectedPlaylistId) {
      userMessage = `[Playlist ID: ${selectedPlaylistId}] ${userMessage}`
    }

    const displayMessage = input.trim()

    // Clear input and reset streaming state
    setInput('')
    setStreamingStatus({
      isStreaming: true,
      currentAction: 'Processing your request...',
      toolsUsed: []
    })
    setCurrentStreamContent('')

    // Add user message
    flushSync(() => {
      setMessages(prev => [...prev, { role: 'user', content: displayMessage }])
    })
    scrollToBottom()

    // Stream the response
    await chatStreamClient.streamMessage(
      userMessage,
      messages,
      mode,
      {
        onThinking: (message) => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: message,
            currentTool: undefined
          }))
        },

        onToolStart: (tool, args) => {
          setStreamingStatus(prev => ({
            ...prev,
            currentTool: tool,
            currentAction: `Running ${tool}...`
          }))
        },

        onToolEnd: (tool, result) => {
          setStreamingStatus(prev => ({
            ...prev,
            currentTool: undefined,
            toolsUsed: [...prev.toolsUsed, tool],
            currentAction: result
          }))
        },

        onContent: (content) => {
          setCurrentStreamContent(prev => {
            const newContent = prev + content
            // Update the last message or add new one
            setMessages(messages => {
              const lastMessage = messages[messages.length - 1]
              if (lastMessage?.role === 'assistant') {
                // Update existing assistant message
                return [
                  ...messages.slice(0, -1),
                  { ...lastMessage, content: newContent }
                ]
              } else {
                // Add new assistant message
                return [...messages, { role: 'assistant', content: newContent }]
              }
            })
            return newContent
          })
          scrollToBottom()
        },

        onError: (error) => {
          setStreamingStatus({
            isStreaming: false,
            currentAction: undefined,
            toolsUsed: []
          })
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `Error: ${error}` }
          ])
          scrollToBottom()
        },

        onDone: () => {
          setStreamingStatus({
            isStreaming: false,
            toolsUsed: []
          })
          setCurrentStreamContent('')
          scrollToBottom()
        }
      }
    )
  }, [input, streamingStatus.isStreaming, mode, selectedPlaylistId, messages, scrollToBottom])

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>AI DJ Assistant (Streaming)</h2>
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

      <StreamingStatusDisplay status={streamingStatus} />

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>Hi! I'm your AI DJ assistant with real-time streaming.</p>
            <ul>
              <li>🎵 Watch as I analyze tracks and artists</li>
              <li>📝 See playlist creation in real-time</li>
              <li>✏️ Track every step of playlist editing</li>
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

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            streamingStatus.isStreaming
              ? "Streaming response..."
              : mode === 'create'
              ? "Describe the playlist you want to create..."
              : mode === 'analyze'
              ? "Ask me about any song, artist, or genre..."
              : "Tell me which playlist to edit and how..."
          }
          disabled={streamingStatus.isStreaming || isPending}
        />
        <button type="submit" disabled={streamingStatus.isStreaming || !input.trim()}>
          {streamingStatus.isStreaming ? 'Streaming...' : 'Send'}
        </button>
      </form>
    </div>
  )
}