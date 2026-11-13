// FoodiSpots – Admin-Bereich für Super-Admins: alle Nutzer und Gruppen verwalten.
// Jede Aktion wird in der Datenbank noch einmal geprüft (nur Super-Admins) – die Oberfläche ist nur die Bedienung.
import { $, $$, BUCKET, USERNAME_HINT, esc, fmtDate, isNetErr, sb, state, toast, validUsername } from './core.js';
import { closeSheet, head, openSheet } from './ui.js';
import { afterGroupGone, refreshGroups, selectGroup } from './groups.js';
import { fetchGroupData } from './sync.js';

let data = null;            // Antwort von admin_overview()
let tab = 'users';
let query = '';

export async function isSuperAdmin() {
  if (state.publicMode || !navigator.onLine) return false;
  const { data: ok } = await sb.rpc('is_super_admin');
  return ok === true;
}

// Eintrag in den Einstellungen (nur für Super-Admins sichtbar)
export async function renderAdminEntry(box) {
  if (!box || !(await isSuperAdmin())) return;
  box.innerHTML = '<button class="btn admin-entry" id="btn-admin" type="button">🛡 Admin-Bereich</button>';
  $('#btn-admin', box).addEventListener('click', () => openAdmin());
}

function errText(error) {
  const m = String(error?.message || error || '');
  if (isNetErr(error)) return 'Dafür wird Internet benötigt.';
  if (/could not find the function|schema cache/i.test(m)) return 'Diese Admin-Aktion ist in der Datenbank noch nicht eingerichtet (Migration fehlt).';
  return m || 'Unbekannter Fehler';
}

async function rpc(name, args, okMsg) {
  const { data: res, error } = await sb.rpc(name, args);
  if (error) { toast(errText(error), true, 7000); return { ok: false }; }
  if (okMsg) toast(okMsg);
  return { ok: true, res };
}

async function load() {
  const { data: d, error } = await sb.rpc('admin_overview');
  if (error) { toast(errText(error), true, 6000); return false; }
  data = d;
  return true;
}

const ago = (iso) => {
  if (!iso) return 'noch nie';
  const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return days <= 0 ? 'heute' : days === 1 ? 'gestern' : days < 30 ? `vor ${days} Tagen` : fmtDate(iso);
};
const userById = (id) => data.users.find((u) => u.id === id);
const groupById = (id) => data.groups.find((g) => g.id === id);
const match = (s) => !query || String(s || '').toLowerCase().includes(query.toLowerCase());

// Fotos aus dem Speicher entfernen, nachdem ihre Einträge gelöscht wurden
async function removeFiles(paths) {
  paths = (paths || []).flatMap((p) => [p, p.replace(/(\.[a-z0-9]+)$/i, '-klein$1'), p.replace(/\.(webp|jpg)$/i, '-klein.webp')]);
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
}

// ------------------------------------------------------------------
// Übersicht
// ------------------------------------------------------------------
export async function openAdmin(keepTab = false) {
  if (!keepTab) { tab = 'users'; query = ''; }
  openSheet(`${head('🛡 Admin-Bereich')}<p class="muted">Wird geladen …</p>`, 'admin');
  if (!(await load())) return closeSheet();
  renderOverview();
}

