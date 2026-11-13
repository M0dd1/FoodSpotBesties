// Test-Gerüst: statischer Server für die App, Browser mit Test-Backend statt Supabase,
// und Hilfsfunktionen für typische Abläufe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');          // Repository = Web-Wurzel der App
export const FIXTURES = path.resolve(here, '../fixtures');
const require = createRequire(import.meta.url);
// Echtes Leaflet aus node_modules; nur ohne Internet (lokal) ein kleiner Ersatz
let LEAFLET_DIST = null;
try { LEAFLET_DIST = path.dirname(require.resolve('leaflet/dist/leaflet.js')); } catch { /* Ersatz */ }
export const LEAFLET_STUB = !LEAFLET_DIST;
const MOCK = path.join(here, 'mock-supabase.js');

// Sicherheits-Header wie auf Netlify, damit die Tests auch die Content-Security-Policy prüfen
const CSP = (fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/) || [])[1];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

export function startServer(root = ROOT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (CSP) headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    // Prüfsummen (SRI) gelten für die echten CDN-Dateien – im Test werden Ersatzdateien ausgeliefert
    if (file.endsWith('index.html')) return res.end(fs.readFileSync(file, 'utf8').replace(/ integrity="[^"]+"/g, ''));
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

export async function launch() {
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

// Neuer, leerer Browser-Kontext (eigener localStorage = eigenes Test-Backend)
export async function newContext(browser, { geo = { latitude: 50.3601, longitude: 7.5975 }, seedDb = null, online = true, sw = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin',
    serviceWorkers: sw ? 'allow' : 'block', // Service Worker würde die Test-Umleitungen umgehen
    ...(geo ? { geolocation: { ...geo, accuracy: 8 }, permissions: ['geolocation'] } : {}),
  });
  await ctx.route('**/supabase-js@2*/**', (r) => r.fulfill({ path: MOCK, contentType: 'text/javascript' }));
  await ctx.route('**/leaflet@1.9.4/dist/**', (r) => {
    const rel = new URL(r.request().url()).pathname.split('/dist/')[1] || '';   // z. B. leaflet.js oder images/marker-icon.png
    const file = path.basename(rel);
    if (LEAFLET_DIST) return r.fulfill({ path: path.join(LEAFLET_DIST, rel) });
    return file.endsWith('.js') ? r.fulfill({ path: path.join(here, 'leaflet-stub.js'), contentType: 'text/javascript' }) : r.fulfill({ body: '', contentType: 'text/css' });
  });
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (r) => r.abort());
  if (seedDb) await ctx.addInitScript((d) => { if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', d); }, seedDb);
  if (!online) await ctx.setOffline(true);
  return ctx;
}

export async function openApp(ctx, url) {
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = [];
  page.acceptDialogs = true;
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) page.errors.push('CSP: ' + m.text()); });
  page.on('dialog', (d) => { page.dialogs.push(d.message()); page.acceptDialogs ? d.accept(page.promptAnswer ?? undefined) : d.dismiss(); });
  await page.goto(url);
  return page;
}

export const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}'));
export const hideToast = (page) => page.evaluate(() => document.getElementById('toast').classList.add('hidden'));
export const closeSheet = (page) => page.click('#sheet:not(.hidden) [data-close] >> nth=0');
export const toastText = async (page) => { await page.waitForSelector('#toast:not(.hidden)'); return page.textContent('#toast'); };

export async function register(page, { name = 'Marcel', password = 'geheim123', code = null } = {}) {
  await page.waitForSelector('#screen-auth:not(.hidden)');
  await page.click('[data-auth-tab=register]');
  await page.fill('#auth-name', name); await page.fill('#auth-pass', password); await page.fill('#auth-pass2', password);
  if (code) await page.fill('#auth-code', code);
  await page.click('#auth-submit');
  await page.waitForSelector('#screen-groups:not(.hidden), #screen-main:not(.hidden)');
}
export async function login(page, { name, password = 'geheim123' }) {
  await page.waitForSelector('#screen-auth:not(.hidden)');
  await page.fill('#auth-name', name); await page.fill('#auth-pass', password);
  await page.click('#auth-submit');
}
export async function logout(page) {
  await page.click('#btn-settings'); await page.click('#btn-logout');
  await page.waitForSelector('#screen-auth:not(.hidden)');
}
export async function createGroup(page, name = 'Foodies') {
  await page.fill('#create-name', name); await page.click('#form-create button');
  await page.waitForSelector('#screen-main:not(.hidden)');
  await page.waitForTimeout(500);
}

