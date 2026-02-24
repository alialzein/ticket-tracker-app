// TeamsOps Service Worker
// Cache version — bump this string when deploying new code to invalidate old caches
const CACHE_VERSION = 'teamsops-v24';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// App shell files to pre-cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/css/mobile.css',
    '/js/main.js',
    '/js/ui.js',
    '/js/tickets.js',
    '/js/config.js',
    '/js/state.js',
    '/js/auth.js',
    '/js/schedule.js',
    '/js/presence.js',
    '/js/reminders.js',
    '/js/knowledge-base.js',
    '/js/badges.js',
    '/js/badges-ui.js',
    '/js/userSettings.js',
    '/js/logger.js',
    '/js/admin.js',
    '/js/kpi-analysis.js',
    '/js/performance.js',
    '/js/imageCompression.js',
    '/js/device-detection.js',
    '/js/mobile-nav.js',
    '/js/clients.js',
    '/js/training.js',
    '/js/user-blocking.js',
    '/assets/favicons/bpal-logo.png',
    '/assets/favicons/favicon.ico',
    '/assets/favicons/favicon-32.png',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-512.png',
    '/vendor/tailwind/tailwind.js',
    '/vendor/quill/quill.min.js',
    '/vendor/quill/quill.snow.css',
];

// ── INSTALL: pre-cache the app shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            // addAll fails if any request fails — use individual add with catch to be resilient
            return Promise.allSettled(
                STATIC_ASSETS.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[SW] Failed to cache:', url, err.message);
                    })
                )
            );
        })
    );
    // Take control immediately without waiting for old SW to stop
    self.skipWaiting();
});

// ── ACTIVATE: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version:', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== STATIC_CACHE)
                    .map((key) => {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    })
            )
        )
    );
    // Take control of all clients immediately
    self.clients.claim();
});

// ── FETCH: cache-first for static assets, bypass for API/Supabase ─────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle GET requests
    if (request.method !== 'GET') return;

    // Skip Supabase API calls (always need fresh data)
    if (url.hostname.includes('supabase.co')) return;

    // Skip external CDN resources (fonts, chart.js, dompurify, etc.)
    if (
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('esm.sh')
    ) return;

    // Skip Vercel API routes (serverless functions — always network)
    if (url.pathname.startsWith('/api/')) return;

    // Cache-first strategy for everything else (static app shell)
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }
            // Not in cache — fetch from network and cache for next time
            return fetch(request).then((response) => {
                // Only cache successful responses
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
                }
                return response;
            }).catch(() => {
                // Offline fallback — return index.html for navigation requests
                if (request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
