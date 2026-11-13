// FoodiSpots – Karte, Marker, Stapel und Auffächern
import { $, cfg, esc, fmtNum, ratingColor, spotEmoji, state, toast } from './core.js';
import { filteredSpots, statsOf } from './list.js';
import { openSpot, startManualSpot } from './spots.js';

// ------------------------------------------------------------------
// Karte
// ------------------------------------------------------------------
export let map, markerLayer, meMarker, layers, currentLayer = 'map';
export function initMap() {
  if (map) return;
  const st = cfg.START || { lat: 50.3569, lng: 7.589, zoom: 13 };
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([st.lat, st.lng], st.zoom);
  layers = {
    map: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
    }),
  };
  currentLayer = localStorage.getItem('foodi.layer') === 'sat' ? 'sat' : 'map';
  layers[currentLayer].addTo(map);
  $('#btn-layer').classList.toggle('active', currentLayer === 'sat');
  markerLayer = L.layerGroup().addTo(map);

  // Langes Drücken (bzw. Rechtsklick) auf die Karte: Spot an dieser Stelle eintragen
  map.on('contextmenu', (e) => { if (!state.publicMode) startManualSpot({ lat: e.latlng.lat, lng: e.latlng.lng }); });
  map.on('click', (e) => {
    if (spider.active && !state.pickMode) return unspiderfy();
    if (state.pickMode) { state.pickMode = false; $('#map-hint').classList.add('hidden'); startManualSpot({ lat: e.latlng.lat, lng: e.latlng.lng }); }
  });
  try {
    if (!state.publicMode && !localStorage.getItem('foodi.hintShown')) {
      $('#map-hint').classList.remove('hidden');
      setTimeout(() => $('#map-hint').classList.add('hidden'), 7000);
      localStorage.setItem('foodi.hintShown', '1');
    }
  } catch {}
  map.on('zoomstart', () => unspiderfy(true));
  map.on('moveend', updateViewport);   // nach Verschieben/Zoomen: Marker des neuen Ausschnitts
}

$('#btn-layer').addEventListener('click', () => {
  map.removeLayer(layers[currentLayer]);
  currentLayer = currentLayer === 'map' ? 'sat' : 'map';
  layers[currentLayer].addTo(map);
  $('#btn-layer').classList.toggle('active', currentLayer === 'sat');
  try { localStorage.setItem('foodi.layer', currentLayer); } catch {}
});
$('#btn-locate').addEventListener('click', () => {
  if (state.myPos) map.setView([state.myPos.lat, state.myPos.lng], Math.max(map.getZoom(), 15));
  else { toast('Standort wird ermittelt …'); startWatch(true); }
});

export function startWatch(center) {
  if (!navigator.geolocation) return;
  if (state.watchId != null) { if (center) state._centerOnFix = true; return; }
  state._centerOnFix = center;
  state.watchId = navigator.geolocation.watchPosition((p) => {
    state.myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    if (!map) return;
    if (!meMarker) {
      meMarker = L.marker([state.myPos.lat, state.myPos.lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false, zIndexOffset: 100000,
      }).addTo(map);
    } else meMarker.setLatLng([state.myPos.lat, state.myPos.lng]);
    if (state._centerOnFix) { state._centerOnFix = false; map.setView([state.myPos.lat, state.myPos.lng], 15); }
    if (!state._fitted && !state.data.spots.length) { state._fitted = true; map.setView([state.myPos.lat, state.myPos.lng], 14); }
  }, (err) => {
    state.watchId = null;
    if (center) toast(err.code === 1 ? 'Standortzugriff verweigert. Bitte in den Browser-Einstellungen erlauben.' : 'Standort nicht verfügbar.', true, 5000);
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
}

// ------------------------------------------------------------------
// Marker: Tropfen mit Küchen-Flagge. Grau = Wunschliste, farbig = Durchschnittsnote
// Marker werden wiederverwendet und nur im sichtbaren Ausschnitt gezeichnet;
// bei sehr vielen Spots auf dem Bildschirm zu Gruppen mit Zahl zusammengefasst.
// ------------------------------------------------------------------
export let spotMarkers = [];
export const STACK_PX = 24;
export const spider = { active: null };
export const MAX_MARKERS = 250;
const CLUSTER_PX = 96;
const markerCache = new Map();
let currentSpots = [];
let clusterLayer = null;

const layerOf = (st) => st.visited ? 20000 + Math.round((st.avg || 0) * 1000) : 10000 + Math.min(st.wants, 99);
function markerSig(s, st) {
  return [s.lat, s.lng, s.name, (s.cuisines || []).join(','), s.category, st.avg, st.count, st.wants, state.pendingIds.has(s.id)].join('|');
}
function markerFor(s) {
  const st = statsOf(s.id);
  const sig = markerSig(s, st);
  const c = markerCache.get(s.id);
  if (c && c.sig === sig) { c.m._spot = s; return c.m; }
  if (c) markerLayer.removeLayer(c.m);
  const wish = !st.visited;
  const icon = L.divIcon({
    className: '',
    html: `<div class="mk"><div class="pin${wish ? ' wish' : ''}${state.pendingIds.has(s.id) ? ' pending' : ''}" style="--c:${ratingColor(st.avg)}"></div>`
      + `<span class="pin-e">${esc(spotEmoji(s))}</span>${wish && st.wants > 1 ? `<span class="pin-n">${st.wants}</span>` : ''}<span class="mk-count hidden"></span></div>`,
    iconSize: [40, 48], iconAnchor: [20, 46],
  });
  const z = layerOf(st);
  const m = L.marker([s.lat, s.lng], { icon, title: `${s.name}${st.visited ? ` · ${fmtNum(st.avg)} ★` : ' · Wunschliste'}`, zIndexOffset: z });
  m._spot = s; m._z = z; m._home = L.latLng(s.lat, s.lng);
  m.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (spider.active && spider.active.markers.includes(m)) return openSpot(m._spot.id);
    const stack = stackOf(m);
    if (stack.length > 1) return spiderfy(stack);
    unspiderfy();
    openSpot(m._spot.id);
  });
  markerCache.set(s.id, { sig, m });
  return m;
}

