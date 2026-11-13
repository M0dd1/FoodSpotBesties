// Liste, Filter, Suche, Öffnungszeiten, Länderküchen-Übersicht, „Wohin heute?“
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, addSpotBySearch, addSpotManual, rateOpenSpot } from './support/harness.mjs';

let env, ctx, p;
before(async () => {
  env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  await addSpotBySearch(p, 'delphi koblenz');
  await rateOpenSpot(p, { overall: 4, dishes: [{ name: 'Moussaka', stars: 4 }] });
  await p.click('[data-close]');
  await addSpotBySearch(p, 'konoba koblenz'); await p.click('[data-close]');
  await addSpotManual(p, { name: 'La Tasca', cuisine: 'spanish' }); await p.click('[data-close]');
});
after(async () => { await env?.close(); });

const listNames = () => p.$$eval('#spot-list .spot-item .title', (els) => els.map((e) => e.textContent));

test('Liste: Suche findet auch Gerichte, Filter nach Status und Länderküche', { timeout: 60000 }, async () => {
  await p.click('.viewtabs [data-view=list]');
  assert.equal((await listNames()).length, 3);
  await p.fill('#list-search', 'moussaka'); await p.waitForTimeout(200);
  assert.deepEqual(await listNames(), ['Delphi']);
  await p.fill('#list-search', ''); await p.waitForTimeout(200);
  await p.click('#btn-filter'); await p.click('[data-status=wish]');
  await p.click('#f-done');
  assert.deepEqual((await listNames()).sort(), ['Konoba Dalmacija', 'La Tasca']);
  assert.ok(await p.isVisible('#filter-dot'));
  await p.click('#btn-filter'); await p.click('[data-status=all]'); await p.click('[data-cuisine=croatian]'); await p.click('[data-cuisine=spanish]');
  assert.match(await p.textContent('#f-done'), /2 Spots anzeigen/);
  await p.click('#f-reset'); await p.click('#f-done');
  assert.equal((await listNames()).length, 3);
});

test('Öffnungszeiten im OpenStreetMap-Format werden richtig gelesen', { timeout: 30000 }, async () => {
  const r = await p.evaluate(async () => {
    const { openState } = await import('./js/list.js');
    const at = (iso) => new Date(iso);
    return [
      openState('Tu-Su 17:00-23:00', at('2026-11-13T18:00:00')),      // Freitag 18 Uhr → offen
      openState('Tu-Su 17:00-23:00', at('2026-11-16T18:00:00')),      // Montag → zu
      openState('Mo-Fr 11:30-14:00,17:30-22:00; Sa 12:00-23:00; Su off', at('2026-11-13T15:00:00')), // Pause → zu
      openState('Fr-Sa 18:00-02:00', at('2026-11-14T01:00:00')),      // Samstag 1 Uhr, über Mitternacht → offen
      openState('24/7', at('2026-11-15T03:00:00')),
      openState('nach Vereinbarung', at('2026-11-15T03:00:00')),       // nicht lesbar → unbekannt
    ];
  });
  assert.deepEqual(r, [true, false, false, true, true, null]);
});

test('Länderküchen-Übersicht zählt probierte Küchen; Antippen filtert die Liste', { timeout: 30000 }, async () => {
  await p.click('.viewtabs [data-view=cuisines]');
  assert.match(await p.textContent('.cuisine-hero'), /1\s*von/);
  assert.match(await p.textContent('[data-cg=greek]'), /1 besucht/);
  assert.match(await p.textContent('[data-cg=croatian]'), /auf der Liste/);
  await p.click('[data-cg=croatian]');
  await p.waitForSelector('#view-list:not(.hidden)');
  assert.deepEqual(await listNames(), ['Konoba Dalmacija']);
  await p.click('#btn-filter'); await p.click('#f-reset'); await p.click('#f-done');
});

test('„Wohin heute?“ schlägt nur offene Spots der Wunschliste vor', { timeout: 30000 }, async () => {
  await p.click('.viewtabs [data-view=map]');
  for (let i = 0; i < 4; i++) {
    await p.click('#btn-random'); await p.waitForSelector('#pick-again');
    const title = await p.textContent('.sheet-head h2');
    assert.ok(!/Delphi/.test(title), `„${title}“ ist schon besucht`);
    await p.click('[data-close]');
  }
  assert.deepEqual(p.errors, []);
});
