// FoodiSpots: Export aller Daten + kurzlebige Download-Links der Fotos für die Sicherung.
// Aufruf nur mit Header "x-backup-token", der dem Secret BACKUP_TOKEN entspricht (GitHub Action).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("BACKUP_TOKEN") || "";
// Tabelle → Spalte für eine stabile Reihenfolge beim seitenweisen Abruf
const TABLES: Record<string, string> = {
  groups: "created_at", group_members: "joined_at", profiles: "created_at", cuisines: "key", spots: "created_at",
  spot_wants: "created_at", visits: "created_at", ratings: "created_at", dishes: "created_at", comments: "created_at",
};

// Konstante Laufzeit beim Vergleich, damit das Token nicht erraten werden kann
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function all(table: string, orderBy: string) {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order(orderBy, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (TOKEN.length < 32) return new Response("BACKUP_TOKEN fehlt oder ist zu kurz (mind. 32 Zeichen)", { status: 503 });
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-backup-token") || "", TOKEN)) return new Response("forbidden", { status: 403 });
  try {
    const tables: Record<string, unknown[]> = {};
    for (const [t, orderBy] of Object.entries(TABLES)) tables[t] = await all(t, orderBy);
    const paths = (tables.dishes as { photo_path: string | null; thumb_path: string | null }[])
      .flatMap((d) => [d.photo_path, d.thumb_path]).filter((p): p is string => !!p);
    const photo_urls: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 100) {
      const { data, error } = await sb.storage.from("food-photos").createSignedUrls(paths.slice(i, i + 100), 3600);
      if (error) throw error;
      for (const d of data || []) if (d.signedUrl && d.path) photo_urls[d.path] = d.signedUrl;
    }
    return new Response(JSON.stringify({ exported_at: new Date().toISOString(), tables, photo_urls }),
      { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
