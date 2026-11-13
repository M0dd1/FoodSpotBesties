// Leistung: viele Spots werden zusammengefasst, Liste baut sich schrittweise auf, Echtzeit ohne Neuladen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await p.evaluate(() => {
    const d = window.__mock.db(), g = d.groups[0], u = d.users[0].id, keys = ['greek', 'croatian', 'spanish', 'italian', 'vietnamese'];
    for (let i = 0; i < 1200; i++) {
      const id = crypto.randomUUID();
      d.spots.push({ id, group_id: g.id, name: 'Spot ' + i, lat: 50.30 + (i % 40) * 0.003, lng: 7.50 + Math.floor(i / 40) * 0.006, cuisines: [keys[i % 5]],
        category: 'restaurant', focus: [], specialties: [], source_urls: [], created_by: u, created_at: new Date(Date.now() - i * 1000).toISOString(), updated_at: new Date().toISOString() });
      if (i % 3 === 0) d.ratings.push({ id: crypto.randomUUID(), spot_id: id, group_id: g.id, created_by: u, overall: 1 + (i % 5), visited_on: '2026-11-01', created_at: new Date().toISOString() });
    }
    window.__mock.save();
  });
  await p.reload(); await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(800);
});
after(async () => { await env?.close(); });

test('1.200 Spots: Karte fasst zusammen, Liste zeigt erst 60', { timeout: 90000 }, async () => {
  const t = Date.now();
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  assert.ok((await p.$$('.mk-cluster')).length > 0, 'Gruppen mit Zahl');
  assert.ok((await p.$$('.leaflet-marker-icon .pin')).length <= 250);
  await p.click('.viewtabs [data-view=list]');
  assert.equal((await p.$$('#spot-list .spot-item')).length, 60);
  assert.match(await p.textContent('.list-more'), /Weitere 60/);
  assert.ok(Date.now() - t < 5000, `zu langsam: ${Date.now() - t} ms`);
});

test('Echtzeit: Änderung eines anderen wird ohne Neuladen eingearbeitet', { timeout: 30000 }, async () => {
  const before = await p.evaluate(() => window.__mock.selects);
  await p.evaluate(() => {
    const d = window.__mock.db(); const s = d.spots[0]; s.name = 'Umbenannt per Echtzeit'; window.__mock.save();
    window.__mock.fire('spots', [{ eventType: 'UPDATE', new: { ...s }, old: { id: s.id } }]);
  });
  await p.waitForFunction(() => [...document.querySelectorAll('#spot-list .title')].some((e) => e.textContent === 'Umbenannt per Echtzeit'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => window.__mock.selects), before, 'kein komplettes Neuladen');
  assert.deepEqual(p.errors, []);
});
