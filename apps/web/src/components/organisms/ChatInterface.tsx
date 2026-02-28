import {useCallback, useRef, useState, useTransition} from 'react'
import {flushSync} from 'react-dom'

import {MarkdownContent} from '../../lib/markdown-renderer'
import {hasMarkdownSyntax} from '../../lib/markdown-utils'
import {chatStreamClient} from '../../lib/streaming-client'
import {selectCurrentMessages, usePlaylistStore} from '../../stores'
import '../../styles/streaming.css'
import '../../styles/chat-interface.css'

interface StreamingStatus {
  currentAction?: string
  currentTool?: string
  isStreaming: boolean
  toolsUsed: string[]
}

export function ChatInterface() {
  // Playlist state from Zustand store (no prop drilling)
  const selectedPlaylist = usePlaylistStore((s) => s.selectedPlaylist)
  const addMessage = usePlaylistStore((s) => s.addMessage)
  const updateLastMessage = usePlaylistStore((s) => s.updateLastMessage)

  // Get messages for current playlist (derived selector - only re-renders when messages change)
  const messages = usePlaylistStore(selectCurrentMessages)

  // Local UI state
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'analyze' | 'create' | 'dj' | 'edit'>('analyze')
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>({
    isStreaming: false,
    toolsUsed: [],
  })
  const [, setCurrentStreamContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamHandleRef = useRef<null | {close: () => void}>(null)

  // Derived value
  const playlistId = selectedPlaylist?.id ?? null

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [])

  const handleModeChange = useCallback((newMode: 'analyze' | 'create' | 'dj' | 'edit') => {
    startTransition(() => {
      setMode(newMode)
    })
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || streamingStatus.isStreaming) return

      let userMessage = input.trim()

      // Inject playlist ID for analyze/edit/dj modes
      console.log(`[ChatInterface] Pre-injection - Mode: ${mode}, SelectedID: ${playlistId}`)
      if ((mode === 'analyze' || mode === 'edit' || mode === 'dj') && playlistId) {
        userMessage = `[Playlist ID: ${playlistId}] ${userMessage}`
        console.log(`[ChatInterface] Injected playlist ID: ${userMessage}`)
      } else {
        console.warn(`[ChatInterface] No playlist ID injected - Mode: ${mode}, ID: ${playlistId}`)
      }

      const displayMessage = input.trim()

      // Clear input and reset streaming state
      setInput('')
      setStreamingStatus({
        currentAction: 'Processing your request...',
        isStreaming: true,
        toolsUsed: [],
      })
      setCurrentStreamContent('')

      // Add user message to current playlist's conversation
      flushSync(() => {
        if (playlistId) {
          addMessage(playlistId, {content: displayMessage, role: 'user'})
        }
      })
      scrollToBottom()

      // Stream the response
      streamHandleRef.current = await chatStreamClient.streamMessage(userMessage, messages, mode, {
        onContent: content => {
          setCurrentStreamContent(prev => {
            const newContent = prev + content
            // Update the last message or add new one in current playlist's conversation
            if (playlistId) {
              updateLastMessage(playlistId, newContent)
            }
            return newContent
          })
          scrollToBottom()
        },

        onDone: () => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: undefined,
            currentTool: undefined,
            isStreaming: false,
          }))
          setCurrentStreamContent('')
          scrollToBottom()
        },

        onError: error => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: undefined,
            isStreaming: false,
          }))
          if (playlistId) {
            addMessage(playlistId, {content: `Error: ${error}`, role: 'assistant'})
          }
          scrollToBottom()
        },

        onThinking: message => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: message,
            currentTool: undefined,
          }))
        },

        // onLog and onDebug are handled directly in streaming-client.ts

        onToolEnd: (tool, result) => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: typeof result === 'string' ? result : `${tool} completed`,
            currentTool: undefined,
            toolsUsed: [...prev.toolsUsed, tool],
          }))
        },

        onToolStart: tool => {
          setStreamingStatus(prev => ({
            ...prev,
            currentAction: `Running ${tool}...`,
            currentTool: tool,
          }))
        },
      })
    },
    [input, streamingStatus.isStreaming, mode, playlistId, messages, scrollToBottom, addMessage, updateLastMessage],
  )

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
            <select onChange={e => handleModeChange(e.target.value as typeof mode)} value={mode}>
              <option value="analyze">Analyze Music</option>
              <option value="create">Create Playlist</option>
              <option value="dj">DJ Mode</option>
              <option value="edit">Edit Playlist</option>
            </select>
          </label>

          {(mode === 'analyze' || mode === 'edit' || mode === 'dj') && (
            <div className="selected-playlist-info">
              <span>
                🎵 {selectedPlaylist.name} ({selectedPlaylist.tracks.total} tracks)
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>Hi! I'm your AI DJ assistant. I can help you:</p>
            <ul>
              <li>🎵 Analyze tracks and artists in your playlists</li>
              <li>📝 Create custom playlists based on your taste</li>
              <li>🎧 DJ Mode - Control playback, queue songs, and get real-time recommendations</li>
              <li>✏️ Edit existing playlists with smart suggestions</li>
            </ul>
            <p>
              {selectedPlaylist
                ? `Ready to work with "${selectedPlaylist.name}"! What would you like to do?`
                : 'What kind of music are you in the mood for today?'}
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={index}>
            <div className="message-role">{message.role === 'user' ? '👤' : '🎧'}</div>
            <div className="message-content">
              {hasMarkdownSyntax(message.content) ? (
                <MarkdownContent>{message.content}</MarkdownContent>
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <StreamingStatusDisplay status={streamingStatus} />

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          disabled={streamingStatus.isStreaming || isPending}
          onChange={e => setInput(e.target.value)}
          placeholder={
            streamingStatus.isStreaming
              ? 'Streaming response...'
              : mode === 'create'
                ? 'Describe the playlist you want to create...'
                : mode === 'analyze'
                  ? 'Ask me about any song, artist, or genre...'
                  : mode === 'dj'
                    ? 'Tell me what to play next, queue songs, or control playback...'
                    : 'Tell me which playlist to edit and how...'
          }
          type="text"
          value={input}
        />
        <button disabled={streamingStatus.isStreaming || !input.trim()} type="submit">
          {streamingStatus.isStreaming ? 'Streaming...' : 'Send'}
        </button>
      </form>
    </div>
  )
}

// Tool status display component
function StreamingStatusDisplay({status}: {status: StreamingStatus}) {
  if (!status.isStreaming && status.toolsUsed.length === 0) return null

  return (
    <div className="streaming-status">
      {status.isStreaming && (
        <div className="streaming-pulse">
          <div className="pulse-ring"></div>
          <div className="pulse-dot"></div>
        </div>
      )}
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
