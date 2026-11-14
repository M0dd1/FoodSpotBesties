// FoodiSpots – Spot eintragen (Suche, Formular), Detailansicht, Wünsche, Kommentare
import { $, $$, CATEGORIES, CAT_EMOJI, canEdit, cuisineNames, cuisineOf, distance, esc, euro, fmtDate, fmtDist, fmtNum, fmtPrice,
  hostOf, nameOf, ratingColor, regionsOf, safeUrl, spotEmoji, starsHtml, state, toast, uuid, SUBSCORES, norm } from './core.js';
import { closeSheet, head, onSheetClose, openSheet, priceInput, wirePrice } from './ui.js';
import { editRow, processOutbox, remove, upsert } from './sync.js';
import { hydratePhotos, openLightbox, openPhoto, photoUrl, removeSpotImage, storeSpotImage } from './photos.js';
import { map, startWatch } from './map.js';
import { commentsOf, dishesOf, dishesOfRating, openState, ratingsOf, statsOf, visitsOf, wantsOf } from './list.js';
import { renderAll, whoWants } from './views.js';
import { GMAPS_RE, candidateToSpot, enrichCandidate, fetchImage, imageCandidates, mergeEnrichment, researchText, resolveLink, searchSpots } from './lookup.js';
import { openRating } from './ratings.js';

export const SPOT_FIELDS = ['id', 'group_id', 'name', 'lat', 'lng', 'address', 'city', 'osm_type', 'osm_id', 'cuisines', 'cuisine_guessed',
  'category', 'focus', 'price_level', 'description', 'specialties', 'website', 'phone', 'opening_hours', 'diet_veg', 'diet_vegan',
  'source_urls', 'notes', 'created_by', 'deleted_at', 'deleted_by'];
export const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);

// ------------------------------------------------------------------
// Spot eintragen: ein Suchfeld
// ------------------------------------------------------------------
$('#btn-add').addEventListener('click', () => openAdd());
export function openAdd(prefill = '') {
  // Geteilter Text kann mehrzeilig sein (Name, Adresse, Link) – das Suchfeld zeigt ihn einzeilig, gesucht wird mit dem Original
  const shared = prefill;
  const body = openSheet(`${head('Spot eintragen')}
    <form id="f-search" class="row">
      <input name="q" id="search-q" required minlength="2" maxlength="600" placeholder="z. B. delphi koblenz" value="${esc(prefill.replace(/\s*\n\s*/g, ' ').trim())}" autocomplete="off" enterkeyhint="search" aria-label="Was wollt ihr ausprobieren?">
      <button class="btn primary" type="submit">Suchen</button>
    </form>
    <p class="small muted" style="margin:6px 0 0">Name und Ort reichen – oder einen Google-Maps-Link einfügen. Adresse, Küchenrichtung und Bild werden automatisch gesucht.</p>
    <div id="search-results" class="stack" style="margin-top:12px"></div>
    <div class="row wrap" style="margin-top:14px">
      <button class="btn small" id="add-pick" type="button">🗺️ Auf der Karte wählen</button>
      <button class="btn small ghost" id="add-manual" type="button">Ohne Suche eintragen</button>
    </div>`, 'add');
  const form = $('#f-search', body);
  setTimeout(() => form.q.focus(), 50);
  form.addEventListener('submit', (e) => { e.preventDefault(); runSearch(form.q.value.trim()); });
  // Link aus der Zwischenablage eingefügt → sofort auflösen
  form.q.addEventListener('paste', () => setTimeout(() => { if (GMAPS_RE.test(form.q.value)) runSearch(form.q.value.trim()); }, 0));
  $('#add-manual', body).addEventListener('click', () => startManualSpot(null, form.q.value.trim()));
  $('#add-pick', body).addEventListener('click', () => {
    closeSheet();
    state.pickMode = true;
    $('#map-hint').textContent = 'Tippe auf die Stelle des Spots.';
    $('#map-hint').classList.remove('hidden');
  });
  if (shared) runSearch(shared);
}

const candHtml = (c, i, extra = '') => {
  const dup = findDuplicate({ ...c, name: c.name });
  return `<button type="button" class="cand" data-i="${i}">
    <b>${esc(c.cuisines?.length ? spotEmoji(c) : (CAT_EMOJI[c.category] || '📍'))} ${esc(c.name || 'Ohne Namen')}</b>
    <span>${esc(c.address || c.display_name || '')}</span>
    <span>${esc([c.is_food ? CATEGORIES[c.category] : 'kein Lokal – nur Adresse', cuisineNames(c.cuisines), ...(c.focus || [])].filter(Boolean).join(' · '))}${extra}</span>
    ${dup ? '<span class="tag">steht schon auf eurer Liste</span>' : ''}
  </button>`;
};
function wireCands(box, cands) {
  $$('.cand', box).forEach((b) => b.addEventListener('click', () => {
    const c = cands[Number(b.dataset.i)];
    const dup = findDuplicate(c);
    if (dup && confirm(`„${dup.name}“ steht schon auf eurer Liste. Öffnen statt neu eintragen?`)) return openSpot(dup.id);
    const spot = candidateToSpot(c);
    if (c.from_link) spot.source_urls = c.link ? [c.link] : [];
    openSpotForm(spot, { enrich: c.name ? c : null, manualPos: c.lat == null });
  }));
}

