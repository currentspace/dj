// DJ Service Worker - v2.0.0
// Version is used for cache busting - increment when deploying updates
const SW_VERSION = '1c19b31-1772328602790';
const STATIC_CACHE = `dj-static-v${SW_VERSION}`;
const RUNTIME_CACHE = `dj-runtime-v${SW_VERSION}`;

// Static assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

// Install event - cache static assets
// NOTE: We do NOT call skipWaiting() here - we let the user decide when to update
self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing service worker...`);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log(`[SW ${SW_VERSION}] Precaching static assets`);
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log(`[SW ${SW_VERSION}] Installed successfully, waiting for activation`);
        // Don't skipWaiting() - wait for user to trigger update via SKIP_WAITING message
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activating service worker...`);
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete caches from older versions
              return name.startsWith('dj-') &&
                     name !== STATIC_CACHE &&
                     name !== RUNTIME_CACHE;
            })
            .map((name) => {
              console.log(`[SW ${SW_VERSION}] Deleting old cache:`, name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log(`[SW ${SW_VERSION}] Activated successfully`);
        // Claim all clients so the new SW takes over immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - stale-while-revalidate for static assets, network-only for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API calls - always fetch from network (no caching)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip external CDNs (Spotify album art, etc.) - let browser handle
  if (url.hostname !== self.location.hostname) {
    return;
  }

  // For same-origin static assets: stale-while-revalidate strategy
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            // Only cache successful responses
            if (networkResponse.ok) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            // Network failed, return cached version if available
            if (cachedResponse) {
              console.log(`[SW ${SW_VERSION}] Returning cached response for:`, url.pathname);
              return cachedResponse;
            }
            throw new Error('No cached version available');
          });

        // Return cached response immediately, update cache in background
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log(`[SW ${SW_VERSION}] Received message:`, event.data?.type);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log(`[SW ${SW_VERSION}] User requested update, calling skipWaiting()`);
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log(`[SW ${SW_VERSION}] Clearing all caches`);
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    // Respond with version info
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }

  // --- SSE Playback Proxy Messages ---

  if (event.data && event.data.type === 'PLAYBACK_SUBSCRIBE') {
    sseSubscriberCount++;
    console.log(`[SW ${SW_VERSION}] PLAYBACK_SUBSCRIBE (count: ${sseSubscriberCount})`);

    if (event.data.token) {
      sseToken = event.data.token;
    }

    if (sseSubscriberCount === 1 || sseStatus === 'disconnected' || sseStatus === 'error') {
      sseConnect(sseToken);
      startReconciliation();
    } else if (sseStatus === 'connected' && lastInitEvent) {
      // Replay cached init for late joiner
      broadcast('SSE_EVENT', { data: lastInitEvent.data, event: lastInitEvent.event });
    }
  }

  if (event.data && event.data.type === 'PLAYBACK_UNSUBSCRIBE') {
    sseSubscriberCount = Math.max(0, sseSubscriberCount - 1);
    console.log(`[SW ${SW_VERSION}] PLAYBACK_UNSUBSCRIBE (count: ${sseSubscriberCount})`);

    if (sseSubscriberCount === 0) {
      sseDisconnect();
    }
  }

  if (event.data && event.data.type === 'PLAYBACK_TOKEN_UPDATE') {
    const newToken = event.data.token;
    if (newToken && newToken !== sseToken) {
      console.log(`[SW ${SW_VERSION}] PLAYBACK_TOKEN_UPDATE — reconnecting with new token`);
      sseToken = newToken;
      lastInitEvent = null; // Stale after token change
      if (sseSubscriberCount > 0) {
        // Disconnect and reconnect with new token
        if (sseAbortController) {
          sseAbortController.abort();
          sseAbortController = null;
        }
        sseReader = null;
        sseBuffer = '';
        sseStatus = 'disconnected';
        if (sseReconnectTimeout) {
          clearTimeout(sseReconnectTimeout);
          sseReconnectTimeout = null;
        }
        sseConnect(newToken);
      }
    }
  }
});

// Log when controller changes (new SW took over)
self.addEventListener('controllerchange', () => {
  console.log(`[SW ${SW_VERSION}] Controller changed`);
});

// =============================================================================
// SSE PLAYBACK PROXY — Single connection shared across all tabs
// =============================================================================

let sseReader = null;
let sseAbortController = null;
let sseToken = null;
let sseStatus = 'disconnected'; // connecting | connected | disconnected | error
let sseReconnectTimeout = null;
let sseSubscriberCount = 0;
let sseBuffer = '';
let lastInitEvent = null; // Cached for late joiners
let reconcileInterval = null;

