/**
 * Shared Playback Worker — single SSE connection shared across all tabs.
 *
 * Each tab connects via `new SharedWorker(...)`, gets a MessagePort, and
 * sends PLAYBACK_SUBSCRIBE / PLAYBACK_UNSUBSCRIBE / PLAYBACK_TOKEN_UPDATE.
 * The worker holds one fetch('/api/player/stream') and forwards parsed SSE
 * events to all connected ports. Auto-terminates when the last tab closes.
 */

const ports = new Set()

let sseAbortController = null
let sseBuffer = ''
let sseReconnectTimeout = null
let sseStatus = 'disconnected' // connecting | connected | disconnected | error
let sseSubscriberCount = 0
let sseToken = null

let lastInitEvent = null // Cached for late joiners

// =============================================================================
// BROADCAST — send a message to all connected ports
// =============================================================================

function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message)
    } catch {
      // Port is dead (tab crashed without unsubscribe) — remove it
      ports.delete(port)
    }
  }
}

// =============================================================================
// SSE PARSING & CONNECTION
// =============================================================================

/**
 * Recursive read loop — parses SSE framing and broadcasts events to all ports.
 */
function readLoop(reader, decoder) {
  reader
    .read()
    .then(({ done, value }) => {
      if (done) {
        console.log('[SharedWorker] SSE stream ended')
        sseStatus = 'disconnected'
        broadcast({ status: 'disconnected', type: 'SW_STATUS' })
        scheduleReconnect()
        return
      }

      sseBuffer += decoder.decode(value, { stream: true })
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() ?? ''

      let currentData = ''
      let currentEvent = ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7)
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6)
        } else if (line === '' && currentEvent && currentData) {
          // Cache init events for late joiners
          if (currentEvent === 'init') {
            lastInitEvent = { data: currentData, event: currentEvent }
          }

          // Handle reconnect internally — don't forward to tabs
          if (currentEvent === 'reconnect') {
            console.log('[SharedWorker] Server requested reconnect')
            sseStatus = 'disconnected'
            broadcast({ status: 'disconnected', type: 'SW_STATUS' })
            reader.cancel()
            scheduleReconnect()
            return
          }

          broadcast({ data: currentData, event: currentEvent, type: 'SSE_EVENT' })
          currentData = ''
          currentEvent = ''
        }
      }

      readLoop(reader, decoder)
    })
    .catch((err) => {
      if (err.name === 'AbortError') return
      console.error('[SharedWorker] SSE read error:', err)
      sseStatus = 'disconnected'
      broadcast({ status: 'disconnected', type: 'SW_STATUS' })
      scheduleReconnect()
    })
}

/**
 * Schedule a reconnect after 2s, only if there are active subscribers.
 */
function scheduleReconnect() {
  if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout)

  sseReconnectTimeout = setTimeout(() => {
    sseReconnectTimeout = null
    if (sseSubscriberCount > 0 && sseToken) {
      sseConnect(sseToken)
    }
  }, 2000)
}

/**
 * Connect to the SSE stream with the given token.
 */
function sseConnect(token) {
  if (sseStatus === 'connecting' || sseStatus === 'connected') return

  sseToken = token
  sseStatus = 'connecting'
  sseBuffer = ''
  broadcast({ status: 'connecting', type: 'SW_STATUS' })
  console.log('[SharedWorker] SSE connecting...')

  sseAbortController = new AbortController()

  fetch('/api/player/stream', {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    signal: sseAbortController.signal,
  })
    .then((response) => {
      if (!response.ok) {
        if (response.status === 401) {
          console.log('[SharedWorker] SSE auth expired (401)')
          sseStatus = 'disconnected'
          broadcast({ data: '{}', event: 'auth_expired', type: 'SSE_EVENT' })
          broadcast({ status: 'disconnected', type: 'SW_STATUS' })
          return
        }
        throw new Error(`HTTP ${response.status}`)
      }

      if (!response.body) throw new Error('No response body')

      sseStatus = 'connected'
      broadcast({ status: 'connected', type: 'SW_STATUS' })
      console.log('[SharedWorker] SSE connected')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      readLoop(reader, decoder)
    })
    .catch((err) => {
      if (err.name === 'AbortError') return
      console.error('[SharedWorker] SSE connection error:', err)
      sseStatus = 'error'
      broadcast({ error: err.message, status: 'error', type: 'SW_STATUS' })
      scheduleReconnect()
    })
}

/**
 * Disconnect the SSE stream and clean up all state.
 */
function sseDisconnect() {
  console.log('[SharedWorker] SSE disconnecting')

  if (sseAbortController) {
    sseAbortController.abort()
    sseAbortController = null
  }
  sseBuffer = ''
  sseStatus = 'disconnected'

  if (sseReconnectTimeout) {
    clearTimeout(sseReconnectTimeout)
    sseReconnectTimeout = null
  }

  broadcast({ status: 'disconnected', type: 'SW_STATUS' })
}

// =============================================================================
// PORT CONNECTION HANDLER
// =============================================================================

self.onconnect = (e) => {
  const port = e.ports[0]
  ports.add(port)

  port.onmessage = (event) => {
    const { type } = event.data

    if (type === 'PLAYBACK_SUBSCRIBE') {
      sseSubscriberCount++
      console.log(`[SharedWorker] PLAYBACK_SUBSCRIBE (count: ${sseSubscriberCount})`)

      if (event.data.token) {
        sseToken = event.data.token
      }

      if (sseSubscriberCount === 1 || sseStatus === 'disconnected' || sseStatus === 'error') {
        sseConnect(sseToken)
      } else if (sseStatus === 'connected' && lastInitEvent) {
        // Replay cached init for late joiner (only to this port)
        port.postMessage({ data: lastInitEvent.data, event: lastInitEvent.event, type: 'SSE_EVENT' })
      }
    }

    if (type === 'PLAYBACK_UNSUBSCRIBE') {
      sseSubscriberCount = Math.max(0, sseSubscriberCount - 1)
      ports.delete(port)
      console.log(`[SharedWorker] PLAYBACK_UNSUBSCRIBE (count: ${sseSubscriberCount})`)

      if (sseSubscriberCount === 0) {
        sseDisconnect()
      }
    }

    if (type === 'PLAYBACK_TOKEN_UPDATE') {
      const newToken = event.data.token
      if (newToken && newToken !== sseToken) {
        console.log('[SharedWorker] PLAYBACK_TOKEN_UPDATE — reconnecting with new token')
        sseToken = newToken
        lastInitEvent = null // Stale after token change
        if (sseSubscriberCount > 0) {
          // Disconnect and reconnect with new token
          if (sseAbortController) {
            sseAbortController.abort()
            sseAbortController = null
          }
          sseBuffer = ''
          sseStatus = 'disconnected'
          if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout)
            sseReconnectTimeout = null
          }
          sseConnect(newToken)
        }
      }
    }
  }

  port.start()
}
