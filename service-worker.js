// Define a unique cache name
const CACHE_NAME = 'offline-player-cache-v2';

// List of files that make up the app shell
const urlsToCache = [
    '/',
    'index.html',
    'style.css',
    'script.js',
    'manifest.json',
    'https://cdn.tailwindcss.com/',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2'
];

// Install event: opens the cache and adds the app shell files to it
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                // Use addAll to fetch and cache all the specified URLs
                return cache.addAll(urlsToCache);
            })
            .catch(err => {
                console.error('Failed to cache files during install:', err);
            })
    );
});

// Fetch event: serves assets from the cache first
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // If the request is in the cache, return the cached response
                if (response) {
                    return response;
                }
                // Otherwise, fetch the request from the network
                return fetch(event.request);
            })
    );
});

// Activate event: cleans up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // If the cache name is not in our whitelist, delete it
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
