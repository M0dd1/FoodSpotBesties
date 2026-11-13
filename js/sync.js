// FoodiSpots – Daten laden, Echtzeit-Abgleich, Offline-Warteschlange
import { $, BUCKET, TABLES, TRASH_DAYS, canEdit, currentGroup, debounce, idb, isNetErr, sb, state, toast, uuid } from './core.js';
import { refreshPublic } from './start.js';
import { refreshGroups, selectGroup, showGroupScreen } from './groups.js';
import { renderAll } from './views.js';
import { buildIndexes } from './list.js';
import { dishPaths } from './photos.js';
import { addConflict, noteRemoteEdit } from './conflicts.js';

// ------------------------------------------------------------------
// Daten laden
// ------------------------------------------------------------------
export async function fetchAll(table, gid) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from(table).select('*').eq('group_id', gid)
      .order('created_at', { ascending: true }).range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) return out;
  }
}

export async function fetchGroupData() {
  if (state.publicMode) return refreshPublic();
  const gid = state.groupId;
  if (!gid || !navigator.onLine) return updateSyncBadge();
  try {
    const [lists, members] = await Promise.all([
      Promise.all(TABLES.map((t) => fetchAll(t, gid))),
      sb.from('group_members').select('user_id, role, joined_at').eq('group_id', gid)
        .then(({ data, error }) => { if (error) throw error; return data; }),
    ]);
    const ids = members.map((m) => m.user_id);
    const profiles = {};
    if (ids.length) {
      const { data: profs } = await sb.from('profiles').select('id, username, display_name').in('id', ids);
      for (const p of profs || []) profiles[p.id] = p.username || p.display_name || 'Ohne Namen';
    }
    if (gid !== state.groupId) return;
    // Gruppe verlassen/entfernt?
    if (!members.some((m) => m.user_id === state.user.id)) {
      toast('Du bist nicht mehr Mitglied dieser Gruppe.', true);
      await refreshGroups();
      return state.groups[0] ? selectGroup(state.groups[0].id) : showGroupScreen();
    }
    const me = members.find((m) => m.user_id === state.user.id);
    const g = currentGroup(); if (g && me) g.role = me.role;
    state.server = { ...Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])), members, profiles };
    lastFullFetch = Date.now();
    idb.put('kv', state.server, 'data:' + gid);
    rebuildData();
    purgeTrash();
  } catch (e) {
    if (!isNetErr(e)) { console.warn(e); toast('Laden fehlgeschlagen: ' + (e.message || e), true); }
  }
  updateSyncBadge();
}
export const refreshSoon = debounce(async () => { await fetchGroupData(); renderAll(false); }, 600);

// ------------------------------------------------------------------
// Echtzeit: Änderungen anderer direkt einarbeiten, statt jedes Mal alles neu zu laden
// ------------------------------------------------------------------
let lastFullFetch = 0, hiddenAt = 0;
const CHILDREN = ['ratings', 'dishes', 'spot_wants', 'visits', 'comments'];
function dropSpotChildren(d, spotId) { for (const t of CHILDREN) d[t] = d[t].filter((r) => r.spot_id !== spotId); }
export function applyChange(table, payload) {
  const list = state.server?.[table];
  if (!list || !payload?.eventType) return false;
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id; if (!id) return false;
    const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1);
    if (table === 'spots') dropSpotChildren(state.server, id);
    if (table === 'ratings') state.server.dishes = state.server.dishes.filter((r) => r.rating_id !== id);
    return true;
  }
  const row = payload.new;
  if (!row?.id) return false;
  if (row.group_id !== state.groupId) return true;          // andere Gruppe: nichts zu tun
  const i = list.findIndex((r) => r.id === row.id);
  if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
  return true;
}
const applySoon = debounce(() => {
  if (state.groupId) idb.put('kv', state.server, 'data:' + state.groupId).catch(() => {});
  rebuildData(); renderAll(false);
}, 150);

export function subscribeRealtime() {
  if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  const gid = state.groupId;
  const ch = sb.channel('foodi-' + gid);
  for (const table of [...TABLES, 'group_members']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `group_id=eq.${gid}` }, (payload) => {
      if (state.syncing || gid !== state.groupId) return;   // eigene Uploads: danach wird ohnehin abgeglichen
      // Mitglieder (Namen!) und alles Unerwartete: vollständig neu laden
      if (table === 'group_members' || !applyChange(table, payload)) refreshSoon();
      else { applySoon(); if (payload.eventType === 'UPDATE') noteRemoteEdit(table, payload.new); }
    });
  }
  ch.subscribe();
  state.channel = ch;
}

