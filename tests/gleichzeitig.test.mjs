// Gleichzeitiges Bearbeiten: keine stillen Überschreibungen, Auswahl „Meine Version“ / „Andere Version“
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotBySearch, db } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotBySearch(p, 'delphi koblenz');
});
after(async () => { await env?.close(); });

// „Jemand anderes“ ändert den Spot direkt im Test-Backend (wie ein zweites Gerät)
const otherEdit = (fields) => p.evaluate((f) => {
  const d = window.__mock.db(); Object.assign(d.spots[0], f, { updated_at: new Date(Date.now() + 1000).toISOString(), updated_by: 'someone-else' }); window.__mock.save();
}, fields);

test('Andere Änderung an einem anderen Feld bleibt erhalten; gleiches Feld → Rückfrage, meine Version gewinnt', { timeout: 60000 }, async () => {
  await p.click('#btn-edit'); await p.waitForSelector('#f-spot');
  await otherEdit({ phone: '0261 999', price_level: 4 });
  await p.click('#f-spot .price-seg [data-p="1"]');
  await p.click('#f-spot button[type=submit]');
  await p.waitForSelector('#conflict-banner');
  await p.click('#conflict-banner button'); await p.waitForSelector('.conflict-table');
  const table = await p.textContent('.conflict-table');
  assert.match(table, /Preisniveau/); assert.ok(!/Telefon/.test(table), 'nur Felder, die ich geändert habe');
  await p.click('[data-mine]'); await p.waitForTimeout(800);
  const s = (await db(p)).spots[0];
  assert.equal(s.price_level, 1, 'meine Version');
  assert.equal(s.phone, '0261 999', 'Änderung der anderen Person an einem anderen Feld bleibt');
  assert.deepEqual(p.errors, []);
});
