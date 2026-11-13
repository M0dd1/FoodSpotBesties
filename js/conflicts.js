// FoodiSpots – Gleichzeitiges Bearbeiten: Hat jemand anderes einen Spot geändert,
// seit du sie zum Bearbeiten geöffnet hast, wird nicht still überschrieben – du entscheidest, welche Version gilt.
import { $, $$, CATEGORIES, cuisineNames, esc, euro, fmtDate, idb, nameOf, state, toast } from './core.js';
import { closeSheet, head, openSheet } from './ui.js';
import { enqueue, processOutbox } from './sync.js';
import { renderAll } from './views.js';

const LABELS = {
  spots: { name: 'Name', address: 'Adresse', cuisines: 'Länderküche', category: 'Art', focus: 'Schwerpunkt', price_level: 'Preisniveau',
    description: 'Beschreibung', specialties: 'Spezialitäten', website: 'Webseite', phone: 'Telefon', opening_hours: 'Öffnungszeiten',
    notes: 'Notiz', position: 'Position', deleted_at: 'Papierkorb' },
};
function show(table, field, row) {
  const v = row?.[field];
  if (field === 'cuisines') return cuisineNames(v) || '–';
  if (field === 'category') return CATEGORIES[v] || v || '–';
  if (field === 'price_level') return euro(v) || '–';
  if (Array.isArray(v)) return v.join(', ') || '–';
  if (field === 'deleted_at') return v ? 'gelöscht' : 'nicht gelöscht';
  if (field === 'position') return row ? `${Number(row.lat).toFixed(5)}, ${Number(row.lng).toFixed(5)}` : '–';
  return v == null || v === '' ? '–' : String(v);
}
function differs(table, field, a, b) {
  if (field === 'position') return Number(a.lat).toFixed(6) !== Number(b.lat).toFixed(6) || Number(a.lng).toFixed(6) !== Number(b.lng).toFixed(6);
  if (Array.isArray(a[field]) || Array.isArray(b[field])) return JSON.stringify(a[field] || []) !== JSON.stringify(b[field] || []);
  if (field === 'deleted_at') return !!a.deleted_at !== !!b.deleted_at;
  return (a[field] ?? '') !== (b[field] ?? '');
}
// Nur Felder, die du geändert hast UND die jetzt anders gespeichert sind
// (orig = Stand beim Öffnen; ohne orig gelten alle mitgeschickten Felder als geändert)
const changedFields = (c) => Object.keys(LABELS[c.table]).filter((f) => f in c.mine || (f === 'position' && 'lat' in c.mine))
  .filter((f) => !c.orig || differs(c.table, f, c.mine, c.orig))
  .filter((f) => !c.current || differs(c.table, f, c.mine, c.current));

export async function loadConflicts() {
  state.conflicts = (await idb.get('kv', 'conflicts').catch(() => null)) || [];
  if (state.conflicts.length) showConflictBanner();
}
const save = () => idb.put('kv', state.conflicts, 'conflicts').catch(() => {});

export function addConflict(op, current) {
  state.conflicts ||= [];
  const c = { id: op.id, table: op.table, rowId: op.row.id, mine: op.row, orig: op.orig || null, current, groupId: op.groupId, at: new Date().toISOString() };
  if (current && !changedFields(c).length) return false;   // beide haben dasselbe gemacht – kein Konflikt
  state.conflicts = state.conflicts.filter((x) => !(x.table === c.table && x.rowId === c.rowId)).concat(c);
  save();
  showConflictBanner();
  return true;
}

export function showConflictBanner() {
  if (!state.conflicts?.length) { $('#conflict-banner')?.remove(); return; }
  let b = $('#conflict-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'conflict-banner'; b.className = 'update-banner conflict-banner'; b.setAttribute('role', 'status');
    b.innerHTML = '<span></span><button class="btn small primary" type="button">Ansehen</button>';
    b.querySelector('button').addEventListener('click', openConflicts);
    document.body.appendChild(b);
  }
  const n = state.conflicts.length;
  b.querySelector('span').textContent = n === 1 ? 'Eine deiner Änderungen überschneidet sich mit einer anderen.' : `${n} deiner Änderungen überschneiden sich mit anderen.`;
}

