// FoodiSpots – Restaurant-Suche
//  action "search": Freitext (z. B. "delphi koblenz") -> Treffer aus OpenStreetMap (Nominatim)
//  action "enrich": Treffer (oder nur Freitext) -> Küchenrichtung, Beschreibung, Preisniveau … per Claude + Websuche
// Secrets: ANTHROPIC_API_KEY (optional, ohne Key gibt es nur die OSM-Daten), ANTHROPIC_MODEL (optional)
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "FoodiSpots/1.0 (private Gruppen-App, Supabase-Projekt bnhagdnfaekhyjbokggp)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function cacheGet(key: string, maxAgeDays: number) {
  const { data } = await db.from("lookup_cache").select("result, created_at").eq("key", key).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > maxAgeDays * 864e5) return null;
  return data.result;
}
async function cachePut(key: string, result: unknown) {
  await db.from("lookup_cache").upsert({ key, result, created_at: new Date().toISOString() });
}

// ---------- OSM-Tags -> FoodiSpots ----------
const CUISINE_KEYS = new Set([
  "german","austrian","swiss","french","belgian","dutch","british","irish","scandinavian","polish","czech",
  "hungarian","russian","ukrainian","georgian","italian","spanish","portuguese","greek","croatian","serbian",
  "bosnian","albanian","bulgarian","balkan","turkish","lebanese","syrian","persian","israeli","arab","moroccan",
  "ethiopian","african","indian","pakistani","nepalese","chinese","japanese","korean","vietnamese","thai",
  "indonesian","filipino","asian","american","mexican","peruvian","brazilian","argentinian","caribbean",
  "hawaiian","international","fusion",
]);
// OSM-Wert -> [Länderküche | null, Schwerpunkt | null]
const OSM_MAP: Record<string, [string | null, string | null]> = {
  yugoslavian: ["balkan", null], dalmatian: ["croatian", null], bavarian: ["german", null], swabian: ["german", null],
  iranian: ["persian", null], arabic: ["arab", null], swedish: ["scandinavian", null], danish: ["scandinavian", null],
  norwegian: ["scandinavian", null], tex_mex: ["mexican", null], english: ["british", null],
  pizza: [null, "Pizza"], burger: [null, "Burger"], kebab: [null, "Döner/Kebab"], doner: [null, "Döner/Kebab"],
  sushi: ["japanese", "Sushi"], ramen: ["japanese", "Ramen"], tapas: ["spanish", "Tapas"], gyros: ["greek", "Gyros"],
  souvlaki: ["greek", "Souvlaki"], falafel: [null, "Falafel"], poke: ["hawaiian", "Poke"], steak_house: [null, "Steak"],
  steak: [null, "Steak"], seafood: [null, "Fisch & Meeresfrüchte"], fish: [null, "Fisch & Meeresfrüchte"],
  fish_and_chips: ["british", "Fish & Chips"], ice_cream: [null, "Eis"], coffee_shop: [null, "Kaffee"],
  cake: [null, "Kuchen"], bubble_tea: [null, "Bubble Tea"], noodle: [null, "Nudeln"], chicken: [null, "Hähnchen"],
  sandwich: [null, "Sandwiches"], breakfast: [null, "Frühstück"], brunch: [null, "Brunch"], vegan: [null, "vegan"],
  vegetarian: [null, "vegetarisch"], bbq: [null, "Grill/BBQ"], barbecue: [null, "Grill/BBQ"], grill: [null, "Grill/BBQ"],
  curry: [null, "Curry"], dumplings: [null, "Dumplings"], hot_pot: ["chinese", "Hot Pot"], crepe: ["french", "Crêpes"],
  waffle: [null, "Waffeln"], bagel: [null, "Bagels"], wings: [null, "Wings"], schnitzel: [null, "Schnitzel"],
  pasta: ["italian", "Pasta"], burrito: ["mexican", "Burritos"], tacos: ["mexican", "Tacos"], dim_sum: ["chinese", "Dim Sum"],
};
const GENERIC = new Set(["regional", "local", "mediterranean", "european", "oriental", "middle_eastern", "international"]);

