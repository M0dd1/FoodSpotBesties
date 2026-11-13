// FoodiSpots – Bewertung: jede Person für sich, mit eigenen Gerichten und Fotos
import { $, $$, SUBSCORES, esc, fmtDate, fmtNum, nameOf, norm, state, toast, todayISO, uuid } from './core.js';
import { head, onSheetClose, openSheet, starsInput, wireStars } from './ui.js';
import { processOutbox, remove, upsert } from './sync.js';
import { dishPaths, photoUrl, prepareDishPhoto, storeDishPhoto } from './photos.js';
import { dishesOf, dishesOfRating, statsOf, visitsOf } from './list.js';
import { renderAll } from './views.js';
import { openSpot } from './spots.js';

const priceText = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const parsePrice = (v) => { const n = parseFloat(String(v || '').replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100), 1000000) : null; };

export function openRating(s) {
  const mine = statsOf(s.id).myRating;
  const r = mine || { overall: null, food: null, service: null, ambience: null, value: null, would_return: null, comment: '', visited_on: todayISO() };
  const values = Object.fromEntries(['overall', ...SUBSCORES.map(([k]) => k)].map((k) => [k, r[k] ?? null]));
  let wouldReturn = r.would_return ?? null;
  // Arbeitskopie der eigenen Gerichte: state keep | update | new | delete
  const dishes = (mine ? dishesOfRating(mine.id) : []).map((d) => ({ ...d, _state: 'keep' }));
  const others = dishesOf(s.id).filter((d) => d.created_by !== state.user.id);
  const known = [...new Set(dishesOf(s.id).map((d) => d.name.trim()))].sort((a, b) => a.localeCompare(b, 'de'));
  const members = state.data.members.map((m) => m.user_id);
  // Gemeinsamer Besuch: wer war dabei? (nur beim ersten Bewerten)
  const participants = new Set([state.user.id]);
  const existingVisit = !mine && visitsOf(s.id).find((v) => (v.participants || []).includes(state.user.id));

  const body = openSheet(`${head(`Bewerten: ${esc(s.name)}`)}
    <form id="f-rate" class="stack">
      <label>Wann wart ihr da?<input type="date" name="visited_on" value="${esc(existingVisit?.visited_on || r.visited_on || todayISO())}" max="${todayISO()}" required></label>
      ${!mine && !existingVisit && members.length > 1 ? `<div><div class="field-label">Wer war dabei?</div>
        <div class="chips" id="r-who">${members.map((uid) => `<button type="button" class="chip${participants.has(uid) ? ' on' : ''}" data-uid="${uid}">${esc(nameOf(uid))}</button>`).join('')}</div>
        <p class="small muted" style="margin:4px 0 0">Die anderen werden beim Öffnen des Spots ans Bewerten erinnert.</p></div>` : ''}
      <div><div class="field-label">Gesamtnote</div>${starsInput('overall', values.overall)}</div>
      <details${SUBSCORES.some(([k]) => r[k]) ? ' open' : ''}><summary class="field-label" style="cursor:pointer">Im Detail (optional)</summary>
        <div class="stack" style="margin-top:8px">${SUBSCORES.map(([k, l]) => `<div class="sub-row"><span>${l}</span>${starsInput(k, values[k], true)}</div>`).join('')}</div>
      </details>
      <div><div class="field-label">Würdest du wieder hingehen?</div>
        <div class="seg" id="r-return">${[['true', 'Ja 👍'], ['false', 'Eher nicht'], ['', 'Weiß nicht']].map(([v, l]) =>
          `<button type="button" data-v="${v}" class="${String(wouldReturn ?? '') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <label>Kommentar<textarea name="comment" maxlength="2000" placeholder="Wie war’s?">${esc(r.comment || '')}</textarea></label>

      <div class="row" style="justify-content:space-between;margin-top:6px"><span class="field-label" style="margin:0">Was hattest du?</span>
        <button type="button" class="btn small" id="r-add-dish">＋ Gericht</button></div>
      <datalist id="dish-names">${known.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div id="r-dishes" class="stack"></div>

      <button class="btn primary big" type="submit" id="r-save">Bewertung speichern</button>
      ${mine ? '<button class="btn danger" type="button" id="r-delete">Meine Bewertung löschen</button>' : ''}
      <button class="btn ghost" type="button" id="r-back">Zurück</button>
    </form>`, 'rating');

  const form = $('#f-rate', body);
  const box = $('#r-dishes', body);
  // Ein Handler für alle Sterne: Gesamt/Unterpunkte und Gerichte
  wireStars(form, (name, v, starBox) => {
    if (name === 'dish') {
      const d = dishes[Number(starBox.closest('[data-idx]').dataset.idx)];
      d.stars = v; if (d._state === 'keep') d._state = 'update';
    } else if (name in values) values[name] = v;
  });
  $('#r-return', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    wouldReturn = b.dataset.v === '' ? null : b.dataset.v === 'true';
    $$('#r-return button', body).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#r-who', body)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-uid]'); if (!b || b.dataset.uid === state.user.id) return;
    participants.has(b.dataset.uid) ? participants.delete(b.dataset.uid) : participants.add(b.dataset.uid);
    b.classList.toggle('on', participants.has(b.dataset.uid));
  });

  const hint = (name) => {
    const same = others.filter((d) => d.stars && norm(d.name) === norm(name));
    if (!norm(name) || !same.length) return '';
    const avg = same.reduce((a, d) => a + d.stars, 0) / same.length;
    return `Hatte auch: ${esc([...new Set(same.map((d) => nameOf(d.created_by)))].join(', '))} – Ø ${fmtNum(avg)} ★`;
  };
  const renderDishes = () => {
    const live = dishes.map((d, i) => [d, i]).filter(([d]) => d._state !== 'delete');
    box.innerHTML = live.length ? live.map(([d, i]) => `<div class="dish-edit" data-idx="${i}">
      <label class="dish-photo${d._preview || d.thumb_path || d.photo_path ? ' has' : ''}" data-photo-for="${i}">
        <span>📷<br>Foto</span><input type="file" accept="image/*" data-f="photo" aria-label="Foto vom Gericht"></label>
      <div class="dish-fields">
        <input data-f="name" list="dish-names" maxlength="120" placeholder="z. B. Gyros-Teller" value="${esc(d.name || '')}" aria-label="Gericht">
        ${starsInput('dish', d.stars || 0, true)}
        <div class="row">
          <input data-f="price" inputmode="decimal" placeholder="Preis €" value="${priceText(d.price_cents)}" style="width:96px;flex:none" aria-label="Preis in Euro">
          <input data-f="note" maxlength="500" placeholder="Notiz" value="${esc(d.note || '')}" aria-label="Notiz">
        </div>
        <div class="row" style="justify-content:space-between"><span class="small muted" data-hint>${hint(d.name)}</span>
          <button type="button" class="btn ghost small" data-remove>Entfernen</button></div>
      </div></div>`).join('')
      : '<p class="small muted">Trag ein, was du hattest – mit Foto sieht die Gruppe gleich, was sich lohnt.</p>';
    // Vorschaubilder
    for (const [d, i] of live) {
      const el = $(`[data-photo-for="${i}"]`, box);
      if (d._preview) el.style.backgroundImage = `url("${d._preview}")`;
      else if (d.thumb_path || d.photo_path) photoUrl(d.thumb_path || d.photo_path).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; });
    }
  };
  renderDishes();

  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]'); if (!el || el.dataset.f === 'photo') return;
    const card = el.closest('[data-idx]'); const d = dishes[Number(card.dataset.idx)];
    if (d._state === 'keep') d._state = 'update';
    if (el.dataset.f === 'name') { d.name = el.value; $('[data-hint]', card).innerHTML = hint(el.value); }
    if (el.dataset.f === 'note') d.note = el.value;
    if (el.dataset.f === 'price') d.price_cents = parsePrice(el.value);
  });
  box.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-f="photo"]'); if (!el?.files?.[0]) return;
    const card = el.closest('[data-idx]'); const d = dishes[Number(card.dataset.idx)];
    const lbl = el.closest('.dish-photo'); lbl.classList.add('has', 'busy');
    try {
      d._photo = await prepareDishPhoto(el.files[0]);
      if (d._preview) URL.revokeObjectURL(d._preview);
      d._preview = d._photo.url;
      lbl.style.backgroundImage = `url("${d._preview}")`;
      if (d._state === 'keep') d._state = 'update';
      // Aufnahmedatum als Besuchsdatum vorschlagen, solange niemand es geändert hat
      if (d._photo.meta?.date && !dateTouched && d._photo.meta.date <= todayISO()) { form.visited_on.value = d._photo.meta.date; toast(`Datum aus dem Foto übernommen (${fmtDate(d._photo.meta.date)}).`); dateTouched = true; }
    } catch { toast('Foto konnte nicht gelesen werden.', true); if (!d._preview && !d.thumb_path) lbl.classList.remove('has'); }
    lbl.classList.remove('busy'); el.value = '';
  });
  let dateTouched = !!mine;
  form.visited_on.addEventListener('change', () => { dateTouched = true; });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove]')) return;
    const i = Number(e.target.closest('[data-idx]').dataset.idx);
    if (dishes[i].id && dishes[i]._state !== 'new') dishes[i]._state = 'delete'; else dishes.splice(i, 1);
    renderDishes();
  });
  $('#r-add-dish', body).addEventListener('click', () => {
    dishes.push({ id: uuid(), name: '', stars: null, price_cents: null, note: '', _state: 'new' });
    renderDishes();
    const cards = $$('.dish-edit', box); $('[data-f="name"]', cards[cards.length - 1])?.focus();
  });
  onSheetClose(() => dishes.forEach((d) => d._preview && URL.revokeObjectURL(d._preview)));
  $('#r-back', body).addEventListener('click', () => openSpot(s.id));

  $('#r-delete', body)?.addEventListener('click', async () => {
    if (!confirm('Deine Bewertung samt Gerichten und Fotos löschen?')) return;
    await remove('ratings', mine.id, { paths: dishPaths(dishesOfRating(mine.id)) });
    renderAll(false); openSpot(s.id); processOutbox();
    toast('Bewertung gelöscht.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!values.overall) return toast('Bitte eine Gesamtnote vergeben.', true);
    if (dishes.some((d) => d._state !== 'delete' && !String(d.name || '').trim())) return toast('Jedes Gericht braucht einen Namen (oder „Entfernen“).', true);
    $('#r-save', body).disabled = true;
    const visited_on = form.visited_on.value || todayISO();
    let visitId = mine?.visit_id || existingVisit?.id || null;
    if (!mine && !existingVisit) {
      visitId = uuid();
      await upsert('visits', { id: visitId, spot_id: s.id, group_id: state.groupId, visited_on, participants: [...participants], created_by: state.user.id });
    }
    const ratingId = mine?.id || uuid();
    await upsert('ratings', { id: ratingId, spot_id: s.id, group_id: state.groupId, created_by: state.user.id, visit_id: visitId,
      ...values, would_return: wouldReturn, comment: form.comment.value.trim(), visited_on });
    for (const d of dishes) {
      if (d._state === 'delete') { await remove('dishes', d.id, { paths: dishPaths([d]) }); continue; }
      if (d._state === 'new' || d._state === 'update') {
        await upsert('dishes', { id: d.id, rating_id: ratingId, spot_id: s.id, group_id: state.groupId, created_by: state.user.id,
          name: String(d.name).trim(), stars: d.stars || null, price_cents: d.price_cents ?? null, note: String(d.note || '').trim() });
      }
      if (d._photo) await storeDishPhoto(d, d._photo, s.id);
    }
    state._spotTab = 'ratings';
    renderAll(false); openSpot(s.id); processOutbox();
    toast(navigator.onLine ? 'Bewertung gespeichert ⭐' : 'Offline gespeichert – wird später hochgeladen.');
  });
}
