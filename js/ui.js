// FoodiSpots – Bildschirme, Bottom-Sheet und wiederverwendbare Formular-Bausteine
import { $, $$, state } from './core.js';
import { map } from './map.js';

// ------------------------------------------------------------------
// Bildschirme
// ------------------------------------------------------------------
export function show(screen) {
  for (const id of ['loading', 'auth', 'groups', 'main']) {
    $('#screen-' + id).classList.toggle('hidden', id !== screen);
  }
  if (screen === 'main') setTimeout(() => map && map.invalidateSize(), 50);
}

// ------------------------------------------------------------------
// Bottom-Sheet
// ------------------------------------------------------------------
let cleanup = null;
export function onSheetClose(fn) { cleanup = fn; }
export function openSheet(html, kind) {
  if (cleanup) { const c = cleanup; cleanup = null; try { c(); } catch {} }
  state._sheetKind = kind;
  // frisches Element: keine Event-Listener vom vorherigen Inhalt
  const old = $('#sheet-body'), body = old.cloneNode(false);
  old.replaceWith(body);
  body.innerHTML = html;
  body.scrollTop = 0;
  $('#sheet').classList.remove('hidden');
  $('#sheet-backdrop').classList.remove('hidden');
  $$('[data-close]', $('#sheet')).forEach((b) => b.addEventListener('click', closeSheet));
  return body;
}
export function closeSheet() {
  if (cleanup) { const c = cleanup; cleanup = null; try { c(); } catch {} }
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  state.openSpotId = null; state._sheetKind = null; state.editing = null;
  if (state.pickMarker && map) { map.removeLayer(state.pickMarker); state.pickMarker = null; }
}
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').classList.contains('hidden')) $('#lightbox').classList.add('hidden'); else closeSheet();
});
export const head = (title) => `<div class="sheet-head"><h2>${title}</h2><button class="close-btn" data-close type="button" aria-label="Schließen">✕</button></div>`;

// ------------------------------------------------------------------
// Sterne (erneut tippen = zurücksetzen)
// ------------------------------------------------------------------
export function starsInput(name, value = 0, small = false) {
  return `<div class="stars${small ? ' sm' : ''}" data-stars="${name}" data-value="${value || 0}">${[1, 2, 3, 4, 5].map((i) =>
    `<button type="button" class="star${i <= value ? ' on' : ''}" data-v="${i}" aria-label="${i} Stern${i === 1 ? '' : 'e'}">★</button>`).join('')}</div>`;
}
// Ein Handler für alle Sterne im Bereich (auch später hinzugefügte)
export function wireStars(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.star'); if (!b || !root.contains(b)) return;
    const box = b.closest('[data-stars]');
    let v = Number(b.dataset.v);
    if (Number(box.dataset.value) === v) v = 0;
    box.dataset.value = v;
    $$('.star', box).forEach((x) => x.classList.toggle('on', Number(x.dataset.v) <= v));
    onChange?.(box.dataset.stars, v || null, box);
  });
}
export const starsValue = (root, name) => Number($(`[data-stars="${name}"]`, root)?.dataset.value) || null;

// Preisniveau € – €€€€ (erneut tippen = zurücksetzen)
export const priceInput = (v) => `<div class="price-seg" data-price="${v || ''}">${[1, 2, 3, 4].map((p) =>
  `<button type="button" data-p="${p}" class="${v === p ? 'on' : ''}">${'€'.repeat(p)}</button>`).join('')}</div>`;
export function wirePrice(root) {
  const box = $('.price-seg', root);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const v = Number(b.dataset.p) === Number(box.dataset.price) ? '' : b.dataset.p;
    box.dataset.price = v;
    $$('[data-p]', box).forEach((x) => x.classList.toggle('on', x.dataset.p === v));
  });
  return () => Number(box.dataset.price) || null;
}
