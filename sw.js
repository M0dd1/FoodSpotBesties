// Service Worker: App offline verfügbar machen und Kartenkacheln zwischenspeichern.
// Die App startet immer sofort aus dem Speicher (auch bei schlechtem Netz).
// Neue Versionen kommen über einen neuen Service Worker: Netlify setzt bei jedem Deploy BUILD,
// dadurch ändert sich diese Datei, der Browser installiert sie und lädt alle Dateien vorab neu.
const BUILD = '__BUILD__';
const VERSION = `foodispots-v2.0.0-${BUILD}`;
const SHELL = `${VERSION}-shell`;
const TILES = 'foodispots-tiles';
const MAX_TILES = 3000;

const SHELL_FILES = [
  './', './index.html', './styles.css', './config.js', './cuisines.js', './exif.js', './manifest.webmanifest',
  './js/main.js', './js/core.js', './js/ui.js', './js/auth.js', './js/start.js', './js/groups.js', './js/sync.js', './js/photos.js', './js/map.js',
  './js/list.js', './js/views.js', './js/lookup.js', './js/spots.js', './js/ratings.js', './js/settings.js', './js/admin.js', './js/invites.js',
  './js/conflicts.js', './js/trash.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
];

self.addEventListener('install', (e) => {
  // Alles oder nichts: Fehlt eine Datei (schlechtes Netz), bleibt die bisherige Version aktiv und es wird später neu versucht
  // Eigene Dateien sind Pflicht, Bibliotheken vom CDN optional (sie werden sonst beim ersten Laden gemerkt)
  const own = SHELL_FILES.filter((u) => u.startsWith('./')), libs = SHELL_FILES.filter((u) => !u.startsWith('./'));
  e.waitUntil(caches.open(SHELL).then(async (c) => {
    await c.addAll(own.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.allSettled(libs.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    // Bibliotheken der Vorversion übernehmen, falls das CDN gerade nicht erreichbar war (feste Versionen, ändern sich nie)
    for (const u of libs) if (!(await c.match(u))) { const old = await caches.match(u); if (old) await c.put(u, old); }
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isTile = (url) => /tile\.openstreetmap\.org|arcgisonline\.com/.test(url.hostname);
const isLib = (url) => /unpkg\.com|cdn\.jsdelivr\.net/.test(url.hostname);

// Bei schwachem Netz nicht ewig warten
const fetchWithTimeout = (req, ms) => Promise.race([
  fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.co$/.test(url.hostname)) return; // Daten nie aus dem Cache

  // Kartenkacheln: Cache zuerst, sonst laden und merken
  if (isTile(url)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Eigene Dateien & Bibliotheken: Speicher zuerst (sofortiger Start), sonst Netz und merken
  if (url.origin === location.origin || isLib(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const nav = req.mode === 'navigate';
      // Seitenaufrufe mit ?view=, ?join= … sind immer dieselbe index.html
      const hit = await cache.match(nav ? './' : req, { ignoreSearch: nav }) || (nav && await cache.match('./index.html'));
      if (hit) return hit;
      try {
        const res = await fetchWithTimeout(req, nav ? 8000 : 15000);
        if (res.ok && req.method === 'GET') cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
});
