// Teilen aus Google Maps (Teilen-Ziel und eingefügter Link) und Vorschaubilder der Spots
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup, newContext, openApp, register, createGroup, db, openSpotByName, FIXTURES, hideToast } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
});
after(async () => { await env?.close(); });

const spot = async (name) => (await db(p)).spots.find((x) => x.name === name);
const save = async () => {
  await p.waitForSelector('#f-spot');
  await p.waitForFunction(() => !document.querySelector('#sf-enrich .spinner'), null, { timeout: 10000 });
  await p.click('#f-spot button[type=submit]');
  await p.waitForSelector('#sheet:not(.hidden) #btn-rate');
};

test('Aus Google Maps geteilt: App öffnet „Spot eintragen“ und findet das Lokal an der Stelle', { timeout: 60000 }, async () => {
  const text = 'Delphi\nGörgenstraße 12, 56068 Koblenz\nhttps://maps.app.goo.gl/delphi?g_st=ic';
  await p.goto(env.url + '?share_title=Delphi&share_text=' + encodeURIComponent(text));
  await p.waitForSelector('#search-results .cand');
  assert.equal(new URL(p.url()).search, '', 'Adresszeile wird aufgeräumt');
  assert.match(await p.inputValue('#search-q'), /Delphi Görgenstraße 12, 56068 Koblenz https:\/\/maps\.app\.goo\.gl\/delphi/);
  assert.match(await p.textContent('#search-results .cand >> nth=0'), /Delphi.*Görgenstraße.*genau dort/s);
  const call = await p.evaluate(() => window.__mock.lookups.find((x) => x.action === 'resolve_link'));
  assert.match(call.text, /Delphi\nGörgenstraße 12, 56068 Koblenz\nhttps:\/\/maps\.app\.goo\.gl\/delphi/, 'Server bekommt den Text mit Zeilen');
  await p.click('#search-results .cand >> nth=0');
  await save();
  const s = await spot('Delphi');
  assert.equal(s.osm_id, 1001, 'Treffer aus OpenStreetMap übernommen');
  assert.deepEqual(s.cuisines, ['greek']);
  assert.deepEqual(p.errors, []);
});

test('Neuer Spot bekommt automatisch ein Vorschaubild mit Quellenangabe', { timeout: 60000 }, async () => {
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb')).spots.some((s) => s.name === 'Delphi' && s.image_path), null, { timeout: 10000 });
  const s = await spot('Delphi');
  assert.match(s.image_path, new RegExp(`^${s.group_id}/${s.id}/cover-[a-z0-9]+\\.(webp|jpg)$`));
  assert.match(s.image_thumb, /-klein\.(webp|jpg)$/);
  assert.equal(s.image_credit, 'Webseite des Lokals (delphi.example)');
  assert.equal(s.image_source, 'https://delphi.example/');
  const files = Object.keys((await db(p)).files);
  assert.ok(files.includes(s.image_path) && files.includes(s.image_thumb), 'Bild und Vorschau hochgeladen');
  await p.waitForSelector('#d-cover.has-img');
  assert.match(await p.textContent('#d-cover .cover-credit'), /Bild: Webseite des Lokals/);
  await p.click('#d-cover');
  await p.waitForSelector('#lightbox:not(.hidden)');
  assert.equal(await p.getAttribute('#lightbox-caption a', 'href'), 'https://delphi.example/');
  await p.click('#lightbox-close');
  await p.click('[data-close]');
  await p.click('.viewtabs [data-view=list]');
  await p.waitForSelector('#spot-list .spot-item:has-text("Delphi") .spot-thumb.has-img');
});

test('Bild selbst auswählen: Vorschläge von Webseite und Wikimedia, altes Bild wird gelöscht', { timeout: 60000 }, async () => {
  const before = await spot('Delphi');
  await openSpotByName(p, 'Delphi');
  await p.click('#btn-image');
  await p.waitForSelector('#ip-grid .img-opt.has-img >> nth=1');
  assert.match(await p.textContent('#ip-grid'), /Webseite.*Wikimedia|Wikimedia.*Webseite/s);
  await p.click('#ip-grid .img-opt.has-img:has-text("Wikimedia")');
  await p.waitForSelector('#sheet:not(.hidden) #btn-rate');
  await p.waitForFunction((old) => { const s = JSON.parse(localStorage.getItem('mockdb')).spots.find((x) => x.name === 'Delphi'); return s.image_path && s.image_path !== old; }, before.image_path);
  const s = await spot('Delphi');
  assert.match(s.image_credit, /^Wikimedia Commons · Max Muster · CC BY-SA 4\.0$/);
  const files = Object.keys((await db(p)).files);
  assert.ok(!files.includes(before.image_path) && !files.includes(before.image_thumb), 'altes Bild ist weg');
  assert.ok(files.includes(s.image_path));
});

