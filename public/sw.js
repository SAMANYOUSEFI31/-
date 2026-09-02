// Bushido Discipline OS - Service Worker (Offline PWA Cache v3)
const STATIC_CACHE_NAME = 'bushido-static-v3';
const RUNTIME_CACHE_NAME = 'bushido-runtime-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icon-maskable.svg'
];

// Install: Precache App Shell with error-resilient allSettled
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response && response.ok) {
              await cache.put(url, response);
            }
          } catch (err) {
            console.warn('[PWA] Precache item skip:', url, err);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE_NAME && key !== RUNTIME_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Listen for messages from the page (e.g. SKIP_WAITING or CLEAR_CACHE)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    });
  }
});

// Fetch: Multi-strategy caching dispatch
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 1. API Requests: Network Only with Graceful Offline JSON Fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ 
            offline: true, 
            error: 'اینترنت قطع است. داده‌ها در حافظه محلی دستگاه محفوظ هستند.' 
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      })
    );
    return;
  }

  // 2. Navigation Requests (HTML entry points): Network-First with Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put(request, copy);
              cache.put('/index.html', copy.clone());
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          const indexCached = await caches.match('/index.html', { ignoreSearch: true });
          if (indexCached) return indexCached;
          return caches.match('/', { ignoreSearch: true });
        })
    );
    return;
  }

  // 3. Vite Hashed Immutable Assets (/assets/*): Cache-First
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((networkResponse) => {
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              !networkResponse.headers.get('content-type')?.includes('text/html')
            ) {
              const copy = networkResponse.clone();
              caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn('[SW] Asset fetch failed, checking cache:', request.url, err);
            return caches.match(request);
          });
      })
    );
    return;
  }

  // 4. External Fonts & CDN Styles (Google Fonts, etc.): Stale-While-Revalidate
  const isExternalFontOrStyle = 
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    request.destination === 'font';

  if (isExternalFontOrStyle) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              const copy = networkResponse.clone();
              caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 5. Other Static Assets (Images, Icons, Scripts): Stale-While-Revalidate with Runtime Cache
  const isStatic = 
    url.origin === self.location.origin && (
      request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'image' ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.json')
    );

  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Revalidate in background
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Default: Network fetch
  event.respondWith(fetch(request));
});

