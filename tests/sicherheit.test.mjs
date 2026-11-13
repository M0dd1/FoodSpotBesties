// Sicherheit: Schadcode (XSS) in Eingaben und Suchergebnissen wird nur als Text angezeigt; nur App-Dateien werden veröffentlicht
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, newContext, openApp, register, createGroup, rateOpenSpot, ROOT } from './support/harness.mjs';

const P = (tag) => `${tag}<img src=x onerror="window.__xss=(window.__xss||[]).concat('${tag}')"><svg onload="window.__xss=(window.__xss||[]).concat('${tag}-svg')"></svg>"'><b class=xss-${tag}>`;
let env, ctx, p;
before(async () => { env = await setup(); ctx = await newContext(env.browser); p = await openApp(ctx, env.url); });
after(async () => { await env?.close(); });

async function assertClean(where) {
  await p.waitForTimeout(300);
  const hit = await p.evaluate(() => ({ ran: window.__xss || null, injected: document.querySelectorAll('img[src="x"], [class^="xss-"], svg[onload]').length }));
  assert.equal(hit.ran, null, `${where}: Skript wurde ausgeführt`);
  assert.equal(hit.injected, 0, `${where}: HTML wurde eingeschleust`);
}

test('Schadcode in Gruppe, Spot, Suchergebnis, Bewertung, Gericht und Kommentar bleibt Text', { timeout: 120000 }, async () => {
  await register(p, { name: 'Marcel' });
  await createGroup(p, P('gruppe').slice(0, 80));
  await assertClean('Gruppenname');
  // Suchergebnis mit Schadcode (fremde Daten aus OpenStreetMap/Recherche)
  await p.evaluate((x) => { window.__mockLookup = () => [{ name: x, lat: 50.36, lng: 7.59, address: x, city: 'K', is_food: true, category: 'restaurant',
    cuisines: [], focus: [x], website: 'javascript:alert(1)', phone: x, opening_hours: x, osm_type: 'node', osm_id: 9 }]; }, P('osm'));
  await p.click('#btn-add'); await p.fill('#search-q', 'irgendwas'); await p.click('#f-search button[type=submit]');
  await p.waitForSelector('#search-results .cand'); await assertClean('Suchergebnis');
  await p.click('#search-results .cand'); await p.waitForSelector('#f-spot');
  await p.fill('#f-spot [name=description]', P('beschreibung')); await p.fill('#f-spot [name=notes]', P('notiz'));
  await p.click('#f-spot button[type=submit]'); await p.waitForSelector('#btn-rate');
  await assertClean('Detailansicht');
  assert.equal(await p.$$eval('a[href^="javascript:"]', (a) => a.length), 0, 'keine javascript:-Links');
  await rateOpenSpot(p, { overall: 3, comment: P('bewertung'), dishes: [{ name: P('gericht').slice(0, 120) }] });
  await assertClean('Bewertung');
  await p.click('#d-tabs [data-t=dishes]'); await assertClean('Gerichte');
  await p.fill('#f-comment input', P('kommentar')); await p.click('#f-comment button'); await p.waitForSelector('.comment');
  await assertClean('Kommentar');
  await p.click('[data-close]');
  for (const v of ['list', 'cuisines', 'map']) { await p.click(`.viewtabs [data-view=${v}]`); await assertClean(v); }
  await p.click('#btn-filter'); await assertClean('Filter');
  assert.deepEqual(p.errors, []);
});

test('Netlify veröffentlicht nur App-Dateien; Sicherheits-Header und SRI sind gesetzt', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const cmd = toml.match(/command = "(.*)"/)[1];
  assert.match(toml, /publish = "dist"/);
  for (const secret of ['tests', 'supabase', 'scripts', 'PROMPT.md', 'schema.sql', '.github', 'ANLEITUNG.md']) assert.ok(!cmd.includes(secret), `${secret} darf nicht veröffentlicht werden`);
  for (const h of ['Content-Security-Policy', "frame-ancestors 'none'", 'X-Frame-Options = "DENY"', 'Cross-Origin-Opener-Policy', 'Permissions-Policy']) assert.ok(toml.includes(h), h);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const lib of html.match(/<(script|link)[^>]+(unpkg|jsdelivr)[^>]+>/g)) assert.match(lib, /integrity="sha(256|384)-/, 'feste Version mit Prüfsumme: ' + lib);
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.ok(!/service_role|sb_secret_|sk-ant-/i.test(cfg), 'keine Geheimnisse im Code');
});
