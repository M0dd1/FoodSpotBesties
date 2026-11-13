// FoodiSpots – Anmeldung und Registrierung (Name + Passwort)
// Supabase braucht intern eine E-Mail-Adresse – sie wird aus dem Namen gebildet (loginEmail).
// Registriert wird über die Edge Function „signup“ (legt das Konto bestätigt an, ohne E-Mail).
import { $, $$, USERNAME_HINT, idb, isNetErr, loginEmail, sb, state, toast, validUsername } from './core.js';
import { closeSheet } from './ui.js';

export let authMode = 'login';
$$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
  authMode = b.dataset.authTab;
  $$('[data-auth-tab]').forEach((x) => x.classList.toggle('on', x === b));
  const reg = authMode === 'register';
  $('#auth-pass2-wrap').classList.toggle('hidden', !reg);
  $('#auth-pass2').required = reg;
  $('#auth-code-wrap').classList.toggle('hidden', !reg);
  $('#auth-submit').textContent = reg ? 'Konto erstellen' : 'Anmelden';
  $('#auth-pass').autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-hint').textContent = reg
    ? `Den Einladungscode bekommst du von jemandem aus der Gruppe (steckt auch im Einladungslink). Name: ${USERNAME_HINT} Er ist für die anderen sichtbar. Passwort gut merken – zurücksetzen kann nur, wer FoodiSpots betreibt.`
    : 'Noch kein Konto? Oben auf „Neu registrieren“ tippen.';
}));

// Über einen Einladungslink gekommen: Hinweis zeigen, „Neu registrieren“ vorauswählen, Code eintragen
export function showInviteHint() {
  let join = null, invite = null;
  try { join = localStorage.getItem('foodi.pendingJoin'); invite = localStorage.getItem('foodi.pendingInvite'); } catch {}
  const pending = join || invite;
  const hint = $('#auth-invite');
  hint.classList.toggle('hidden', !pending);
  hint.textContent = join
    ? 'Du wurdest in eine Gruppe eingeladen. Registriere dich oder melde dich an – danach bist du automatisch dabei.'
    : 'Du wurdest zu FoodiSpots eingeladen. Registriere dich – danach kannst du eine eigene Gruppe gründen.';
  if (pending) { $('[data-auth-tab="register"]').click(); $('#auth-code').value = pending; }
  return !!pending;
}

$('#form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#auth-name').value.trim();
  const password = $('#auth-pass').value;
  if (!validUsername(name)) return toast(`Name ungültig. ${USERNAME_HINT}`, true, 6000);
  const btn = $('#auth-submit'); btn.disabled = true;
  try {
    if (authMode === 'register') {
      if (password !== $('#auth-pass2').value) return toast('Die Passwörter stimmen nicht überein.', true);
      // Privates Angebot: Registrieren nur mit Einladungscode (prüft auch die Datenbank)
      const code = $('#auth-code').value.trim().toUpperCase();
      const { data: inv, error: invErr } = await sb.rpc('check_invite', { code });
      if (invErr) return toast(authErrorText(invErr), true, 6000);
      if (inv === 'invalid') return toast(code ? 'Einladungscode ungültig. Bitte noch einmal prüfen.' : 'Zum Registrieren brauchst du einen Einladungscode – du bekommst ihn von jemandem aus der Gruppe.', true, 7000);
      const { error } = await sb.functions.invoke('signup', { body: { username: name, password, invite_code: code } });
      if (error) return toast(await fnErrorText(error), true, 7000);
      try { localStorage.removeItem('foodi.pendingInvite'); } catch {}   // Einladung ist verbraucht
    }
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(name), password });
    if (error) return toast(authErrorText(error), true, 6000);
    // onAuthStateChange übernimmt
  } finally { btn.disabled = false; }
});

export async function fnErrorText(error) {
  try { const j = await error.context.json(); if (j?.error) return j.error; } catch {}
  return authErrorText(error);
}
export function authErrorText(err) {
  const m = String(err?.message || err);
  if (/invalid login|invalid credentials/i.test(m)) return 'Name oder Passwort falsch.';
  if (/banned/i.test(m)) return 'Dieses Konto ist gesperrt. Bitte wende dich an einen Admin.';
  if (/already registered|already exists|duplicate|vergeben/i.test(m)) return 'Dieser Name ist schon vergeben oder einem anderen zu ähnlich – bitte einen anderen wählen.';
  if (/password/i.test(m) && /at least|short|weak/i.test(m)) return 'Passwort zu kurz oder zu schwach (mind. 6 Zeichen).';
  if (/rate|security purposes|seconds/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten.';
  if (isNetErr(err)) return 'Keine Verbindung. Für die Anmeldung wird Internet benötigt.';
  return 'Fehler: ' + m;
}

export async function logout() {
  if (state.outbox.length && !confirm(`Es gibt ${state.outbox.length} noch nicht hochgeladene Änderungen. Beim Abmelden gehen sie verloren. Trotzdem abmelden?`)) return;
  closeSheet();
  await sb.auth.signOut().catch(() => {});
  await Promise.all(['kv', 'outbox', 'blobs'].map((s) => idb.clear(s).catch(() => {})));
  location.reload();
}
$('#btn-logout-2').addEventListener('click', logout);
