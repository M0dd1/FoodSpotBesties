// FoodiSpots – Gruppen: beitreten, gründen, verwalten, Lese-Link
import { $, $$, BUCKET, currentGroup, emptyData, esc, freshFilters, idb, isAdmin, isNetErr, nameOf, sb, state, toast } from './core.js';
import { dishPaths, spotImagePaths } from './photos.js';
import { closeSheet, head, openSheet, show } from './ui.js';
import { fetchGroupData, processOutbox, rebuildData, subscribeRealtime } from './sync.js';
import { initMap } from './map.js';
import { renderAll } from './views.js';
import { openTrash } from './trash.js';

// ------------------------------------------------------------------
// Gruppen
// ------------------------------------------------------------------
export async function refreshGroups() {
  if (!navigator.onLine) return;
  const { data, error } = await sb.from('group_members')
    .select('role, groups(id, name, invite_code, share_token, created_by, created_at)')
    .eq('user_id', state.user.id);
  if (error) { if (!isNetErr(error)) console.warn(error); return; }
  state.groups = (data || []).filter((r) => r.groups).map((r) => ({ ...r.groups, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  idb.put('kv', state.groups, 'groups');
}

export function showGroupScreen() {
  const box = $('#group-choices');
  box.innerHTML = state.groups.length ? '<p class="small muted">Deine Gruppen:</p>' + state.groups.map((g) =>
    `<button class="group-row" data-gid="${g.id}" type="button"><span class="gname">${esc(g.name)}</span><span class="chev">›</span></button>`).join('') : '';
  $$('.group-row', box).forEach((b) => b.addEventListener('click', () => selectGroup(b.dataset.gid)));
  show('groups');
}

$('#form-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  if (!code) return;
  const g = await joinGroup(code);
  if (g) { $('#join-code').value = ''; selectGroup(g.id); }
});
$('#form-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#create-name').value.trim();
  if (!name) return toast('Bitte einen Namen eingeben.', true);
  const { data, error } = await sb.rpc('create_group', { group_name: name });
  if (error) return toast(isNetErr(error) ? 'Zum Gründen wird Internet benötigt.' : 'Fehler: ' + error.message, true);
  $('#create-name').value = '';
  await refreshGroups();
  selectGroup(data.id);
  toast('Gruppe gegründet. Lade andere über den Gruppennamen oben ein.');
});

export async function joinGroup(code) {
  const { data, error } = await sb.rpc('join_group', { code });
  if (error) {
    toast(isNetErr(error) ? 'Zum Beitreten wird Internet benötigt.' :
      /ungültig/i.test(error.message) ? 'Einladungscode ungültig.' : 'Fehler: ' + error.message, true);
    return null;
  }
  await refreshGroups();
  toast(`Willkommen in „${data.name}“!`);
  return data;
}

export async function selectGroup(gid) {
  state.groupId = gid;
  idb.put('kv', gid, 'currentGroup');
  $('#group-name').textContent = currentGroup()?.name || 'Gruppe';
  closeSheet();
  state.filters = freshFilters();
  state._fitted = false;
  state.server = { ...emptyData(), ...((await idb.get('kv', 'data:' + gid).catch(() => null)) || {}) };
  rebuildData();
  show('main');
  initMap();
  renderAll(true);
  subscribeRealtime();
  await fetchGroupData();
  renderAll(!state._fitted);
  processOutbox();
}

