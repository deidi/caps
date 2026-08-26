const CACHE_NAME = 'eventcaps-pwa-v2.4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// Install Event - Pre-cache App Shell & Skip Waiting Immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event - Clean up stale caches & Claim Clients Immediately
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

// Fetch Event - Network-First with Offline Cache Fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, WebSockets, Google OAuth/APIs
  if (
    event.request.method !== 'GET' ||
    url.protocol.startsWith('ws') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse.ok && event.request.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
