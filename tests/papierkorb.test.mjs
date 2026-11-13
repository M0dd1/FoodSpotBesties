// Papierkorb: weiches Löschen, wiederherstellen, endgültig löschen, nach 30 Tagen automatisch
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotManual, addSpotBySearch, rateOpenSpot, db } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Löschen → Papierkorb → wiederherstellen → endgültig löschen (samt Fotos)', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser); const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotBySearch(p, 'delphi koblenz');
  await rateOpenSpot(p, { overall: 4, dishes: [{ name: 'Gyros', photo: 'ort-b.jpg' }] });
  await p.click('#btn-del'); await p.waitForTimeout(500);
  assert.equal((await p.$$('.leaflet-marker-icon .pin')).length, 0, 'verschwindet von der Karte');
  assert.ok((await db(p)).spots[0].deleted_at);
  await p.click('#btn-group'); await p.click('#btn-trash');
  assert.match(await p.textContent('.trash-item'), /Delphi.*1 Bewertung.*1 Gericht/s);
  await p.click('[data-restore]'); await p.waitForTimeout(500);
  assert.equal((await db(p)).spots[0].deleted_at, null);
  await p.click('[data-close]');
  assert.equal((await p.$$('.leaflet-marker-icon .pin')).length, 1);
  await p.click('.leaflet-marker-icon:has(.pin)'); await p.waitForSelector('#btn-del');
  await p.click('#btn-del'); await p.waitForTimeout(400);
  await p.click('#btn-group'); await p.click('#btn-trash'); await p.click('[data-purge]'); await p.waitForTimeout(800);
  const d = await db(p);
  assert.equal(d.spots.length, 0); assert.equal(d.ratings.length, 0); assert.equal(d.dishes.length, 0);
  assert.equal(Object.keys(d.files).length, 0, 'Fotodateien gelöscht');
  await ctx.close();
});

test('Nach 30 Tagen wird automatisch endgültig gelöscht', { timeout: 60000 }, async () => {
  const ctx = await newContext(env.browser); const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotManual(p, { name: 'Alt' });
  await p.evaluate(() => { const d = window.__mock.db(); d.spots[0].deleted_at = new Date(Date.now() - 31 * 864e5).toISOString(); window.__mock.save(); });
  await p.reload(); await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(1500);
  assert.equal((await db(p)).spots.length, 0);
  await ctx.close();
});
