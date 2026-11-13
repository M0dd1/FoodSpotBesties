// FoodiSpots – Einstellungen, Darstellung, Export
import { $, $$, APP_VERSION, CATEGORIES, USERNAME_HINT, currentGroup, cuisineNames, esc, euro, idb, isNetErr, nameOf, sb, state, toast, todayISO, validUsername } from './core.js';
import { renderInviteBox } from './invites.js';
import { head, openSheet } from './ui.js';
import { logout } from './auth.js';
import { renderAdminEntry } from './admin.js';
import { fetchGroupData, processOutbox } from './sync.js';
import { dishesOf, ratingsOf, statsOf } from './list.js';
import { renderAll } from './views.js';

$('#btn-settings').addEventListener('click', openSettings);
export function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('foodi.theme', t); } catch {}
}
export async function loadProfile() {
  if (!navigator.onLine) return;
  const { data } = await sb.from('profiles').select('id, username, display_name').eq('id', state.user.id).maybeSingle();
  if (data) { state.profile = data; idb.put('kv', data, 'profile'); }
}
export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

export function openSettings() {
  const theme = localStorage.getItem('foodi.theme') || 'auto';
  const n = state.outbox.length;
  const body = openSheet(`${head('Einstellungen')}
    <form id="f-name" class="row" style="align-items:flex-end">
      <label style="flex:1">Mein Name (auch zum Anmelden)<input name="name" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false"
        value="${esc(state.profile?.username || state.profile?.display_name || '')}"></label>
      <button class="btn primary" type="submit">Ändern</button>
    </form>
    <p class="small muted">Wenn du den Namen änderst, meldest du dich künftig mit dem neuen Namen an.</p>
    <div id="admin-entry"></div>

    <h3>Zu FoodiSpots einladen</h3>
    <div id="invite-box"></div>

    <h3>Darstellung</h3>
    <div class="chips">${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) =>
      `<button class="chip${theme === k ? ' on' : ''}" data-theme-set="${k}" type="button">${l}</button>`).join('')}</div>

    <h3>Synchronisation</h3>
    <p>${!navigator.onLine ? 'Offline. ' : ''}${n ? `${n} Änderung(en) warten auf Upload.` : 'Alles ist hochgeladen.'}</p>
    <button class="btn" id="btn-sync" type="button">Jetzt synchronisieren</button>

    ${!isStandalone ? `<h3>Als App installieren</h3>
      ${isIOS ? '<p class="small">In Safari unten auf <b>Teilen</b> (□↑) tippen, dann <b>„Zum Home-Bildschirm“</b>.</p>'
        : installPrompt ? '<button class="btn primary" id="btn-install" type="button">App installieren</button>'
        : '<p class="small">Im Browser-Menü (⋮) <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>'}` : ''}

    <h3>Export (aktuelle Gruppe)</h3>
    <div class="row wrap">
      <button class="btn" id="btn-csv" type="button">Liste für Excel (CSV)</button>
      <button class="btn" id="btn-json" type="button">JSON-Backup</button>
    </div>
    <p class="small muted">Die CSV-Liste öffnet sich in Excel oder Numbers. Das Backup enthält alle Daten ohne die Fotos selbst.</p>

    <div class="stack" style="margin-top:20px">
      <button class="btn danger" id="btn-logout" type="button">Abmelden</button>
      <p class="small muted" style="text-align:center">FoodiSpots ${APP_VERSION}</p>
    </div>`, 'settings');

  $('#f-name', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim(); if (!name) return;
    if (name === (state.profile?.username || '')) return;
    if (!validUsername(name)) return toast(`Name ungültig. ${USERNAME_HINT}`, true, 6000);
    if (!confirm(`Namen in „${name}“ ändern? Du meldest dich danach mit diesem Namen an.`)) return;
    const { error } = await sb.rpc('rename_me', { new_name: name });
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : (error.message || 'Fehler'), true, 6000);
    state.profile = { ...(state.profile || {}), id: state.user.id, display_name: name, username: name };
    idb.put('kv', state.profile, 'profile');
    toast(`Name geändert. Anmelden ab jetzt mit „${name}“.`, false, 5000); fetchGroupData();
  });
  $$('[data-theme-set]', body).forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.themeSet); openSettings(); }));
  renderAdminEntry($('#admin-entry', body));
  renderInviteBox($('#invite-box', body));
  $('#btn-sync', body).addEventListener('click', async () => { await processOutbox(); await fetchGroupData(); renderAll(false); openSettings(); });
  $('#btn-install', body)?.addEventListener('click', async () => { installPrompt.prompt(); installPrompt = null; });
  $('#btn-csv', body).addEventListener('click', exportCSV);
  $('#btn-json', body).addEventListener('click', exportJSON);
  $('#btn-logout', body).addEventListener('click', logout);
}

export function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const fileBase = () => `foodispots-${(currentGroup()?.name || 'gruppe').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}-${todayISO()}`;
// CSV mit Semikolon (deutsches Excel), Formel-Injektion verhindern
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function exportCSV() {
  const head = ['Name', 'Adresse', 'Länderküche', 'Art', 'Preis', 'Status', 'Durchschnitt', 'Bewertungen', 'Will ich auch', 'Gerichte', 'Webseite', 'Eingetragen von', 'Eingetragen am'];
  const rows = state.data.spots.map((s) => {
    const st = statsOf(s.id);
    return [s.name, s.address, cuisineNames(s.cuisines), CATEGORIES[s.category] || '', euro(s.price_level), st.visited ? 'besucht' : 'Wunschliste',
      st.avg != null ? st.avg.toFixed(1).replace('.', ',') : '', st.count, st.wants, dishesOf(s.id).map((d) => d.name).join(', '), s.website,
      nameOf(s.created_by), (s.created_at || '').slice(0, 10)];
  });
  download(fileBase() + '.csv', '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
export function exportJSON() {
  const d = state.data;
  download(fileBase() + '.json', JSON.stringify({
    app: 'FoodiSpots', version: APP_VERSION, exported_at: new Date().toISOString(), group: { id: currentGroup()?.id, name: currentGroup()?.name },
    members: d.members.map((m) => ({ ...m, name: nameOf(m.user_id) })),
    spots: d.spots, ratings: d.ratings, dishes: d.dishes, spot_wants: d.spot_wants, visits: d.visits, comments: d.comments, trash: d.trash,
    summary: d.spots.map((s) => ({ id: s.id, name: s.name, ratings: ratingsOf(s.id).length, avg: statsOf(s.id).avg })),
  }, null, 2), 'application/json');
}
