import { useState, useRef, useCallback, useTransition } from 'react'
import { chatStreamClient } from '../../lib/streaming-client'
import { flushSync } from 'react-dom'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  external_urls: {
    spotify: string;
  };
  images: Array<{
    url: string;
    height: number;
    width: number;
  }>;
  tracks: {
    total: number;
  };
  public: boolean;
  owner: {
    display_name: string;
  };
}

interface ChatInterfaceProps {
  selectedPlaylist: SpotifyPlaylist | null;
}


interface StreamingStatus {
  isStreaming: boolean
  currentAction?: string
  currentTool?: string
  toolsUsed: string[]
  logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; timestamp: string }>
  debugData?: any
}


// Tool status display component
function StreamingStatusDisplay({ status }: { status: StreamingStatus }) {
  if (!status.isStreaming && status.logs.length === 0) return null

  const showDebugLogs = true // Toggle for debug mode

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

      {showDebugLogs && status.logs.length > 0 && (
        <details className="debug-logs">
          <summary>📋 Debug Logs ({status.logs.length})</summary>
          <div className="log-entries">
            {status.logs.slice(-10).map((log, i) => (
              <div key={i} className={`log-entry log-${log.level}`}>
                <span className="log-time">{log.timestamp}</span>
                <span className="log-level">{log.level.toUpperCase()}</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {showDebugLogs && status.debugData && (
        <details className="debug-data">
          <summary>🔍 Debug Data</summary>
          <pre>{JSON.stringify(status.debugData, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

export function ChatInterface({ selectedPlaylist }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'analyze' | 'create' | 'edit'>('analyze')
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>({
    isStreaming: false,
    toolsUsed: [],
    logs: []
  })
  const [, setCurrentStreamContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleModeChange = useCallback((newMode: 'analyze' | 'create' | 'edit') => {
    startTransition(() => {
      setMode(newMode)
    })
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || streamingStatus.isStreaming) return

    let userMessage = input.trim()

    // Inject playlist ID for analyze/edit modes
    console.log(`[ChatInterface] Pre-injection - Mode: ${mode}, SelectedID: ${selectedPlaylist?.id}`)
    if ((mode === 'analyze' || mode === 'edit') && selectedPlaylist?.id) {
      userMessage = `[Playlist ID: ${selectedPlaylist.id}] ${userMessage}`
      console.log(`[ChatInterface] Injected playlist ID: ${userMessage}`)
    } else {
      console.warn(`[ChatInterface] No playlist ID injected - Mode: ${mode}, ID: ${selectedPlaylist?.id}`)
    }

    const displayMessage = input.trim()

    // Clear input and reset streaming state
    setInput('')
    setStreamingStatus({
      isStreaming: true,
      currentAction: 'Processing your request...',
      toolsUsed: [],
      logs: []
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

        onToolStart: (tool) => {
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

        onLog: (level, message) => {
          console.log(`[Server ${level}] ${message}`)
          setStreamingStatus(prev => ({
            ...prev,
            logs: [...prev.logs, {
              level,
              message,
              timestamp: new Date().toLocaleTimeString()
            }].slice(-20) // Keep last 20 logs
          }))
        },

        onDebug: (data) => {
          console.log('[Server Debug]', data)
          setStreamingStatus(prev => ({
            ...prev,
            debugData: data
          }))
        },

        onError: (error) => {
          setStreamingStatus(prev => ({
            ...prev,
            isStreaming: false,
            currentAction: undefined
          }))
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `Error: ${error}` }
          ])
          scrollToBottom()
        },

        onDone: () => {
          setStreamingStatus(prev => ({
            ...prev,
            isStreaming: false,
            currentAction: undefined,
            currentTool: undefined
          }))
          setCurrentStreamContent('')
          scrollToBottom()
        }
      }
    )
  }, [input, streamingStatus.isStreaming, mode, selectedPlaylist?.id, messages, scrollToBottom])

  // If no playlist is selected, show selection prompt
  if (!selectedPlaylist) {
    return (
      <div className="chat-interface">
        <div className="no-playlist-selected">
          <h2>🎵 Select a Playlist</h2>
          <p>Choose a playlist from the left to start chatting with your AI DJ assistant!</p>
          <p>I can help you analyze your music, create new playlists, or edit existing ones.</p>
        </div>
      </div>
    )
  }

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

          {(mode === 'analyze' || mode === 'edit') && (
            <div className="selected-playlist-info">
              <span>🎵 {selectedPlaylist.name} ({selectedPlaylist.tracks.total} tracks)</span>
            </div>
          )}
        </div>
      </div>

      <StreamingStatusDisplay status={streamingStatus} />

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>Hi! I'm your AI DJ assistant. I can help you:</p>
            <ul>
              <li>🎵 Analyze tracks and artists in your playlists</li>
              <li>📝 Create custom playlists based on your taste</li>
              <li>✏️ Edit existing playlists with smart suggestions</li>
            </ul>
            <p>{selectedPlaylist
              ? `Ready to work with "${selectedPlaylist.name}"! What would you like to do?`
              : 'What kind of music are you in the mood for today?'
            }</p>
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