function renderOverview() {
  const users = data.users.filter((u) => match(u.username));
  const groups = data.groups.filter((g) => match(g.name));
  const body = openSheet(`${head('🛡 Admin-Bereich')}
    <div class="admin-stats">
      <div><b>${data.users.length}</b><span>Nutzer</span></div>
      <div><b>${data.groups.length}</b><span>Gruppen</span></div>
      <div><b>${data.stats?.spots ?? data.groups.reduce((n, g) => n + g.spots, 0)}</b><span>Spots</span></div>
      <div><b>${data.stats?.ratings ?? 0}</b><span>Bewertungen</span></div>
      <div><b>${data.stats?.photos ?? data.groups.reduce((n, g) => n + g.photos, 0)}</b><span>Fotos</span></div>
      <div><b>${data.stats?.lookups ?? 0}</b><span>Suchen (30 Tage)</span></div>
    </div>
    <div class="chips" style="margin:12px 0 8px">
      <button class="chip${tab === 'users' ? ' on' : ''}" data-tab="users" type="button">👤 Nutzer</button>
      <button class="chip${tab === 'groups' ? ' on' : ''}" data-tab="groups" type="button">👥 Gruppen</button>
      <button class="chip${tab === 'cuisines' ? ' on' : ''}" data-tab="cuisines" type="button">🌍 Länderküchen</button>
    </div>
    ${tab === 'cuisines' ? cuisineAdminHtml() : `
    <input type="search" id="adm-search" placeholder="${tab === 'users' ? 'Nutzer suchen' : 'Gruppe suchen'}" value="${esc(query)}" autocomplete="off">
    <div class="stack" style="margin-top:10px">
    ${tab === 'users' ? (users.map((u) => `
      <button class="adm-row" data-user="${u.id}" type="button">
        <span class="adm-main"><b>${esc(u.username)}</b>
          ${u.id === data.me ? '<span class="adm-tag">Du</span>' : ''}
          ${u.super_admin ? '<span class="adm-tag sa">Super-Admin</span>' : ''}
          ${u.banned ? '<span class="adm-tag ban">Gesperrt</span>' : ''}
          <span class="small muted">${u.groups.length ? u.groups.map((g) => esc(g.name) + (g.role === 'admin' ? ' (Admin)' : '')).join(', ') : 'in keiner Gruppe'}</span>
          <span class="small muted">${u.spots} Spots · ${u.ratings} Bewertungen · ${u.photos} Fotos · zuletzt ${ago(u.last_sign_in_at)}</span></span>
        <span class="chev">›</span>
      </button>`).join('') || '<p class="muted">Keine Treffer.</p>')
    : (groups.map((g) => `
      <button class="adm-row" data-group="${g.id}" type="button">
        <span class="adm-main"><b>${esc(g.name)}</b> ${g.public_link ? '<span class="adm-tag">Lese-Link</span>' : ''}
          <span class="small muted">${g.members.length} Mitglieder · ${g.spots} Spots · ${g.ratings} Bewertungen · ${g.photos} Fotos</span>
          <span class="small muted">Admins: ${g.members.filter((m) => m.role === 'admin').map((m) => esc(m.username)).join(', ') || '–'}</span></span>
        <span class="chev">›</span>
      </button>`).join('') || '<p class="muted">Keine Treffer.</p>')}
    </div>`}`, 'admin');
  $$('[data-tab]', body).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; query = ''; renderOverview(); }));
  if (tab === 'cuisines') return wireCuisineAdmin(body);
  const s = $('#adm-search', body);
  s.addEventListener('input', () => {
    query = s.value; const pos = s.selectionStart; renderOverview();
    const n = $('#adm-search'); n.focus(); n.setSelectionRange(pos, pos);
  });
  $$('[data-user]', body).forEach((b) => b.addEventListener('click', () => openUser(b.dataset.user)));
  $$('[data-group]', body).forEach((b) => b.addEventListener('click', () => openGroup(b.dataset.group)));
}

async function reloadAnd(fn) {
  if (await load()) fn();
}

