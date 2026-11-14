// FoodiSpots – Restaurant-Suche
//  action "search": Freitext (z. B. "delphi koblenz") -> Treffer aus OpenStreetMap (Nominatim, sonst Photon + OSM-API)
//  action "enrich": Treffer (oder nur Freitext) -> Küchenrichtung, Beschreibung, Preisniveau … per Claude + Websuche
// Secrets: ANTHROPIC_API_KEY (optional, ohne Key gibt es nur die OSM-Daten), ANTHROPIC_MODEL (optional)
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "FoodiSpots/2.0 (+https://foodispots.netlify.app; private Gruppen-App)";

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

// Nominatim sperrt Anfragen aus manchen Rechenzentren (403). Dann weichen wir für 6 h auf
// Photon (Suche) + OSM-API (Tags wie cuisine, opening_hours, website) aus – gleiches Datenformat.
let nominatimBlockedUntil = 0;
const FOOD_TAGS = ["amenity:restaurant", "amenity:fast_food", "amenity:cafe", "amenity:bar", "amenity:pub", "amenity:biergarten", "amenity:ice_cream", "amenity:food_court", "shop:bakery", "shop:pastry"];

async function nominatimDirect(params: Record<string, string>) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  const { lat: _lat, lon: _lon, ...rest } = params;
  for (const [k, v] of Object.entries({ format: "jsonv2", addressdetails: "1", extratags: "1", namedetails: "1", "accept-language": "de", ...rest })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw Object.assign(new Error(`Nominatim ${res.status}`), { status: res.status });
  return await res.json();
}