export function openConflicts() {
  const list = state.conflicts || [];
  if (!list.length) return closeSheet();
  const body = openSheet(`${head('Gleichzeitig bearbeitet')}
    <p class="small muted">Jemand anderes hat diese Einträge geändert, während du sie bearbeitet hast. Wähle, welche Version gelten soll.</p>
    <div class="stack">${list.map((c) => {
      const title = `Spot „${esc(c.mine.name || c.current?.name || 'ohne Name')}“`;
      if (!c.current) return `<div class="conflict" data-c="${c.id}"><b>${title}</b>
        <p class="small">wurde inzwischen endgültig gelöscht. Deine Änderung kann nicht mehr gespeichert werden.</p>
        <div class="row"><button class="btn small primary" data-drop="${c.id}" type="button">OK</button></div></div>`;
      const fields = changedFields(c);
      return `<div class="conflict" data-c="${c.id}"><b>${title}</b>
        <p class="small muted">geändert von <b>${c.current.updated_by ? esc(nameOf(c.current.updated_by)) : 'jemand anderem'}</b>${c.current.updated_at ? ` am ${fmtDate(c.current.updated_at)}` : ''}</p>
        <table class="conflict-table"><thead><tr><th></th><th>Deine Version</th><th>Jetzt gespeichert</th></tr></thead><tbody>
        ${fields.map((f) => `<tr><th>${LABELS[c.table][f]}</th><td>${esc(show(c.table, f, c.mine))}</td><td>${esc(show(c.table, f, c.current))}</td></tr>`).join('')}
        </tbody></table>
        <div class="row wrap"><button class="btn small primary" data-mine="${c.id}" type="button">Meine Version speichern</button>
        <button class="btn small" data-theirs="${c.id}" type="button">Andere Version behalten</button></div></div>`;
    }).join('')}</div>`, 'conflicts');

  const done = (id) => {
    state.conflicts = state.conflicts.filter((x) => x.id !== id); save();
    showConflictBanner();
    if (state.conflicts.length) openConflicts(); else closeSheet();
  };
  $$('[data-mine]', body).forEach((b) => b.addEventListener('click', async () => {
    const c = state.conflicts.find((x) => x.id === b.dataset.mine); if (!c) return;
    // Bewusst überschreiben: Basis ist jetzt der aktuelle Stand
    // Nur die eigenen Änderungen übernehmen – was andere an anderen Feldern geändert haben, bleibt erhalten
    const row = { id: c.rowId };
    for (const f of changedFields(c)) {
      if (f === 'position') { row.lat = c.mine.lat; row.lng = c.mine.lng; } else row[f] = c.mine[f];
      if (f === 'deleted_at') row.deleted_by = c.mine.deleted_by ?? null;
    }
    await enqueue({ kind: 'upsert', table: c.table, row, base: c.current.updated_at, groupId: c.groupId });
    done(c.id); renderAll(false); processOutbox();
    toast('Deine Version wird gespeichert.');
  }));
  $$('[data-theirs]', body).forEach((b) => b.addEventListener('click', () => { done(b.dataset.theirs); toast('Andere Version behalten.'); }));
  $$('[data-drop]', body).forEach((b) => b.addEventListener('click', () => done(b.dataset.drop)));
}

// Hinweis im offenen Bearbeiten-Formular, wenn gerade jemand anderes denselben Eintrag ändert
export function noteRemoteEdit(table, row) {
  const e = state.editing;
  if (!e || e.table !== table || e.id !== row.id || state._sheetKind !== 'edit') return;
  if (row.updated_by && row.updated_by === state.user?.id) return;
  if (row.updated_at && row.updated_at === e.base) return;
  if ($('#edit-conflict')) return;
  const form = $('#sheet-body form'); if (!form) return;
  form.insertAdjacentHTML('afterbegin', `<div class="warn" id="edit-conflict">⚠️ <b>${row.updated_by ? esc(nameOf(row.updated_by)) : 'Jemand anderes'}</b> hat das gerade geändert. Wenn du speicherst, fragt die App nach, welche Version gelten soll.</div>`);
}