// ------------------------------------------------------------------
// Nutzer
// ------------------------------------------------------------------
function openUser(id) {
  const u = userById(id); if (!u) return renderOverview();
  const me = u.id === data.me;
  const others = data.groups.filter((g) => !u.groups.some((x) => x.id === g.id));
  const body = openSheet(`${head(`👤 ${esc(u.username)}`)}
    <div class="row wrap" style="margin-bottom:8px">
      ${me ? '<span class="adm-tag">Du</span>' : ''}${u.super_admin ? '<span class="adm-tag sa">Super-Admin</span>' : ''}${u.banned ? '<span class="adm-tag ban">Gesperrt</span>' : ''}
    </div>
    <dl class="info-grid">
      <dt>Konto seit</dt><dd>${fmtDate(u.created_at)}</dd>
      <dt>Zuletzt aktiv</dt><dd>${ago(u.last_sign_in_at)}</dd>
      <dt>Inhalte</dt><dd>${u.spots} Spots, ${u.ratings} Bewertungen, ${u.photos} Fotos</dd>
    </dl>

    <h3>Gruppen</h3>
    <div>${u.groups.map((g) => `<div class="member"><span class="name">${esc(g.name)}</span>
      ${g.role === 'admin' ? '<span class="role">Admin</span>' : ''}
      <button class="btn ghost small" data-role-g="${g.id}" data-to="${g.role === 'admin' ? 'member' : 'admin'}" type="button">${g.role === 'admin' ? 'Admin entziehen' : 'Zum Admin'}</button>
      <button class="btn ghost small" data-rm-g="${g.id}" type="button" style="color:var(--danger)">Entfernen</button></div>`).join('') || '<p class="small muted">In keiner Gruppe.</p>'}</div>
    ${others.length ? `<div class="row" style="margin-top:8px">
      <select id="adm-add-group">${others.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      <button class="btn small" id="adm-add" type="button">Hinzufügen</button></div>` : ''}

    <h3>Konto</h3>
    <form id="adm-rename" class="row" style="align-items:flex-end">
      <label style="flex:1">Name (zum Anmelden)<input name="name" maxlength="30" autocapitalize="none" value="${esc(u.username)}"></label>
      <button class="btn" type="submit">Umbenennen</button>
    </form>
    <form id="adm-pass" class="row" style="align-items:flex-end;margin-top:8px">
      <label style="flex:1">Neues Passwort<input name="pw" type="text" minlength="6" autocomplete="off" placeholder="mind. 6 Zeichen"></label>
      <button class="btn" type="submit">Setzen</button>
    </form>
    <p class="small muted">Nach dem Setzen wird ${esc(u.username)} auf allen Geräten abgemeldet. Teile das neue Passwort persönlich mit.</p>

    <div class="stack" style="margin-top:12px">
      ${me ? '' : `<button class="btn" id="adm-sa" type="button">${u.super_admin ? 'Super-Admin-Rechte entziehen' : '🛡 Zum Super-Admin machen'}</button>
      <button class="btn${u.banned ? '' : ' danger'}" id="adm-ban" type="button">${u.banned ? 'Sperre aufheben' : 'Konto sperren'}</button>
      <button class="btn danger" id="adm-del" type="button">Konto löschen …</button>`}
      <button class="btn ghost" id="adm-back" type="button">← Zurück zur Übersicht</button>
    </div>`, 'admin');

  const again = () => reloadAnd(() => openUser(id));
  $('#adm-back', body).addEventListener('click', renderOverview);
  $$('[data-role-g]', body).forEach((b) => b.addEventListener('click', async () => {
    if ((await rpc('admin_set_member', { gid: b.dataset.roleG, uid: u.id, new_role: b.dataset.to }, 'Rolle geändert.')).ok) again();
  }));
  $$('[data-rm-g]', body).forEach((b) => b.addEventListener('click', async () => {
    const g = groupById(b.dataset.rmG);
    if (!confirm(`${u.username} aus „${g?.name}“ entfernen? Die Spots und Bewertungen bleiben in der Gruppe.`)) return;
    if ((await rpc('admin_remove_member', { gid: b.dataset.rmG, uid: u.id }, 'Entfernt.')).ok) { afterMembershipChange(u.id); again(); }
  }));
  $('#adm-add', body)?.addEventListener('click', async () => {
    const gid = $('#adm-add-group', body).value;
    if ((await rpc('admin_set_member', { gid, uid: u.id, new_role: 'member' }, 'Zur Gruppe hinzugefügt.')).ok) { afterMembershipChange(u.id); again(); }
  });
  $('#adm-rename', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (name === u.username) return;
    if (!validUsername(name)) return toast(`Name ungültig. ${USERNAME_HINT}`, true, 6000);
    if (!confirm(`„${u.username}“ in „${name}“ umbenennen? Die Anmeldung erfolgt dann mit dem neuen Namen.`)) return;
    if ((await rpc('admin_rename_user', { uid: u.id, new_name: name }, 'Umbenannt.')).ok) {
      if (me) state.profile = { ...(state.profile || {}), username: name, display_name: name };
      fetchGroupData(); again();
    }
  });
  $('#adm-pass', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = e.target.pw.value;
    if (pw.length < 6) return toast('Passwort zu kurz (mind. 6 Zeichen).', true);
    if (!confirm(`Neues Passwort für ${u.username} setzen?${me ? ' Du wirst danach abgemeldet.' : ''}`)) return;
    if ((await rpc('admin_set_password', { uid: u.id, new_password: pw }, 'Passwort gesetzt.')).ok) { e.target.pw.value = ''; if (me) location.reload(); }
  });
  $('#adm-sa', body)?.addEventListener('click', async () => {
    const on = !u.super_admin;
    if (!confirm(on ? `${u.username} zum Super-Admin machen? Super-Admins können alle Nutzer und Gruppen verwalten.` : `${u.username} die Super-Admin-Rechte entziehen?`)) return;
    if ((await rpc('admin_set_super_admin', { uid: u.id, enabled: on }, on ? 'Ist jetzt Super-Admin.' : 'Rechte entzogen.')).ok) again();
  });
  $('#adm-ban', body)?.addEventListener('click', async () => {
    const on = !u.banned;
    if (on && !confirm(`${u.username} sperren? Die Anmeldung ist dann nicht mehr möglich, die Daten bleiben erhalten.`)) return;
    if ((await rpc('admin_set_banned', { uid: u.id, banned: on }, on ? 'Konto gesperrt.' : 'Sperre aufgehoben.')).ok) again();
  });
  $('#adm-del', body)?.addEventListener('click', () => openDeleteUser(u));
}

