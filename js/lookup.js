// FoodiSpots – Restaurant-Suche über die Edge Function „lookup-spot“
//  search: Freitext (z. B. „delphi koblenz“) → Treffer aus OpenStreetMap
//  enrich: Länderküche, Beschreibung, Preisniveau, Spezialitäten per Claude-Websuche (nur mit API-Key im Supabase-Secret)
import { isNetErr, sb, state } from './core.js';
import { map } from './map.js';

async function call(body) {
  if (!navigator.onLine) return { error: 'offline' };
  try {
    const { data, error } = await sb.functions.invoke('lookup-spot', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
      return { error: isNetErr(error) ? 'offline' : msg };
    }
    return { data };
  } catch (e) { return { error: isNetErr(e) ? 'offline' : String(e.message || e) }; }
}

export function searchSpots(q) {
  const c = state.myPos || (map ? map.getCenter() : null);
  return call({ action: 'search', q, near: c ? { lat: c.lat, lng: c.lng } : undefined });
}
export const enrichCandidate = (candidate) => call({ action: 'enrich', candidate });
export const researchText = (q) => call({ action: 'enrich', q });

// Geteilte Google-Maps-Links (maps.app.goo.gl/…, google.com/maps/…)
export const GMAPS_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6})[^\s<>"']*/i;
export const resolveLink = (text) => call({ action: 'resolve_link', text });

// Vorschaubilder: Vorschläge (Webseite des Lokals, Wikimedia) und das Bild selbst (über den Server, wegen CORS)
export const imageCandidates = (spot) =>
  call({ action: 'image_candidates', spot: { website: spot.website || '', osm_type: spot.osm_type || null, osm_id: spot.osm_id || null } });
export async function fetchImage(url) {
  const { data, error } = await call({ action: 'fetch_image', url });
  if (error || !(data instanceof Blob) || data.size < 200) return null;
  return data;
}

// Ergänzt nur leere Felder; eine ermittelte Küche gilt als „vermutet“, bis jemand sie bestätigt
export function mergeEnrichment(spot, e, { weakCuisine = false } = {}) {
  if (!e?.enriched) return spot;
  const out = { ...spot };
  if ((weakCuisine || !out.cuisines?.length) && e.cuisines?.length) { out.cuisines = e.cuisines; out.cuisine_guessed = true; }
  if (e.category && !out._fromOsmFood) out.category = e.category;
  if (!out.focus?.length && e.focus?.length) out.focus = e.focus;
  if (!out.price_level && e.price_level) out.price_level = e.price_level;
  if (!out.description && e.description) out.description = e.description;
  if (!out.specialties?.length && e.specialties?.length) out.specialties = e.specialties;
  if (!out.website && e.website) out.website = e.website;
  out.source_urls = [...new Set([...(out.source_urls || []), ...(e.source_urls || [])])].slice(0, 8);
  return out;
}

// Treffer aus OpenStreetMap → Spot-Felder
export function candidateToSpot(c) {
  return {
    name: c.name || '', lat: c.lat, lng: c.lng, address: c.address || '', city: c.city || '',
    osm_type: c.osm_type || null, osm_id: c.osm_id || null,
    cuisines: c.cuisines || [], cuisine_guessed: false, category: c.category || 'restaurant', focus: c.focus || [],
    website: c.website || '', phone: c.phone || '', opening_hours: c.opening_hours || '',
    diet_veg: c.diet_veg ?? null, diet_vegan: c.diet_vegan ?? null,
    _fromOsmFood: !!c.is_food, _weakCuisine: !c.cuisines?.length || !!c.cuisine_generic,
  };
}
