import {useEffect, useRef, useState} from 'react'

import '../styles/sse-test.css'

interface LogEntry {
  message: string
  timestamp: string
  type: 'error' | 'info' | 'success' | 'warning'
}

export function SSETestPage() {
  const [token, setToken] = useState('')
  const [apiBase, setApiBase] = useState(import.meta.env.DEV ? 'http://localhost:8787/api' : '/api')
  const [message, setMessage] = useState('What is the tempo of the songs?')
  const [playlistId, setPlaylistId] = useState('')
  const [mode, setMode] = useState<'analyze' | 'create' | 'edit'>('analyze')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Auto-load token on mount
    const storedToken = localStorage.getItem('spotify_token')
    if (storedToken) {
      setToken(storedToken)
      addLog('Token loaded from localStorage', 'success')
    }
  }, [])

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
    setLogs(prev => [...prev, {message, timestamp, type}])
  }

  const clearLogs = () => {
    setLogs([])
    addLog('Logs cleared', 'info')
  }

  const getTokenFromStorage = () => {
    const storedToken = localStorage.getItem('spotify_token')
    if (storedToken) {
      setToken(storedToken)
      addLog('Token retrieved from localStorage', 'success')
    } else {
      addLog('No token found in localStorage', 'warning')
    }
  }

  const testSimpleSSE = async () => {
    addLog('Testing simple SSE GET endpoint...', 'info')

    try {
      const response = await fetch(`${apiBase}/sse-test/simple`)
      addLog(`Response status: ${response.status}`, response.ok ? 'success' : 'error')
      addLog(`Content-Type: ${response.headers.get('content-type')}`, 'info')

      if (!response.ok || !response.body) {
        addLog('Failed to get stream', 'error')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const {done, value} = await reader.read()
        if (done) break

        buffer += decoder.decode(value, {stream: true})
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const event = JSON.parse(data)
              addLog(`SSE Event [${event.type}]: ${JSON.stringify(event.data)}`, 'success')
            } catch {
              addLog(`Raw SSE data: ${data}`, 'info')
            }
          }
        }
      }
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  const testPostSSE = async () => {
    addLog('Testing POST SSE endpoint...', 'info')

    try {
      const response = await fetch(`${apiBase}/sse-test/post-stream`, {
        body: JSON.stringify({test: 'data', timestamp: Date.now()}),
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      addLog(`Response status: ${response.status}`, response.ok ? 'success' : 'error')
      addLog(`Content-Type: ${response.headers.get('content-type')}`, 'info')

      if (!response.ok || !response.body) {
        addLog('Failed to get stream', 'error')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const {done, value} = await reader.read()
        if (done) break

        buffer += decoder.decode(value, {stream: true})
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const event = JSON.parse(data)
              addLog(`SSE Event [${event.type}]: ${JSON.stringify(event.data)}`, 'success')
            } catch {
              addLog(`Raw SSE data: ${data}`, 'info')
            }
          } else if (line.startsWith(':')) {
            addLog(`SSE comment: ${line}`, 'info')
          }
        }
      }
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  const testSimplePost = async () => {
    addLog('Testing simple POST to chat-stream...', 'info')

    if (!token) {
      addLog('No token provided!', 'error')
      return
    }

    try {
      const response = await fetch(`${apiBase}/chat-stream/message`, {
        body: JSON.stringify({
          conversationHistory: [],
          message: 'test',
          mode: 'analyze',
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      addLog(`Response status: ${response.status} ${response.statusText}`, response.ok ? 'success' : 'error')
      addLog('Response headers:', 'info')
      for (const [key, value] of response.headers.entries()) {
        addLog(`  ${key}: ${value}`, 'info')
      }

      if (!response.ok) {
        const text = await response.text()
        addLog(`Response body: ${text}`, 'error')
      }
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  const testSSEStream = async () => {
    addLog('Starting SSE stream test...', 'info')

    if (!token) {
      addLog('No token provided!', 'error')
      return
    }

    // Build message with optional playlist ID
    let finalMessage = message
    if (playlistId && (mode === 'analyze' || mode === 'edit')) {
      finalMessage = `[Playlist ID: ${playlistId}] ${message}`
      addLog(`Message with playlist ID: ${finalMessage}`, 'info')
    }

    abortControllerRef.current = new AbortController()
    setIsStreaming(true)

    try {
      addLog(`POST to ${apiBase}/chat-stream/message`, 'info')
      const response = await fetch(`${apiBase}/chat-stream/message`, {
        body: JSON.stringify({
          conversationHistory: [],
          message: finalMessage,
          mode,
        }),
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: abortControllerRef.current.signal,
      })

      addLog(`Response status: ${response.status}`, response.ok ? 'success' : 'error')

      const contentType = response.headers.get('content-type') ?? ''
      addLog(`Content-Type: ${contentType}`, contentType.includes('text/event-stream') ? 'success' : 'warning')

      if (!response.ok) {
        const text = await response.text()
        addLog(`Error response: ${text}`, 'error')
        setIsStreaming(false)
        return
      }

      if (!response.body) {
        addLog('No response body!', 'error')
        setIsStreaming(false)
        return
      }

      // Read the stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventCount = 0

      while (true) {
        const {done, value} = await reader.read()

        if (done) {
          addLog('Stream ended', 'info')
          break
        }

        const chunk = decoder.decode(value, {stream: true})
        buffer += chunk

        // Log raw chunks
        if (chunk.trim()) {
          addLog(`Raw chunk (${chunk.length} bytes): ${chunk.slice(0, 200)}${chunk.length > 200 ? '...' : ''}`, 'info')
        }

        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventCount++
            const data = line.slice(6)
            try {
              const event = JSON.parse(data)
              addLog(`Event #${eventCount} [${event.type}]: ${JSON.stringify(event.data).slice(0, 200)}`, 'success')

              if (event.type === 'done') {
                addLog('Received done event', 'success')
                setIsStreaming(false)
                return
              }
              if (event.type === 'error') {
                addLog(`Server error: ${event.data}`, 'error')
                setIsStreaming(false)
                return
              }
            } catch {
              addLog(`Failed to parse event: ${data}`, 'warning')
            }
          } else if (line.startsWith(':')) {
            // Comment or heartbeat
            if (line.includes('heartbeat')) {
              addLog('Heartbeat received', 'info')
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        addLog('Stream aborted', 'warning')
      } else {
        addLog(`Stream error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
      }
    } finally {
      setIsStreaming(false)
    }
  }

  const stopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      addLog('Stream stopped', 'warning')
    } else {
      addLog('No active stream', 'info')
    }
  }

  const showCurlCommand = () => {
    const curl = `curl -N -X POST '${apiBase}/chat-stream/message' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: text/event-stream' \\
  -H 'Authorization: Bearer ${token.slice(0, 20)}...' \\
  -d '{"message": "test", "conversationHistory": [], "mode": "analyze"}'`

    addLog('Equivalent curl command:', 'info')
    addLog(curl, 'info')
  }

  return (
    <div className="sse-test-page">
      <h1>🔧 SSE Streaming Test Dashboard</h1>

      <div className="test-section">
        <h2>1. Setup</h2>
        <div className="form-row">
          <label>
            Spotify Token:
            <input
              onChange={e => setToken(e.target.value)}
              placeholder="Your Spotify token"
              type="text"
              value={token}
            />
          </label>
          <button onClick={getTokenFromStorage}>Get from localStorage</button>
        </div>
        <div className="form-row">
          <label>
            API Base:
            <input onChange={e => setApiBase(e.target.value)} type="text" value={apiBase} />
          </label>
        </div>
      </div>

      <div className="test-section">
        <h2>2. Test Basic SSE</h2>
        <div className="button-group">
          <button onClick={testSimpleSSE}>Test GET /api/sse-test/simple</button>
          <button onClick={testPostSSE}>Test POST /api/sse-test/post-stream</button>
        </div>
      </div>

      <div className="test-section">
        <h2>3. Test Chat Stream Endpoint</h2>
        <button onClick={testSimplePost}>Test POST to /api/chat-stream/message</button>
      </div>

      <div className="test-section">
        <h2>4. Full Chat SSE Stream</h2>
        <div className="form-row">
          <label>
            Message:
            <input onChange={e => setMessage(e.target.value)} type="text" value={message} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Playlist ID:
            <input
              onChange={e => setPlaylistId(e.target.value)}
              placeholder="Optional playlist ID"
              type="text"
              value={playlistId}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Mode:
            <select onChange={e => setMode(e.target.value as typeof mode)} value={mode}>
              <option value="analyze">Analyze</option>
              <option value="create">Create</option>
              <option value="edit">Edit</option>
            </select>
          </label>
        </div>
        <div className="button-group">
          <button disabled={isStreaming} onClick={testSSEStream}>
            {isStreaming ? 'Streaming...' : 'Start SSE Stream'}
          </button>
          <button onClick={stopStream}>Stop Stream</button>
        </div>
      </div>

      <div className="test-section">
        <h2>5. Debug Commands</h2>
        <button onClick={showCurlCommand}>Show curl command</button>
      </div>

      <div className="test-section">
        <h2>Event Log</h2>
        <button onClick={clearLogs}>Clear Log</button>
        <div className="log-container">
          {logs.map((log, index) => (
            <div className={`log-entry log-${log.type}`} key={index}>
              <span className="log-time">[{log.timestamp}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