function openDeleteUser(u) {
  const body = openSheet(`${head('Konto löschen')}
    <p>Konto <b>${esc(u.username)}</b> endgültig löschen?</p>
    <div class="warn">Der Name wird wieder frei. Das lässt sich nicht rückgängig machen.</div>
    <h3>Was passiert mit den Inhalten (${u.spots} Spots, ${u.ratings} Bewertungen, ${u.photos} Fotos)?</h3>
    <div class="stack">
      <label class="adm-choice"><input type="radio" name="keep" value="1" checked> <span><b>Behalten</b> – Spots, Bewertungen, Gerichte, Fotos und Kommentare gehen auf dich über.</span></label>
      <label class="adm-choice"><input type="radio" name="keep" value="0"> <span><b>Mit löschen</b> – alles, was ${esc(u.username)} eingetragen hat, wird entfernt.</span></label>
    </div>
    <label style="margin-top:12px">Zum Bestätigen den Namen eintippen<input id="adm-del-confirm" autocomplete="off" autocapitalize="none" placeholder="${esc(u.username)}"></label>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="adm-del-back" type="button">Abbrechen</button>
      <button class="btn danger" id="adm-del-go" type="button" style="flex:1">Endgültig löschen</button>
    </div>`, 'admin');
  $('#adm-del-back', body).addEventListener('click', () => openUser(u.id));
  $('#adm-del-go', body).addEventListener('click', async (e) => {
    if ($('#adm-del-confirm', body).value.trim() !== u.username) return toast('Name stimmt nicht – nichts gelöscht.', true);
    e.target.disabled = true;
    const keep = $('input[name=keep]:checked', body).value === '1';
    const r = await rpc('admin_delete_user', { uid: u.id, keep_content: keep });
    if (!r.ok) { e.target.disabled = false; return; }
    await removeFiles(r.res?.photo_paths);
    toast(`${u.username} wurde gelöscht.`);
    fetchGroupData();
    reloadAnd(renderOverview);
  });
}

// Eigene Mitgliedschaft geändert → Gruppenliste der App aktualisieren
async function afterMembershipChange(uid) {
  if (uid === data.me) await refreshGroups();
  if (state.groupId) fetchGroupData();
}