export function renderMarkers() {
  if (!markerLayer) return;
  const keepOpen = spider.active ? spider.active.markers.map((m) => m._spot.id) : null;
  unspiderfy(true);
  currentSpots = filteredSpots();
  const alive = new Set(currentSpots.map((s) => s.id));
  for (const [id, c] of markerCache) if (!alive.has(id)) { markerLayer.removeLayer(c.m); markerCache.delete(id); }
  updateViewport();
  if (keepOpen) {
    const again = spotMarkers.filter((m) => keepOpen.includes(m._spot.id));
    if (again.length > 1) spiderfy(again, true);
  }
}

export function updateViewport() {
  if (!map || !markerLayer || spider.active) return;
  if (!clusterLayer) clusterLayer = L.layerGroup().addTo(map);
  clusterLayer.clearLayers();
  const screen = map.getBounds(), b = screen.pad(0.4);
  const inView = currentSpots.filter((s) => b.contains([s.lat, s.lng]));
  let singles = inView;
  if (inView.reduce((n, s) => n + (screen.contains([s.lat, s.lng]) ? 1 : 0), 0) > MAX_MARKERS) {
    const cells = new Map();
    for (const s of inView) {
      const pt = map.latLngToLayerPoint([s.lat, s.lng]);
      const k = Math.floor(pt.x / CLUSTER_PX) + ',' + Math.floor(pt.y / CLUSTER_PX);
      const c = cells.get(k); if (c) c.push(s); else cells.set(k, [s]);
    }
    singles = [];
    for (const list of cells.values()) {
      if (list.length === 1) { singles.push(list[0]); continue; }
      clusterMarker(list).addTo(clusterLayer);
    }
  }
  const want = new Set(singles.map((s) => s.id));
  for (const [id, c] of markerCache) if (!want.has(id) && markerLayer.hasLayer(c.m)) markerLayer.removeLayer(c.m);
  spotMarkers = singles.map((s) => { const m = markerFor(s); if (!markerLayer.hasLayer(m)) m.addTo(markerLayer); return m; });
  updateStackBadges();
}