/**
 * Open a short-lived BroadcastChannel, post a message, then close.
 * SW can be terminated at any time — don't hold long-lived channel refs.
 */
function broadcast(type, payload) {
  try {
    const ch = new BroadcastChannel('dj-playback');
    ch.postMessage({ type, ...payload });
    ch.close();
  } catch (err) {
    console.warn(`[SW ${SW_VERSION}] Broadcast error:`, err);
  }
}

/**
 * Recursive read loop — parses SSE framing and broadcasts events.
 */
function readLoop(reader, decoder, token) {
  reader
    .read()
    .then(({ done, value }) => {
      if (done) {
        console.log(`[SW ${SW_VERSION}] SSE stream ended`);
        sseStatus = 'disconnected';
        broadcast('SW_STATUS', { status: 'disconnected' });
        scheduleSSEReconnect();
        return;
      }

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' && currentEvent && currentData) {
          // Cache init events for late joiners
          if (currentEvent === 'init') {
            lastInitEvent = { data: currentData, event: currentEvent };
          }

          // Handle reconnect internally — don't forward to tabs
          if (currentEvent === 'reconnect') {
            console.log(`[SW ${SW_VERSION}] Server requested reconnect`);
            sseStatus = 'disconnected';
            broadcast('SW_STATUS', { status: 'disconnected' });
            reader.cancel();
            scheduleSSEReconnect();
            return;
          }

          broadcast('SSE_EVENT', { data: currentData, event: currentEvent });
          currentEvent = '';
          currentData = '';
        }
      }

      readLoop(reader, decoder, token);
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      console.error(`[SW ${SW_VERSION}] SSE read error:`, err);
      sseStatus = 'disconnected';
      broadcast('SW_STATUS', { status: 'disconnected' });
      scheduleSSEReconnect();
    });
}

/**
 * Schedule a reconnect after 2s, only if there are active subscribers.
 */
function scheduleSSEReconnect() {
  if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout);

  sseReconnectTimeout = setTimeout(() => {
    sseReconnectTimeout = null;
    if (sseSubscriberCount > 0 && sseToken) {
      sseConnect(sseToken);
    }
  }, 2000);
}

/**
 * Connect to the SSE stream with the given token.
 */
function sseConnect(token) {
  if (sseStatus === 'connecting' || sseStatus === 'connected') return;

  sseToken = token;
  sseStatus = 'connecting';
  sseBuffer = '';
  broadcast('SW_STATUS', { status: 'connecting' });
  console.log(`[SW ${SW_VERSION}] SSE connecting...`);

  sseAbortController = new AbortController();

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
          console.log(`[SW ${SW_VERSION}] SSE auth expired (401)`);
          sseStatus = 'disconnected';
          broadcast('SSE_EVENT', { data: '{}', event: 'auth_expired' });
          broadcast('SW_STATUS', { status: 'disconnected' });
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');

      sseStatus = 'connected';
      broadcast('SW_STATUS', { status: 'connected' });
      console.log(`[SW ${SW_VERSION}] SSE connected`);

      sseReader = response.body.getReader();
      const decoder = new TextDecoder();
      readLoop(sseReader, decoder, token);
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      console.error(`[SW ${SW_VERSION}] SSE connection error:`, err);
      sseStatus = 'error';
      broadcast('SW_STATUS', { error: err.message, status: 'error' });
      scheduleSSEReconnect();
    });
}

/**
 * Disconnect the SSE stream and clean up all state.
 */
function sseDisconnect() {
  console.log(`[SW ${SW_VERSION}] SSE disconnecting`);

  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }
  sseReader = null;
  sseBuffer = '';
  sseStatus = 'disconnected';

  if (sseReconnectTimeout) {
    clearTimeout(sseReconnectTimeout);
    sseReconnectTimeout = null;
  }

  stopReconciliation();
  broadcast('SW_STATUS', { status: 'disconnected' });
}

/**
 * Periodically check if all client tabs are gone (handles tabs killed without beforeunload).
 */
function startReconciliation() {
  if (reconcileInterval) return;

  reconcileInterval = setInterval(() => {
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length === 0 && sseSubscriberCount > 0) {
        console.log(`[SW ${SW_VERSION}] No clients found, disconnecting SSE`);
        sseSubscriberCount = 0;
        sseDisconnect();
      }
    });
  }, 30000);
}

function stopReconciliation() {
  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
}
