// Spot eintragen: Suche, Anreicherung, Länderküche „vermutet“, Dubletten, manuell, bearbeiten
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotBySearch, db, pins } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
});
after(async () => { await env?.close(); });

test('„delphi koblenz“: Treffer wählen, Infos werden ergänzt, grauer Marker auf der Wunschliste', { timeout: 60000 }, async () => {
  await addSpotBySearch(p, 'delphi koblenz');
  const s = (await db(p)).spots[0];
  assert.equal(s.name, 'Delphi');
  assert.equal(s.address, 'Görgenstraße 12, 56068 Koblenz');
  assert.deepEqual(s.cuisines, ['greek']);
  assert.equal(s.cuisine_guessed, false, 'Küche aus OpenStreetMap ist nicht „vermutet“');
  assert.equal(s.price_level, 2);
  assert.match(s.description, /griechisch/i);
  assert.deepEqual(s.specialties, ['Gyros', 'Bifteki']);
  assert.ok(s.source_urls.length >= 1);
  assert.equal((await db(p)).spot_wants.length, 1, 'wer einträgt, will auch hin');
  assert.match(await p.textContent('.status-box'), /Wollen wir hin/);
  await p.click('[data-close]');
  assert.deepEqual((await pins(p)).map((x) => x.wish), [true]);
  assert.match(await p.textContent('.leaflet-marker-icon .pin-e'), /🇬🇷/);
});

test('Küche ohne genaue OSM-Angabe wird ermittelt und als „vermutet“ markiert; bestätigen entfernt den Hinweis', { timeout: 60000 }, async () => {
  await addSpotBySearch(p, 'konoba koblenz', { edit: async (pg) => {
    assert.match(await pg.textContent('#sf-guess'), /vermutet/);
    assert.match(await pg.textContent('#sf-cuisines'), /Kroatisch/);
  } });
  let s = (await db(p)).spots.find((x) => x.name === 'Konoba Dalmacija');
  assert.equal(s.cuisine_guessed, true);
  assert.match(await p.textContent('.d-sub'), /Küche vermutet/);
  await p.click('#btn-edit'); await p.waitForSelector('#f-spot');
  await p.click('#sf-confirm');
  await p.click('#f-spot button[type=submit]'); await p.waitForTimeout(600);
  s = (await db(p)).spots.find((x) => x.name === 'Konoba Dalmacija');
  assert.equal(s.cuisine_guessed, false);
});

test('Gleicher Spot noch einmal: Hinweis „steht schon auf eurer Liste“', { timeout: 60000 }, async () => {
  await p.click('[data-close]');
  await p.click('#btn-add'); await p.fill('#search-q', 'delphi'); await p.click('#f-search button[type=submit]');
  await p.waitForSelector('#search-results .cand');
  assert.match(await p.textContent('#search-results .cand >> nth=0'), /steht schon auf eurer Liste/);
  p.acceptDialogs = true;
  await p.click('#search-results .cand >> nth=0');
  await p.waitForSelector('#sheet:not(.hidden) #btn-rate');
  assert.equal((await db(p)).spots.length, 2, 'kein doppelter Eintrag');
});

test('Ohne API-Key: Daten aus OpenStreetMap; Web-Recherche ohne Treffer → ohne Suche eintragen', { timeout: 60000 }, async () => {
  await p.click('[data-close]');
  await p.evaluate(() => { window.__mock.noKey = true; });
  await p.click('#btn-add'); await p.fill('#search-q', 'delphi'); await p.click('#f-search button[type=submit]');
  await p.click('#search-results .cand >> nth=1');
  await p.waitForSelector('#sf-enrich .hint:not(:has(.spinner))');
  assert.match(await p.textContent('#sf-enrich'), /OpenStreetMap übernommen/);
  assert.match(await p.inputValue('#f-spot [name=focus]'), /Döner/);
  await p.click('[data-close]');
  await p.click('#btn-add'); await p.fill('#search-q', 'gibtsnicht xyz'); await p.click('#f-search button[type=submit]');
  await p.waitForSelector('#btn-research'); await p.click('#btn-research');
  await p.waitForSelector('#btn-manual-2'); await p.click('#btn-manual-2');
  await p.waitForSelector('#f-spot');
  assert.equal(await p.inputValue('#f-spot [name=name]'), 'gibtsnicht xyz');
  await p.evaluate(() => { window.__mock.noKey = false; });
});

test('Langes Drücken auf die Karte öffnet das Formular an dieser Stelle; Bearbeiten ändert Preisniveau', { timeout: 60000 }, async () => {
  await p.click('[data-close]');
  const b = await p.locator('#map').boundingBox();
  await p.mouse.click(b.x + b.width / 2 + 60, b.y + b.height / 2 + 80, { button: 'right' });
  await p.waitForSelector('#f-spot');
  await p.fill('#f-spot [name=name]', 'Pho Saigon');
  await p.click('#sf-add-c'); await p.click('#sf-picker [data-pick=vietnamese]');
  await p.click('#f-spot .price-seg [data-p="1"]');
  await p.click('#f-spot button[type=submit]'); await p.waitForSelector('#btn-edit');
  await p.click('#btn-edit'); await p.click('#f-spot .price-seg [data-p="2"]');
  await p.click('#f-spot button[type=submit]'); await p.waitForTimeout(500);
  const s = (await db(p)).spots.find((x) => x.name === 'Pho Saigon');
  assert.deepEqual(s.cuisines, ['vietnamese']);
  assert.equal(s.price_level, 2);
  assert.deepEqual(p.errors, []);
});
