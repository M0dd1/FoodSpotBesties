// Admin-Bereich: nur Super-Admin „Marcel“, Übersicht, Länderküche anlegen, Nutzer sperren
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, logout, db, toastText } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Marcel sieht den Admin-Bereich, legt eine Länderküche an und sperrt ein Konto; andere sehen ihn nicht', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser); const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' }); await createGroup(p, 'Foodies');
  const code = (await db(p)).groups[0].invite_code;
  await logout(p);
  await register(p, { name: 'Kumpel', code });
  await p.waitForSelector('#screen-main:not(.hidden)');
  await p.click('#btn-settings'); await p.waitForTimeout(400);
  assert.ok(!(await p.$('#btn-admin')), 'Kumpel hat keinen Admin-Bereich');
  await p.click('#btn-logout'); await p.waitForSelector('#screen-auth:not(.hidden)');
  await p.fill('#auth-name', 'Marcel'); await p.fill('#auth-pass', 'geheim123'); await p.click('#auth-submit');
  await p.waitForSelector('#screen-main:not(.hidden)');
  await p.click('#btn-settings'); await p.waitForSelector('#btn-admin'); await p.click('#btn-admin');
  await p.waitForSelector('.admin-stats');
  assert.match(await p.textContent('.admin-stats'), /2\s*Nutzer/);
  await p.click('[data-tab=cuisines]'); await p.waitForSelector('#adm-cuisine');
  await p.fill('#adm-cuisine [name=key]', 'tunisian'); await p.fill('#adm-cuisine [name=name]', 'Tunesisch');
  await p.fill('#adm-cuisine [name=emoji]', '🇹🇳'); await p.selectOption('#adm-cuisine [name=region]', 'Afrika');
  await p.click('#adm-cuisine button[type=submit]');
  assert.match(await toastText(p), /gespeichert/);
  assert.equal((await db(p)).cuisines_extra[0].key, 'tunisian');
  await p.click('[data-tab=users]');
  await p.click('.adm-row:has-text("Kumpel")');
  await p.click('text=Sperren'); await p.waitForTimeout(500);
  assert.ok((await db(p)).users.find((u) => u.email.startsWith('kumpel')).banned);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});
