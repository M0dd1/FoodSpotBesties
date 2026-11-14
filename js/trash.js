// FoodiSpots – Papierkorb: gelöschte Spots 30 Tage lang wiederherstellen
import { $$, TRASH_DAYS, canEdit, esc, fmtDate, nameOf, spotEmoji, state, toast } from './core.js';
import { head, openSheet } from './ui.js';
import { editRow, processOutbox, remove } from './sync.js';
import { dishPaths, spotImagePaths } from './photos.js';
import { renderAll } from './views.js';
import { SPOT_FIELDS, openSpot, pick } from './spots.js';

const daysLeft = (iso) => Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - Date.parse(iso)) / 864e5));

export function openTrash() {
  const t = state.data.trash;
  const items = [...t.spots].sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));
  const body = openSheet(`${head('🗑 Papierkorb')}
    <p class="small muted">Gelöschte Spots bleiben ${TRASH_DAYS} Tage hier und werden danach endgültig gelöscht – mit allen Bewertungen, Gerichten und Fotos.
      Wiederherstellen oder endgültig löschen kann, wer den Spot eingetragen hat, oder ein Admin.</p>
    ${items.length ? `<div class="stack">${items.map((s) => {
      const r = (t.ratings || []).filter((x) => x.spot_id === s.id).length, d = t.dishes.filter((x) => x.spot_id === s.id).length;
      const left = daysLeft(s.deleted_at);
      return `<div class="trash-item">
      <div class="trash-title"><b>${esc(spotEmoji(s))} ${esc(s.name)}</b></div>
      <div class="small muted">${r} Bewertung${r === 1 ? '' : 'en'} · ${d} Gericht${d === 1 ? '' : 'e'} · gelöscht ${fmtDate(s.deleted_at)}${s.deleted_by ? ` von ${esc(nameOf(s.deleted_by))}` : ''} · noch ${left} Tag${left === 1 ? '' : 'e'}</div>
      ${canEdit(s) ? `<div class="row" style="margin-top:8px">
        <button class="btn small primary" data-restore="${s.id}" type="button">↩ Wiederherstellen</button>
        <button class="btn small danger" data-purge="${s.id}" type="button">Endgültig löschen</button></div>` : ''}
    </div>`;
    }).join('')}</div>` : '<p class="muted" style="text-align:center;margin:28px 0">Der Papierkorb ist leer.</p>'}`, 'trash');

  $$('[data-restore]', body).forEach((b) => b.addEventListener('click', async () => {
    const s = t.spots.find((x) => x.id === b.dataset.restore); if (!s) return;
    await editRow('spots', { ...pick(s, SPOT_FIELDS), deleted_at: null, deleted_by: null }, s.updated_at, pick(s, SPOT_FIELDS));
    renderAll(false); processOutbox();
    toast('Wiederhergestellt.');
    openSpot(s.id);
  }));
  $$('[data-purge]', body).forEach((b) => b.addEventListener('click', async () => {
    const s = t.spots.find((x) => x.id === b.dataset.purge); if (!s) return;
    if (!confirm(`„${s.name}“ mit allen Bewertungen, Gerichten und Fotos endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    await remove('spots', s.id, { paths: [...dishPaths(t.dishes.filter((x) => x.spot_id === s.id)), ...spotImagePaths([s])] });
    renderAll(false); processOutbox(); openTrash();
    toast('Endgültig gelöscht.');
  }));
}
