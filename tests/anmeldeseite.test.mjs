// Anmeldeseite: privates Angebot, Einladungslinks (Gruppe und Konto), Suchmaschinen-Ausschluss
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newContext, openApp, register, createGroup, logout, db } from './support/harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test('Hinweis „privates Angebot“ und Gruppen-Einladungslink mit vorausgefülltem Code', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser);
  const p = await openApp(ctx, env.url);
  await p.waitForSelector('#screen-auth:not(.hidden)');
  assert.match(await p.textContent('.auth-private'), /Privates, nicht-kommerzielles Angebot/);
  await register(p, { name: 'Marcel' });
  await createGroup(p, 'Foodies');
  const code = (await db(p)).groups[0].invite_code;
  await logout(p);
  await p.goto(env.url + '?join=' + code);
  await p.waitForSelector('#screen-auth:not(.hidden)');
  assert.ok(await p.isVisible('#auth-invite'));
  assert.equal(await p.inputValue('#auth-code'), code);
  assert.ok(await p.isVisible('#auth-pass2'), '„Neu registrieren“ ist vorausgewählt');
  assert.equal(await p.getAttribute('meta[name=robots]', 'content'), 'noindex, nofollow, noarchive');
  await p.fill('#auth-name', 'Gast'); await p.fill('#auth-pass', 'geheim123'); await p.fill('#auth-pass2', 'geheim123');
  await p.click('#auth-submit');
  await p.waitForSelector('#screen-main:not(.hidden)');
  assert.equal(await p.textContent('#group-name'), 'Foodies');
  await ctx.close();
});

test('Einladung ohne Gruppe: Link erstellen, einlösen, danach verbraucht', { timeout: 90000 }, async () => {
  const ctx = await newContext(env.browser);
  const p = await openApp(ctx, env.url);
  await register(p, { name: 'Marcel' });
  await createGroup(p, 'Foodies');
  await p.click('#btn-settings');
  await p.waitForSelector('#invite-box button');
  await p.fill('#invite-box input', 'für Lisa');
  await p.click('#invite-box button[type=submit], #invite-box form button');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb')).signup_invites.length === 1);
  const inv = (await db(p)).signup_invites[0].code;
  await p.click('#btn-logout'); await p.waitForSelector('#screen-auth:not(.hidden)');
  await p.goto(env.url + '?invite=' + inv);
  await register(p, { name: 'Lisa', code: inv });
  await p.waitForSelector('#screen-groups:not(.hidden)');
  const d = await db(p);
  assert.ok(d.signup_invites[0].used_at, 'Einladung ist verbraucht');
  assert.equal(d.group_members.filter((m) => m.user_id === d.users[1].id).length, 0, 'Lisa ist in keiner Gruppe');
  await ctx.close();
});