function mapCuisine(raw: string | undefined) {
  const cuisines: string[] = []; const focus: string[] = []; let generic = false;
  for (const v of (raw ?? "").toLowerCase().split(/[;,]/).map((s) => s.trim().replace(/\s+/g, "_")).filter(Boolean)) {
    if (CUISINE_KEYS.has(v) && v !== "international") cuisines.push(v);
    else if (OSM_MAP[v]) { const [c, f] = OSM_MAP[v]; if (c) cuisines.push(c); if (f) focus.push(f); }
    else if (GENERIC.has(v)) generic = true;
  }
  return { cuisines: [...new Set(cuisines)], focus: [...new Set(focus)], generic };
}

function mapCategory(cls: string, type: string) {
  if (cls === "amenity") {
    if (type === "fast_food") return "imbiss";
    if (type === "cafe") return "cafe";
    if (["bar", "pub", "biergarten"].includes(type)) return "bar";
    if (type === "ice_cream") return "eis";
    if (["restaurant", "food_court"].includes(type)) return "restaurant";
  }
  if (cls === "shop" && ["bakery", "pastry", "confectionery"].includes(type)) return "baeckerei";
  return null;
}

function fmtAddress(a: Record<string, string> = {}) {
  const street = [a.road ?? a.pedestrian ?? a.square, a.house_number].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? "";
  const place = [a.postcode, city].filter(Boolean).join(" ");
  return { address: [street, place].filter(Boolean).join(", "), city };
}

function yesNo(v?: string) { return v === "yes" || v === "only" ? true : v === "no" ? false : null; }

// deno-lint-ignore no-explicit-any
function toCandidate(r: any) {
  const x = r.extratags ?? {};
  const { address, city } = fmtAddress(r.address);
  const m = mapCuisine(x.cuisine);
  const category = mapCategory(r.category ?? r.class, r.type);
  return {
    name: r.namedetails?.name ?? r.name ?? r.display_name?.split(",")[0] ?? "",
    lat: Number(r.lat), lng: Number(r.lon),
    address, city,
    osm_type: r.osm_type, osm_id: r.osm_id,
    is_food: !!category,
    category: category ?? "restaurant",
    cuisines: m.cuisines, focus: m.focus, cuisine_generic: m.generic, osm_cuisine: x.cuisine ?? "",
    website: x.website ?? x["contact:website"] ?? x.url ?? "",
    phone: x.phone ?? x["contact:phone"] ?? "",
    opening_hours: x.opening_hours ?? "",
    diet_veg: yesNo(x["diet:vegetarian"]), diet_vegan: yesNo(x["diet:vegan"]),
    display_name: r.display_name ?? "",
  };
}

async function nominatim(params: Record<string, string>) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ format: "jsonv2", addressdetails: "1", extratags: "1", namedetails: "1", "accept-language": "de", ...params })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return await res.json();
}