// Gruppe mit Zahl: Ring zeigt die Anteile (grau = Wunschliste, sonst Notenfarbe)
const BUCKETS = [['wish', 'Wunschliste', 'var(--empty)'], ['1', 'unter 2 ★', '#c0392b'], ['2', '2–3 ★', '#e67e22'], ['3', '3–4 ★', '#e8b812'], ['4', 'ab 4 ★', '#2e7d32']];
const bucketOf = (st) => !st.visited ? 'wish' : st.avg < 2 ? '1' : st.avg < 3 ? '2' : st.avg < 4 ? '3' : '4';
function clusterMarker(list) {
  const counts = {}; let lat = 0, lng = 0;
  for (const s of list) { const k = bucketOf(statsOf(s.id)); counts[k] = (counts[k] || 0) + 1; lat += s.lat; lng += s.lng; }
  const size = list.length < 10 ? 38 : list.length < 100 ? 44 : 52;
  let acc = 0;
  const stops = BUCKETS.filter(([k]) => counts[k]).map(([k, , col]) => {
    const from = acc; acc += counts[k] / list.length * 360;
    return `${col} ${from.toFixed(1)}deg ${acc.toFixed(1)}deg`;
  }).join(', ');
  const detail = BUCKETS.filter(([k]) => counts[k]).map(([k, l]) => `${counts[k]}× ${l}`).join(', ');
  const m = L.marker([lat / list.length, lng / list.length], {
    icon: L.divIcon({ className: '', html: `<div class="mk-cluster" style="width:${size}px;height:${size}px;--ring:conic-gradient(${stops})"><b>${list.length}</b></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
    title: `${list.length} Spots (${detail}) – antippen zum Hineinzoomen`, zIndexOffset: 1000,
  });
  m.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    map.fitBounds(L.latLngBounds(list.map((s) => [s.lat, s.lng])).pad(0.15), { maxZoom: Math.max(map.getZoom() + 2, 16) });
  });
  return m;
}

export function stackOf(m) {
  const p = map.latLngToLayerPoint(m._home);
  return spotMarkers.filter((o) => map.latLngToLayerPoint(o._home).distanceTo(p) < STACK_PX);
}
// Zahl am obersten Marker eines Stapels: „2 ✓ · 1 🕓“ (besucht / Wunschliste)
export function updateStackBadges() {
  if (!map) return;
  const seen = new Set();
  for (const m of spotMarkers) { const el = m.getElement()?.querySelector('.mk-count'); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
  const pts = new Map(), grid = new Map(), key = (x, y) => x + ',' + y;
  for (const m of spotMarkers) {
    const pt = map.latLngToLayerPoint(m._home); pts.set(m, pt);
    const k = key(Math.floor(pt.x / STACK_PX), Math.floor(pt.y / STACK_PX));
    const cell = grid.get(k); if (cell) cell.push(m); else grid.set(k, [m]);
  }
  const near = (m) => {
    const p = pts.get(m), cx = Math.floor(p.x / STACK_PX), cy = Math.floor(p.y / STACK_PX), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const o of grid.get(key(cx + dx, cy + dy)) || []) if (pts.get(o).distanceTo(p) < STACK_PX) out.push(o);
    return out;
  };
  for (const m of spotMarkers) {
    if (seen.has(m)) continue;
    const stack = near(m);
    stack.forEach((x) => seen.add(x));
    if (stack.length < 2) continue;
    const visited = stack.filter((x) => statsOf(x._spot.id).visited).length, wish = stack.length - visited;
    const top = stack.reduce((a, b) => (b._z > a._z ? b : a));
    const el = top.getElement()?.querySelector('.mk-count');
    if (!el) continue;
    el.innerHTML = [visited && `<span class="seg seg-ok" title="${visited}× besucht">${visited}✓</span>`, wish && `<span class="seg" title="${wish}× Wunschliste">${wish}🕓</span>`].filter(Boolean).join('');
    el.classList.remove('hidden');
  }
}

export function spiderfy(stack, quiet = false) {
  unspiderfy(true);
  const centerLL = stack[0]._home;
  const c = map.latLngToLayerPoint(centerLL);
  const n = stack.length;
  const ordered = [...stack].sort((a, b) => b._z - a._z);   // bestbewertete oben im Kreis
  const lines = [];
  map.getContainer().classList.add('spidering');
  ordered.forEach((m, i) => {
    let off;
    if (n <= 8) { const r = Math.max(50, n * 14), a = -Math.PI / 2 + (i * 2 * Math.PI) / n; off = L.point(Math.cos(a) * r, Math.sin(a) * r); }
    else { const a = i * 0.9 + 0.5, r = 38 + i * 8; off = L.point(Math.cos(a) * r, Math.sin(a) * r); }
    const ll = map.layerPointToLatLng(c.add(off));
    lines.push(L.polyline([centerLL, ll], { color: '#7a6f66', weight: 1.5, opacity: .8, dashArray: '3 3', interactive: false }).addTo(markerLayer));
    m.setLatLng(ll);
    m.setZIndexOffset(200000 + m._z / 100);
    m.getElement()?.querySelector('.mk-count')?.classList.add('hidden');
  });
  const dot = L.circleMarker(centerLL, { radius: 4, color: '#fff', weight: 2, fillColor: '#7a6f66', fillOpacity: 1, interactive: false }).addTo(markerLayer);
  spider.active = { markers: ordered, lines, dot };
  setTimeout(() => map.getContainer().classList.remove('spidering'), 300);
  if (!quiet) toast(`${n} Spots an dieser Stelle – zum Öffnen antippen.`, false, 2200);
}
export function unspiderfy(silent = false) {
  const sp = spider.active; if (!sp) return;
  spider.active = null;
  if (!silent && map) map.getContainer().classList.add('spidering');
  for (const m of sp.markers) { m.setLatLng(m._home); m.setZIndexOffset(m._z); }
  for (const l of sp.lines) markerLayer.removeLayer(l);
  markerLayer.removeLayer(sp.dot);
  updateStackBadges();
  if (!silent && map) setTimeout(() => map.getContainer().classList.remove('spidering'), 300);
}

export function fitToSpots() {
  const spots = filteredSpots();
  if (!spots.length) return false;
  map.fitBounds(L.latLngBounds(spots.map((s) => [s.lat, s.lng])).pad(0.2), { maxZoom: 16 });
  return true;
}