// ------------------------------------------------------------------
// Gruppen
// ------------------------------------------------------------------
function openGroup(id) {
  const g = groupById(id); if (!g) return renderOverview();
  const iAmMember = g.members.some((m) => m.user_id === data.me);
  const others = data.users.filter((u) => !g.members.some((m) => m.user_id === u.id));
  const body = openSheet(`${head(`🧺 ${esc(g.name)}`)}
    <dl class="info-grid">
      <dt>Erstellt</dt><dd>${fmtDate(g.created_at)}</dd>
      <dt>Inhalte</dt><dd>${g.spots} Spots, ${g.ratings} Bewertungen, ${g.photos} Fotos</dd>
      <dt>Einladungscode</dt><dd><b>${esc(g.invite_code)}</b></dd>
      <dt>Lese-Link</dt><dd>${g.public_link ? `aktiv` : 'aus'}</dd>
    </dl>
    <div class="stack" style="margin-top:8px">
      <button class="btn primary" id="adm-open" type="button">${iAmMember ? 'Gruppe auf der Karte öffnen' : 'Beitreten und auf der Karte öffnen'}</button>
    </div>

    <h3>Mitglieder (${g.members.length})</h3>
    <div>${g.members.map((m) => `<div class="member"><span class="name">${esc(m.username)}${m.user_id === data.me ? ' (du)' : ''}</span>
      ${m.role === 'admin' ? '<span class="role">Admin</span>' : ''}
      <button class="btn ghost small" data-role-u="${m.user_id}" data-to="${m.role === 'admin' ? 'member' : 'admin'}" type="button">${m.role === 'admin' ? 'Admin entziehen' : 'Zum Admin'}</button>
      <button class="btn ghost small" data-rm-u="${m.user_id}" type="button" style="color:var(--danger)">Entfernen</button></div>`).join('') || '<p class="small muted">Keine Mitglieder.</p>'}</div>
    ${others.length ? `<div class="row" style="margin-top:8px">
      <select id="adm-add-user">${others.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</select>
      <button class="btn small" id="adm-add" type="button">Hinzufügen</button></div>` : ''}

    <h3>Verwalten</h3>
    <form id="adm-grename" class="row" style="align-items:flex-end">
      <label style="flex:1">Gruppenname<input name="name" maxlength="80" value="${esc(g.name)}"></label>
      <button class="btn" type="submit">Umbenennen</button>
    </form>
    <div class="stack" style="margin-top:12px">
      <button class="btn" id="adm-code" type="button">Neuen Einladungscode erzeugen</button>
      ${g.public_link ? '<button class="btn" id="adm-share-off" type="button">Lese-Link deaktivieren</button>' : ''}
      <button class="btn danger" id="adm-gdel" type="button">Gruppe löschen …</button>
      <button class="btn ghost" id="adm-back" type="button">← Zurück zur Übersicht</button>
    </div>`, 'admin');

  const again = () => reloadAnd(() => openGroup(id));
  $('#adm-back', body).addEventListener('click', () => { tab = 'groups'; renderOverview(); });
  $('#adm-open', body).addEventListener('click', async () => {
    if (!iAmMember && !(await rpc('admin_set_member', { gid: g.id, uid: data.me, new_role: 'admin' })).ok) return;
    await refreshGroups();
    closeSheet();
    selectGroup(g.id);
  });
  $$('[data-role-u]', body).forEach((b) => b.addEventListener('click', async () => {
    if ((await rpc('admin_set_member', { gid: g.id, uid: b.dataset.roleU, new_role: b.dataset.to }, 'Rolle geändert.')).ok) again();
  }));
  $$('[data-rm-u]', body).forEach((b) => b.addEventListener('click', async () => {
    const u = userById(b.dataset.rmU);
    if (!confirm(`${u?.username} aus „${g.name}“ entfernen? Die Spots und Bewertungen bleiben in der Gruppe.`)) return;
    if ((await rpc('admin_remove_member', { gid: g.id, uid: b.dataset.rmU }, 'Entfernt.')).ok) { afterMembershipChange(b.dataset.rmU); again(); }
  }));
  $('#adm-add', body)?.addEventListener('click', async () => {
    const uid = $('#adm-add-user', body).value;
    if ((await rpc('admin_set_member', { gid: g.id, uid, new_role: 'member' }, 'Hinzugefügt.')).ok) { afterMembershipChange(uid); again(); }
  });
  $('#adm-grename', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name || name === g.name) return;
    if ((await rpc('admin_rename_group', { gid: g.id, new_name: name }, 'Gruppe umbenannt.')).ok) {
      const mine = state.groups.find((x) => x.id === g.id);
      if (mine) { mine.name = name; if (state.groupId === g.id) $('#group-name').textContent = name; }
      again();
    }
  });
  $('#adm-code', body).addEventListener('click', async () => {
    if (!confirm('Neuen Einladungscode erzeugen? Der alte Code und alte Einladungslinks funktionieren dann nicht mehr.')) return;
    if ((await rpc('regenerate_invite_code', { gid: g.id }, 'Neuer Code erzeugt.')).ok) again();
  });
  $('#adm-share-off', body)?.addEventListener('click', async () => {
    if (!confirm('Lese-Link dieser Gruppe deaktivieren?')) return;
    if ((await rpc('set_public_share', { gid: g.id, enabled: false }, 'Lese-Link deaktiviert.')).ok) again();
  });
  $('#adm-gdel', body).addEventListener('click', () => openDeleteGroup(g));
}

