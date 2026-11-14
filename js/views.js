// FoodiSpots – Ansichten: Liste, Länderküchen, Ansichtswechsel, „Wohin heute?“
import { $, $$, CATEGORIES, distance, esc, euro, fmtDist, fmtNum, freshFilters, nameOf, norm, ratingColor, regionsOf, spotEmoji, state, cuisineNames, toast } from './core.js';
import { closeSheet } from './ui.js';
import { updateSyncBadge } from './sync.js';
import { hydratePhotos } from './photos.js';
import { fitToSpots, map, renderMarkers, startWatch } from './map.js';
import { dishesOf, filterCount, filteredSpots, statsOf } from './list.js';
import { openSpot } from './spots.js';

// ------------------------------------------------------------------
// Liste (schrittweise: erst LIST_PAGE Einträge, beim Herunterscrollen die nächsten)
// ------------------------------------------------------------------
export const LIST_PAGE = 60;
let listRows = [], listShown = 0, listKey = '', listObserver = null;

export function spotRowHtml(s, dist) {
  const st = statsOf(s.id);
  const cover = s.image_thumb || s.image_path || st.cover?.thumb_path || st.cover?.photo_path;
  return `<li class="spot-item${st.visited ? '' : ' wish'}" data-id="${s.id}">
    <div class="spot-thumb"${cover ? ` data-bg="${esc(cover)}"` : ''}><span>${esc(spotEmoji(s))}</span></div>
    <div style="min-width:0;flex:1">
      <div class="title">${esc(s.name)}</div>
      <div class="meta">${esc([cuisineNames(s.cuisines) || CATEGORIES[s.category], euro(s.price_level), s.city].filter(Boolean).join(' · '))}</div>
      <div class="meta row" style="gap:6px;margin-top:3px">
        ${st.visited ? `<span class="score" style="background:${ratingColor(st.avg)}">${fmtNum(st.avg)} ★</span><span>${st.count} Bewertung${st.count === 1 ? '' : 'en'}</span>`
                     : `<span class="score wish">Wunschliste</span>${st.wants ? `<span>🙋 ${st.wants}</span>` : ''}`}
        ${dist != null ? `<span>· ${fmtDist(dist)}</span>` : ''}
        ${state.pendingIds.has(s.id) ? '<span>· ⟳</span>' : ''}
      </div>
    </div></li>`;
}

export function renderList() {
  const sort = $('#list-sort').value;
  const q = norm($('#list-search').value);
  const dishText = (id) => dishesOf(id).map((d) => d.name).join(' ');
  let rows = filteredSpots()
    .filter((s) => !q || norm([s.name, s.city, s.address, cuisineNames(s.cuisines), (s.focus || []).join(' '), (s.specialties || []).join(' '), dishText(s.id)].join(' ')).includes(q))
    .map((s) => ({ s, st: statsOf(s.id), dist: state.myPos ? distance(state.myPos, s) : null }));
  const by = {
    new: (a, b) => (b.s.created_at || '').localeCompare(a.s.created_at || ''),
    want: (a, b) => b.st.wants - a.st.wants || (b.s.created_at || '').localeCompare(a.s.created_at || ''),
    rating: (a, b) => (b.st.avg ?? -1) - (a.st.avg ?? -1) || b.st.count - a.st.count,
    distance: (a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12),
    name: (a, b) => a.s.name.localeCompare(b.s.name, 'de'),
  }[sort] || (() => 0);
  rows.sort(by);
  $('#list-count').textContent = `${rows.length} Spot${rows.length === 1 ? '' : 's'}`;
  const ul = $('#spot-list');
  listObserver?.disconnect();
  if (!rows.length) {
    listRows = []; listShown = 0;
    ul.innerHTML = `<li class="empty">${state.data.spots.length ? 'Keine Treffer für Filter oder Suche.' : 'Noch keine Spots.<br>Tippe auf <b>＋ Spot eintragen</b> und schreib z. B. „delphi koblenz“.'}</li>`;
    return;
  }
  const key = sort + '|' + q + '|' + JSON.stringify(state.filters, (k, v) => (v instanceof Set ? [...v] : v));
  if (key !== listKey) { listKey = key; listShown = 0; }
  listRows = rows;
  listShown = Math.min(rows.length, Math.max(listShown, LIST_PAGE));
  ul.innerHTML = rows.slice(0, listShown).map((r) => spotRowHtml(r.s, r.dist)).join('');
  addMoreRow(ul);
  hydratePhotos(ul);
}
function addMoreRow(ul) {
  $('.list-more', ul)?.remove();
  listObserver?.disconnect();
  const rest = listRows.length - listShown;
  if (rest <= 0) return;
  ul.insertAdjacentHTML('beforeend', `<li class="list-more"><button class="btn" type="button">Weitere ${Math.min(rest, LIST_PAGE)} von ${rest} anzeigen</button></li>`);
  const more = $('.list-more', ul);
  $('button', more).addEventListener('click', () => showMore(ul));
  if ('IntersectionObserver' in window) {
    listObserver = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) showMore(ul); }, { root: null, rootMargin: '400px' });
    listObserver.observe(more);
  }
}
function showMore(ul) {
  const from = listShown;
  listShown = Math.min(listRows.length, listShown + LIST_PAGE);
  if (listShown === from) return;
  $('.list-more', ul)?.remove();
  ul.insertAdjacentHTML('beforeend', listRows.slice(from, listShown).map((r) => spotRowHtml(r.s, r.dist)).join(''));
  addMoreRow(ul);
  hydratePhotos(ul);
}
// Ein Klick-Handler für alle Einträge (Liste und Länderküchen-Übersicht)
document.addEventListener('click', (e) => {
  const li = e.target.closest('.spot-item[data-id]');
  if (li && !li.closest('#sheet')) openSpot(li.dataset.id);
});
$('#list-search').addEventListener('input', () => renderList());
$('#list-sort').addEventListener('change', () => {
  if ($('#list-sort').value === 'distance' && !state.myPos) startWatch(false);
  renderList();
});