// Geteilter Google-Maps-Link: Name + Lage aus dem Link, dann das passende Lokal aus OpenStreetMap
async function runLinkSearch(text) {
  const box = $('#search-results');
  box.innerHTML = '<div class="hint row"><span class="spinner"></span> Lese den Google-Maps-Link …</div>';
  const { data, error } = await resolveLink(text);
  if (!$('#search-results')) return;
  if (error || !data?.found) {
    box.innerHTML = `<div class="warn">${error === 'offline' ? 'Dafür wird Internet benötigt.' : error ? esc(error) : 'Aus dem Link ließ sich kein Ort lesen.'} Tipp den Namen des Lokals ein oder trag es ohne Suche ein.</div>`;
    return;
  }
  const cands = [...(data.candidates || [])];
  const g = data.google ? { ...data.google, link: data.link } : null;
  if (g) cands.push(g);
  box.innerHTML = (data.candidates?.length ? '<div class="small muted" style="font-weight:600">Gefunden – welcher ist es?</div>' : '')
    + (data.candidates || []).map((c, i) => candHtml(c, i, c.distance_m != null ? ` · ${c.distance_m < 15 ? 'genau dort' : `${c.distance_m} m daneben`}` : '')).join('')
    + (g ? `${data.candidates?.length ? '<div class="small muted" style="margin-top:6px">Nicht dabei?</div>' : '<div class="small muted" style="font-weight:600">Aus dem Google-Maps-Link:</div>'}
      ${candHtml({ ...g, display_name: g.address || 'Position aus Google Maps' }, cands.length - 1, ' · Position aus Google Maps')}` : '')
    + (!g && !data.candidates?.length ? `<div class="hint">„${esc(data.name)}“ – Lage unbekannt. Bitte auf der Karte wählen.</div>` : '');
  wireCands(box, cands);
  if (!g && !data.candidates?.length && data.name) {
    box.insertAdjacentHTML('beforeend', '<button type="button" class="btn" id="btn-link-manual">Eintragen und Position wählen</button>');
    $('#btn-link-manual', box).addEventListener('click', () => startManualSpot(null, data.name));
  }
}

async function runSearch(q) {
  const box = $('#search-results'); if (!box || q.length < 2) return;
  if (GMAPS_RE.test(q)) return runLinkSearch(q);
  q = q.slice(0, 120);
  box.innerHTML = `<div class="hint row"><span class="spinner"></span> Suche „${esc(q)}“ …</div>`;
  const { data, error } = await searchSpots(q);
  if (!$('#search-results')) return;
  if (error) {
    box.innerHTML = `<div class="warn">${error === 'offline' ? 'Die Suche braucht Internet. Du kannst den Spot trotzdem ohne Suche eintragen.' : esc(error)}</div>`;
    return;
  }
  const cands = data?.candidates || [];
  box.innerHTML = (cands.length ? '<div class="small muted" style="font-weight:600">Welcher ist es?</div>' + cands.map((c, i) => candHtml(c, i)).join('')
    : '<div class="hint">Auf OpenStreetMap nichts gefunden.</div>')
    + '<button type="button" class="btn" id="btn-research">🔎 Im Web recherchieren lassen</button>';
  wireCands(box, cands);
  $('#btn-research', box).addEventListener('click', () => research(q));
}

async function research(q) {
  const box = $('#search-results');
  box.innerHTML = `<div class="hint row"><span class="spinner"></span> Recherchiere „${esc(q)}“ im Web …</div>`;
  const { data, error } = await researchText(q);
  if (!$('#search-results')) return;
  if (error || !data?.enriched) {
    box.innerHTML = `<div class="warn">${data?.reason === 'no_key' ? 'Die Web-Recherche ist noch nicht eingerichtet.' : error === 'offline' ? 'Dafür wird Internet benötigt.' : 'Die Web-Recherche hat nichts ergeben.'} Du kannst den Spot ohne Suche eintragen.</div>
      <button class="btn" type="button" id="btn-manual-2">Ohne Suche eintragen</button>`;
    $('#btn-manual-2', box).addEventListener('click', () => startManualSpot(null, q));
    return;
  }
  const c = map.getCenter();
  const spot = mergeEnrichment({ name: data.name || q, lat: data.lat ?? c.lat, lng: data.lng ?? c.lng, address: data.address || '', city: data.city || '', cuisines: [] }, data);
  openSpotForm(spot, { manualPos: data.lat == null });
}

export function startManualSpot(latlng, name = '') {
  state.pickMode = false; $('#map-hint').classList.add('hidden');
  const c = latlng || state.myPos || map.getCenter();
  openSpotForm({ name, lat: c.lat, lng: c.lng, cuisines: [] }, { manualPos: !latlng });
}

export function findDuplicate(s, ignoreId) {
  const n = norm(s.name);
  return state.data.spots.find((x) => x.id !== ignoreId && (
    (s.osm_id && x.osm_id && String(x.osm_id) === String(s.osm_id) && x.osm_type === s.osm_type) ||
    (n && distance(x, s) < 30 && (norm(x.name).includes(n) || n.includes(norm(x.name))))));
}

