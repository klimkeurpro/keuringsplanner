const CACHE = 'keuringsplanner-v1';
const STATIC = ['/', '/keuringsplanner/', '/keuringsplanner/index.html', '/keuringsplanner/app.js', '/keuringsplanner/supabase.js', '/keuringsplanner/config.js'];

self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });

self.addEventListener('fetch', function(e) {
  // Supabase API calls altijd live ophalen
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return response;
      }).catch(function() { return cached; });
    })
  );
});
