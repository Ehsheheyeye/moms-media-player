const CACHE_NAME = 'moms-media-player-cache-v1';
const urlsToCache = [
    './', // Caches the root (index.html)
    './index.html',
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
    // Add any other static assets your app might use
];

// Install event: caches the app shell
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .catch((error) => {
                console.error('[Service Worker] Caching failed:', error);
            })
    );
});

// Activate event: cleans up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // This immediately takes control of the page, allowing navigation requests to be intercepted.
    return self.clients.claim();
});

// Fetch event: serves cached content first, then falls back to network
self.addEventListener('fetch', (event) => {
    // Only handle GET requests for navigation and static assets
    if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(event.request).then((response) => {
                // Cache hit - return response
                if (response) {
                    console.log('[Service Worker] Serving from cache:', event.request.url);
                    return response;
                }
                // No cache hit - fetch from network
                console.log('[Service Worker] Fetching from network:', event.request.url);
                return fetch(event.request);
            }).catch((error) => {
                console.error('[Service Worker] Fetch failed:', error);
                // You could return a fallback page here for offline scenarios
                // For example, caches.match('/offline.html');
            })
        );
    }
    // For other requests (e.g., cross-origin, POST), let the browser handle them
    return;
});

// Important: IndexedDB operations are handled directly by the main script (index.html)
// The service worker focuses on caching the app's static assets.
