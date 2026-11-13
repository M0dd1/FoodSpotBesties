// Anmeldung, Gruppen, Einladen, Super-Admin
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, login, logout, createGroup, addSpotManual, db, toastText } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Erstes Konto ohne Code, Gruppe gründen, zweite Person tritt per Code bei', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser);
  const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' });
  await createGroup(p, 'Foodies Koblenz');
  assert.equal(await p.textContent('#group-name'), 'Foodies Koblenz');
  await addSpotManual(p, { name: 'Taverna Test', cuisine: 'greek' });
  const d = await db(p);
  assert.equal(d.super_admins.length, 1, 'Marcel ist Super-Admin');
  const code = d.groups[0].invite_code;

  await p.click('[data-close]'); await logout(p);
  await register(p, { name: 'Kumpel', code: code.toLowerCase() });
  await p.waitForSelector('#screen-main:not(.hidden)'); await p.waitForTimeout(600);
  assert.equal(await p.textContent('#group-name'), 'Foodies Koblenz');
  assert.equal((await p.$$('.leaflet-marker-icon .pin')).length, 1, 'Kumpel sieht den Spot');
  assert.equal((await db(p)).super_admins.length, 1, 'nur Marcel ist Super-Admin');
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

test('Ohne Einladungscode keine Registrierung (ab dem zweiten Konto)', { timeout: 60000 }, async () => {
  const ctx = await newContext(env.browser);
  const p = await openApp(ctx, env.url);
  await register(p, { name: 'Erste' });
  await p.click('#btn-logout-2'); await p.waitForSelector('#screen-auth:not(.hidden)');
  await p.click('[data-auth-tab=register]');
  await p.fill('#auth-name', 'Zweite'); await p.fill('#auth-pass', 'geheim123'); await p.fill('#auth-pass2', 'geheim123');
  await p.click('#auth-submit');
  assert.match(await toastText(p), /Einladungscode/);
  assert.equal((await db(p)).users.length, 1);
  await ctx.close();
});

test('Falsches Passwort zeigt verständliche Meldung, Passwörter müssen übereinstimmen', { timeout: 60000 }, async () => {
  const ctx = await newContext(env.browser);
  const p = await openApp(ctx, env.url);
  await register(p, { name: 'Xaver' });
  await p.click('#btn-logout-2'); await p.waitForSelector('#screen-auth:not(.hidden)');
  await login(p, { name: 'xaver', password: 'falsch123' });
  assert.match(await toastText(p), /Name oder Passwort falsch/);
  await p.click('[data-auth-tab=register]');
  await p.fill('#auth-name', 'Yvonne'); await p.fill('#auth-pass', 'geheim123'); await p.fill('#auth-pass2', 'anders123');
  await p.click('#auth-submit');
  assert.match(await toastText(p), /stimmen nicht überein/);
  await ctx.close();
});