async function search(q: string, near?: { lat: number; lng: number }) {
  const key = `search:${q.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const cached = await cacheGet(key, 7);
  if (cached) return cached;
  let rows = await nominatim({ q, limit: "10", countrycodes: "de,at,ch,nl,be,lu,fr,dk,pl,cz,it,es,hr,gr" });
  // deno-lint-ignore no-explicit-any
  let food = rows.map(toCandidate).filter((c: any) => c.is_food);
  if (!food.length) {
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max. 1 Anfrage/Sekunde
    rows = await nominatim({ q: `${q} restaurant`, limit: "10" });
    // deno-lint-ignore no-explicit-any
    food = rows.map(toCandidate).filter((c: any) => c.is_food);
  }
  let list = food.length ? food : rows.map(toCandidate).slice(0, 3);
  if (near) {
    const d = (c: { lat: number; lng: number }) => Math.hypot(c.lat - near.lat, (c.lng - near.lng) * Math.cos(near.lat * Math.PI / 180));
    list = list.sort((a: { lat: number; lng: number }, b: { lat: number; lng: number }) => d(a) - d(b));
  }
  const result = { candidates: list.slice(0, 5) };
  if (list.length) await cachePut(key, result);
  return result;
}

// ---------- Anreicherung per Claude + Websuche ----------
const ALLOWED = [...CUISINE_KEYS].join(", ");

async function enrich(input: { q?: string; candidate?: Record<string, unknown> }) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { enriched: false, reason: "no_key" };
  const c = input.candidate ?? {};
  const key = c.osm_id ? `enrich:${c.osm_type}:${c.osm_id}` : `enrich:q:${String(input.q ?? "").toLowerCase().trim()}`;
  const cached = await cacheGet(key, 30);
  if (cached) return cached;

  const known = c.name
    ? `Name: ${c.name}\nAdresse: ${c.address ?? ""}\nOSM-Küche: ${c.osm_cuisine ?? ""}\nWebseite: ${c.website ?? ""}`
    : `Suchanfrage des Nutzers: "${input.q}"`;
  const prompt = `Du recherchierst ein gastronomisches Lokal für eine private Restaurant-Wunschliste.

${known}

Finde per Websuche (Webseite, Speisekarte, Google-/Tripadvisor-Einträge, Presse) heraus:
- cuisines: Herkunft der Küche (Länderküche), 1–2 Werte, NUR aus dieser Liste: ${ALLOWED}
- category: eines von restaurant, imbiss, cafe, bar, foodtruck, eis, baeckerei, sonstiges
- focus: 0–3 Schwerpunkte auf Deutsch (z. B. "Pizza", "Tapas", "Grill/BBQ", "Fisch & Meeresfrüchte")
- price_level: 1 (günstig) bis 4 (teuer), null wenn unklar
- description: 1–2 neutrale Sätze auf Deutsch, was das Lokal ausmacht
- specialties: bis zu 5 typische Gerichte/Spezialitäten auf Deutsch
- website: offizielle Webseite oder ""
- name, address (Straße Nr., PLZ Ort), city: nur ausfüllen, wenn oben kein Name/keine Adresse steht
- source_urls: die URLs, auf die sich deine Angaben stützen

Erfinde nichts. Unbekanntes bleibt leer bzw. null. Antworte am Ende ausschließlich mit einem JSON-Objekt mit genau diesen Schlüsseln.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("Anthropic", res.status, await res.text());
    return { enriched: false, reason: "api_error" };
  }
  const msg = await res.json();
  // deno-lint-ignore no-explicit-any
  const text = (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) return { enriched: false, reason: "parse_error" };
  // deno-lint-ignore no-explicit-any
  let out: any;
  try { out = JSON.parse(text.slice(s, e + 1)); } catch { return { enriched: false, reason: "parse_error" }; }

  const result: Record<string, unknown> = {
    enriched: true,
    cuisines: (Array.isArray(out.cuisines) ? out.cuisines : []).filter((k: string) => CUISINE_KEYS.has(k)).slice(0, 3),
    category: ["restaurant","imbiss","cafe","bar","foodtruck","eis","baeckerei","sonstiges"].includes(out.category) ? out.category : null,
    focus: (Array.isArray(out.focus) ? out.focus : []).map(String).slice(0, 3),
    price_level: [1, 2, 3, 4].includes(out.price_level) ? out.price_level : null,
    description: String(out.description ?? "").slice(0, 1000),
    specialties: (Array.isArray(out.specialties) ? out.specialties : []).map(String).slice(0, 5),
    website: String(out.website ?? ""),
    source_urls: (Array.isArray(out.source_urls) ? out.source_urls : []).map(String).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 6),
  };

  // Kein OSM-Treffer: Adresse aus der Recherche geocodieren
  if (!c.name && out.address) {
    try {
      const rows = await nominatim({ q: String(out.address), limit: "1" });
      if (rows[0]) {
        result.name = String(out.name ?? input.q ?? "");
        result.address = String(out.address);
        result.city = String(out.city ?? "");
        result.lat = Number(rows[0].lat); result.lng = Number(rows[0].lon);
      }
    } catch (_) { /* ohne Koordinaten weiter */ }
  }
  await cachePut(key, result);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }
  try {
    if (body.action === "search") {
      const q = String(body.q ?? "").trim().slice(0, 120);
      if (q.length < 2) return json({ candidates: [] });
      return json(await search(q, body.near));
    }
    if (body.action === "enrich") return json(await enrich({ q: body.q, candidate: body.candidate }));
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Suche gerade nicht möglich" }, 502);
  }
});
