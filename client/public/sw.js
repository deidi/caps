const CACHE_NAME = 'caps-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Install Event - Pre-cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network-First for API/Data, Cache-First for static assets, with offline fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket, chrome extensions, and non-GET requests
  if (event.request.method !== 'GET' || url.protocol.startsWith('ws') || url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // API or live photo data: Network first with cache fallback
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/data')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful thumbnail and asset responses
          if (response.ok && url.pathname.startsWith('/data/events/')) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          // If offline and request is in cache, return cached response
          const cached = await caches.match(event.request);
          if (cached) return cached;

          // For JSON API calls while offline, return structured offline response
          if (url.pathname.startsWith('/api')) {
            return new Response(JSON.stringify({
              success: false,
              offline: true,
              error: 'You are currently offline. Actions will be queued.'
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }

          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Static Assets / SPA Navigation: Stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback to index.html for SPA client routing
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
