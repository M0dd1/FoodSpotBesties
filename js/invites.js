// FoodiSpots – Einladungen zu FoodiSpots (ohne Gruppe): jeder Nutzer kann sie in den Einstellungen erstellen.
// Ein Link gilt für eine Person und 30 Tage; die Datenbank prüft und zählt das (signup_invites).
import { $, $$, esc, fmtDate, isNetErr, sb, toast } from './core.js';

export const inviteLink = (code) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
const SHARE_TEXT = 'Ich lade dich zu FoodiSpots ein – unserer privaten Restaurant-Wunschliste auf der Karte. Mit diesem Link kannst du dir ein Konto anlegen (gilt 30 Tage und nur für dich). Danach kannst du eine eigene Gruppe gründen.';

async function shareInvite(code) {
  const url = inviteLink(code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Einladung zu FoodiSpots', text: SHARE_TEXT, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  await copyInvite(code);
}
async function copyInvite(code) {
  const url = inviteLink(code);
  try { await navigator.clipboard.writeText(url); toast('Einladungslink kopiert.'); }
  catch { toast(`Einladungslink: ${url}`, false, 12000); }
}

function row(i) {
  const title = i.note ? esc(i.note) : 'Einladung';
  const status = {
    open: `offen bis ${fmtDate(i.expires_at)}`,
    used: `✓ eingelöst${i.used_by_name ? ` von <b>${esc(i.used_by_name)}</b>` : ''} am ${fmtDate(i.used_at)}`,
    revoked: 'widerrufen',
    expired: `abgelaufen am ${fmtDate(i.expires_at)}`,
  }[i.status] || '';
  return `<div class="invite-row ${i.status}" data-code="${esc(i.code)}">
    <div class="invite-head"><b>${title}</b><code class="invite-code">${esc(i.code)}</code></div>
    <div class="small muted">${status}</div>
    ${i.status === 'open' ? `<div class="row wrap" style="margin-top:8px">
      <button class="btn small primary" data-inv-share="${esc(i.code)}" type="button">Teilen</button>
      <button class="btn small" data-inv-copy="${esc(i.code)}" type="button">Link kopieren</button>
      <button class="btn small ghost" data-inv-revoke="${esc(i.code)}" type="button">Widerrufen</button></div>` : ''}
  </div>`;
}

export async function renderInviteBox(box) {
  if (!box) return;
  box.innerHTML = '<p class="small muted">Wird geladen …</p>';
  const { data, error } = await sb.rpc('my_signup_invites');
  if (!box.isConnected) return;
  if (error) {
    box.innerHTML = `<p class="small muted">${isNetErr(error) ? 'Einladungen brauchen eine Internetverbindung.' : 'Einladungen konnten nicht geladen werden.'}</p>`;
    return;
  }
  const list = data || [];
  const done = list.filter((i) => i.status !== 'open');
  box.innerHTML = `
    <p class="small muted">Für jemanden, der noch kein Konto hat: Ein Link gilt für <b>eine Person</b> und <b>30 Tage</b>.
      Danach kann die Person eine eigene Gruppe gründen. Um jemanden in eine bestimmte Gruppe zu holen, nimm stattdessen die Einladung der Gruppe (oben auf den Gruppennamen tippen).</p>
    <form id="f-invite" class="row" style="align-items:flex-end">
      <label style="flex:1"><span>Für wen? <span class="muted" style="font-weight:400">(optional, nur für dich)</span></span>
        <input name="note" maxlength="60" autocomplete="off" placeholder="z. B. Onkel Peter"></label>
      <button class="btn primary" type="submit">Link erstellen</button>
    </form>
    <div class="stack invite-list">
      ${list.filter((i) => i.status === 'open').map(row).join('')}
      ${done.length ? `<details class="invite-old"><summary class="small">Frühere Einladungen (${done.length})</summary><div class="stack">${done.map(row).join('')}</div></details>` : ''}
    </div>`;

  $('#f-invite', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { data: inv, error: err } = await sb.rpc('create_signup_invite', { note: e.target.note.value.trim() || null });
    if (btn) btn.disabled = false;
    if (err) return toast(isNetErr(err) ? 'Dafür wird Internet benötigt.' : (err.message || 'Fehler'), true, 7000);
    await renderInviteBox(box);
    toast('Einladungslink erstellt – jetzt teilen.');
    shareInvite(inv.code);
  });
  $$('[data-inv-share]', box).forEach((b) => b.addEventListener('click', () => shareInvite(b.dataset.invShare)));
  $$('[data-inv-copy]', box).forEach((b) => b.addEventListener('click', () => copyInvite(b.dataset.invCopy)));
  $$('[data-inv-revoke]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Diese Einladung widerrufen? Der Link funktioniert danach nicht mehr.')) return;
    const { error: err } = await sb.rpc('revoke_signup_invite', { code: b.dataset.invRevoke });
    if (err) return toast(isNetErr(err) ? 'Dafür wird Internet benötigt.' : (err.message || 'Fehler'), true, 6000);
    toast('Einladung widerrufen.');
    renderInviteBox(box);
  }));
}
