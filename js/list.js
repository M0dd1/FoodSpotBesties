// FoodiSpots – Verzeichnisse je Spot, Filter, Öffnungszeiten
import { $, $$, CATEGORIES, cuisineOf, esc, freshFilters, nameOf, regionsOf, state } from './core.js';
import { head, openSheet } from './ui.js';
import { renderAll } from './views.js';

// ------------------------------------------------------------------
// Verzeichnisse: einmal pro Datenstand aufbauen (statt bei jedem Aufruf alles zu durchsuchen)
// ------------------------------------------------------------------
const NONE = Object.freeze([]);
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const l = m.get(r[key]); if (l) l.push(r); else m.set(r[key], [r]); } return m; };
export function buildIndexes(d) {
  const ratingsBySpot = group(d.ratings, 'spot_id'), dishesBySpot = group(d.dishes, 'spot_id'), dishesByRating = group(d.dishes, 'rating_id');
  const wantsBySpot = group(d.spot_wants, 'spot_id'), commentsBySpot = group(d.comments, 'spot_id'), visitsBySpot = group(d.visits, 'spot_id');
  for (const l of ratingsBySpot.values()) l.sort((a, b) => (b.visited_on || '').localeCompare(a.visited_on || '') || (b.updated_at || '').localeCompare(a.updated_at || ''));
  for (const l of commentsBySpot.values()) l.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const me = state.user?.id;
  const stats = new Map();
  for (const s of d.spots) {
    const rs = ratingsBySpot.get(s.id) || NONE, ws = wantsBySpot.get(s.id) || NONE, ds = dishesBySpot.get(s.id) || NONE;
    const pub = state.publicMode;
    const count = pub ? Number(s.rating_count || 0) : rs.length;
    const avg = pub ? (s.avg_overall != null ? Number(s.avg_overall) : null) : (count ? rs.reduce((a, r) => a + r.overall, 0) / count : null);
    const withImg = ds.filter((x) => x.thumb_path || x.photo_path);
    const cover = withImg.sort((a, b) => (b.stars || 0) - (a.stars || 0) || (b.created_at || '').localeCompare(a.created_at || ''))[0] || null;
    const visits = visitsBySpot.get(s.id) || NONE;
    const lastVisit = [...rs.map((r) => r.visited_on), ...visits.map((v) => v.visited_on)].filter(Boolean).sort().pop() || null;
    stats.set(s.id, {
      avg, count, wants: pub ? Number(s.want_count || 0) : ws.length, iWant: !!me && ws.some((w) => w.created_by === me),
      myRating: rs.find((r) => r.created_by === me) || null, lastVisit, visited: count > 0, cover,
    });
  }
  Object.assign(d, { ratingsBySpot, dishesBySpot, dishesByRating, wantsBySpot, commentsBySpot, visitsBySpot, stats });
}
export const statsOf = (id) => state.data.stats?.get(id) || { avg: null, count: 0, wants: 0, iWant: false, myRating: null, lastVisit: null, visited: false, cover: null };
export const ratingsOf = (id) => state.data.ratingsBySpot?.get(id) || NONE;
export const dishesOf = (id) => state.data.dishesBySpot?.get(id) || NONE;
export const dishesOfRating = (id) => state.data.dishesByRating?.get(id) || NONE;
export const commentsOf = (id) => state.data.commentsBySpot?.get(id) || NONE;
export const wantsOf = (id) => state.data.wantsBySpot?.get(id) || NONE;
export const visitsOf = (id) => state.data.visitsBySpot?.get(id) || NONE;
export const isVisited = (s) => statsOf(s.id).visited;

