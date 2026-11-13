// Offline: bewerten (mit Foto) und Spot eintragen ohne Netz, später automatisch hochladen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotBySearch, addSpotManual, rateOpenSpot, db } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Ohne Netz bewerten und eintragen, wieder online wird alles hochgeladen', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser); const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotBySearch(p, 'delphi koblenz');
  await p.evaluate(() => { window.__mockOffline = true; }); await ctx.setOffline(true);
  await rateOpenSpot(p, { overall: 4, dishes: [{ name: 'Souvlaki', stars: 4, photo: 'ort-a-2.jpg' }] });
  assert.match(await p.textContent('#sync-badge'), /Offline/);
  await p.click('[data-close]');
  await addSpotManual(p, { name: 'Offline-Imbiss' }); await p.click('[data-close]');
  let d = await db(p);
  assert.equal(d.ratings.length, 0, 'noch nicht hochgeladen'); assert.equal(d.spots.length, 1);
  assert.equal((await p.$$('.leaflet-marker-icon .pin')).length, 2, 'lokal schon sichtbar');
  await ctx.setOffline(false); await p.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); });
  await p.waitForFunction(() => document.querySelector('#sync-badge').textContent === '✓', null, { timeout: 15000 });
  d = await db(p);
  assert.equal(d.spots.length, 2); assert.equal(d.ratings.length, 1);
  const dish = d.dishes[0];
  assert.ok(dish.photo_path && d.files[dish.photo_path], 'Foto nachträglich hochgeladen');
  assert.deepEqual(p.errors, []);
  await ctx.close();
});