// ------------------------------------------------------------------
// Länderküchen: was habt ihr schon probiert?
// ------------------------------------------------------------------
export function renderCuisines() {
  const all = [...state.cuisines.values()].filter((c) => !['international', 'fusion'].includes(c.key)).sort((a, b) => a.sort - b.sort);
  const tried = new Map(), wished = new Map();
  for (const s of state.data.spots) for (const k of s.cuisines || []) {
    const m = statsOf(s.id).visited ? tried : wished; m.set(k, (m.get(k) || 0) + 1);
  }
  const n = all.filter((c) => tried.has(c.key)).length;
  const top = state.data.spots.filter((s) => statsOf(s.id).visited).sort((a, b) => statsOf(b.id).avg - statsOf(a.id).avg).slice(0, 3);
  const visitedN = state.data.spots.filter((s) => statsOf(s.id).visited).length;
  $('#cuisine-body').innerHTML = `
    <div class="card cuisine-hero">
      <div class="small muted caps">Länderküchen probiert</div>
      <div class="row" style="align-items:baseline"><span class="big-num">${n}</span><span class="muted">von ${all.length}</span></div>
      <div class="progress"><i style="width:${all.length ? (n / all.length) * 100 : 0}%"></i></div>
      <p class="small muted" style="margin:8px 0 0">${visitedN} besucht · ${state.data.spots.length - visitedN} auf der Wunschliste</p>
    </div>
    ${top.length ? `<h3>Eure Top-Spots</h3><ul class="spot-list">${top.map((s) => spotRowHtml(s, null)).join('')}</ul>` : ''}
    ${regionsOf().map((r) => {
      const list = all.filter((c) => c.region === r); if (!list.length) return '';
      return `<h3>${esc(r)}</h3><div class="cuisine-grid">${list.map((c) => {
        const t = tried.get(c.key), w = wished.get(c.key);
        return `<button type="button" class="cg ${t ? 'tried' : w ? 'wish' : 'todo'}" data-cg="${c.key}"><span class="f">${c.emoji}</span>${esc(c.name_de)}<small>${t ? `✓ ${t} besucht` : w ? `${w} auf der Liste` : 'noch offen'}</small></button>`;
      }).join('')}</div>`;
    }).join('')}`;
  hydratePhotos($('#cuisine-body'));
}
$('#cuisine-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cg]'); if (!b) return;
  state.filters = freshFilters(); state.filters.cuisines.add(b.dataset.cg);
  setView('list');
  toast('Filter gesetzt – über das Filter-Symbol wieder zurücksetzen.');
});

// ------------------------------------------------------------------
// Ansichtswechsel & alles neu zeichnen
// ------------------------------------------------------------------
export function setView(v) {
  state.view = v;
  $$('.viewtabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  for (const id of ['map', 'list', 'cuisines']) $('#view-' + id).classList.toggle('hidden', id !== v);
  if (v === 'map') setTimeout(() => map?.invalidateSize(), 30);
  renderAll(false);
}
$$('.viewtabs .tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

export function renderAll(fit) {
  renderMarkers();
  if (state.view === 'list') renderList();
  if (state.view === 'cuisines') renderCuisines();
  $('#filter-dot').classList.toggle('hidden', !filterCount());
  if (fit && map) state._fitted = fitToSpots() || state._fitted;
  const typing = document.activeElement && $('#sheet').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!typing && state.openSpotId && !$('#sheet').classList.contains('hidden') && state._sheetKind === 'spot') {
    if (state.data.spots.some((s) => s.id === state.openSpotId)) openSpot(state.openSpotId, true);
    else closeSheet();
  }
  if (!state.publicMode) updateSyncBadge();
}

// ------------------------------------------------------------------
// „Wohin heute?“ – Zufall aus der Wunschliste (mehr „Will ich auch“ = höhere Chance)
// ------------------------------------------------------------------
$('#btn-random').addEventListener('click', randomPick);
let lastPick = null;
export function randomPick() {
  // Nur Spots, bei denen ihr noch nicht wart: keine Bewertung und auch kein eingetragener Besuch
  let pool = filteredSpots().filter((s) => { const st = statsOf(s.id); return !st.visited && !st.lastVisit; });
  if (!pool.length) return toast(state.data.spots.length ? 'Keine offenen Spots auf der Wunschliste (mit diesen Filtern).' : 'Trag zuerst ein paar Spots ein.', true);
  if (pool.length > 1 && lastPick) pool = pool.filter((s) => s.id !== lastPick);   // „Nochmal“ = ein anderer
  const weighted = pool.flatMap((s) => Array(1 + Math.min(statsOf(s.id).wants, 10)).fill(s));
  const s = weighted[Math.floor(Math.random() * weighted.length)];
  lastPick = s.id;
  if (state.view !== 'map') setView('map');
  map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15));
  openSpot(s.id, false, { random: true });
}
export const whoWants = (wants) => wants.map((w) => nameOf(w.created_by)).join(', ');
