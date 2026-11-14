// FoodiSpots – Start der App, öffentliche Lese-Ansicht, Direktlinks
import { $, emptyData, idb, sb, setCuisines, state } from './core.js';
import { show } from './ui.js';
import { joinGroup, refreshGroups, selectGroup, showGroupScreen } from './groups.js';
import { rebuildData } from './sync.js';
import { initMap, map } from './map.js';
import { renderAll } from './views.js';
import { openAdd, openSpot } from './spots.js';
import { applyTheme, loadProfile } from './settings.js';
import { showInviteHint } from './auth.js';
import { loadConflicts } from './conflicts.js';

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
const params = new URLSearchParams(location.search);
export const viewToken = params.get('view');
export const deepLink = { group: params.get('group'), spot: params.get('spot') };
if (deepLink.spot) history.replaceState(null, '', location.pathname);
// Aus einer anderen App geteilt (z. B. Google Maps → Teilen → FoodiSpots): merken, bis eine Gruppe offen ist
if (['share_title', 'share_text', 'share_url'].some((k) => params.get(k))) {
  const shared = [params.get('share_title'), params.get('share_text'), params.get('share_url')]
    .map((x) => (x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i && !a.some((y, j) => j !== i && y.length > x.length && y.includes(x))).join('\n');
  try { sessionStorage.setItem('foodi.shared', shared.slice(0, 2000)); } catch {}
  history.replaceState(null, '', location.pathname);
}
// Einladung zu FoodiSpots ohne Gruppe (?invite=CODE) bzw. in eine Gruppe (?join=CODE): fürs Registrieren merken
for (const [p, key] of [['invite', 'foodi.pendingInvite'], ['join', 'foodi.pendingJoin']]) {
  const v = params.get(p);
  if (v) { try { localStorage.setItem(key, v.toUpperCase()); } catch {} history.replaceState(null, '', location.pathname); }
}

export let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  if (viewToken) return; // öffentliche Ansicht braucht keine Anmeldung
  if (event === 'SIGNED_OUT') { state.user = null; return; }
  if (session?.user && (!booted || state.user?.id !== session.user.id)) {
    booted = true; state.user = session.user; startApp();
  }
});

// Wird von main.js aufgerufen, nachdem alle Module geladen sind
export async function boot() {
  applyTheme(localStorage.getItem('foodi.theme') || 'auto');
  if ('serviceWorker' in navigator) {
    // Neue Version installiert sich im Hintergrund; danach Hinweis zum Neuladen (App startet ja sofort aus dem Speicher)
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setCuisines(await idb.get('kv', 'cuisines').catch(() => null));
  loadCuisines();
  if (viewToken) return startPublic(viewToken);
  const { data } = await sb.auth.getSession();
  if (data?.session?.user) {
    if (!booted) { booted = true; state.user = data.session.user; startApp(); }
  } else {
    show('auth');
    showInviteHint();
  }
}

// Länderküchen aus der Datenbank (für alle lesbar), lokal gemerkt
async function loadCuisines() {
  if (!navigator.onLine) return;
  const { data, error } = await sb.from('cuisines').select('key, name_de, emoji, region, sort').order('sort');
  if (error || !data?.length) return;
  setCuisines(data);
  idb.put('kv', data, 'cuisines').catch(() => {});
  if (state.groupId) renderAll(false);
}

// ------------------------------------------------------------------
// Öffentliche Ansicht (nur lesen, ohne Anmeldung)
// ------------------------------------------------------------------
export async function startPublic(token) {
  state.publicMode = true;
  state.user = { id: null };
  document.body.classList.add('public-mode');
  show('loading');
  let d = null, netFail = !navigator.onLine;
  if (navigator.onLine) {
    const { data, error } = await sb.rpc('public_group_data', { token });
    if (error) netFail = true;
    else if (data) { d = data; idb.put('kv', d, 'public:' + token).catch(() => {}); }
    else idb.del('kv', 'public:' + token).catch(() => {});   // Link deaktiviert: gemerkte Kopie verwerfen
  }
  if (!d && netFail) d = await idb.get('kv', 'public:' + token).catch(() => null);
  if (!d) {
    $('#screen-loading').innerHTML = `<div class="card auth-card"><div class="logo-big">🍽️</div>
      <h1>Link nicht gültig</h1><p class="muted">Dieser Lese-Link wurde deaktiviert oder ist falsch. Frag in der Gruppe nach einem neuen Link.</p>
      <a class="btn primary big" href="${location.pathname}">Zu FoodiSpots</a></div>`;
    return;
  }
  applyPublic(d);
  $('#group-name').textContent = d.group.name;
  show('main');
  initMap();
  renderAll(true);
}
function applyPublic(d) {
  state.groupId = d.group.id;
  state.groups = [{ id: d.group.id, name: d.group.name, role: 'viewer' }];
  state.server = { ...emptyData(), spots: d.spots || [], dishes: d.dishes || [] };
  rebuildData();
}
export async function refreshPublic() {
  if (!navigator.onLine) return;
  const { data } = await sb.rpc('public_group_data', { token: viewToken });
  if (!data) return;
  idb.put('kv', data, 'public:' + viewToken).catch(() => {});
  applyPublic(data);
}

export async function startApp() {
  show('loading');
  state.outbox = (await idb.all('outbox').catch(() => [])).sort((a, b) => a.seq - b.seq);
  state.groups = (await idb.get('kv', 'groups').catch(() => null)) || [];
  state.profile = (await idb.get('kv', 'profile').catch(() => null)) || null;
  await refreshGroups();
  loadProfile();

  try { localStorage.removeItem('foodi.pendingInvite'); } catch {}   // angemeldet: Konto-Einladung wird nicht mehr gebraucht
  loadConflicts();
  let pendingJoin = null;
  try { pendingJoin = localStorage.getItem('foodi.pendingJoin'); } catch {}
  if (pendingJoin) {
    try { localStorage.removeItem('foodi.pendingJoin'); } catch {}
    if (!state.groups.some((g) => g.invite_code === pendingJoin)) {
      const g = await joinGroup(pendingJoin);
      if (g) return selectGroup(g.id);
    }
  }

  const last = await idb.get('kv', 'currentGroup').catch(() => null);
  const g = state.groups.find((x) => x.id === deepLink.group) || state.groups.find((x) => x.id === last) || state.groups[0];
  if (g) { await selectGroup(g.id); openDeepLink(); } else showGroupScreen();
}
export function openDeepLink() {
  let shared = null;
  try { shared = sessionStorage.getItem('foodi.shared'); sessionStorage.removeItem('foodi.shared'); } catch {}
  if (shared) return openAdd(shared);
  const s = deepLink.spot && state.data.spots.find((x) => x.id === deepLink.spot);
  deepLink.spot = null;
  if (!s) return;
  map.setView([s.lat, s.lng], 16); openSpot(s.id);
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner'; b.className = 'update-banner'; b.setAttribute('role', 'status');
  b.innerHTML = '<span>Neue Version von FoodiSpots ist da.</span><button class="btn small primary" type="button">Neu laden</button><button class="close-btn" type="button" aria-label="Später">✕</button>';
  b.querySelector('.btn').addEventListener('click', () => location.reload());
  b.querySelector('.close-btn').addEventListener('click', () => b.remove());
  document.body.appendChild(b);
}