// Server-Stand + lokale Warteschlange zusammenführen
export function rebuildData() {
  const d = structuredClone(state.server);
  for (const t of TABLES) d[t] ||= [];
  d.members ||= []; d.profiles ||= {};
  const pending = new Set();
  for (const op of state.outbox) {
    if (op.groupId !== state.groupId) continue;
    const list = d[op.table];
    if (!list) continue;
    if (op.kind === 'upsert' || op.kind === 'photo') {
      const i = list.findIndex((r) => r.id === op.row.id);
      if (i >= 0) list[i] = { ...list[i], ...op.row }; else if (op.kind === 'upsert') list.push({ created_at: new Date(op.seq / 1000).toISOString(), ...op.row });
      pending.add(op.row.id);
    } else if (op.kind === 'delete') {
      const i = list.findIndex((r) => r.id === op.rowId);
      if (i >= 0) list.splice(i, 1);
      if (op.table === 'spots') dropSpotChildren(d, op.rowId);
      if (op.table === 'ratings') d.dishes = d.dishes.filter((r) => r.rating_id !== op.rowId);
    }
  }
  // Papierkorb: gelöschte Spots (samt Bewertungen, Gerichten …) ausblenden
  const binned = new Set(d.spots.filter((x) => x.deleted_at).map((x) => x.id));
  d.trash = { spots: d.spots.filter((x) => x.deleted_at), dishes: d.dishes.filter((x) => binned.has(x.spot_id)),
    ratings: d.ratings.filter((x) => binned.has(x.spot_id)) };
  d.spots = d.spots.filter((x) => !x.deleted_at);
  for (const t of CHILDREN) d[t] = d[t].filter((x) => !binned.has(x.spot_id));
  if (state.user?.id && !d.profiles[state.user.id] && state.profile) d.profiles[state.user.id] = state.profile.username || state.profile.display_name;
  buildIndexes(d);
  state.data = d;
  state.pendingIds = pending;
}

// ------------------------------------------------------------------
// Warteschlange (offline speichern, später hochladen)
// ------------------------------------------------------------------
let seqCounter = 0;
export async function enqueue(op) {
  op.id = uuid();
  op.seq = Date.now() * 1000 + (seqCounter++ % 1000);
  op.groupId = op.groupId || state.groupId;
  await idb.put('outbox', op);
  state.outbox.push(op);
  rebuildData();
  updateSyncBadge();
}
export const upsert = (table, row) => enqueue({ kind: 'upsert', table, row });
// Bestehenden Spot ändern: base = Stand (updated_at), auf dem die Änderung beruht.
// Hat inzwischen jemand anderes gespeichert, wird nicht überschrieben, sondern nachgefragt (conflicts.js).
export const editRow = (table, row, base, orig = null) => enqueue({ kind: 'upsert', table, row, base: base || null, orig });
export const remove = (table, rowId, extra = {}) => enqueue({ kind: 'delete', table, rowId, ...extra });
// Foto eines Gerichts: Dateien liegen bis zum Hochladen in IndexedDB (Schlüssel = Speicherpfad)
export const queuePhoto = (dishId, photo_path, thumb_path, oldPaths = []) =>
  enqueue({ kind: 'photo', table: 'dishes', row: { id: dishId, photo_path, thumb_path }, oldPaths });

// Nach 30 Tagen endgültig löschen (macht jedes Gerät, das es darf – also Ersteller oder Admin)
export async function purgeTrash() {
  const limit = Date.now() - TRASH_DAYS * 864e5;
  const queued = new Set(state.outbox.filter((o) => o.kind === 'delete').map((o) => o.rowId));
  let n = 0;
  for (const s of state.data.trash.spots) {
    if (Date.parse(s.deleted_at) > limit || !canEdit(s) || queued.has(s.id)) continue;
    await remove('spots', s.id, { paths: dishPaths(state.data.trash.dishes.filter((x) => x.spot_id === s.id)) }); n++;
  }
  if (n) processOutbox();
}

