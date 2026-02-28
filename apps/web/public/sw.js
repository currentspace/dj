// DJ Service Worker - v2.0.0
// Version is used for cache busting - increment when deploying updates
const SW_VERSION = 'a106ed8-1772302846108';
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
});

// Log when controller changes (new SW took over)
self.addEventListener('controllerchange', () => {
  console.log(`[SW ${SW_VERSION}] Controller changed`);
});