// ------------------------------------------------------------------
// Formular für neuen oder bestehenden Spot
// ------------------------------------------------------------------
export function openSpotForm(input, opts = {}) {
  const editing = !!input.id && state.data.spots.some((x) => x.id === input.id);
  const s = { cuisines: [], cuisine_guessed: false, category: 'restaurant', focus: [], specialties: [], source_urls: [], ...input };
  const base = editing ? input.updated_at : null;
  if (editing) state.editing = { table: 'spots', id: s.id, base };
  const dup = !editing && findDuplicate(s);
  const body = openSheet(`${head(editing ? 'Spot bearbeiten' : 'Neuer Spot')}
    ${dup ? `<div class="warn">„${esc(dup.name)}“ steht schon auf eurer Liste. <button type="button" class="btn small" id="sf-dup">Ansehen</button></div>` : ''}
    <div id="sf-enrich"></div>
    <form id="f-spot" class="stack">
      <label>Name<input name="name" required maxlength="120" value="${esc(s.name)}"></label>
      <label>Adresse<input name="address" maxlength="200" value="${esc(s.address || '')}" placeholder="Straße Nr., PLZ Ort"></label>
      <div>
        <div class="row" style="justify-content:space-between"><span class="field-label">Länderküche</span><span id="sf-guess"></span></div>
        <div class="chips" id="sf-cuisines" style="margin-top:6px"></div>
        <div id="sf-picker" class="cuisine-picker hidden"></div>
      </div>
      <div class="row amount-row">
        <label>Art<select name="category">${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}"${s.category === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Schwerpunkt<input name="focus" maxlength="120" value="${esc((s.focus || []).join(', '))}" placeholder="z. B. Tapas, Grill"></label>
      </div>
      <div><div class="field-label">Preisniveau</div>${priceInput(s.price_level)}</div>
      <label>Beschreibung<textarea name="description" maxlength="1000" placeholder="Was macht den Laden aus?">${esc(s.description || '')}</textarea></label>
      <label>Spezialitäten<input name="specialties" maxlength="300" value="${esc((s.specialties || []).join(', '))}" placeholder="kommagetrennt, z. B. Gyros, Moussaka"></label>
      <div class="chips">
        <label class="chip check"><input type="checkbox" name="diet_veg"${s.diet_veg ? ' checked' : ''}> 🥦 vegetarische Auswahl</label>
        <label class="chip check"><input type="checkbox" name="diet_vegan"${s.diet_vegan ? ' checked' : ''}> 🌱 vegane Auswahl</label>
      </div>
      <div class="row amount-row">
        <label>Webseite<input name="website" inputmode="url" maxlength="300" value="${esc(s.website || '')}"></label>
        <label>Telefon<input name="phone" inputmode="tel" maxlength="40" value="${esc(s.phone || '')}"></label>
      </div>
      <label>Öffnungszeiten<input name="opening_hours" maxlength="200" value="${esc(s.opening_hours || '')}" placeholder="z. B. Tu-Su 17:00-23:00"></label>
      <label>Notiz<textarea name="notes" maxlength="2000" placeholder="Von wem empfohlen? Was sollte man bestellen?">${esc(s.notes || '')}</textarea></label>
      <div>
        <div class="field-label">Position <span class="muted small" style="font-weight:400">– Marker verschieben oder in die Karte tippen</span></div>
        <div id="sf-map" class="mini-map"></div>
      </div>
      <div id="sf-sources"></div>
      <button class="btn primary big" type="submit">${editing ? 'Speichern' : 'Auf die Wunschliste'}</button>
      ${editing ? '<button class="btn" type="button" id="sf-back">Zurück</button>' : ''}
    </form>`, editing ? 'edit' : 'new');

  $('#sf-dup', body)?.addEventListener('click', () => openSpot(dup.id));
  $('#sf-back', body)?.addEventListener('click', () => openSpot(s.id));
  const form = $('#f-spot', body);
  const getPrice = wirePrice(form);

  const renderCuisines = () => {
    $('#sf-cuisines', body).innerHTML = (s.cuisines || []).map((k) => {
      const c = cuisineOf(k);
      return `<button type="button" class="chip on" data-rm="${esc(k)}">${c ? `${c.emoji} ${esc(c.name_de)}` : esc(k)} <span class="x">✕</span></button>`;
    }).join('') + '<button type="button" class="chip" id="sf-add-c">＋ Küche</button>';
    $('#sf-guess', body).innerHTML = s.cuisine_guessed && s.cuisines.length
      ? '<span class="tag guess">vermutet</span> <button type="button" class="btn small" id="sf-confirm">Stimmt</button>' : '';
    $('#sf-confirm', body)?.addEventListener('click', () => { s.cuisine_guessed = false; renderCuisines(); });
  };
  $('#sf-cuisines', body).addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { s.cuisines = s.cuisines.filter((k) => k !== rm.dataset.rm); s.cuisine_guessed = false; renderCuisines(); renderPicker(); return; }
    if (e.target.closest('#sf-add-c')) { $('#sf-picker', body).classList.toggle('hidden'); renderPicker(); }
  });
  const renderPicker = () => {
    const p = $('#sf-picker', body); if (p.classList.contains('hidden')) return;
    p.innerHTML = regionsOf().map((r) => `<div><h4>${esc(r)}</h4><div class="chips">${[...state.cuisines.values()].filter((c) => c.region === r).sort((a, b) => a.sort - b.sort)
      .map((c) => `<button type="button" class="chip${s.cuisines.includes(c.key) ? ' on' : ''}" data-pick="${c.key}">${c.emoji} ${esc(c.name_de)}</button>`).join('')}</div></div>`).join('');
  };
  $('#sf-picker', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const k = b.dataset.pick;
    s.cuisines = s.cuisines.includes(k) ? s.cuisines.filter((x) => x !== k) : [...s.cuisines, k].slice(0, 3);
    s.cuisine_guessed = false; renderCuisines(); renderPicker();
  });
  renderCuisines();

  const renderSources = () => {
    const urls = (s.source_urls || []).map(safeUrl).filter(Boolean);
    $('#sf-sources', body).innerHTML = urls.length ? `<p class="small muted"><b>Quellen:</b> ${urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(u))}</a>`).join(', ')}</p>` : '';
  };
  renderSources();

  // Mini-Karte mit verschiebbarem Marker
  // ohne Animationen: das Formular kann jederzeit geschlossen werden (sonst Fehler in Leaflet)
  const mm = L.map($('#sf-map', body), { zoomControl: false, attributionControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false })
    .setView([s.lat, s.lng], opts.manualPos ? 14 : 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mm);
  const mk = L.marker([s.lat, s.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="pick-marker">📍</div>', iconSize: [34, 34], iconAnchor: [17, 34] }) }).addTo(mm);
  mk.on('dragend', () => { const p = mk.getLatLng(); s.lat = p.lat; s.lng = p.lng; });
  mm.on('click', (e) => { mk.setLatLng(e.latlng); s.lat = e.latlng.lat; s.lng = e.latlng.lng; });
  let mapAlive = true;
  setTimeout(() => { if (mapAlive) mm.invalidateSize(); }, 150);
  onSheetClose(() => { mapAlive = false; mm.off(); mm.remove(); });

  const read = () => ({
    name: form.name.value.trim(), address: form.address.value.trim(), category: form.category.value,
    focus: list(form.focus.value), description: form.description.value.trim(), specialties: list(form.specialties.value),
    website: form.website.value.trim(), phone: form.phone.value.trim(), opening_hours: form.opening_hours.value.trim(),
    notes: form.notes.value.trim(), diet_vegan: form.diet_vegan.checked || null, diet_veg: (form.diet_veg.checked || form.diet_vegan.checked) || null,
    price_level: getPrice(),
  });

  // Anreicherung im Hintergrund (Küche, Beschreibung, Preis …) – ergänzt nur leere Felder
  if (opts.enrich && !editing) {
    const box = $('#sf-enrich', body);
    box.innerHTML = '<div class="hint row"><span class="spinner"></span> Suche Infos zu Küche, Preis &amp; Beschreibung …</div>';
    enrichCandidate(opts.enrich).then(({ data }) => {
      if (!document.body.contains(form)) return;
      if (!data?.enriched) {
        box.innerHTML = `<div class="hint small">${data?.reason === 'no_key' ? 'Daten von OpenStreetMap übernommen.' : 'Daten von OpenStreetMap übernommen – mehr war nicht zu finden.'}</div>`;
        return;
      }
      Object.assign(s, mergeEnrichment({ ...s, ...read() }, data, { weakCuisine: s._weakCuisine }));
      form.description.value = s.description || ''; form.specialties.value = (s.specialties || []).join(', ');
      form.focus.value = (s.focus || []).join(', '); form.website.value = s.website || ''; form.category.value = s.category;
      const pbox = $('.price-seg', form); pbox.dataset.price = s.price_level || '';
      $$('[data-p]', pbox).forEach((x) => x.classList.toggle('on', Number(x.dataset.p) === s.price_level));
      renderCuisines(); renderSources();
      box.innerHTML = '<div class="hint small">✓ Infos ergänzt – bitte kurz prüfen.</div>';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = read();
    if (!v.name) return toast('Bitte einen Namen eingeben.', true);
    e.submitter && (e.submitter.disabled = true);
    const row = { ...pick(s, SPOT_FIELDS), ...v, lat: Number(Number(s.lat).toFixed(6)), lng: Number(Number(s.lng).toFixed(6)),
      cuisines: s.cuisines, cuisine_guessed: s.cuisine_guessed && s.cuisines.length > 0, source_urls: s.source_urls || [] };
    if (!row.city && row.address) row.city = (row.address.match(/\d{4,5}\s+([^,]+)/) || [])[1] || '';
    if (editing) {
      await editRow('spots', row, base, pick(input, SPOT_FIELDS));
      renderAll(false); openSpot(s.id); processOutbox();
      return toast('Gespeichert.');
    }
    const id = uuid();
    await upsert('spots', { ...row, id, group_id: state.groupId, created_by: state.user.id });
    await upsert('spot_wants', { id: uuid(), spot_id: id, group_id: state.groupId, created_by: state.user.id });
    renderAll(false); processOutbox();
    if (map) map.setView([row.lat, row.lng], Math.max(map.getZoom(), 15));
    openSpot(id);
    autoImage({ ...row, id });
    toast(navigator.onLine ? 'Auf der Wunschliste 🍽️' : 'Offline gespeichert – wird später hochgeladen.');
  });
}

// ------------------------------------------------------------------
// Detailansicht
// ------------------------------------------------------------------
// Routenplanung in Google Maps (öffnet auf dem Handy die Google-Maps-App) – Ziel sind die Koordinaten, damit es genau passt
export const navUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`;