export async function processOutbox() {
  if (state.syncing || !navigator.onLine || !state.outbox.length) return updateSyncBadge();
  state.syncing = true; updateSyncBadge();
  let changed = false;
  try {
    while (state.outbox.length) {
      const op = state.outbox[0];
      try {
        await runOp(op);
      } catch (e) {
        if (isNetErr(e)) break; // später erneut
        console.warn('Sync-Fehler', op, e);
        toast('Eine Änderung konnte nicht gespeichert werden: ' + (e.message || e), true, 6000);
      }
      await idb.del('outbox', op.id);
      state.outbox.shift();
      changed = true;
    }
  } finally {
    state.syncing = false;
  }
  if (changed) { await fetchGroupData(); renderAll(false); }
  updateSyncBadge();
}

async function uploadBlob(path) {
  const blob = await idb.get('blobs', path);
  if (!blob) return false;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/webp' });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
  return true;
}

export async function runOp(op) {
  if (op.kind === 'photo') {
    const okFull = await uploadBlob(op.row.photo_path);
    const okThumb = op.row.thumb_path ? await uploadBlob(op.row.thumb_path) : false;
    if (!okFull) return; // Datei fehlt (z. B. Speicher geleert) – nichts zu tun
    const { error } = await sb.from('dishes').update({ photo_path: op.row.photo_path, thumb_path: okThumb ? op.row.thumb_path : null }).eq('id', op.row.id);
    if (error) throw error;
    if (op.oldPaths?.length) await sb.storage.from(BUCKET).remove(op.oldPaths);
  } else if (op.kind === 'upsert' && op.base && op.table === 'spots') {
    // Nur ändern, wenn der Eintrag seit dem Öffnen unverändert ist
    const { id, ...fields } = op.row;
    const { data, error } = await sb.from(op.table).update(fields).eq('id', id).eq('updated_at', op.base).select('id, updated_at');
    if (error) throw error;
    if (data?.length) {
      // Weitere wartende Änderungen am selben Eintrag bauen auf dem neuen Stand auf
      for (const o of state.outbox) if (o !== op && o.table === op.table && o.row?.id === id && o.base) { o.base = data[0].updated_at; idb.put('outbox', o).catch(() => {}); }
    } else {
      const { data: cur, error: e2 } = await sb.from(op.table).select('*').eq('id', id).maybeSingle();
      if (e2) throw e2;
      addConflict(op, cur || null);
    }
  } else if (op.kind === 'upsert') {
    const { error } = await sb.from(op.table).upsert(op.row);
    if (error) throw error;
  } else if (op.kind === 'delete') {
    if (op.paths?.length) {
      const { error: stErr } = await sb.storage.from(BUCKET).remove(op.paths);
      if (stErr && isNetErr(stErr)) throw stErr;
    }
    const { error } = await sb.from(op.table).delete().eq('id', op.rowId);
    if (error) throw error;
  }
}

window.addEventListener('online', () => { if (state.publicMode) return refreshSoon(); updateSyncBadge(); refreshGroups(); processOutbox(); fetchGroupData().then(() => renderAll(false)); });
window.addEventListener('offline', updateSyncBadge);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (!state.groupId) return;
  processOutbox();
  // Nur komplett neu laden, wenn die Echtzeit-Verbindung Ereignisse verpasst haben könnte
  const live = state.channel?.state === 'joined';
  if (!live || Date.now() - hiddenAt > 30000 || Date.now() - lastFullFetch > 10 * 60000) refreshSoon();
});
setInterval(() => { if (state.outbox.length) processOutbox(); }, 30000);

export function updateSyncBadge() {
  const b = $('#sync-badge');
  const n = state.outbox.length;
  b.className = 'sync-badge';
  if (!navigator.onLine) { b.textContent = n ? `Offline · ${n}` : 'Offline'; b.classList.add('offline'); }
  else if (n) { b.textContent = `⟳ ${n}`; b.classList.add('pending'); }
  else { b.textContent = '✓'; b.classList.add('ok'); }
  b.title = n ? `${n} Änderung(en) warten auf Upload` : 'Alles synchronisiert';
}
$('#sync-badge').addEventListener('click', () => {
  const n = state.outbox.length;
  if (!navigator.onLine) toast(n ? `Offline – ${n} Änderung(en) werden hochgeladen, sobald wieder Netz da ist.` : 'Offline – du kannst trotzdem bewerten und eintragen.');
  else if (n) { toast('Wird hochgeladen …'); processOutbox(); }
  else { toast('Alles synchronisiert.'); refreshSoon(); }
});
