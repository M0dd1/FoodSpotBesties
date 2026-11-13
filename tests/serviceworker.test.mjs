// Service Worker: Start sofort aus dem Speicher (auch bei sehr langsamem Netz und offline), Hinweis bei neuer Version.
// Läuft mit echtem Service Worker gegen eine Kopie der App wie auf Netlify (dist/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, ROOT, LEAFLET_STUB } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const LEAFLET = LEAFLET_STUB ? null : path.dirname(require.resolve('leaflet/dist/leaflet.js'));
const STUB = path.join(ROOT, 'tests/support/leaflet-stub.js');
const MOCK = path.join(ROOT, 'tests/support/mock-supabase.js');
// genau die Dateien, die der Netlify-Build veröffentlicht
const FILES = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').match(/cp -r (.*?) dist\//)[1].split(/\s+/);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };

let dist, server, url, browser, delay = 0;
before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'foodi-dist-'));
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(dist, f), { recursive: true });
  // wie der Netlify-Build: Build-Kennung einsetzen; Prüfsummen gelten nur für die echten CDN-Dateien
  fs.writeFileSync(path.join(dist, 'sw.js'), fs.readFileSync(path.join(dist, 'sw.js'), 'utf8').replace('__BUILD__', 'test1'));
  fs.writeFileSync(path.join(dist, 'index.html'), fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace(/ integrity="[^"]+"/g, ''));
  server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
    setTimeout(() => {
      if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
    }, delay);
  });
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}/`;
  browser = await launch();
});
after(async () => { await browser?.close(); server?.close(); if (dist) fs.rmSync(dist, { recursive: true, force: true }); });

test('Zweiter Start kommt sofort aus dem Speicher – auch bei 6 s Verzögerung je Datei und offline; neue Version wird angezeigt', { timeout: 120000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  await ctx.route('**/supabase-js@2*/**', (r) => r.fulfill({ path: MOCK, contentType: 'text/javascript' }));
  await ctx.route('**/leaflet@1.9.4/dist/**', (r) => { const f = path.basename(new URL(r.request().url()).pathname); return LEAFLET ? r.fulfill({ path: path.join(LEAFLET, f) }) : f.endsWith('.js') ? r.fulfill({ path: STUB, contentType: 'text/javascript' }) : r.fulfill({ body: '', contentType: 'text/css' }); });
  await ctx.route(/openstreetmap|arcgisonline/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url); await p.waitForSelector('#screen-auth:not(.hidden)');
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(async () => { await p.reload(); });
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });

  delay = 6000;
  let t = Date.now(); await p.reload(); await p.waitForSelector('#screen-auth:not(.hidden)');
  assert.ok(Date.now() - t < 3000, `Start bei langsamem Netz dauerte ${Date.now() - t} ms`);
  delay = 0;

  await ctx.setOffline(true);
  t = Date.now(); await p.goto(url + '?view=' + 'x'.repeat(40));
  await p.waitForFunction(() => document.querySelector('#screen-loading').classList.contains('hidden') || /nicht gültig|offline/i.test(document.body.innerText), null, { timeout: 10000 });
  await ctx.setOffline(false);

  // Neue Version veröffentlicht → Hinweis zum Neuladen
  await p.goto(url); await p.waitForSelector('#screen-auth:not(.hidden)');
  fs.writeFileSync(path.join(dist, 'sw.js'), fs.readFileSync(path.join(dist, 'sw.js'), 'utf8').replace("const BUILD = 'test1'", "const BUILD = 'test2'"));
  await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await p.waitForSelector('#update-banner', { timeout: 20000 });
  assert.match(await p.textContent('#update-banner'), /Neue Version/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
