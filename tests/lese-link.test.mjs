// Öffentlicher Lese-Link: ohne Anmeldung nur lesen, keine Namen/Kommentare/Einzelbewertungen, Fotos nur mit Schlüssel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotBySearch, rateOpenSpot, db } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Lese-Link zeigt Spots mit Durchschnittsnote und Gerichtfotos, aber keine Namen; deaktiviert = ungültig', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser); const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotBySearch(p, 'delphi koblenz');
  await rateOpenSpot(p, { overall: 4, comment: 'GEHEIMER KOMMENTAR', dishes: [{ name: 'Gyros', stars: 5, photo: 'ort-a-1.jpg' }] });
  await p.fill('#f-comment input', 'INTERNER KOMMENTAR'); await p.click('#f-comment button'); await p.waitForSelector('.comment');
  await p.click('[data-close]');
  await p.click('#btn-group'); await p.click('#btn-public-on'); await p.waitForSelector('#btn-copy-public');
  const token = (await db(p)).groups[0].share_token;
  const dbJson = JSON.stringify(await db(p));
  // Gast: anderer Browser, gleiches Test-Backend, nicht angemeldet
  const g = await openApp(ctx, env.url + '?view=' + token);
  await g.evaluate(() => localStorage.removeItem('mocksession'));
  await g.reload(); await g.waitForSelector('#screen-main:not(.hidden)');
  assert.ok(await g.isVisible('.readonly-badge'));
  assert.ok(!(await g.isVisible('#btn-add')));
  await g.click('.leaflet-marker-icon:has(.pin)'); await g.waitForSelector('.status-box');
  const text = await g.textContent('#sheet');
  assert.match(text, /4,0/);
  assert.ok(!/Marcel|GEHEIMER|INTERNER/.test(text), 'keine Namen, Bewertungstexte oder Kommentare');
  await g.click('#d-tabs [data-t=dishes]');
  await g.waitForFunction(() => document.querySelector('#d-dishes .img.has-img'), null, { timeout: 5000 });
  // ohne Schlüssel kein Foto
  const ok = await g.evaluate(async (path) => { const r = await window.supabase.createClient('', '', {}).storage.from('food-photos').download(path); return !!r.data; }, JSON.parse(dbJson).dishes[0].photo_path);
  assert.equal(ok, false);
  await p.click('#btn-public-off'); await p.waitForTimeout(300);
  await g.reload();
  await g.waitForFunction(() => /nicht gültig/.test(document.body.innerText));
  assert.deepEqual(g.errors, []);
  await ctx.close();
});