export function openSpot(id, keepScroll = false, opts = {}) {
  const s = state.data.spots.find((x) => x.id === id);
  if (!s) return;
  const scroll = keepScroll ? $('#sheet-body').scrollTop : 0;
  const pub = state.publicMode;
  const st = statsOf(id), rs = ratingsOf(id), ds = dishesOf(id), wants = wantsOf(id), comments = commentsOf(id);
  const mine = st.myRating;
  const web = safeUrl(s.website);
  const open = openState(s.opening_hours);
  const tab = state._spotTab === 'dishes' ? 'dishes' : 'ratings';
  const cover = st.cover;
  // Vorschaubild des Spots hat Vorrang, sonst das beste Foto eines Gerichts
  const coverPath = s.image_path || s.image_thumb || (cover ? cover.photo_path || cover.thumb_path : null);
  // Mitglied war bei einem Besuch dabei, hat aber noch nicht bewertet?
  const pendingVisit = !pub && !mine && visitsOf(id).find((v) => (v.participants || []).includes(state.user.id));

  // Gerichte gleichen Namens zusammenfassen
  const groups = new Map();
  for (const d of ds) { const k = norm(d.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const dishGroups = [...groups.values()].map((l) => {
    const rated = l.filter((d) => d.stars); const avg = rated.length ? rated.reduce((a, d) => a + d.stars, 0) / rated.length : null;
    const best = l.filter((d) => d.thumb_path || d.photo_path).sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    return { name: l[0].name, list: l, avg, best };
  }).sort((a, b) => (b.avg || 0) - (a.avg || 0) || b.list.length - a.list.length);

  const dishTile = (d, label = d.name, sub = '') => `<button type="button" class="dish-tile" data-dish="${d.id}">
    <span class="img"${d.thumb_path || d.photo_path ? ` data-bg="${esc(d.thumb_path || d.photo_path)}"` : ''}><span>🍽️</span></span>
    <span class="nm">${esc(label)}</span><span class="st">${sub}</span></button>`;
  const ratingHtml = (r) => {
    const own = dishesOfRating(r.id);
    const subs = SUBSCORES.filter(([k]) => r[k]).map(([k, l]) => `<span>${l} ${r[k]}★</span>`).join('');
    return `<div class="rating-card">
      <div class="row" style="justify-content:space-between"><b>${esc(nameOf(r.created_by))}</b><span class="small muted">${fmtDate(r.visited_on)}${state.pendingIds.has(r.id) ? ' · ⟳' : ''}</span></div>
      <div class="row wrap">${starsHtml(r.overall)}${r.would_return === true ? '<span class="tag">würde wieder hingehen</span>' : r.would_return === false ? '<span class="tag">eher nicht nochmal</span>' : ''}</div>
      ${subs ? `<div class="subscores">${subs}</div>` : ''}
      ${r.comment ? `<div class="pre">${esc(r.comment)}</div>` : ''}
      ${own.length ? `<div class="dish-tiles">${own.map((d) => dishTile(d, d.name, `${d.stars ? starsHtml(d.stars) : ''} ${d.price_cents != null ? `<span class="muted">${fmtPrice(d.price_cents)}</span>` : ''}`)).join('')}</div>` : ''}
    </div>`;
  };

  const body = openSheet(`
    ${coverPath ? `<div class="cover" id="d-cover" role="button" tabindex="0" aria-label="Bild groß ansehen" data-bg="${esc(coverPath)}">${s.image_path && s.image_credit
      ? `<span class="cover-credit">Bild: ${esc(s.image_credit)}</span>` : ''}</div>` : ''}
    ${head(`${esc(spotEmoji(s))} ${esc(s.name)}`)}
    ${opts.random ? '<div class="row" style="margin:-4px 0 8px"><div class="hint" style="flex:1">🎲 Wie wär’s damit?</div><button type="button" class="btn small" id="pick-again">Nochmal</button></div>' : ''}
    <div class="d-sub">${esc([cuisineNames(s.cuisines), CATEGORIES[s.category], euro(s.price_level)].filter(Boolean).join(' · '))}
      ${s.cuisine_guessed ? ' <span class="tag guess">Küche vermutet</span>' : ''}</div>
    ${(s.focus || []).length ? `<div class="row wrap" style="gap:6px;margin-top:6px">${s.focus.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}

    <div class="status-box">
      ${st.visited ? `<span class="avg" style="color:${ratingColor(st.avg)}">${fmtNum(st.avg)}</span>
        <div><div>${starsHtml(st.avg)}</div><div class="small muted">${st.count} Bewertung${st.count === 1 ? '' : 'en'}${st.lastVisit ? ` · zuletzt ${fmtDate(st.lastVisit)}` : ''}</div></div>`
      : `<span class="avg wish">🕓</span><div><b>Wollen wir hin</b><div class="small muted">${pub ? (st.wants ? `${st.wants}× „Will ich auch“` : '') : wants.length ? `${esc(whoWants(wants))} ${wants.length === 1 ? 'will' : 'wollen'} hin` : 'Noch niemand dafür'}</div></div>`}
    </div>
    ${state.pendingIds.has(s.id) ? '<div class="warn">⟳ Noch nicht hochgeladen – andere sehen diesen Spot erst, wenn du wieder online bist.</div>' : ''}
    ${pendingVisit ? `<div class="warn">Du warst am ${fmtDate(pendingVisit.visited_on)} dabei – jetzt bewerten?</div>` : ''}

    ${pub ? '' : `<div class="row" style="margin:10px 0">
      <button class="btn${st.iWant ? '' : ' soft'}" type="button" id="btn-want" style="flex:1">${st.iWant ? '✓ Will ich auch' : '🙋 Will ich auch!'}${st.wants ? ` (${st.wants})` : ''}</button>
      <button class="btn primary" type="button" id="btn-rate" style="flex:1">${mine ? 'Meine Bewertung' : 'Waren wir! Bewerten'}</button>
    </div>`}

    ${s.description ? `<p class="pre" style="margin:8px 0">${esc(s.description)}</p>` : ''}
    <dl class="info-list">
      ${(s.specialties || []).length ? `<dt>⭐</dt><dd>${esc(s.specialties.join(', '))}</dd>` : ''}
      <dt>📍</dt><dd>${s.address ? esc(s.address) + '<br>' : ''}<a id="d-nav" href="${esc(navUrl(s))}" target="_blank" rel="noopener noreferrer">Google Maps</a> ·
        <a href="https://maps.apple.com/?daddr=${s.lat},${s.lng}" target="_blank" rel="noopener noreferrer">Apple Karten</a>${state.myPos ? ` · ${fmtDist(distance(state.myPos, s))} entfernt` : ''}</dd>
      ${s.opening_hours ? `<dt>🕒</dt><dd>${esc(s.opening_hours)}${open === true ? ' · <b class="ok-text">jetzt geöffnet</b>' : open === false ? ' · <span class="muted">jetzt geschlossen</span>' : ''}</dd>` : ''}
      ${web ? `<dt>🌐</dt><dd><a href="${esc(web)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(web))}</a></dd>` : ''}
      ${s.phone ? `<dt>📞</dt><dd><a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a></dd>` : ''}
      ${s.diet_veg || s.diet_vegan ? `<dt>🌱</dt><dd>${s.diet_vegan ? 'vegane und vegetarische Auswahl' : 'vegetarische Auswahl'}</dd>` : ''}
      ${s.notes ? `<dt>📝</dt><dd class="pre">${esc(s.notes)}</dd>` : ''}
    </dl>

    <div class="seg" id="d-tabs" style="margin-top:14px">
      <button type="button" data-t="ratings" class="${tab === 'ratings' ? 'on' : ''}">${pub ? 'Bewertung' : `Bewertungen (${rs.length})`}</button>
      <button type="button" data-t="dishes" class="${tab === 'dishes' ? 'on' : ''}">Gerichte (${ds.length})</button>
    </div>
    <div id="d-ratings" class="stack" style="margin-top:10px"${tab === 'ratings' ? '' : ' hidden'}>
      ${pub ? (st.visited ? `<p>Durchschnitt <b>${fmtNum(st.avg)} ★</b> aus ${st.count} Bewertung${st.count === 1 ? '' : 'en'}.</p>` : '<p class="muted">Noch nicht bewertet.</p>')
        : rs.length ? rs.map(ratingHtml).join('') : '<p class="muted small">Noch keine Bewertung. Wart ihr schon da? Dann auf „Waren wir!“ tippen.</p>'}
    </div>
    <div id="d-dishes" style="margin-top:10px"${tab === 'dishes' ? '' : ' hidden'}>
      ${dishGroups.length ? `<div class="dish-tiles">${dishGroups.map((g) => dishTile(g.best || g.list[0], g.name,
        `${g.avg ? starsHtml(g.avg) + ' ' : ''}<span class="muted">${g.list.length}×${pub ? '' : ' · ' + esc([...new Set(g.list.map((d) => nameOf(d.created_by)))].join(', '))}</span>`)).join('')}</div>`
        : '<p class="muted small">Noch keine Gerichte. Beim Bewerten kann jede:r eintragen, was es gab – mit Foto.</p>'}
    </div>

    ${pub ? '' : `<h3>Kommentare</h3>
    ${comments.map((c) => `<div class="comment"><div class="who">${esc(nameOf(c.created_by))} · ${fmtDate(c.created_at)}${canEdit(c) ? ` · <a href="#" data-del-comment="${c.id}">löschen</a>` : ''}</div><div class="pre">${esc(c.body)}</div></div>`).join('') || '<p class="small muted">Noch keine Kommentare.</p>'}
    <form id="f-comment" class="row" style="margin-top:8px">
      <input name="body" placeholder="z. B. Mittwochs Ruhetag!" maxlength="2000" autocomplete="off" aria-label="Kommentar">
      <button class="btn primary" type="submit">Senden</button>
    </form>`}

    ${(s.source_urls || []).length ? `<p class="small muted" style="margin-top:14px"><b>Quellen:</b> ${s.source_urls.map(safeUrl).filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(u))}</a>`).join(', ')}</p>` : ''}
    ${pub ? '' : `<p class="small muted">Eingetragen von ${esc(nameOf(s.created_by))} am ${fmtDate(s.created_at)}</p>
    <div class="row wrap">
      <button class="btn small" id="btn-edit" type="button">✏️ Bearbeiten</button>
      <button class="btn small" id="btn-image" type="button">🖼️ ${s.image_path ? 'Bild ändern' : 'Vorschaubild'}</button>
      ${canEdit(s) ? '<button class="btn small danger" id="btn-del" type="button">🗑 Löschen</button>' : ''}
    </div>`}`, 'spot');
  state.openSpotId = id;
  body.scrollTop = scroll;
  hydratePhotos(body);
  if (!state.myPos) startWatch(false);

  $('#pick-again', body)?.addEventListener('click', () => import('./views.js').then((m) => m.randomPick()));
  $('#d-tabs', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    state._spotTab = b.dataset.t;
    $$('#d-tabs button', body).forEach((x) => x.classList.toggle('on', x === b));
    $('#d-ratings', body).hidden = b.dataset.t !== 'ratings';
    $('#d-dishes', body).hidden = b.dataset.t !== 'dishes';
  });
  $$('[data-dish]', body).forEach((b) => b.addEventListener('click', () => {
    const d = ds.find((x) => x.id === b.dataset.dish); if (!d) return;
    openPhoto(d, `<b>${esc(d.name)}</b><div>${d.stars ? starsHtml(d.stars) : ''} ${d.price_cents != null ? esc(fmtPrice(d.price_cents)) : ''}</div>
      ${d.note ? `<div class="small">${esc(d.note)}</div>` : ''}<div class="small" style="opacity:.7">${pub ? '' : esc(nameOf(d.created_by)) + ' · '}${fmtDate(d.created_at)}</div>`);
  }));
  $('#btn-want', body)?.addEventListener('click', async () => {
    const w = wants.find((x) => x.created_by === state.user.id);
    if (w) await remove('spot_wants', w.id);
    else await upsert('spot_wants', { id: uuid(), spot_id: id, group_id: state.groupId, created_by: state.user.id });
    renderAll(false); openSpot(id, true); processOutbox();
  });
  $('#btn-rate', body)?.addEventListener('click', () => openRating(s));
  $('#f-comment', body)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.body.value.trim(); if (!text) return;
    await upsert('comments', { id: uuid(), spot_id: id, group_id: state.groupId, body: text, created_by: state.user.id });
    openSpot(id, true); processOutbox();
  });
  $$('[data-del-comment]', body).forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault(); await remove('comments', a.dataset.delComment); openSpot(id, true); processOutbox();
  }));
  $('#btn-edit', body)?.addEventListener('click', () => openSpotForm(s));
  $('#btn-image', body)?.addEventListener('click', () => openImagePicker(s));
  const coverEl = $('#d-cover', body);
  const openCover = async () => {
    const src = await photoUrl(coverPath); if (!src) return;
    const srcUrl = s.image_path ? safeUrl(s.image_source) : null;
    openLightbox(src, `<b>${esc(s.name)}</b>${s.image_path && s.image_credit ? `<div class="small">Bild: ${srcUrl
      ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.image_credit)}</a>` : esc(s.image_credit)}</div>` : ''}`);
  };
  coverEl?.addEventListener('click', openCover);
  coverEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCover(); });
  $('#btn-del', body)?.addEventListener('click', async () => {
    if (!confirm(`„${s.name}“ in den Papierkorb legen? Der Spot lässt sich 30 Tage lang wiederherstellen (Gruppe → Papierkorb).`)) return;
    await editRow('spots', { ...pick(s, SPOT_FIELDS), deleted_at: new Date().toISOString(), deleted_by: state.user.id }, s.updated_at);
    closeSheet(); renderAll(false); processOutbox();
    toast('In den Papierkorb gelegt.');
  });
}

// ------------------------------------------------------------------
// Vorschaubild: automatisch beim Eintragen, oder selbst auswählen
// ------------------------------------------------------------------
const KIND = { commons: 'Wikimedia', website: 'Webseite', osm: 'OpenStreetMap' };
// Für die Bildquelle den echten Namen (nameOf liefert für einen selbst „Ich“)
const realName = (uid) => state.data.profiles?.[uid] || (uid === state.user?.id ? state.profile?.username || state.profile?.display_name : null) || 'Mitglied';

async function autoImage(spot) {
  if (!navigator.onLine || (!spot.website && !spot.osm_id)) return;
  const { data } = await imageCandidates(spot);
  for (const im of (data?.images || []).slice(0, 3)) {
    const blob = await fetchImage(im.url);
    if (!blob) continue;
    const cur = state.data.spots.find((x) => x.id === spot.id);
    if (!cur || cur.image_path) return;   // inzwischen gelöscht oder schon ein Bild gewählt
    try { await storeSpotImage(cur, blob, { credit: im.credit, source: im.source }); } catch { continue; }
    renderAll(false); processOutbox();
    if (state.openSpotId === spot.id && state._sheetKind === 'spot') openSpot(spot.id, true);
    return;
  }
}

export function openImagePicker(s) {
  const own = dishesOf(s.id).filter((d) => d.thumb_path || d.photo_path).slice(0, 6);
  const body = openSheet(`${head('Vorschaubild')}
    <p class="small muted" style="margin-top:0">Tippe auf ein Bild, um es als Vorschaubild für „${esc(s.name)}“ zu nehmen.</p>
    <div class="img-grid" id="ip-grid">
      <label class="img-opt own"><input type="file" accept="image/*" id="ip-file" hidden><span>📷<br>Eigenes Foto</span></label>
      ${own.map((d) => `<button type="button" class="img-opt" data-dish="${d.id}" data-bg="${esc(d.thumb_path || d.photo_path)}"><span class="cap">🍽️ ${esc(d.name)}</span></button>`).join('')}
    </div>
    <div id="ip-status" class="hint row" style="margin-top:10px"><span class="spinner"></span> Suche Bilder auf der Webseite und bei Wikimedia …</div>
    <p class="small muted">Bilder von Webseiten gehören den Lokalen bzw. Fotograf:innen – die Quelle wird beim Bild angezeigt.</p>
    <div class="row wrap">
      <button class="btn" type="button" id="ip-back">Zurück</button>
      ${s.image_path ? '<button class="btn danger" type="button" id="ip-remove">Bild entfernen</button>' : ''}
    </div>`, 'images');
  hydratePhotos(body);
  const grid = $('#ip-grid', body), status = $('#ip-status', body);
  const alive = () => document.body.contains(grid);
  let busy = false;
  const choose = async (blob, credit, source) => {
    if (busy || !blob) return; busy = true;
    status.innerHTML = '<span class="spinner"></span> Speichere das Bild …';
    try {
      const cur = state.data.spots.find((x) => x.id === s.id) || s;
      await storeSpotImage(cur, blob, { credit, source });
    } catch { busy = false; status.textContent = 'Das Bild ließ sich nicht verarbeiten.'; return; }
    renderAll(false); processOutbox(); openSpot(s.id);
    toast(navigator.onLine ? 'Vorschaubild gesetzt.' : 'Vorschaubild gespeichert – wird später hochgeladen.');
  };
  $('#ip-back', body).addEventListener('click', () => openSpot(s.id));
  $('#ip-remove', body)?.addEventListener('click', async () => {
    await removeSpotImage(state.data.spots.find((x) => x.id === s.id) || s);
    renderAll(false); processOutbox(); openSpot(s.id); toast('Vorschaubild entfernt.');
  });
  $('#ip-file', body).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) choose(f, `Foto von ${realName(state.user.id)}`, ''); });
  $$('[data-dish]', grid).forEach((b) => b.addEventListener('click', async () => {
    const d = own.find((x) => x.id === b.dataset.dish);
    const url = await photoUrl(d.photo_path || d.thumb_path); if (!url) return;
    choose(await (await fetch(url)).blob(), `Foto von ${realName(d.created_by)}`, '');
  }));

  if (!navigator.onLine) { status.textContent = 'Offline – Bilder aus dem Netz lassen sich gerade nicht suchen.'; return; }
  imageCandidates(s).then(async ({ data, error }) => {
    if (!alive()) return;
    const images = data?.images || [];
    if (error || !images.length) {
      status.textContent = error ? 'Die Bildersuche hat gerade nicht geklappt.' : (s.website ? 'Auf der Webseite und bei Wikimedia war kein passendes Bild zu finden.' : 'Ohne Webseite des Lokals lassen sich keine Bilder finden – trag sie unter „Bearbeiten“ ein oder nimm ein eigenes Foto.');
      return;
    }
    let shown = 0, left = images.length;
    const done = () => { if (--left === 0 && alive()) status.textContent = shown ? '' : 'Die gefundenen Bilder ließen sich nicht laden.'; if (!left && shown) status.classList.add('hidden'); };
    // höchstens 3 gleichzeitig laden
    const queue = images.map((im, i) => ({ im, i }));
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const blob = await fetchImage(job.im.url);
        if (!alive()) return;
        if (blob) {
          shown++;
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'img-opt has-img'; b.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
          b.innerHTML = `<span class="cap">${esc(KIND[job.im.kind] || 'Web')}</span>`;
          b.title = job.im.credit;
          b.addEventListener('click', () => choose(blob, job.im.credit, job.im.source));
          grid.appendChild(b);
        }
        done();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  });
}
