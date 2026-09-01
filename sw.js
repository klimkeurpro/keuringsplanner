const CACHE = 'keuringsplanner-v1';
// Relatieve paden: de service worker draait binnen de scope van de app, dus
// deze lijst klopt ook als de app ooit onder een ander pad komt te staan.
// (De oude lijst begon met '/', dat was de root van github.io -- niet van ons.)
const STATIC = ['./', './index.html', './app.js', './supabase.js', './config.js', './manifest.json'];

self.addEventListener('install', function(e) {
  // De app-shell alvast in de cache zetten, zodat de eerste offline-start ook
  // werkt. Mislukt er een bestand, dan is dat niet fataal: de fetch-handler
  // hieronder vult de cache alsnog tijdens normaal gebruik.
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(STATIC); })
      .catch(function() {})
  );
  self.skipWaiting();
});
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });

self.addEventListener('fetch', function(e) {
  // Alleen GET: caches.put() weigert een POST of DELETE en dat gooit een
  // onafgevangen fout op. Andere methodes gaan gewoon rechtstreeks.
  if (e.request.method !== 'GET') return;
  // Supabase API calls altijd live ophalen
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          // Alleen wat echt uit onze eigen map komt bewaren; een CDN-antwoord
          // of een ondertekende foto-URL hoort hier niet in de cache.
          if (response.type === 'basic') {
            caches.open(CACHE).then(function(c) { c.put(e.request, clone); }).catch(function() {});
          }
        }
        return response;
      }).catch(function() { return cached; });
    })
  );
});
