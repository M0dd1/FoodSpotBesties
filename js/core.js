// FoodiSpots – Grundlagen: Hilfsfunktionen, Supabase-Client, IndexedDB, gemeinsamer Zustand

// ------------------------------------------------------------------
// Grundlagen
// ------------------------------------------------------------------
export const APP_VERSION = '2.1.0';
export const cfg = window.FOODI_CONFIG || {};
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

// Lese-, Einladungs- und Direktlinks gehören nicht in Suchmaschinen (zusätzlich zu robots.txt)
if (/[?&](view|join|invite|group|spot)=/.test(location.search)) {
  const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow, noarchive';
  document.head.appendChild(m);
}

// Lese-Link: Fotos gibt der Server nur heraus, wenn der Link-Schlüssel mitgeschickt wird
const shareToken = new URLSearchParams(location.search).get('view');
export const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'foodispots-auth' },
  ...(shareToken ? { global: { headers: { 'x-foodi-share': shareToken } } } : {}),
});
export const BUCKET = 'food-photos';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Nur http(s)-Links zulassen (Daten aus OpenStreetMap/Recherche sind fremde Eingaben)
export const safeUrl = (u) => {
  const s = String(u || '').trim(); if (!s) return '';
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
};
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));
export const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
export const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const fmtNum = (n, d = 1) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPrice = (c) => c == null ? '' : (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export const euro = (n) => (n ? '€'.repeat(n) : '');
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Anmeldename → interne Anmelde-Adresse (identisch zu login_email() in der Datenbank).
// .invalid ist eine reservierte Endung – das ist nie eine echte E-Mail-Adresse.
export const USERNAME_RULE = /^[A-Za-zÄÖÜäöüß0-9._-]{3,30}$/;
export const validUsername = (n) => USERNAME_RULE.test(String(n || '').trim());
export const loginSlug = (n) => String(n || '').trim().toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
export const loginEmail = (n) => `${loginSlug(n)}@nutzer.foodispots.invalid`;
export const USERNAME_HINT = '3–30 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich (keine Leerzeichen).';

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isNetErr = (e) => !navigator.onLine ||
  /fetch|network|load failed|timeout|offline|ECONN/i.test(String(e?.message || e || ''));
export const TRASH_DAYS = 30;

export function toast(msg, isError = false, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg; el.classList.toggle('error', isError); el.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const fmtDist = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;

// ------------------------------------------------------------------
// Restaurants: Art, Länderküche, Noten
// ------------------------------------------------------------------
export const CATEGORIES = {
  restaurant: 'Restaurant', imbiss: 'Imbiss', cafe: 'Café', bar: 'Bar / Kneipe',
  foodtruck: 'Foodtruck', eis: 'Eisdiele', baeckerei: 'Bäckerei / Konditorei', sonstiges: 'Sonstiges',
};
export const CAT_EMOJI = { restaurant: '🍽️', imbiss: '🥙', cafe: '☕', bar: '🍻', foodtruck: '🚚', eis: '🍨', baeckerei: '🥐', sonstiges: '🍴' };
export const SUBSCORES = [['food', 'Essen'], ['service', 'Service'], ['ambience', 'Ambiente'], ['value', 'Preis-Leistung']];

// Länderküchen: aus der Datenbank (Cache), sonst Ersatzliste aus cuisines.js
export function setCuisines(list) {
  state.cuisines = new Map((list?.length ? list : window.FOODI_CUISINES || []).map((c) => [c.key, c]));
}
export const cuisineOf = (k) => state.cuisines.get(k);
export const cuisineNames = (keys) => (keys || []).map((k) => cuisineOf(k)?.name_de || k).join(' · ');
export const cuisineChips = (keys) => (keys || []).map((k) => { const c = cuisineOf(k); return c ? `${c.emoji} ${c.name_de}` : k; }).join(' · ');
export const spotEmoji = (s) => (s.cuisines || []).map(cuisineOf).find(Boolean)?.emoji || CAT_EMOJI[s.category] || '🍽️';
export const regionsOf = () => {
  const order = window.FOODI_REGIONS || [];
  const set = [...new Set([...state.cuisines.values()].map((c) => c.region))];
  return set.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
};

// Farbverlauf der Durchschnittsnote: 1 rot → 5 grün
const STOPS = [[1, [192, 57, 43]], [2, [230, 126, 34]], [3, [232, 184, 18]], [4, [124, 179, 66]], [5, [46, 125, 50]]];
export function ratingColor(v) {
  if (v == null) return 'var(--empty)';
  v = Math.max(1, Math.min(5, Number(v)));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
    if (v <= b) { const t = (v - a) / (b - a); return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * t)).join(',')})`; }
  }
  return 'rgb(46,125,50)';
}
export function starsHtml(n, max = 5) {
  if (n == null) return '';
  const r = Math.round(n);
  return `<span class="stars-static" aria-label="${fmtNum(n, n % 1 ? 1 : 0)} von 5 Sternen">${'★'.repeat(r)}<span class="off">${'★'.repeat(max - r)}</span></span>`;
}

// ------------------------------------------------------------------
// IndexedDB: lokale Kopie, Warteschlange, Fotos
// ------------------------------------------------------------------
export const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('foodispots', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    put: (store, val, key) => tx(store, 'readwrite', (s) => key === undefined ? s.put(val) : s.put(val, key)),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
  };
})();

// ------------------------------------------------------------------
// Zustand
// ------------------------------------------------------------------
export const TABLES = ['spots', 'ratings', 'dishes', 'spot_wants', 'visits', 'comments'];
export const freshFilters = () => ({
  status: 'all', cuisines: new Set(), regions: new Set(), prices: new Set(), minRating: 0,
  category: '', veg: false, vegan: false, notMine: false, openNow: false, who: 'all',
});
export const state = {
  user: null,
  profile: null,
  groups: [],          // [{id,name,invite_code,share_token,created_by,role}]
  groupId: null,
  server: emptyData(), // Stand vom Server (bzw. Cache)
  data: emptyData(),   // Server + lokale, noch nicht hochgeladene Änderungen
  pendingIds: new Set(),
  outbox: [],
  filters: freshFilters(),
  cuisines: new Map(),
  myPos: null,
  watchId: null,
  channel: null,
  syncing: false,
  openSpotId: null,
  pickMode: false,
  pickMarker: null,
  view: 'map',
};
export function emptyData() {
  return { spots: [], ratings: [], dishes: [], spot_wants: [], visits: [], comments: [], members: [], profiles: {}, trash: { spots: [], dishes: [] } };
}
export const currentGroup = () => state.groups.find((g) => g.id === state.groupId);
export const isAdmin = () => currentGroup()?.role === 'admin';
export const nameOf = (uid) => state.publicMode ? 'Mitglied' : uid === state.user?.id ? 'Ich' : (state.data.profiles[uid] || 'Ehemaliges Mitglied');
export const canEdit = (row) => !state.publicMode && row && (row.created_by === state.user?.id || isAdmin());
export const isMine = (row) => !state.publicMode && row && row.created_by === state.user?.id;
setCuisines(null);