// Spot über die Suche eintragen (Treffer Nr. idx), Anreicherung abwarten, speichern
export async function addSpotBySearch(page, q = 'delphi koblenz', { idx = 0, edit = null } = {}) {
  await page.click('#btn-add');
  await page.fill('#search-q', q); await page.click('#f-search button[type=submit]');
  await page.waitForSelector('#search-results .cand');
  await page.click(`#search-results .cand >> nth=${idx}`);
  await page.waitForSelector('#f-spot');
  await page.waitForFunction(() => !document.querySelector('#sf-enrich .spinner'), null, { timeout: 10000 });
  if (edit) await edit(page);
  await page.click('#f-spot button[type=submit]');
  await page.waitForSelector('#sheet:not(.hidden) #btn-rate');
  await page.waitForTimeout(300);
}
// Spot ohne Suche eintragen (Name, optional Länderküche)
export async function addSpotManual(page, { name = 'Testlokal', cuisine = null } = {}) {
  await page.click('#btn-add'); await page.click('#add-manual');
  await page.waitForSelector('#f-spot');
  await page.fill('#f-spot [name=name]', name);
  if (cuisine) { await page.click('#sf-add-c'); await page.click(`#sf-picker [data-pick=${cuisine}]`); }
  await page.click('#f-spot button[type=submit]');
  await page.waitForSelector('#sheet:not(.hidden) #btn-rate');
  await page.waitForTimeout(300);
}
// Offenen Spot bewerten: Gesamtnote + optional Gerichte [{ name, stars, price, photo }]
export async function rateOpenSpot(page, { overall = 4, comment = '', dishes = [] } = {}) {
  await page.click('#btn-rate');
  await page.waitForSelector('#f-rate');
  const cur = Number(await page.getAttribute('#f-rate [data-stars=overall]', 'data-value'));
  if (cur !== overall) await page.click(`#f-rate [data-stars=overall] [data-v="${overall}"]`);
  if (comment) await page.fill('#f-rate [name=comment]', comment);
  for (const d of dishes) {
    await page.click('#r-add-dish');
    const card = page.locator('#r-dishes .dish-edit').last();
    await card.locator('[data-f=name]').fill(d.name);
    if (d.stars) await card.locator(`[data-stars=dish] [data-v="${d.stars}"]`).click();
    if (d.price) await card.locator('[data-f=price]').fill(d.price);
    if (d.photo) {
      await card.locator('[data-f=photo]').setInputFiles(path.join(FIXTURES, d.photo));
      await page.waitForFunction(() => { const l = [...document.querySelectorAll('#r-dishes .dish-photo')].pop(); return l && l.classList.contains('has') && !l.classList.contains('busy'); });
    }
  }
  await page.click('#r-save');
  await page.waitForSelector('#sheet:not(.hidden) #btn-rate');
  await page.waitForTimeout(400);
}
export async function openSpotByName(page, name) {
  await page.click('.viewtabs [data-view=list]');
  await page.click(`#spot-list .spot-item:has-text("${name}")`);
  await page.waitForSelector('#sheet:not(.hidden) #btn-rate, #sheet:not(.hidden) .status-box');
}

export const pins = (page) => page.$$eval('.leaflet-marker-icon .pin', (ps) => ps.map((p) => ({ wish: p.classList.contains('wish'), color: p.style.getPropertyValue('--c') })));

// Gemeinsamer Aufbau pro Testdatei
export async function setup() {
  const { server, url } = await startServer();
  const browser = await launch();
  return { server, url, browser, async close() { await browser.close(); server.close(); } };
}
