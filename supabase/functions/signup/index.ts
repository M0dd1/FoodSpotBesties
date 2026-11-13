// FoodiSpots – Registrierung mit Name + Passwort + Einladungscode.
// Legt den Nutzer bestätigt an (keine E-Mail nötig); der DB-Trigger prüft den Code erneut.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function loginEmail(name: string) {
  const slug = name.trim().toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss");
  return `${slug}@nutzer.foodispots.invalid`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  let body: { username?: string; password?: string; invite_code?: string };
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const code = String(body.invite_code ?? "").trim().toUpperCase();

  if (password.length < 6 || password.length > 72) return json({ error: "Passwort: 6–72 Zeichen" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: check, error: checkErr } = await admin.rpc("signup_precheck", { username, code });
  if (checkErr) return json({ error: "Prüfung fehlgeschlagen" }, 500);
  if (check !== "ok") return json({ error: check }, 400);

  const { error } = await admin.auth.admin.createUser({
    email: loginEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, invite_code: code },
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message)
      ? "Name ist schon vergeben"
      : "Registrierung fehlgeschlagen – Einladungscode prüfen";
    return json({ error: msg }, 400);
  }
  return json({ ok: true });
});