function openDeleteGroup(g) {
  const body = openSheet(`${head('Gruppe löschen')}
    <p>Gruppe <b>${esc(g.name)}</b> mit allen ${g.spots} Spots, ${g.ratings} Bewertungen und ${g.photos} Fotos für alle ${g.members.length} Mitglieder löschen?</p>
    <div class="warn">Das lässt sich nicht rückgängig machen. Eine Kopie steckt nur in der letzten automatischen Sicherung.</div>
    <label style="margin-top:12px">Zum Bestätigen den Gruppennamen eintippen<input id="adm-gdel-confirm" autocomplete="off" placeholder="${esc(g.name)}"></label>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="adm-gdel-back" type="button">Abbrechen</button>
      <button class="btn danger" id="adm-gdel-go" type="button" style="flex:1">Endgültig löschen</button>
    </div>`, 'admin');
  $('#adm-gdel-back', body).addEventListener('click', () => openGroup(g.id));
  $('#adm-gdel-go', body).addEventListener('click', async (e) => {
    if ($('#adm-gdel-confirm', body).value.trim() !== g.name) return toast('Name stimmt nicht – nichts gelöscht.', true);
    e.target.disabled = true;
    const r = await rpc('admin_delete_group', { gid: g.id });
    if (!r.ok) { e.target.disabled = false; return; }
    await removeFiles(r.res?.photo_paths);
    toast(`Gruppe „${g.name}“ gelöscht.`);
    if (state.groups.some((x) => x.id === g.id)) await afterGroupGone(g.id);
    tab = 'groups';
    openAdmin(true);
  });
}

// ------------------------------------------------------------------
// Länderküchen pflegen (neue Küche anlegen, Emoji/Region ändern)
// ------------------------------------------------------------------
function cuisineAdminHtml() {
  const list = [...state.cuisines.values()].sort((a, b) => a.sort - b.sort);
  return `<p class="small muted">Die Liste gilt für alle Gruppen. Der Schlüssel (z. B. <code>croatian</code>) verbindet sie mit OpenStreetMap und der Web-Recherche.</p>
    <form id="adm-cuisine" class="stack card" style="padding:14px">
      <div class="row amount-row"><label>Schlüssel<input name="key" required pattern="[a-z_]{2,30}" placeholder="z. B. tunisian"></label>
        <label>Name<input name="name" required maxlength="40" placeholder="Tunesisch"></label></div>
      <div class="row amount-row"><label>Emoji/Flagge<input name="emoji" maxlength="8" placeholder="🇹🇳"></label>
        <label>Region<select name="region">${(window.FOODI_REGIONS || []).map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
        <label>Reihenfolge<input name="sort" type="number" min="0" max="999" value="100"></label></div>
      <button class="btn primary" type="submit">Speichern</button>
    </form>
    <div class="stack" style="margin-top:10px">${list.map((c) => `<button type="button" class="adm-row" data-ck="${esc(c.key)}">
      <span class="adm-main"><b>${esc(c.emoji)} ${esc(c.name_de)}</b><span class="small muted">${esc(c.key)} · ${esc(c.region)} · ${c.sort}</span></span><span class="chev">✎</span></button>`).join('')}</div>`;
}
function wireCuisineAdmin(body) {
  const f = $('#adm-cuisine', body);
  $$('[data-ck]', body).forEach((b) => b.addEventListener('click', () => {
    const c = state.cuisines.get(b.dataset.ck); if (!c) return;
    f.key.value = c.key; f.name.value = c.name_de; f.emoji.value = c.emoji; f.region.value = c.region; f.sort.value = c.sort;
    $('#sheet-body').scrollTop = 0;
  }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const args = { c_key: f.key.value.trim(), c_name: f.name.value.trim(), c_emoji: f.emoji.value.trim(), c_region: f.region.value, c_sort: Number(f.sort.value) || 100 };
    const { ok } = await rpc('admin_upsert_cuisine', args, 'Länderküche gespeichert.');
    if (!ok) return;
    state.cuisines.set(args.c_key, { key: args.c_key, name_de: args.c_name, emoji: args.c_emoji || '🍽️', region: args.c_region, sort: args.c_sort });
    renderOverview();
  });
}