// deno-lint-ignore no-explicit-any
async function osmTags(rows: any[]) {
  const ids: Record<string, string[]> = { node: [], way: [], relation: [] };
  const food = rows.filter((r) => mapCategory(r.category, r.type));
  for (const r of (food.length ? food : rows.slice(0, 3))) if (ids[r.osm_type]) ids[r.osm_type].push(String(r.osm_id));
  const tags: Record<string, Record<string, string>> = {};
  await Promise.all(Object.entries(ids).filter(([, l]) => l.length).map(async ([t, l]) => {
    try {
      const res = await fetch(`https://api.openstreetmap.org/api/0.6/${t}s.json?${t}s=${l.join(",")}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      // deno-lint-ignore no-explicit-any
      for (const e of (await res.json()).elements ?? []) tags[`${e.type}:${e.id}`] = e.tags ?? {};
    } catch (_) { /* ohne Zusatz-Tags weiter */ }
  }));
  for (const r of rows) {
    const t = tags[`${r.osm_type}:${r.osm_id}`];
    if (t) { r.extratags = t; if (t.name) r.namedetails = { name: t.name }; }
  }
  return rows;
}

async function photon(params: Record<string, string>, foodOnly = false) {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", foodOnly ? params.q.replace(/\s+restaurant$/i, "") : params.q);
  u.searchParams.set("limit", String(Math.min(Number(params.limit ?? 10) * 2, 20)));
  u.searchParams.set("lang", "de");
  if (params.lat && params.lon) { u.searchParams.set("lat", params.lat); u.searchParams.set("lon", params.lon); }
  if (foodOnly) for (const t of FOOD_TAGS) u.searchParams.append("osm_tag", t);
  const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const cc = params.countrycodes ? new Set(params.countrycodes.split(",")) : null;
  const TYPES: Record<string, string> = { N: "node", W: "way", R: "relation" };
  // deno-lint-ignore no-explicit-any
  const rows = ((await res.json()).features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    return {
      lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0],
      osm_type: TYPES[p.osm_type] ?? p.osm_type, osm_id: p.osm_id,
      category: p.osm_key, type: p.osm_value, name: p.name ?? "",
      countrycode: String(p.countrycode ?? "").toLowerCase(),
      address: { road: p.street, house_number: p.housenumber, postcode: p.postcode, city: p.city ?? p.locality ?? p.district },
      display_name: [p.name, [p.street, p.housenumber].filter(Boolean).join(" "), p.city].filter(Boolean).join(", "),
    };
  // deno-lint-ignore no-explicit-any
  }).filter((r: any) => r.lat != null && (!cc || !r.countrycode || cc.has(r.countrycode))).slice(0, Number(params.limit ?? 10));
  return await osmTags(rows);
}

async function nominatim(params: Record<string, string>, foodOnly = false) {
  if (Date.now() > nominatimBlockedUntil) {
    try { return await nominatimDirect(params); }
    catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 403 || st === 429) nominatimBlockedUntil = Date.now() + 6 * 3600e3;
      console.warn(`Nominatim nicht nutzbar (${(e as Error).message}) – nehme Photon`);
    }
  }
  return await photon(params, foodOnly);
}

async function search(q: string, near?: { lat: number; lng: number }) {
  const key = `search:${q.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const cached = await cacheGet(key, 7);
  if (cached) return cached;
  const bias: Record<string, string> = near && isFinite(near.lat) && isFinite(near.lng) ? { lat: String(near.lat), lon: String(near.lng) } : {};
  let rows = await nominatim({ q, limit: "10", countrycodes: "de,at,ch,nl,be,lu,fr,dk,pl,cz,it,es,hr,gr", ...bias });
  // deno-lint-ignore no-explicit-any
  let food = rows.map(toCandidate).filter((c: any) => c.is_food);
  if (!food.length) {
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max. 1 Anfrage/Sekunde
    rows = await nominatim({ q: `${q} restaurant`, limit: "10", ...bias }, true);
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

// ---------- Geteilter Google-Maps-Link -> Spot ----------
// Wir lesen nur, was im Link (bzw. in seiner Weiterleitung) und im geteilten Text steht – keine Google-Seiten auslesen.
const GMAPS_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6})[^\s<>"']*/i;
const BROWSER_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const isGoogleHost = (h: string) => /(^|\.)(google\.[a-z.]{2,6}|goo\.gl)$/i.test(h);

async function expandLink(start: string) {
  let u = new URL(start);
  for (let i = 0; i < 6; i++) {
    if (!isGoogleHost(u.hostname)) break;
    if (/consent\.google\./i.test(u.hostname) && u.searchParams.get("continue")) { u = new URL(u.searchParams.get("continue")!); continue; }
    if (!/goo\.gl$/i.test(u.hostname)) break; // schon die lange Form
    const r = await fetch(u, { redirect: "manual", headers: { "User-Agent": BROWSER_UA, "Accept-Language": "de" }, signal: AbortSignal.timeout(6000) });
    await r.body?.cancel();
    const loc = r.headers.get("location");
    if (!loc || r.status < 300 || r.status > 399) break;
    u = new URL(loc, u);
  }
  return u;
}

function parseGoogleUrl(u: URL) {
  const out: { name?: string; lat?: number; lng?: number; query?: string } = {};
  const path = decodeURIComponent(u.pathname);
  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place) out.name = place[1].replace(/\+/g, " ").trim();
  const full = decodeURIComponent(u.href);
  const d = full.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  const at = full.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  const pair = (v: string | null) => v?.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? u.searchParams.get("destination");
  const ll = pair(q) ?? pair(u.searchParams.get("ll")) ?? pair(u.searchParams.get("center"));
  const m = d ?? ll ?? at;
  if (m) { out.lat = Number(m[1]); out.lng = Number(m[2]); }
  if (q && !pair(q)) out.query = q.replace(/\+/g, " ").trim();
  if (!out.name && out.query) out.name = out.query.split(",")[0].trim();
  if (out.lat != null && (Math.abs(out.lat) > 90 || Math.abs(out.lng!) > 180)) { delete out.lat; delete out.lng; }
  return out;
}

const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));

async function resolveLink(text: string) {
  const raw = String(text ?? "").slice(0, 2000);
  const link = raw.match(GMAPS_RE)?.[0] ?? null;
  const lines = raw.replace(GMAPS_RE, "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^https?:\/\//i.test(s));
  let textName = lines[0] ?? "", textAddr = lines.slice(1).find((l) => /\d/.test(l) && /,|\d{4,5}/.test(l)) ?? "";
  if (lines.length === 1 && textName.includes(",")) { const i = textName.indexOf(","); textAddr = textName.slice(i + 1).trim(); textName = textName.slice(0, i).trim(); }
  let info: ReturnType<typeof parseGoogleUrl> = {};
  if (link) {
    try { info = parseGoogleUrl(await expandLink(link)); } catch (e) { console.warn("Link nicht auflösbar", (e as Error).message); }
  }
  const name = (info.name || textName || "").slice(0, 120);
  const address = textAddr || (info.query && info.query.includes(",") ? info.query.split(",").slice(1).join(",").trim() : "");
  let pos = info.lat != null ? { lat: info.lat, lng: info.lng! } : null;
  if (!name && !pos) return { found: false, candidates: [] };

  // Lage aus der Adresse, falls der Link keine Koordinaten enthält
  if (!pos && (address || name)) {
    try {
      const rows = await photon({ q: [name, address].filter(Boolean).join(" "), limit: "3" });
      if (rows[0]) pos = { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
    } catch (_) { /* weiter ohne */ }
  }
  // Passende Lokale aus OpenStreetMap in der Nähe
  // deno-lint-ignore no-explicit-any
  let cands: any[] = [];
  if (name) {
    try {
      const near = pos ? { lat: String(pos.lat), lon: String(pos.lng) } : {};
      const rows = await photon({ q: name, limit: "10", ...near }, true);
      // deno-lint-ignore no-explicit-any
      cands = rows.map(toCandidate).filter((c: any) => c.is_food)
        // deno-lint-ignore no-explicit-any
        .map((c: any) => ({ ...c, distance_m: pos ? Math.round(metersBetween(pos, c)) : null }))
        // deno-lint-ignore no-explicit-any
        .filter((c: any) => !pos || c.distance_m <= 400)
        // deno-lint-ignore no-explicit-any
        .sort((a: any, b: any) => (a.distance_m ?? 0) - (b.distance_m ?? 0)).slice(0, 4);
    } catch (_) { /* weiter ohne */ }
  }
  const google = pos ? { name, lat: pos.lat, lng: pos.lng, address, city: (address.match(/\d{4,5}\s+([^,]+)/) || [])[1] ?? "",
    osm_type: null, osm_id: null, is_food: true, category: "restaurant", cuisines: [], focus: [], cuisine_generic: false, osm_cuisine: "",
    website: "", phone: "", opening_hours: "", diet_veg: null, diet_vegan: null, display_name: [name, address].filter(Boolean).join(", "), from_link: true } : null;
  return { found: true, name, address, lat: pos?.lat ?? null, lng: pos?.lng ?? null, link, candidates: cands, google };
}

// ---------- Vorschaubilder ----------
// Quellen: Foto am OSM-Eintrag (image / wikimedia_commons / wikidata) und Vorschaubild der Webseite des Lokals.
function safeRemote(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".supabase.co") || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[")) return null; // keine IP-Adressen
  return u;
}

async function commonsImage(file: string) {
  const title = "File:" + file.replace(/^(File|Datei):/i, "").trim();
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1200", titles: title })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  // deno-lint-ignore no-explicit-any
  const p: any = Object.values((await r.json()).query?.pages ?? {})[0];
  const ii = p?.imageinfo?.[0];
  if (!ii?.thumburl) return null;
  const strip = (s: string) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const artist = strip(ii.extmetadata?.Artist?.value).slice(0, 120);
  const lic = strip(ii.extmetadata?.LicenseShortName?.value).slice(0, 40);
  return { url: ii.thumburl, credit: ["Wikimedia Commons", artist, lic].filter(Boolean).join(" · "), source: ii.descriptionurl ?? ii.url, kind: "commons" };
}

async function wikidataImage(q: string) {
  if (!/^Q\d+$/.test(q)) return null;
  const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const file = (await r.json()).entities?.[q]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file ? await commonsImage(file) : null;
}

const SKIP_IMG = /logo|icon|favicon|sprite|lockup|badge|button|arrow|flag|pixel|spacer|avatar|payment|paypal|visa|social|facebook|instagram|tripadvisor|google|apple|whatsapp|placeholder|loader|banner-cookie|qr/i;

async function websiteImages(site: string) {
  const u = safeRemote(site);
  if (!u) return [];
  const r = await fetch(u, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html", "Accept-Language": "de" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "html")) { await r.body?.cancel(); return []; }
  const html = (await r.text()).slice(0, 600_000);
  const base = r.url || u.href;
  const found: string[] = [];
  const add = (v?: string | null) => {
    if (!v || v.startsWith("data:")) return;
    try {
      let abs = new URL(v.replace(/&amp;/g, "&").trim(), base).href;
      abs = abs.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, ""); // WordPress-Vorschau -> Original
      if (!found.includes(abs)) found.push(abs);
    } catch (_) { /* ungültig */ }
  };
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    if (/(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i.test(tag)) add(tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]);
  }
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src = tag.match(/\s(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src || !/\.(?:jpe?g|webp|png)(?:\?|$)/i.test(src) || SKIP_IMG.test(src) || SKIP_IMG.test(tag.match(/alt\s*=\s*["']([^"']*)/i)?.[1] ?? "")) continue;
    const w = Number(tag.match(/\swidth\s*=\s*["']?(\d+)/i)?.[1] ?? 0);
    if (w && w < 250) continue;
    add(src);
    if (found.length >= 10) break;
  }
  const host = new URL(base).hostname.replace(/^www\./, "");
  return found.filter((x) => safeRemote(x) && !SKIP_IMG.test(new URL(x).pathname)).slice(0, 6)
    .map((url) => ({ url, credit: `Webseite des Lokals (${host})`, source: base, kind: "website" }));
}

async function imageCandidates(c: { website?: string; osm_type?: string; osm_id?: number | string }) {
  const key = `images:${c.osm_type ?? ""}:${c.osm_id ?? ""}:${String(c.website ?? "").toLowerCase()}`;
  const cached = await cacheGet(key, 14);
  if (cached) return cached;
  // deno-lint-ignore no-explicit-any
  const images: any[] = [];
  let website = String(c.website ?? "");
  if (c.osm_type && c.osm_id && ["node", "way", "relation"].includes(c.osm_type)) {
    try {
      const [row] = await osmTags([{ osm_type: c.osm_type, osm_id: c.osm_id, category: "amenity", type: "restaurant" }]);
      const t = row?.extratags ?? {};
      if (!website) website = t.website ?? t["contact:website"] ?? "";
      const commons = t.wikimedia_commons?.startsWith("File:") ? t.wikimedia_commons : (t.image?.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/)?.[1] ?? null);
      if (commons) { const im = await commonsImage(decodeURIComponent(commons)).catch(() => null); if (im) images.push(im); }
      else if (t.image && safeRemote(t.image)) images.push({ url: t.image, credit: "Foto aus OpenStreetMap", source: t.image, kind: "osm" });
      if (!images.length && t.wikidata) { const im = await wikidataImage(t.wikidata).catch(() => null); if (im) images.push(im); }
    } catch (_) { /* weiter */ }
  }
  if (website) images.push(...await websiteImages(website).catch(() => []));
  const result = { images: images.slice(0, 8) };
  await cachePut(key, result);
  return result;
}

const IMG_TYPES = /^image\/(jpeg|png|webp|gif|avif)/i;
async function fetchImage(raw: string) {
  const u = safeRemote(raw);
  if (!u) return json({ error: "Bildadresse nicht erlaubt" }, 400);
  const r = await fetch(u, { headers: { "User-Agent": BROWSER_UA, Accept: "image/avif,image/webp,image/*", Referer: u.origin + "/" }, signal: AbortSignal.timeout(10000) });
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !IMG_TYPES.test(type) || !safeRemote(r.url || u.href)) { await r.body?.cancel(); return json({ error: "Kein Bild" }, 422); }
  const max = 8 * 1024 * 1024;
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > max) { await r.body?.cancel(); return json({ error: "Bild zu groß" }, 413); }
  const reader = r.body!.getReader(); const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return json({ error: "Bild zu groß" }, 413); }
    parts.push(value);
  }
  return new Response(new Blob(parts), { headers: { ...cors, "Content-Type": "application/octet-stream", "X-Image-Type": type.split(";")[0], "Cache-Control": "private, max-age=86400" } });
}

const MAX_PER_DAY = Number(Deno.env.get("LOOKUP_MAX_PER_DAY") ?? 200);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  // Nur angemeldete Nutzer (schützt den API-Key vor Missbrauch), mit Tageslimit
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = token ? await db.auth.getUser(token) : { data: null };
  const uid = who?.user?.id;
  if (!uid) return json({ error: "Bitte anmelden." }, 401);
  const { data: allowed } = await db.rpc("count_lookup", { uid, max_per_day: MAX_PER_DAY });
  if (allowed === false) return json({ error: "Tageslimit für die Suche erreicht – morgen geht es weiter." }, 429);
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
    if (body.action === "resolve_link") return json(await resolveLink(String(body.text ?? "")));
    if (body.action === "image_candidates") return json(await imageCandidates(body.spot ?? {}));
    if (body.action === "fetch_image") return await fetchImage(String(body.url ?? ""));
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Suche gerade nicht möglich" }, 502);
  }
});
