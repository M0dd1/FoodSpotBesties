// Bewertung: jede Person für sich, Gerichte mit Foto, Durchschnitt und Markerfarbe
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, logout, addSpotBySearch, rateOpenSpot, openSpotByName, db, pins } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
});
after(async () => { await env?.close(); });

test('Bewerten mit Gericht und Foto: Marker wird farbig, Foto + Vorschaubild werden hochgeladen', { timeout: 90000 }, async () => {
  await addSpotBySearch(p, 'delphi koblenz');
  await rateOpenSpot(p, { overall: 5, comment: 'Bester Gyros-Teller', dishes: [{ name: 'Gyros-Teller', stars: 5, price: '16,90', photo: 'ort-a-1.jpg' }] });
  const d = await db(p);
  assert.equal(d.ratings.length, 1);
  assert.equal(d.ratings[0].overall, 5);
  assert.equal(d.visits.length, 1, '„Waren wir!“ legt einen Besuch an');
  assert.equal(d.dishes.length, 1);
  const dish = d.dishes[0];
  assert.equal(dish.price_cents, 1690);
  assert.match(dish.photo_path, new RegExp(`^${d.groups[0].id}/${d.spots[0].id}/`));
  assert.ok(d.files[dish.photo_path] && d.files[dish.thumb_path], 'Foto und Vorschaubild liegen im Speicher');
  assert.match(await p.textContent('.status-box'), /5,0/);
  assert.match(await p.textContent('#d-ratings'), /Bester Gyros-Teller/);
  await p.click('[data-close]');
  const [pin] = await pins(p);
  assert.equal(pin.wish, false, 'Marker ist farbig');
  assert.match(pin.color, /rgb\(46, ?125, ?50\)/, 'Note 5 = dunkelgrün');
});

test('Zweite Person bewertet: Durchschnitt, „Hatte auch“, Gerichte zusammengefasst, nur eigene Bewertung änderbar', { timeout: 90000 }, async () => {
  const code = (await db(p)).groups[0].invite_code;
  await logout(p);
  await register(p, { name: 'Kumpel', code });
  await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(500);
  await openSpotByName(p, 'Delphi');
  assert.match(await p.textContent('#btn-rate'), /Waren wir/);
  await p.click('#btn-rate'); await p.waitForSelector('#f-rate');
  await p.click('#f-rate [data-stars=overall] [data-v="2"]');
  await p.click('#r-add-dish');
  await p.locator('#r-dishes [data-f=name]').last().fill('Gyros-Teller');
  assert.match(await p.textContent('#r-dishes [data-hint]'), /Hatte auch: Marcel – Ø 5,0 ★/);
  await p.click('#r-save'); await p.waitForSelector('#btn-rate'); await p.waitForTimeout(400);
  assert.match(await p.textContent('.status-box'), /3,5/);
  assert.match(await p.textContent('.status-box'), /2 Bewertungen/);
  await p.click('#d-tabs [data-t=dishes]');
  assert.match(await p.textContent('#d-dishes'), /Gyros-Teller.*2×/s);
  // Eigene Bewertung öffnen: Formular zeigt die eigene Note (2), nicht die von Marcel
  await p.click('#btn-rate'); await p.waitForSelector('#f-rate');
  assert.equal(await p.getAttribute('#f-rate [data-stars=overall]', 'data-value'), '2');
  assert.equal(await p.locator('#r-dishes .dish-edit').count(), 1, 'nur das eigene Gericht');
  await p.click('#r-back');
  const d = await db(p);
  assert.equal(d.ratings.length, 2);
  assert.equal(new Set(d.ratings.map((r) => r.created_by)).size, 2);
});

test('Eigene Bewertung löschen entfernt auch die Gerichte und Fotos', { timeout: 60000 }, async () => {
  await p.click('[data-close]');
  await logout(p);
  await p.fill('#auth-name', 'Marcel'); await p.fill('#auth-pass', 'geheim123'); await p.click('#auth-submit');
  await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(500);
  await openSpotByName(p, 'Delphi');
  const before = await db(p);
  const path0 = before.dishes.find((x) => x.photo_path).photo_path;
  await p.click('#btn-rate'); await p.waitForSelector('#r-delete');
  await p.click('#r-delete'); await p.waitForTimeout(800);
  const d = await db(p);
  assert.equal(d.ratings.length, 1);
  assert.equal(d.dishes.filter((x) => x.photo_path).length, 0);
  assert.ok(!d.files[path0], 'Fotodatei gelöscht');
  assert.match(await p.textContent('.status-box'), /2,0/);
  assert.deepEqual(p.errors, []);
});
