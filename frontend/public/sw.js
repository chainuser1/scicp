// ── Service Worker for Scriptures in View ────────────────────────────────────
// Strategy:
//   • Static assets (JS, CSS, fonts, images)  → cache-first
//   • Navigation / HTML / API                 → network-first
//   • socket.io WebSocket upgrades bypass the fetch event entirely (no action needed)
//
// The Client page continues displaying the last received verse from React state
// if the network drops — no extra SW work required for that use-case.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'siv-client-v1';

// Resources to pre-cache on install (Client page shell + key fonts)
const PRECACHE_URLS = [
  '/client',
  '/index.html',
];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {/* non-fatal: might be offline at install time */})
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route by resource type ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin http/https requests
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.origin !== self.location.origin) {
    // Cross-origin fonts / images — cache-first, network fallback
    if (
      request.destination === 'font' ||
      request.destination === 'image' ||
      /\.(woff2?|ttf|otf|eot)(\?.*)?$/.test(url.pathname)
    ) {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  // socket.io polling / upgrade requests — let them pass through
  if (url.pathname.startsWith('/socket.io')) return;

  // API endpoints — network-first
  if (
    url.pathname.startsWith('/verse/') ||
    url.pathname.startsWith('/themes') ||
    url.pathname.startsWith('/config') ||
    url.pathname.startsWith('/health')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (hashed bundles, fonts, images) — cache-first
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)(\?.*)?$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation (HTML) — network-first so fresh shell is served when online
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not cached — nothing to return
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}
