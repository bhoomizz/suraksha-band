// Offline support: the app shell is served from cache, and GET API calls fall back to their last cached response.
const CACHE = "suraksha-v1";
const SHELL = [
  "./", "index.html", "app.css", "app.js", "i18n.js", "manifest.json", "icon.svg",
  "../shared/theme.css", "../shared/common.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POSTs are queued by the app itself
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  // Map tiles: cache the ones the tourist has already seen so the map works offline.
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE + "-tiles").then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }

  // App shell: network first so updates show up, then fall back to the cache.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
});