// ------------------------------------------------------------------
// Öffnungszeiten im OpenStreetMap-Format (häufige Schreibweisen)
// z. B. „Mo-Fr 11:30-14:00,17:30-22:00; Sa 12:00-23:00; Su off“ oder „24/7“
// Ergebnis: true (geöffnet), false (geschlossen), null (unbekannt/nicht lesbar)
// ------------------------------------------------------------------
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function parseDays(spec) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const p = part.trim(); if (!p) continue;
    const r = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(p);
    if (!r) { if (p === 'PH' || p === 'SH') continue; return null; }
    const a = DAYS.indexOf(r[1]), b = r[2] ? DAYS.indexOf(r[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let i = a; ; i = (i + 1) % 7) { set.add(i); if (i === b) break; }
  }
  return set;
}
export function openState(oh, now = new Date()) {
  const s = String(oh || '').trim();
  if (!s) return null;
  if (s === '24/7') return true;
  const day = (now.getDay() + 6) % 7, min = now.getHours() * 60 + now.getMinutes();
  const prev = (day + 6) % 7;
  const ranges = Array.from({ length: 7 }, () => null);   // je Wochentag Liste [von, bis] oder [] (zu)
  for (const ruleRaw of s.split(';')) {
    const rule = ruleRaw.trim(); if (!rule) continue;
    const m = /^((?:(?:[A-Z][a-z](?:-[A-Z][a-z])?|PH|SH),?\s*)+)?\s*(.*)$/.exec(rule);
    const days = m[1] ? parseDays(m[1].replace(/\s+/g, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const times = m[2].trim();
    let list;
    if (/^(off|closed)$/i.test(times)) list = [];
    else {
      list = [];
      for (const t of times.split(',')) {
        const r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\+?$/.exec(t.trim());
        if (!r) return null;
        list.push([toMin(r[1]), toMin(r[2])]);
      }
    }
    for (const d of days) ranges[d] = list;
  }
  if (!ranges.some(Boolean)) return null;
  const inRange = (list, m, overnightOnly = false) => (list || []).some(([a, b]) => {
    if (b > a) return !overnightOnly && m >= a && m < b;
    return overnightOnly ? m < b : m >= a;   // über Mitternacht
  });
  return inRange(ranges[day], min) || inRange(ranges[prev], min, true);
}

// ------------------------------------------------------------------
// Filter
// ------------------------------------------------------------------
export function filteredSpots() {
  const f = state.filters, me = state.user?.id;
  return state.data.spots.filter((s) => {
    const st = statsOf(s.id);
    if (f.status === 'wish' && st.visited) return false;
    if (f.status === 'visited' && !st.visited) return false;
    if (f.cuisines.size && !(s.cuisines || []).some((k) => f.cuisines.has(k))) return false;
    if (f.regions.size && !(s.cuisines || []).some((k) => f.regions.has(cuisineOf(k)?.region))) return false;
    if (f.prices.size && !f.prices.has(s.price_level)) return false;
    if (f.minRating && !(st.avg >= f.minRating)) return false;
    if (f.category && s.category !== f.category) return false;
    if (f.veg && !s.diet_veg && !s.diet_vegan) return false;
    if (f.vegan && !s.diet_vegan) return false;
    if (f.notMine && st.myRating) return false;
    if (f.openNow && openState(s.opening_hours) !== true) return false;
    if (f.who === 'mine' && s.created_by !== me) return false;
    if (f.who !== 'all' && f.who !== 'mine' && s.created_by !== f.who) return false;
    return true;
  });
}
export const filterCount = () => {
  const f = state.filters;
  return (f.status !== 'all') + (f.cuisines.size > 0) + (f.regions.size > 0) + (f.prices.size > 0) + (f.minRating > 0)
    + !!f.category + f.veg + f.vegan + f.notMine + f.openNow + (f.who !== 'all');
};

$('#btn-filter').addEventListener('click', openFilter);
export function openFilter() {
  const f = state.filters;
  const used = new Set(state.data.spots.flatMap((s) => s.cuisines || []));
  const cuisines = [...state.cuisines.values()].filter((c) => used.has(c.key) || f.cuisines.has(c.key)).sort((a, b) => a.sort - b.sort);
  const regions = regionsOf().filter((r) => cuisines.some((c) => c.region === r));
  const people = state.publicMode ? [] : state.data.members.map((m) => m.user_id).filter((id) => id !== state.user.id);
  const n = filteredSpots().length;
  const chip = (on, attrs, label) => `<button class="chip${on ? ' on' : ''}" ${attrs} type="button">${label}</button>`;
  const body = openSheet(`${head('Filter')}
    <h3 style="margin-top:0">Status</h3>
    <div class="chips">${[['all', 'Alle'], ['wish', '🕓 Wunschliste'], ['visited', '✓ Besucht']].map(([k, l]) => chip(f.status === k, `data-status="${k}"`, l)).join('')}</div>
    <h3>Länderküche</h3>
    <div class="chips">${cuisines.map((c) => chip(f.cuisines.has(c.key), `data-cuisine="${c.key}"`, `${c.emoji} ${esc(c.name_de)}`)).join('') || '<span class="small muted">Noch keine Küchen eingetragen.</span>'}</div>
    ${regions.length > 1 ? `<h3>Region</h3><div class="chips">${regions.map((r) => chip(f.regions.has(r), `data-region="${esc(r)}"`, esc(r))).join('')}</div>` : ''}
    <h3>Preis</h3>
    <div class="chips">${[1, 2, 3, 4].map((p) => chip(f.prices.has(p), `data-price="${p}"`, '€'.repeat(p))).join('')}</div>
    <h3>Mindestnote</h3>
    <div class="chips">${[[0, 'egal'], [3, '3+ ★'], [4, '4+ ★'], [4.5, '4,5+ ★']].map(([v, l]) => chip(f.minRating === v, `data-min="${v}"`, l)).join('')}</div>
    <h3>Art</h3>
    <div class="chips">${chip(!f.category, 'data-cat=""', 'Alle')}${Object.entries(CATEGORIES).map(([k, l]) => chip(f.category === k, `data-cat="${k}"`, l)).join('')}</div>
    <h3>Sonstiges</h3>
    <div class="chips">
      ${chip(f.openNow, 'data-flag="openNow"', '🕒 Jetzt geöffnet')}
      ${chip(f.veg, 'data-flag="veg"', '🥦 vegetarisch')}
      ${chip(f.vegan, 'data-flag="vegan"', '🌱 vegan')}
      ${state.publicMode ? '' : chip(f.notMine, 'data-flag="notMine"', 'Noch nicht von mir bewertet')}
    </div>
    ${state.publicMode ? '' : `<h3>Eingetragen von</h3>
    <div class="chips">${chip(f.who === 'all', 'data-who="all"', 'Alle')}${chip(f.who === 'mine', 'data-who="mine"', 'Mir')}${people.map((id) => chip(f.who === id, `data-who="${id}"`, esc(nameOf(id)))).join('')}</div>`}
    <div class="row" style="margin-top:20px">
      <button class="btn" id="f-reset" type="button">Zurücksetzen</button>
      <button class="btn primary" style="flex:1" data-close type="button" id="f-done">${n} Spot${n === 1 ? '' : 's'} anzeigen</button>
    </div>`, 'filter');
  const apply = () => { const top = body.scrollTop; renderAll(false); openFilter(); $('#sheet-body').scrollTop = top; };
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
  $$('[data-status]', body).forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.status; apply(); }));
  $$('[data-cuisine]', body).forEach((b) => b.addEventListener('click', () => { toggle(f.cuisines, b.dataset.cuisine); apply(); }));
  $$('[data-region]', body).forEach((b) => b.addEventListener('click', () => { toggle(f.regions, b.dataset.region); apply(); }));
  $$('[data-price]', body).forEach((b) => b.addEventListener('click', () => { toggle(f.prices, Number(b.dataset.price)); apply(); }));
  $$('[data-min]', body).forEach((b) => b.addEventListener('click', () => { f.minRating = Number(b.dataset.min); apply(); }));
  $$('[data-cat]', body).forEach((b) => b.addEventListener('click', () => { f.category = b.dataset.cat; apply(); }));
  $$('[data-flag]', body).forEach((b) => b.addEventListener('click', () => { f[b.dataset.flag] = !f[b.dataset.flag]; apply(); }));
  $$('[data-who]', body).forEach((b) => b.addEventListener('click', () => { f.who = b.dataset.who; apply(); }));
  $('#f-reset', body).addEventListener('click', () => { state.filters = freshFilters(); apply(); });
}