test('Google-Maps-Link einfügen: Lokal fehlt in OpenStreetMap → Name, Adresse und Position aus dem Link', { timeout: 60000 }, async () => {
  await p.click('[data-close]');
  await p.click('#btn-add');
  await p.fill('#search-q', 'https://maps.app.goo.gl/neu');
  await p.click('#f-search button[type=submit]');
  await p.waitForSelector('#search-results .cand');
  assert.match(await p.textContent('#search-results'), /Aus dem Google-Maps-Link:.*Bistro Neu.*Position aus Google Maps/s);
  await p.click('#search-results .cand');
  await p.waitForSelector('#f-spot');
  assert.equal(await p.inputValue('#f-spot [name=name]'), 'Bistro Neu');
  assert.equal(await p.inputValue('#f-spot [name=address]'), 'Neustraße 1, 56068 Koblenz');
  await save();
  const s = await spot('Bistro Neu');
  assert.equal(s.lat, 50.358); assert.equal(s.lng, 7.591);
  assert.deepEqual(s.source_urls, ['https://maps.app.goo.gl/neu']);
  assert.equal(s.osm_id, null);
});

test('Ohne Webseite: eigenes Foto als Vorschaubild, danach wieder entfernen', { timeout: 60000 }, async () => {
  await p.waitForTimeout(500);
  assert.equal((await spot('Bistro Neu')).image_path ?? null, null, 'ohne Webseite kein automatisches Bild');
  await p.click('#btn-image');
  await p.waitForSelector('#ip-status:has-text("Ohne Webseite")');
  await p.setInputFiles('#ip-file', path.join(FIXTURES, 'ohne-exif.jpg'));
  await p.waitForSelector('#sheet:not(.hidden) #d-cover');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb')).spots.find((x) => x.name === 'Bistro Neu').image_path);
  let s = await spot('Bistro Neu');
  assert.equal(s.image_credit, 'Foto von Marcel');
  assert.equal(s.image_source ?? null, null);
  const old = s.image_path;
  await hideToast(p);
  await p.click('#btn-image');
  await p.click('#ip-remove');
  await p.waitForFunction(() => !JSON.parse(localStorage.getItem('mockdb')).spots.find((x) => x.name === 'Bistro Neu').image_path);
  s = await spot('Bistro Neu');
  assert.equal(s.image_thumb, null); assert.equal(s.image_credit, null);
  assert.ok(!Object.keys((await db(p)).files).includes(old), 'Datei gelöscht');
  assert.equal(await p.$('#d-cover'), null);
  assert.deepEqual(p.errors, []);
});

test('Bearbeiten nach dem Bild-Upload ergibt keinen Schein-Konflikt', { timeout: 60000 }, async () => {
  await p.click('#btn-edit'); await p.waitForSelector('#f-spot');
  await p.fill('#f-spot [name=notes]', 'Von Anna empfohlen');
  // Währenddessen setzt jemand anderes ein Vorschaubild (neuer Stand auf dem Server)
  await p.evaluate(() => { const d = window.__mock.db(); const s = d.spots.find((x) => x.name === 'Bistro Neu');
    s.image_credit = 'x'; s.updated_at = new Date(Date.now() + 1000).toISOString(); window.__mock.save(); });
  await p.click('#f-spot button[type=submit]');
  await p.waitForTimeout(1200);
  const s = await spot('Bistro Neu');
  assert.equal(s.notes, 'Von Anna empfohlen', 'Notiz gespeichert');
  assert.equal(s.image_credit, 'x', 'fremde Änderung bleibt');
  assert.equal(await p.$('#conflict-banner'), null, 'kein Konflikt-Hinweis');
});

test('Teilen-Ziel ist im Manifest eingetragen', async () => {
  const m = await p.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  assert.deepEqual(m.share_target, { action: './', method: 'GET', params: { title: 'share_title', text: 'share_text', url: 'share_url' } });
});

test('„Wohin heute?“: Spot mit eingetragenem Besuch (auch ohne Bewertung) kommt nicht mehr; Route per Google-Maps-Link', { timeout: 60000 }, async () => {
  await p.evaluate(() => { const d = window.__mock.db(); const s = d.spots.find((x) => x.name === 'Delphi');
    d.visits.push({ id: crypto.randomUUID(), spot_id: s.id, group_id: s.group_id, visited_on: '2026-11-01', participants: [], created_by: d.users[0].id, created_at: new Date().toISOString() });
    window.__mock.save(); });
  await p.reload();
  await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(500);
  for (let i = 0; i < 5; i++) {
    await p.click('#btn-random');
    await p.waitForSelector('#sheet:not(.hidden) #d-nav');
    assert.match(await p.textContent('#sheet-body h2'), /Bistro Neu/, 'nur der noch nicht besuchte Spot');
    await p.click('[data-close]');
  }
  await p.click('#btn-random'); await p.waitForSelector('#sheet:not(.hidden) #d-nav');
  assert.equal(await p.getAttribute('#d-nav', 'href'), 'https://www.google.com/maps/dir/?api=1&destination=50.358000,7.591000');
  assert.equal(await p.getAttribute('#d-nav', 'target'), '_blank');
  assert.deepEqual(p.errors, []);
});
