// DJ Service Worker - v1.0.0
const CACHE_VERSION = 'dj-cache-v1';
const STATIC_CACHE = 'dj-static-v1';
const RUNTIME_CACHE = 'dj-runtime-v1';

// Static assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Precaching static assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Installed successfully');
        return self.skipWaiting();
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activated successfully');
        return self.clients.claim();
      })
  );
});

// Fetch event - network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API calls - always fetch from network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip Spotify CDN (album art) - let browser handle caching
  if (url.hostname.includes('spotify') || url.hostname.includes('scdn.co')) {
    return;
  }

  // For static assets: stale-while-revalidate strategy
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
              console.log('[SW] Returning cached response for:', url.pathname);
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
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});

// Notify clients when a new version is available
self.addEventListener('controllerchange', () => {
  console.log('[SW] Controller changed, page may need refresh');
});
