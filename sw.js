// TeamsOps Service Worker
// Cache version: bump on deploy to invalidate old caches
const CACHE_VERSION = 'teamsops-v49';
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

self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            // addAll fails if any request fails; cache files individually for resiliency
            return Promise.allSettled(
                STATIC_ASSETS.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[SW] Failed to cache:', url, err.message);
                    })
                )
            );
        })
    );
    self.skipWaiting();
});

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
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    const isHttpRequest = url.protocol === 'http:' || url.protocol === 'https:';

    if (request.method !== 'GET') return;
    if (!isHttpRequest) return;

    // Always bypass API/data calls
    if (url.hostname.includes('supabase.co')) return;
    if (
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('esm.sh')
    ) return;
    if (url.pathname.startsWith('/api/')) return;

    const isSameOrigin = url.origin === self.location.origin;
    const isAppCodeRequest = isSameOrigin && (
        url.pathname === '/' ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css')
    );

    // Network-first for app code to avoid stale business logic on mobile/PWA.
    if (isAppCodeRequest) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() =>
                    caches.match(request).then((cached) => {
                        if (cached) return cached;
                        if (request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    })
                )
        );
        return;
    }

    // Cache-first for non-code static assets
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }

            return fetch(request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    if (request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                });
        })
    );
});