// ------------------------------------------------------------------
// Gruppe verwalten
// ------------------------------------------------------------------
$('#btn-group').addEventListener('click', () => state.publicMode ? openPublicInfo() : openGroupSheet());
export function openPublicInfo() {
  openSheet(`${head(esc(currentGroup()?.name || 'FoodiSpots'))}
    <p>Du siehst die Spots dieser Gruppe <b>nur lesend</b>, ohne Anmeldung.</p>
    <p class="small muted">Namen der Mitglieder, Kommentare und einzelne Bewertungen werden in dieser Ansicht nicht angezeigt – nur die Durchschnittsnoten.</p>
    <a class="btn big" href="${location.pathname}" style="margin-top:12px">Eigene FoodiSpots öffnen / anmelden</a>`, 'public');
}
export function inviteLink(code) { return `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`; }
export function openGroupSheet() {
  const g = currentGroup(); if (!g) return showGroupScreen();
  const members = [...state.data.members].sort((a, b) => nameOf(a.user_id).localeCompare(nameOf(b.user_id), 'de'));
  const trashN = state.data.trash.spots.length;
  const body = openSheet(`${head(esc(g.name))}
    <h3 style="margin-top:0">Andere einladen</h3>
    <div class="invite-code">${esc(g.invite_code)}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn primary" style="flex:1" id="btn-share" type="button">Einladung teilen</button>
      <button class="btn" id="btn-copy-link" type="button">Link kopieren</button>
    </div>
    <p class="small muted">Wer den Link öffnet oder den Code eingibt, sieht alle Spots dieser Gruppe.</p>
    ${isAdmin() ? '<button class="btn ghost small" id="btn-new-code" type="button">Neuen Code erzeugen (alter wird ungültig)</button>' : ''}

    <h3>Öffentlicher Lese-Link</h3>
    ${g.share_token ? `<p class="small">Jeder mit diesem Link sieht eure Spots mit Durchschnittsnoten und Gerichtfotos – <b>ohne Anmeldung, nur lesend</b>. Namen, Kommentare und einzelne Bewertungen bleiben verborgen.</p>
      <div class="row"><button class="btn primary" style="flex:1" id="btn-share-public" type="button">Lese-Link teilen</button>
      <button class="btn" id="btn-copy-public" type="button">Kopieren</button></div>
      ${isAdmin() ? `<div class="row wrap" style="margin-top:6px"><button class="btn ghost small" id="btn-public-new" type="button">Neuen Link erzeugen</button>
      <button class="btn ghost small" id="btn-public-off" type="button" style="color:var(--danger)">Deaktivieren</button></div>` : ''}`
    : isAdmin() ? `<p class="small muted">Erzeugt einen Link, mit dem auch Leute ohne Konto eure Top-Spots ansehen können (nur lesen).</p>
      <button class="btn" id="btn-public-on" type="button">Lese-Link erstellen</button>`
    : '<p class="small muted">Ist nicht aktiviert. Das kann ein Admin der Gruppe einschalten.</p>'}

    <h3>Mitglieder (${members.length})</h3>
    <div>${members.map((m) => `<div class="member"><span class="name">${esc(nameOf(m.user_id))}</span>
      ${m.role === 'admin' ? '<span class="role">Admin</span>' : ''}
      ${isAdmin() && m.user_id !== state.user.id ? `<button class="btn ghost small" data-role="${m.user_id}" data-to="${m.role === 'admin' ? 'member' : 'admin'}" type="button">${m.role === 'admin' ? 'Admin entziehen' : 'Zum Admin'}</button>
      <button class="btn ghost small" data-kick="${m.user_id}" type="button" style="color:var(--danger)">Entfernen</button>` : ''}
    </div>`).join('')}</div>

    ${state.groups.length > 1 ? `<h3>Gruppe wechseln</h3><div class="stack">${state.groups.map((x) =>
      `<button class="group-row${x.id === g.id ? ' current' : ''}" data-gid="${x.id}" type="button"><span class="gname">${esc(x.name)}</span>${x.id === g.id ? '✓' : '›'}</button>`).join('')}</div>` : ''}

    <h3>Weitere</h3>
    <div class="stack">
      <button class="btn" id="btn-trash" type="button">🗑 Papierkorb${trashN ? ` (${trashN})` : ''}</button>
      <button class="btn" id="btn-other-group" type="button">Andere Gruppe beitreten / neue gründen</button>
      <button class="btn danger" id="btn-leave" type="button">Gruppe verlassen</button>
      ${isAdmin() ? '<button class="btn danger" id="btn-del-group" type="button">Gruppe für alle löschen</button>' : ''}
    </div>`, 'group');

  $('#btn-trash', body).addEventListener('click', openTrash);
  const publicLink = g.share_token ? `${location.origin}${location.pathname}?view=${g.share_token}` : null;
  const setPublic = async (enabled, ask) => {
    if (ask && !confirm(ask)) return;
    const { data, error } = await sb.rpc('set_public_share', { gid: g.id, enabled });
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : 'Fehler: ' + error.message, true);
    g.share_token = data; idb.put('kv', state.groups, 'groups'); openGroupSheet();
    toast(enabled ? 'Lese-Link ist aktiv.' : 'Lese-Link deaktiviert.');
  };
  $('#btn-public-on', body)?.addEventListener('click', () => setPublic(true, 'Lese-Link erstellen? Jeder, der den Link bekommt, kann eure Spots mit Durchschnittsnoten sehen.'));
  $('#btn-public-new', body)?.addEventListener('click', () => setPublic(true, 'Neuen Link erzeugen? Der bisherige Link funktioniert dann nicht mehr.'));
  $('#btn-public-off', body)?.addEventListener('click', () => setPublic(false, 'Lese-Link deaktivieren? Niemand kann die Spots dann mehr ohne Anmeldung sehen.'));
  const share = async (title, text, url, copiedMsg) => {
    if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast(copiedMsg); } catch { toast(url, false, 8000); }
  };
  const copy = async (url, msg) => { try { await navigator.clipboard.writeText(url); toast(msg); } catch { toast(url, false, 8000); } };
  $('#btn-copy-public', body)?.addEventListener('click', () => copy(publicLink, 'Lese-Link kopiert.'));
  $('#btn-share-public', body)?.addEventListener('click', () => share('FoodiSpots', `Unsere Spots „${g.name}“ zum Ansehen:`, publicLink, 'Lese-Link kopiert.'));
  const link = inviteLink(g.invite_code);
  $('#btn-share', body).addEventListener('click', () => share('FoodiSpots', `Komm in unsere FoodiSpots-Gruppe „${g.name}“! Link öffnen oder Code ${g.invite_code} eingeben:`, link, 'Einladung kopiert.'));
  $('#btn-copy-link', body).addEventListener('click', () => copy(link, 'Link kopiert.'));
  $('#btn-new-code', body)?.addEventListener('click', async () => {
    if (!confirm('Neuen Code erzeugen? Der alte Link funktioniert dann nicht mehr.')) return;
    const { data, error } = await sb.rpc('regenerate_invite_code', { gid: g.id });
    if (error) return toast('Fehler: ' + error.message, true);
    g.invite_code = data; idb.put('kv', state.groups, 'groups'); openGroupSheet();
  });
  $$('[data-role]', body).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await sb.rpc('set_member_role', { gid: g.id, uid: b.dataset.role, new_role: b.dataset.to });
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : 'Fehler: ' + error.message, true);
    await fetchGroupData(); openGroupSheet();
  }));
  $$('[data-kick]', body).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${nameOf(b.dataset.kick)} aus der Gruppe entfernen?`)) return;
    const { error } = await sb.from('group_members').delete().eq('group_id', g.id).eq('user_id', b.dataset.kick);
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : 'Fehler: ' + error.message, true);
    await fetchGroupData(); openGroupSheet();
  }));
  $$('[data-gid]', body).forEach((b) => b.addEventListener('click', () => { if (b.dataset.gid !== g.id) selectGroup(b.dataset.gid); }));
  $('#btn-other-group', body).addEventListener('click', () => { closeSheet(); showGroupScreen(); });
  $('#btn-leave', body).addEventListener('click', async () => {
    const admins = state.data.members.filter((m) => m.role === 'admin');
    if (isAdmin() && admins.length === 1 && state.data.members.length > 1) {
      return toast('Du bist der einzige Admin. Ernenne vorher jemand anderen zum Admin.', true, 6000);
    }
    if (!confirm(`Gruppe „${g.name}“ verlassen? Deine Bewertungen bleiben für die anderen sichtbar.`)) return;
    const { error } = await sb.from('group_members').delete().eq('group_id', g.id).eq('user_id', state.user.id);
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : 'Fehler: ' + error.message, true);
    await afterGroupGone(g.id);
  });
  $('#btn-del-group', body)?.addEventListener('click', async () => {
    const answer = prompt(`Achtung: Alle Spots, Bewertungen, Gerichte und Fotos von „${g.name}“ werden für alle gelöscht.\nZum Bestätigen den Gruppennamen eingeben:`);
    if (answer == null) return;
    if (answer.trim() !== g.name) return toast('Name stimmt nicht – nichts gelöscht.', true);
    const paths = [...dishPaths([...state.data.dishes, ...state.data.trash.dishes]), ...spotImagePaths([...state.data.spots, ...state.data.trash.spots])];
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    const { error } = await sb.from('groups').delete().eq('id', g.id);
    if (error) return toast(isNetErr(error) ? 'Dafür wird Internet benötigt.' : 'Fehler: ' + error.message, true);
    await afterGroupGone(g.id);
  });
}
export async function afterGroupGone(gid) {
  idb.del('kv', 'data:' + gid).catch(() => {});
  for (const op of state.outbox.filter((o) => o.groupId === gid)) await idb.del('outbox', op.id);
  state.outbox = state.outbox.filter((o) => o.groupId !== gid);
  closeSheet();
  await refreshGroups();
  if (state.groups[0]) selectGroup(state.groups[0].id); else { state.groupId = null; showGroupScreen(); }
}
