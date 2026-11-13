/* FoodiSpots – Web-App (Vanilla JS, Supabase, Leaflet) */
(() => {
"use strict";

const CFG = window.FOODI_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "foodispots-auth" },
});
const BUCKET = "food-photos";

const CATEGORIES = {
  restaurant: "Restaurant", imbiss: "Imbiss", cafe: "Café", bar: "Bar/Kneipe",
  foodtruck: "Foodtruck", eis: "Eisdiele", baeckerei: "Bäckerei/Konditorei", sonstiges: "Sonstiges",
};
const CAT_EMOJI = { restaurant: "🍽️", imbiss: "🥙", cafe: "☕", bar: "🍻", foodtruck: "🚚", eis: "🍨", baeckerei: "🥐", sonstiges: "🍴" };
const SUB = [["food", "Essen"], ["service", "Service"], ["ambience", "Ambiente"], ["value", "Preis-Leistung"]];

const state = {
  session: null,
  me: null,            // { id, username, isSuper }
  groups: [],
  group: null,
  members: new Map(),  // user_id -> { username, role }
  cuisines: new Map(), // key -> { key, name_de, emoji, region, sort }
  spots: [],
  view: "map",
  filters: freshFilters(),
  myPos: null,
  channel: null,
};

function freshFilters() {
  return { status: "all", cuisines: new Set(), regions: new Set(), prices: new Set(), minRating: 0, veg: false, vegan: false, notMine: false, category: "" };
}

// ---------- Helfer ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(u.startsWith("http") ? u : `https://${u}`); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }) : "";
const fmtNum = (n, d = 1) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPrice = (c) => c == null ? "" : (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const euro = (n) => n ? "€".repeat(n) : "";
const today = () => new Date().toISOString().slice(0, 10);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const loginEmail = (name) => `${name.trim().toLowerCase().replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")}@nutzer.foodispots.invalid`;
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const memberName = (uid) => state.members.get(uid)?.username ?? "Ehemaliges Mitglied";
const errMsg = (e) => (e?.message ?? String(e)).replace(/^.*?:\s(?=[A-ZÄÖÜ])/, "");

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

function stars(n, max = 5) {
  if (n == null) return "";
  const r = Math.round(n);
  return `<span class="stars" aria-label="${fmtNum(n, n % 1 ? 1 : 0)} von 5 Sternen">${"★".repeat(r)}<span class="off">${"★".repeat(max - r)}</span></span>`;
}

// Farbskala 1 (rot) → 5 (grün)
const STOPS = [[1, [192, 57, 43]], [2, [230, 126, 34]], [3, [241, 196, 15]], [4, [124, 179, 66]], [5, [46, 125, 50]]];
function ratingColor(v) {
  if (v == null) return "#a8a29a";
  v = Math.max(1, Math.min(5, Number(v)));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
    if (v <= b) { const t = (v - a) / (b - a); return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * t)).join(",")})`; }
  }
  return "rgb(46,125,50)";
}

function spotEmoji(s) {
  const c = (s.cuisines ?? []).map((k) => state.cuisines.get(k)).find(Boolean);
  return c?.emoji ?? CAT_EMOJI[s.category] ?? "🍽️";
}
function cuisineNames(keys) { return (keys ?? []).map((k) => state.cuisines.get(k)?.name_de ?? k).join(" · "); }
function cuisineLabels(keys) { return (keys ?? []).map((k) => { const c = state.cuisines.get(k); return c ? `${c.emoji} ${c.name_de}` : k; }).join(" · "); }
function isRated(s) { return (s.rating_count ?? 0) > 0; }

async function fnError(error) {
  try { const j = await error.context.json(); return j.error ?? error.message; } catch { return error.message; }
}

// ---------- Signierte Foto-URLs ----------
const urlCache = new Map();
async function signUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > Date.now())))];
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(chunk, 3600 * 6);
    (data ?? []).forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3600 * 5 * 1000 }));
  }
}
const photoUrl = (p) => (p ? urlCache.get(p)?.url ?? "" : "");

// ---------- Bilder verkleinern (entfernt dabei EXIF/Standort) ----------
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
async function resize(src, max, quality) {
  const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  let blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  return blob;
}
async function processPhoto(file) {
  const bmp = await loadBitmap(file);
  const [full, thumb] = await Promise.all([resize(bmp, 1600, 0.82), resize(bmp, 420, 0.75)]);
  return { full, thumb };
}

// =====================================================================
// Start & Anmeldung
// =====================================================================
function show(screen) {
  for (const id of ["auth", "onboard", "app"]) $(`#screen-${id}`).hidden = id !== screen;
}

const params = new URLSearchParams(location.search);
const linkCode = (params.get("code") ?? "").trim().toUpperCase();

async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((ev, session) => {
    state.session = session;
    if (ev === "SIGNED_OUT") { teardown(); showAuth(); }
  });
  if (!state.session) return showAuth();
  await afterLogin();
}

function showAuth() {
  show("auth");
  if (linkCode) { setAuthTab("signup"); $("#auth-form").invite_code.value = linkCode; }
}

let authMode = "login";
function setAuthTab(mode) {
  authMode = mode;
  $$("[data-auth-tab]").forEach((b) => b.classList.toggle("on", b.dataset.authTab === mode));
  $$("[data-signup-only]").forEach((el) => (el.hidden = mode !== "signup"));
  $("#auth-submit").textContent = mode === "signup" ? "Konto anlegen" : "Anmelden";
  $("#auth-form").password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#auth-error").hidden = true;
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const f = e.target, btn = $("#auth-submit"), errEl = $("#auth-error");
  const username = f.username.value.trim(), password = f.password.value;
  errEl.hidden = true; btn.disabled = true;
  try {
    if (authMode === "signup") {
      const { error } = await sb.functions.invoke("signup", { body: { username, password, invite_code: f.invite_code.value } });
      if (error) throw new Error(await fnError(error));
    }
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(username), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? "Name oder Passwort falsch" : error.message);
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    await afterLogin();
  } catch (err) {
    errEl.textContent = errMsg(err); errEl.hidden = false;
  } finally { btn.disabled = false; }
}

async function afterLogin() {
  const uid = state.session.user.id;
  const [{ data: prof }, { data: sup }, { data: cuis }] = await Promise.all([
    sb.from("profiles").select("id, username").eq("id", uid).maybeSingle(),
    sb.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle(),
    sb.from("cuisines").select("*").order("sort"),
  ]);
  state.me = { id: uid, username: prof?.username ?? "", isSuper: !!sup };
  state.cuisines = new Map((cuis ?? []).map((c) => [c.key, c]));
  if (state.cuisines.size) localStorage.setItem("fs-cuisines", JSON.stringify(cuis));
  else { try { JSON.parse(localStorage.getItem("fs-cuisines") ?? "[]").forEach((c) => state.cuisines.set(c.key, c)); } catch {} }

  if (linkCode) {
    try { await sb.rpc("join_group", { code: linkCode }); toast("Gruppe beigetreten 🎉"); } catch {}
    history.replaceState(null, "", location.pathname);
  }
  await loadGroups();
}

async function loadGroups(preferId) {
  const { data, error } = await sb.from("group_members")
    .select("role, groups(id, name, invite_code, created_by)")
    .eq("user_id", state.me.id);
  if (error) { toast("Laden fehlgeschlagen"); return; }
  state.groups = (data ?? []).filter((r) => r.groups).map((r) => ({ ...r.groups, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  if (!state.groups.length) {
    $("#onboard-name").textContent = state.me.username;
    return show("onboard");
  }
  const want = preferId ?? localStorage.getItem("fs-group");
  await selectGroup(state.groups.find((g) => g.id === want) ?? state.groups[0]);
}

async function selectGroup(g) {
  state.group = g;
  localStorage.setItem("fs-group", g.id);
  $("#group-name").textContent = g.name;
  show("app");
  initMap();
  await Promise.all([loadMembers(), loadSpots()]);
  subscribe();
}

function teardown() {
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = null; state.group = null; state.spots = []; closeSheet();
}

async function loadMembers() {
  const { data: ms } = await sb.from("group_members").select("user_id, role, joined_at").eq("group_id", state.group.id);
  const ids = (ms ?? []).map((m) => m.user_id);
  const { data: ps } = ids.length ? await sb.from("profiles").select("id, username").in("id", ids) : { data: [] };
  const names = new Map((ps ?? []).map((p) => [p.id, p.username]));
  state.members = new Map((ms ?? []).map((m) => [m.user_id, { username: names.get(m.user_id) ?? "?", role: m.role, joined_at: m.joined_at }]));
}

async function loadSpots() {
  const gid = state.group.id;
  const { data, error } = await sb.from("spot_summary").select("*").eq("group_id", gid);
  if (error) {
    try { state.spots = JSON.parse(localStorage.getItem(`fs-spots-${gid}`) ?? "[]"); } catch { state.spots = []; }
    $("#offline-banner").hidden = navigator.onLine;
  } else {
    state.spots = data ?? [];
    $("#offline-banner").hidden = true;
    try { localStorage.setItem(`fs-spots-${gid}`, JSON.stringify(state.spots)); } catch {}
    await signUrls(state.spots.map((s) => s.cover_thumb));
  }
  renderAll();
}

const reloadSoon = debounce(async () => {
  await loadSpots();
  const open = $("#sheet").dataset.spot;
  if (open && $("#sheet").dataset.kind === "detail") openDetail(open, true);
}, 600);

function subscribe() {
  if (state.channel) sb.removeChannel(state.channel);
  const gid = state.group.id;
  const ch = sb.channel(`group-${gid}`);
  for (const t of ["spots", "ratings", "dishes", "spot_wants"]) {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `group_id=eq.${gid}` }, reloadSoon);
  }
  state.channel = ch.subscribe();
}

// =====================================================================
// Karte
// =====================================================================
let map, markerLayer, didFit = false;
function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([50.36, 7.59], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20, subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function markerIcon(s) {
  const rated = isRated(s);
  const n = !rated && s.want_count > 1 ? `<span class="n">${s.want_count}</span>` : "";
  return L.divIcon({
    className: "", iconSize: [40, 48], iconAnchor: [20, 46], popupAnchor: [0, -40],
    html: `<div class="fs-pin ${rated ? "" : "wish"}" style="--c:${ratingColor(s.avg_overall)}"><span class="b"></span><span class="e">${esc(spotEmoji(s))}</span>${n}</div>`,
  });
}

function renderMap() {
  if (!map) return;
  markerLayer.clearLayers();
  const list = filtered();
  for (const s of list) {
    const m = L.marker([s.lat, s.lng], { icon: markerIcon(s), title: s.name, zIndexOffset: isRated(s) ? 100 : 0 });
    m.on("click", () => openDetail(s.id));
    m.bindTooltip(`${s.name}${isRated(s) ? ` · ${fmtNum(s.avg_overall)} ★` : ""}`, { direction: "top", offset: [0, -42] });
    markerLayer.addLayer(m);
  }
  if (!didFit && state.spots.length) {
    didFit = true;
    const b = L.latLngBounds(state.spots.map((s) => [s.lat, s.lng]));
    map.fitBounds(b.pad(0.2), { maxZoom: 15 });
  }
}

function locate() {
  if (!navigator.geolocation) return toast("Standort nicht verfügbar");
  navigator.geolocation.getCurrentPosition((p) => {
    state.myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
    map.setView([state.myPos.lat, state.myPos.lng], 15);
    if (locate.dot) locate.dot.remove();
    locate.dot = L.circleMarker([state.myPos.lat, state.myPos.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2a6fdb", fillOpacity: 1 }).addTo(map);
    if (state.view === "list") renderList();
  }, () => toast("Standort nicht freigegeben"), { enableHighAccuracy: true, timeout: 10000 });
}

// =====================================================================
// Filter
// =====================================================================
function filtered() {
  const f = state.filters;
  return state.spots.filter((s) => {
    if (f.status === "wish" && isRated(s)) return false;
    if (f.status === "visited" && !isRated(s)) return false;
    if (f.cuisines.size && !(s.cuisines ?? []).some((k) => f.cuisines.has(k))) return false;
    if (f.regions.size && !(s.cuisines ?? []).some((k) => f.regions.has(state.cuisines.get(k)?.region))) return false;
    if (f.prices.size && !f.prices.has(s.price_level)) return false;
    if (f.minRating && !(s.avg_overall >= f.minRating)) return false;
    if (f.veg && !s.diet_veg && !s.diet_vegan) return false;
    if (f.vegan && !s.diet_vegan) return false;
    if (f.notMine && s.my_rating != null) return false;
    if (f.category && s.category !== f.category) return false;
    return true;
  });
}
function filterCount() {
  const f = state.filters;
  return (f.status !== "all") + (f.cuisines.size > 0) + (f.regions.size > 0) + (f.prices.size > 0) + (f.minRating > 0) + f.veg + f.vegan + f.notMine + (!!f.category);
}

function openFilter() {
  const f = state.filters;
  const used = new Set(state.spots.flatMap((s) => s.cuisines ?? []));
  const cuisinesUsed = [...state.cuisines.values()].filter((c) => used.has(c.key));
  const regions = [...new Set(cuisinesUsed.map((c) => c.region))];
  const body = `
    <h2 class="h2 sheet-title">Filter</h2>
    <div class="stack">
      <div class="seg" id="f-status">
        ${[["all", "Alle"], ["wish", "Wunschliste"], ["visited", "Besucht"]].map(([k, l]) => `<button type="button" data-v="${k}" class="${f.status === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div><div class="h3">Länderküche</div>
        <div class="chips" id="f-cuisines">${cuisinesUsed.length ? cuisinesUsed.map((c) => `<button type="button" class="chip ${f.cuisines.has(c.key) ? "on" : ""}" data-v="${c.key}">${c.emoji} ${esc(c.name_de)}</button>`).join("") : '<span class="muted small">Noch keine Küchen eingetragen.</span>'}</div>
      </div>
      ${regions.length > 1 ? `<div><div class="h3">Region</div><div class="chips" id="f-regions">${regions.map((r) => `<button type="button" class="chip ${f.regions.has(r) ? "on" : ""}" data-v="${esc(r)}">${esc(r)}</button>`).join("")}</div></div>` : ""}
      <div><div class="h3">Preis</div><div class="price-seg" id="f-prices">${[1, 2, 3, 4].map((p) => `<button type="button" data-v="${p}" class="${f.prices.has(p) ? "on" : ""}">${euro(p)}</button>`).join("")}</div></div>
      <div><div class="h3">Mindestnote</div><div class="seg" id="f-min">${[[0, "egal"], [3, "3+"], [4, "4+"], [4.5, "4,5+"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${f.minRating === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <label>Art<select id="f-cat"><option value="">Alle</option>${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}" ${f.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="chips">
        <button type="button" class="chip ${f.veg ? "on" : ""}" id="f-veg">🥦 vegetarisch</button>
        <button type="button" class="chip ${f.vegan ? "on" : ""}" id="f-vegan">🌱 vegan</button>
        <button type="button" class="chip ${f.notMine ? "on" : ""}" id="f-notmine">Noch nicht von mir bewertet</button>
      </div>
      <div class="row">
        <button class="btn btn-ghost" type="button" id="f-reset">Zurücksetzen</button>
        <button class="btn btn-primary" style="flex:1" type="button" data-action="close-sheet" id="f-done">Fertig</button>
      </div>
    </div>`;
  openSheet(body, "filter");
  const sb_ = $("#sheet-body");
  const apply = () => { renderAll(); const n = filtered().length; $("#f-done").textContent = `${n} Spot${n === 1 ? "" : "s"} anzeigen`; };
  const single = (id, key, cast) => sb_.querySelector(id)?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    f[key] = cast(b.dataset.v); $$("button", b.parentElement).forEach((x) => x.classList.toggle("on", x === b)); apply();
  });
  const multi = (id, set, cast = (v) => v) => sb_.querySelector(id)?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    const v = cast(b.dataset.v); set.has(v) ? set.delete(v) : set.add(v); b.classList.toggle("on"); apply();
  });
  single("#f-status", "status", String);
  single("#f-min", "minRating", Number);
  multi("#f-cuisines", f.cuisines);
  multi("#f-regions", f.regions);
  multi("#f-prices", f.prices, Number);
  $("#f-cat").addEventListener("change", (e) => { f.category = e.target.value; apply(); });
  for (const [id, key] of [["#f-veg", "veg"], ["#f-vegan", "vegan"], ["#f-notmine", "notMine"]]) {
    $(id).addEventListener("click", (e) => { f[key] = !f[key]; e.currentTarget.classList.toggle("on", f[key]); apply(); });
  }
  $("#f-reset").addEventListener("click", () => { state.filters = freshFilters(); renderAll(); openFilter(); });
  apply();
}

// =====================================================================
// Liste & Länderküchen
// =====================================================================
function distKm(s) {
  const p = state.myPos ?? (map ? map.getCenter() : null);
  if (!p) return null;
  const R = 6371, dLat = (s.lat - p.lat) * Math.PI / 180, dLng = (s.lng - p.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function spotCardHtml(s) {
  const rated = isRated(s), thumb = photoUrl(s.cover_thumb);
  const d = distKm(s);
  return `<button type="button" class="spot-card" data-open="${s.id}">
    <span class="thumb ${rated ? "" : "wish"}" style="${thumb ? `background-image:url('${esc(thumb)}')` : ""}">${thumb ? "" : esc(spotEmoji(s))}</span>
    <span class="meta">
      <span class="t" style="display:block">${esc(s.name)}</span>
      <span class="s" style="display:block">${esc([cuisineNames(s.cuisines) || CATEGORIES[s.category], euro(s.price_level), s.city].filter(Boolean).join(" · "))}</span>
      <span class="row" style="margin-top:4px;gap:6px">
        ${rated ? `<span class="score" style="background:${ratingColor(s.avg_overall)}">${fmtNum(s.avg_overall)} ★</span><span class="muted small">${s.rating_count} Bewertung${s.rating_count === 1 ? "" : "en"}</span>`
               : `<span class="score wish">Wunschliste</span>${s.want_count ? `<span class="muted small">🙋 ${s.want_count}</span>` : ""}`}
        ${d != null ? `<span class="muted small">· ${d < 1 ? `${Math.round(d * 1000)} m` : `${fmtNum(d, d < 10 ? 1 : 0)} km`}</span>` : ""}
      </span>
    </span>
  </button>`;
}

function renderList() {
  const q = norm($("#list-search").value);
  const sort = $("#list-sort").value;
  let list = filtered().filter((s) => !q || norm(`${s.name} ${s.city} ${cuisineNames(s.cuisines)} ${(s.focus ?? []).join(" ")} ${(s.specialties ?? []).join(" ")}`).includes(q));
  const by = {
    new: (a, b) => b.created_at.localeCompare(a.created_at),
    want: (a, b) => b.want_count - a.want_count || b.created_at.localeCompare(a.created_at),
    rating: (a, b) => (b.avg_overall ?? -1) - (a.avg_overall ?? -1),
    dist: (a, b) => (distKm(a) ?? 0) - (distKm(b) ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, "de"),
  }[sort];
  list = list.sort(by);
  $("#list-body").innerHTML = list.length ? list.map(spotCardHtml).join("")
    : state.spots.length ? `<div class="empty"><b>Nichts gefunden</b>Filter oder Suche anpassen.</div>`
    : `<div class="empty"><b>Noch keine Spots</b>Tippe auf „+ Spot eintragen“ und schreib z. B. „delphi koblenz“.</div>`;
}

function renderStats() {
  const all = [...state.cuisines.values()].filter((c) => !["international", "fusion"].includes(c.key));
  const tried = new Map(), wished = new Map();
  for (const s of state.spots) for (const k of s.cuisines ?? []) {
    const m = isRated(s) ? tried : wished; m.set(k, (m.get(k) ?? 0) + 1);
  }
  const triedCount = all.filter((c) => tried.has(c.key)).length;
  const regions = [...new Set(all.map((c) => c.region))];
  const ratedSpots = state.spots.filter(isRated).sort((a, b) => b.avg_overall - a.avg_overall);
  $("#stats-body").innerHTML = `
    <div class="card">
      <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">Länderküchen probiert</div>
      <div class="row" style="align-items:baseline"><span class="big-num">${triedCount}</span><span class="lead">von ${all.length}</span></div>
      <div class="progress"><i style="width:${(triedCount / all.length) * 100}%"></i></div>
      <p class="muted small" style="margin:8px 0 0">${state.spots.filter(isRated).length} besucht · ${state.spots.filter((s) => !isRated(s)).length} auf der Wunschliste</p>
    </div>
    ${ratedSpots.length ? `<div class="card"><div class="h3">Eure Top-Spots</div><div class="stack">${ratedSpots.slice(0, 3).map(spotCardHtml).join("")}</div></div>` : ""}
    ${regions.map((r) => `<div><div class="h3">${esc(r)}</div><div class="cuisine-grid">${all.filter((c) => c.region === r).map((c) => {
      const t = tried.get(c.key), w = wished.get(c.key);
      return `<button type="button" class="cg ${t ? "" : w ? "wish" : "todo"}" data-cuisine="${c.key}"><span class="f">${c.emoji}</span>${esc(c.name_de)}<small>${t ? `✓ ${t} besucht` : w ? `${w} auf Liste` : "noch offen"}</small></button>`;
    }).join("")}</div></div>`).join("")}
  `;
}

function renderAll() {
  const n = filterCount(); const b = $("#filter-count"); b.hidden = !n; b.textContent = n;
  renderMap();
  if (state.view === "list") renderList();
  if (state.view === "stats") renderStats();
}

function setView(v) {
  state.view = v;
  $$("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  for (const id of ["map", "list", "stats"]) $(`#view-${id}`).hidden = id !== v;
  if (v === "map" && map) setTimeout(() => map.invalidateSize(), 50);
  renderAll();
}

// =====================================================================
// Sheet
// =====================================================================
let sheetCleanup = null;
function openSheet(html, kind, spotId) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  const sh = $("#sheet");
  sh.dataset.kind = kind ?? ""; sh.dataset.spot = spotId ?? "";
  // frisches Element, damit keine Event-Listener vom vorigen Inhalt übrig bleiben
  const old = $("#sheet-body"), fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  fresh.innerHTML = html;
  fresh.scrollTop = 0;
  sh.hidden = false; $("#sheet-backdrop").hidden = false;
}
function closeSheet() {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  const sh = $("#sheet"); sh.hidden = true; sh.dataset.kind = ""; sh.dataset.spot = "";
  $("#sheet-backdrop").hidden = true; $("#sheet-body").innerHTML = "";
}

// =====================================================================
// Spot eintragen
// =====================================================================
function openAdd(prefill = "") {
  openSheet(`
    <h2 class="h2 sheet-title">Spot eintragen</h2>
    <form id="add-search" class="row-form">
      <input name="q" required placeholder="z. B. delphi koblenz" value="${esc(prefill)}" autocomplete="off" enterkeyhint="search">
      <button class="btn btn-primary" type="submit">Suchen</button>
    </form>
    <p class="muted small" style="margin:-4px 0 0">Name + Ort reicht. Wir suchen Adresse, Küchenrichtung, Preisniveau und eine kurze Beschreibung raus.</p>
    <div id="add-results" class="stack"></div>
    <button class="btn btn-ghost" type="button" id="add-manual">Ohne Suche manuell eintragen</button>
  `, "add");
  const form = $("#add-search");
  form.q.focus();
  form.addEventListener("submit", (e) => { e.preventDefault(); runSearch(form.q.value.trim()); });
  $("#add-manual").addEventListener("click", () => openSpotForm({ name: form.q.value.trim(), lat: map.getCenter().lat, lng: map.getCenter().lng }, { manual: true }));
  if (prefill) runSearch(prefill);
}

async function runSearch(q) {
  if (q.length < 2) return;
  const box = $("#add-results");
  box.innerHTML = `<div class="hint row"><span class="spinner"></span> Suche „${esc(q)}“ …</div>`;
  const c = map.getCenter();
  const { data, error } = await sb.functions.invoke("lookup-spot", { body: { action: "search", q, near: state.myPos ?? { lat: c.lat, lng: c.lng } } });
  if (!$("#add-results")) return;
  if (error) { box.innerHTML = `<p class="form-error">${esc(await fnError(error))}</p>`; return; }
  const cands = data?.candidates ?? [];
  box.innerHTML = (cands.length ? `<div class="muted small" style="font-weight:700">Welcher ist es?</div>` +
    cands.map((x, i) => `<button type="button" class="cand" data-i="${i}">
      <b>${esc(x.cuisines?.length ? `${spotEmoji(x)} ` : `${CAT_EMOJI[x.category] ?? "📍"} `)}${esc(x.name)}</b>
      <span>${esc(x.address || x.display_name)}</span>
      <span>${esc([x.is_food ? CATEGORIES[x.category] : "kein Lokal – nur Adresse", cuisineNames(x.cuisines), ...(x.focus ?? [])].filter(Boolean).join(" · "))}</span>
    </button>`).join("")
    : `<div class="hint">Auf OpenStreetMap nichts gefunden.</div>`) +
    `<button type="button" class="btn" id="add-ai">🔎 Im Web recherchieren lassen</button>`;
  $$(".cand", box).forEach((b) => b.addEventListener("click", () => {
    const cand = cands[+b.dataset.i];
    openSpotForm(cand, { enrich: true });
  }));
  $("#add-ai").addEventListener("click", () => researchOnly(q));
}

async function researchOnly(q) {
  const box = $("#add-results");
  box.innerHTML = `<div class="hint row"><span class="spinner"></span> Recherchiere „${esc(q)}“ im Web …</div>`;
  const { data, error } = await sb.functions.invoke("lookup-spot", { body: { action: "enrich", q } });
  if (!$("#add-results")) return;
  if (error || !data?.enriched) {
    box.innerHTML = `<div class="hint warn">${data?.reason === "no_key" ? "Die Web-Recherche ist noch nicht eingerichtet (API-Key fehlt)." : "Web-Recherche hat nichts ergeben."} Du kannst den Spot manuell eintragen.</div>`;
    return;
  }
  const c = map.getCenter();
  openSpotForm({ name: data.name || q, lat: data.lat ?? c.lat, lng: data.lng ?? c.lng, address: data.address ?? "", city: data.city ?? "" },
    { enrichedData: data, manual: data.lat == null });
}

function mergeEnrichment(spot, e) {
  if (!e?.enriched) return spot;
  const out = { ...spot };
  const weak = !out.cuisines?.length || out.cuisine_generic;
  if (weak && e.cuisines?.length) { out.cuisines = e.cuisines; out.cuisine_guessed = true; }
  if (e.category && !out.is_food) out.category = e.category;
  if (!out.focus?.length && e.focus?.length) out.focus = e.focus;
  if (!out.price_level && e.price_level) out.price_level = e.price_level;
  if (!out.description && e.description) out.description = e.description;
  if (!out.specialties?.length && e.specialties?.length) out.specialties = e.specialties;
  if (!out.website && e.website) out.website = e.website;
  out.source_urls = [...new Set([...(out.source_urls ?? []), ...(e.source_urls ?? [])])];
  return out;
}

function findDuplicate(s, ignoreId) {
  const n = norm(s.name);
  return state.spots.find((x) => x.id !== ignoreId && (
    (s.osm_id && x.osm_id === s.osm_id && x.osm_type === s.osm_type) ||
    (n && haversine(x, s) < 0.03 && (norm(x.name).includes(n) || n.includes(norm(x.name))))
  ));
}
function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Formular für neuen oder bestehenden Spot
function openSpotForm(input, opts = {}) {
  const editing = !!input.id;
  let s = {
    name: "", lat: 50.36, lng: 7.59, address: "", city: "", cuisines: [], cuisine_guessed: false, category: "restaurant",
    focus: [], price_level: null, description: "", specialties: [], website: "", phone: "", opening_hours: "",
    diet_veg: null, diet_vegan: null, source_urls: [], notes: "", osm_type: null, osm_id: null, ...input,
  };
  if (opts.enrichedData) s = mergeEnrichment(s, opts.enrichedData);
  const dup = !editing && findDuplicate(s);

  openSheet(`
    <h2 class="h2 sheet-title">${editing ? "Spot bearbeiten" : "Neuer Spot"}</h2>
    ${dup ? `<div class="hint warn">„${esc(dup.name)}“ steht schon auf eurer Liste. <button type="button" class="btn btn-sm" id="sf-dup">Ansehen</button></div>` : ""}
    <div id="sf-enrich"></div>
    <form id="spot-form" class="stack">
      <label>Name<input name="name" required maxlength="120" value="${esc(s.name)}"></label>
      <label>Adresse<input name="address" value="${esc(s.address)}" placeholder="Straße, PLZ Ort"></label>
      <div>
        <div class="row between"><span class="h3" style="margin:0">Länderküche</span><span id="sf-guess"></span></div>
        <div class="chips" id="sf-cuisines" style="margin-top:8px"></div>
        <div id="sf-picker" class="cuisine-picker" hidden style="margin-top:8px"></div>
      </div>
      <div class="grid2">
        <label>Art<select name="category">${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}" ${s.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Schwerpunkt<input name="focus" value="${esc((s.focus ?? []).join(", "))}" placeholder="z. B. Tapas, Grill"></label>
      </div>
      <div><div class="h3">Preisniveau</div><div class="price-seg" id="sf-price">${[1, 2, 3, 4].map((p) => `<button type="button" data-v="${p}" class="${s.price_level === p ? "on" : ""}">${euro(p)}</button>`).join("")}</div></div>
      <label>Beschreibung<textarea name="description" maxlength="1000" placeholder="Was macht den Laden aus?">${esc(s.description)}</textarea></label>
      <label>Spezialitäten<input name="specialties" value="${esc((s.specialties ?? []).join(", "))}" placeholder="kommagetrennt"></label>
      <div class="chips">
        <label class="chip"><input type="checkbox" name="diet_veg" ${s.diet_veg ? "checked" : ""}> 🥦 vegetarische Auswahl</label>
        <label class="chip"><input type="checkbox" name="diet_vegan" ${s.diet_vegan ? "checked" : ""}> 🌱 vegane Auswahl</label>
      </div>
      <div class="grid2">
        <label>Webseite<input name="website" inputmode="url" value="${esc(s.website)}"></label>
        <label>Telefon<input name="phone" inputmode="tel" value="${esc(s.phone)}"></label>
      </div>
      <label>Öffnungszeiten<input name="opening_hours" value="${esc(s.opening_hours)}" placeholder="z. B. Mo-Sa 17:00-23:00"></label>
      <label>Notiz<textarea name="notes" maxlength="2000" placeholder="Von wem empfohlen? Was sollte man bestellen?">${esc(s.notes)}</textarea></label>
      <div>
        <div class="h3">Position <span class="muted small" style="font-weight:600">– Marker verschieben, falls nötig</span></div>
        <div id="sf-map" class="mini-map"></div>
      </div>
      <div id="sf-sources"></div>
      <p class="form-error" id="sf-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit" id="sf-save">${editing ? "Speichern" : "Auf die Wunschliste"}</button>
    </form>
  `, "form", input.id);

  const form = $("#spot-form");
  if (dup) $("#sf-dup").addEventListener("click", () => openDetail(dup.id));

  // Küchen-Auswahl
  const renderCuisines = () => {
    $("#sf-cuisines").innerHTML = s.cuisines.map((k) => {
      const c = state.cuisines.get(k);
      return `<button type="button" class="chip on" data-rm="${k}">${c ? `${c.emoji} ${esc(c.name_de)}` : esc(k)}<span class="x">✕</span></button>`;
    }).join("") + `<button type="button" class="chip" id="sf-add-c">+ Küche</button>`;
    $("#sf-guess").innerHTML = s.cuisine_guessed && s.cuisines.length
      ? `<span class="tag guess">vermutet</span> <button type="button" class="btn btn-sm" id="sf-confirm">Stimmt</button>` : "";
    $("#sf-confirm")?.addEventListener("click", () => { s.cuisine_guessed = false; renderCuisines(); });
  };
  $("#sf-cuisines").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { s.cuisines = s.cuisines.filter((k) => k !== rm.dataset.rm); s.cuisine_guessed = false; renderCuisines(); return; }
    if (e.target.closest("#sf-add-c")) {
      const p = $("#sf-picker"); p.hidden = !p.hidden;
      if (!p.hidden) {
        const regions = [...new Set([...state.cuisines.values()].map((c) => c.region))];
        p.innerHTML = regions.map((r) => `<div><h4>${esc(r)}</h4><div class="chips" style="margin-top:6px">${[...state.cuisines.values()].filter((c) => c.region === r)
          .map((c) => `<button type="button" class="chip ${s.cuisines.includes(c.key) ? "on" : ""}" data-pick="${c.key}">${c.emoji} ${esc(c.name_de)}</button>`).join("")}</div></div>`).join("");
      }
    }
  });
  $("#sf-picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    const k = b.dataset.pick;
    s.cuisines = s.cuisines.includes(k) ? s.cuisines.filter((x) => x !== k) : [...s.cuisines, k].slice(0, 3);
    s.cuisine_guessed = false; b.classList.toggle("on", s.cuisines.includes(k)); renderCuisines();
  });
  renderCuisines();

  $("#sf-price").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    const v = +b.dataset.v; s.price_level = s.price_level === v ? null : v;
    $$("button", b.parentElement).forEach((x) => x.classList.toggle("on", +x.dataset.v === s.price_level));
  });

  const renderSources = () => {
    const urls = (s.source_urls ?? []).map(safeUrl).filter(Boolean);
    $("#sf-sources").innerHTML = urls.length ? `<div class="muted small"><b>Quellen:</b> ${urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(", ")}</div>` : "";
  };
  renderSources();

  // Mini-Karte
  const mm = L.map("sf-map", { zoomControl: false, attributionControl: false }).setView([s.lat, s.lng], opts.manual ? 13 : 17);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 20 }).addTo(mm);
  const mk = L.marker([s.lat, s.lng], { draggable: true }).addTo(mm);
  mk.on("dragend", () => { const p = mk.getLatLng(); s.lat = p.lat; s.lng = p.lng; });
  mm.on("click", (e) => { mk.setLatLng(e.latlng); s.lat = e.latlng.lat; s.lng = e.latlng.lng; });
  setTimeout(() => mm.invalidateSize(), 120);
  sheetCleanup = () => mm.remove();

  // Anreicherung im Hintergrund
  if (opts.enrich && !editing) {
    const box = $("#sf-enrich");
    box.innerHTML = `<div class="hint row"><span class="spinner"></span> Suche Infos zu Küche, Preis & Beschreibung …</div>`;
    sb.functions.invoke("lookup-spot", { body: { action: "enrich", candidate: input } }).then(({ data, error }) => {
      if (!document.body.contains(form)) return;
      if (error || !data?.enriched) {
        box.innerHTML = data?.reason === "no_key"
          ? `<div class="hint">Daten von OpenStreetMap übernommen. (Web-Recherche ist noch nicht eingerichtet.)</div>`
          : `<div class="hint">Daten von OpenStreetMap übernommen – mehr war nicht zu finden.</div>`;
        return;
      }
      const cur = readForm();
      const merged = mergeEnrichment({ ...s, ...cur, cuisine_generic: input.cuisine_generic, is_food: input.is_food }, data);
      Object.assign(s, merged);
      form.description.value = s.description ?? "";
      form.specialties.value = (s.specialties ?? []).join(", ");
      form.focus.value = (s.focus ?? []).join(", ");
      form.website.value = s.website ?? "";
      form.category.value = s.category;
      $$("#sf-price button").forEach((x) => x.classList.toggle("on", +x.dataset.v === s.price_level));
      renderCuisines(); renderSources();
      box.innerHTML = `<div class="hint">✓ Infos ergänzt – bitte kurz prüfen.</div>`;
    });
  }

  function readForm() {
    const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
    return {
      name: form.name.value.trim(), address: form.address.value.trim(), category: form.category.value,
      focus: list(form.focus.value), description: form.description.value.trim(), specialties: list(form.specialties.value),
      website: form.website.value.trim(), phone: form.phone.value.trim(), opening_hours: form.opening_hours.value.trim(),
      notes: form.notes.value.trim(), diet_veg: form.diet_veg.checked || null, diet_vegan: form.diet_vegan.checked || null,
    };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#sf-save"); btn.disabled = true; $("#sf-error").hidden = true;
    const v = readForm();
    if (v.diet_vegan) v.diet_veg = true;
    const row = {
      ...v, lat: s.lat, lng: s.lng, city: s.city ?? "", cuisines: s.cuisines, cuisine_guessed: s.cuisine_guessed,
      price_level: s.price_level, source_urls: s.source_urls ?? [], osm_type: s.osm_type, osm_id: s.osm_id,
    };
    try {
      let id = input.id;
      if (editing) {
        const { error } = await sb.from("spots").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("spots").insert({ ...row, group_id: state.group.id, created_by: state.me.id }).select("id").single();
        if (error) throw error;
        id = data.id;
        await sb.from("spot_wants").insert({ spot_id: id, user_id: state.me.id });
      }
      await loadSpots();
      toast(editing ? "Gespeichert" : "Auf der Wunschliste 🍽️");
      openDetail(id);
      if (!editing && map) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15));
    } catch (err) {
      $("#sf-error").textContent = errMsg(err); $("#sf-error").hidden = false; btn.disabled = false;
    }
  });
}

// =====================================================================
// Detailansicht
// =====================================================================
async function openDetail(id, keepScroll = false) {
  const s = state.spots.find((x) => x.id === id);
  if (!s) { closeSheet(); return; }
  const scroll = keepScroll ? $("#sheet-body").scrollTop : 0;
  const [{ data: ratings }, { data: dishes }] = await Promise.all([
    sb.from("ratings").select("*").eq("spot_id", id).order("updated_at", { ascending: false }),
    sb.from("dishes").select("*").eq("spot_id", id).order("created_at"),
  ]);
  await signUrls([...(dishes ?? []).flatMap((d) => [d.thumb_path, d.photo_path]), s.cover_thumb]);
  const byRating = new Map();
  (dishes ?? []).forEach((d) => { if (!byRating.has(d.rating_id)) byRating.set(d.rating_id, []); byRating.get(d.rating_id).push(d); });
  const mine = (ratings ?? []).find((r) => r.user_id === state.me.id);
  const rated = isRated(s);
  const cover = photoUrl(s.cover_thumb);
  const web = safeUrl(s.website || "");
  const tab = $("#sheet").dataset.tab || "ratings";

  const ratingHtml = (r) => {
    const ds = byRating.get(r.id) ?? [];
    const subs = SUB.filter(([k]) => r[k]).map(([k, l]) => `<span>${l} ${r[k]}★</span>`).join("");
    return `<div class="rating-card">
      <div class="who"><b>${esc(memberName(r.user_id))}${r.user_id === state.me.id ? " (du)" : ""}</b><span class="muted small">${fmtDate(r.visited_on)}</span></div>
      <div class="row">${stars(r.overall)}${r.would_return === true ? '<span class="tag">würde wieder hingehen</span>' : r.would_return === false ? '<span class="tag">eher nicht nochmal</span>' : ""}</div>
      ${subs ? `<div class="subscores">${subs}</div>` : ""}
      ${r.comment ? `<div>${esc(r.comment)}</div>` : ""}
      ${ds.length ? `<div class="dish-tiles">${ds.map(dishTile).join("")}</div>` : ""}
    </div>`;
  };

  // Gerichte gruppiert
  const groups = new Map();
  for (const d of dishes ?? []) { const k = norm(d.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const dishGroups = [...groups.values()].map((list) => {
    const st = list.filter((d) => d.stars); const avg = st.length ? st.reduce((a, d) => a + d.stars, 0) / st.length : null;
    const best = list.filter((d) => d.thumb_path).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))[0];
    return { name: list[0].name, list, avg, best };
  }).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.list.length - a.list.length);

  openSheet(`
    ${cover ? `<div class="cover" style="background-image:url('${esc(photoUrl(dishGroups[0]?.best?.photo_path) || cover)}')"></div>` : ""}
    <div class="stack" style="gap:6px">
      <h2 class="d-title">${esc(spotEmoji(s))} ${esc(s.name)}</h2>
      <div class="d-sub">${esc([cuisineNames(s.cuisines), CATEGORIES[s.category], euro(s.price_level)].filter(Boolean).join(" · "))}
        ${s.cuisine_guessed ? ' <span class="tag guess">Küche vermutet</span>' : ""}</div>
      ${(s.focus ?? []).length ? `<div class="row" style="gap:6px">${s.focus.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>` : ""}
    </div>

    <div class="status">
      ${rated ? `<span class="avg" style="color:${ratingColor(s.avg_overall)}">${fmtNum(s.avg_overall)}</span>
        <div><div>${stars(s.avg_overall)}</div><div class="muted small">${s.rating_count} Bewertung${s.rating_count === 1 ? "" : "en"}${s.last_visit ? ` · zuletzt ${fmtDate(s.last_visit)}` : ""}</div></div>`
      : `<span style="font-size:30px">🕓</span><div><b>Wollen wir hin</b><div class="muted small">${s.want_count ? `${s.want_count} ${s.want_count === 1 ? "Person will" : "Leute wollen"} hin` : "Noch niemand dafür"}</div></div>`}
    </div>

    <div class="row">
      <button class="btn ${s.i_want ? "" : "btn-soft"}" type="button" id="d-want" style="flex:1">${s.i_want ? "✓ Will ich auch" : "🙋 Will ich auch!"}${s.want_count ? ` (${s.want_count})` : ""}</button>
      <button class="btn btn-primary" type="button" id="d-rate" style="flex:1">${mine ? "Meine Bewertung" : "Waren wir! Bewerten"}</button>
    </div>

    ${s.description ? `<p style="margin:0">${esc(s.description)}</p>` : ""}
    <div class="info-list">
      ${(s.specialties ?? []).length ? `<div><span class="k">⭐</span><span>${esc(s.specialties.join(", "))}</span></div>` : ""}
      ${s.address ? `<div><span class="k">📍</span><span>${esc(s.address)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Route</a></span></div>` : `<div><span class="k">📍</span><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Route</a></div>`}
      ${s.opening_hours ? `<div><span class="k">🕒</span><span>${esc(s.opening_hours)}</span></div>` : ""}
      ${web ? `<div><span class="k">🌐</span><a href="${esc(web)}" target="_blank" rel="noopener">${esc(new URL(web).hostname.replace(/^www\./, ""))}</a></div>` : ""}
      ${s.phone ? `<div><span class="k">📞</span><a href="tel:${esc(s.phone.replace(/[^\d+]/g, ""))}">${esc(s.phone)}</a></div>` : ""}
      ${s.diet_veg || s.diet_vegan ? `<div><span class="k">🌱</span><span>${s.diet_vegan ? "vegane & vegetarische Auswahl" : "vegetarische Auswahl"}</span></div>` : ""}
      ${s.notes ? `<div><span class="k">📝</span><span>${esc(s.notes)}</span></div>` : ""}
    </div>

    <div class="seg" id="d-tabs">
      <button type="button" data-t="ratings" class="${tab === "ratings" ? "on" : ""}">Bewertungen (${(ratings ?? []).length})</button>
      <button type="button" data-t="dishes" class="${tab === "dishes" ? "on" : ""}">Gerichte (${(dishes ?? []).length})</button>
    </div>
    <div id="d-tab-ratings" class="stack" ${tab === "ratings" ? "" : "hidden"}>
      ${(ratings ?? []).length ? ratings.map(ratingHtml).join("") : `<div class="empty" style="padding:16px"><b>Noch keine Bewertung</b>Wart ihr schon da? Dann tippe auf „Waren wir!“.</div>`}
    </div>
    <div id="d-tab-dishes" class="stack" ${tab === "dishes" ? "" : "hidden"}>
      ${dishGroups.length ? `<div class="dish-tiles">${dishGroups.map((g) => `<button type="button" class="dish-tile" data-dish="${g.best?.id ?? g.list[0].id}">
        <span class="img" style="${g.best ? `background-image:url('${esc(photoUrl(g.best.thumb_path))}')` : ""}">${g.best ? "" : "🍽️"}</span>
        <span class="nm">${esc(g.name)}</span>
        <span class="st">${g.avg ? `${stars(g.avg)} ` : ""}<span class="muted">${g.list.length}× · ${esc([...new Set(g.list.map((d) => memberName(d.user_id)))].join(", "))}</span></span>
      </button>`).join("")}</div>` : `<div class="empty" style="padding:16px"><b>Noch keine Gerichte</b>Beim Bewerten könnt ihr eintragen, was ihr gegessen habt – mit Foto.</div>`}
    </div>

    ${(s.source_urls ?? []).length ? `<div class="muted small"><b>Quellen:</b> ${s.source_urls.map(safeUrl).filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(", ")}</div>` : ""}
    <div class="muted small">Eingetragen von ${esc(memberName(s.created_by))} am ${fmtDate(s.created_at)}</div>
    <div class="row">
      <button class="btn btn-sm" type="button" id="d-edit">Bearbeiten</button>
      <button class="btn btn-sm btn-danger" type="button" id="d-del">Löschen</button>
    </div>
  `, "detail", id);
  $("#sheet").dataset.tab = tab;
  if (scroll) $("#sheet-body").scrollTop = scroll;

  const allDishes = dishes ?? [];
  $("#d-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    $("#sheet").dataset.tab = b.dataset.t;
    $$("#d-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#d-tab-ratings").hidden = b.dataset.t !== "ratings";
    $("#d-tab-dishes").hidden = b.dataset.t !== "dishes";
  });
  $("#sheet-body").addEventListener("click", (e) => {
    const t = e.target.closest("[data-dish]"); if (!t) return;
    const d = allDishes.find((x) => x.id === t.dataset.dish); if (d) lightbox(d);
  });
  $("#d-want").addEventListener("click", async () => {
    const q = s.i_want
      ? sb.from("spot_wants").delete().eq("spot_id", id).eq("user_id", state.me.id)
      : sb.from("spot_wants").insert({ spot_id: id, user_id: state.me.id });
    const { error } = await q; if (error) return toast(errMsg(error));
    await loadSpots(); openDetail(id, true);
  });
  $("#d-rate").addEventListener("click", () => openRating(s, mine, mine ? byRating.get(mine.id) ?? [] : [], allDishes));
  $("#d-edit").addEventListener("click", () => openSpotForm(s));
  $("#d-del").addEventListener("click", async () => {
    if (!confirm(`„${s.name}“ wirklich löschen? Bewertungen und Gerichte verschwinden mit.`)) return;
    const { error } = await sb.from("spots").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast(errMsg(error));
    closeSheet(); await loadSpots(); toast("Gelöscht");
  });
}

function dishTile(d) {
  const img = photoUrl(d.thumb_path);
  return `<button type="button" class="dish-tile" data-dish="${d.id}">
    <span class="img" style="${img ? `background-image:url('${esc(img)}')` : ""}">${img ? "" : "🍽️"}</span>
    <span class="nm">${esc(d.name)}</span>
    <span class="st">${d.stars ? stars(d.stars) : ""} ${d.price_cents != null ? `<span class="muted">${fmtPrice(d.price_cents)}</span>` : ""}</span>
  </button>`;
}

function lightbox(d) {
  const el = document.createElement("div");
  el.className = "lightbox";
  const big = photoUrl(d.photo_path) || photoUrl(d.thumb_path);
  el.innerHTML = `${big ? `<img src="${esc(big)}" alt="${esc(d.name)}">` : '<div style="font-size:80px">🍽️</div>'}
    <div style="text-align:center"><div style="font-size:20px;font-weight:700">${esc(d.name)}</div>
    <div>${d.stars ? stars(d.stars) : ""} ${d.price_cents != null ? fmtPrice(d.price_cents) : ""}</div>
    ${d.note ? `<div style="opacity:.85;margin-top:4px">${esc(d.note)}</div>` : ""}
    <div style="opacity:.6;font-size:14px;margin-top:4px">${esc(memberName(d.user_id))} · ${fmtDate(d.created_at)}</div></div>
    <button class="btn" type="button">Schließen</button>`;
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
}

// =====================================================================
// Bewertung mit Gerichten
// =====================================================================
function starInput(name, value, small = false) {
  return `<div class="star-input ${small ? "sm" : ""}" data-stars="${name}" data-value="${value ?? ""}">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-i="${i}" class="${value >= i ? "on" : ""}" aria-label="${i} Sterne">★</button>`).join("")}</div>`;
}
function bindStars(root, onChange, clearable = true) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".star-input button"); if (!b) return;
    const w = b.parentElement; const i = +b.dataset.i;
    const v = clearable && +w.dataset.value === i ? "" : i;
    w.dataset.value = v;
    $$("button", w).forEach((x) => x.classList.toggle("on", v !== "" && +x.dataset.i <= v));
    onChange?.(w.dataset.stars, v === "" ? null : v, w);
  });
}

function openRating(s, mine, myDishes, allDishes) {
  const r = mine ?? { overall: null, food: null, service: null, ambience: null, value: null, would_return: null, comment: "", visited_on: today() };
  // Arbeitskopie der Gerichte
  let dishes = myDishes.map((d) => ({ ...d, _state: "keep" }));
  const known = [...new Set(allDishes.map((d) => d.name.trim()))].sort((a, b) => a.localeCompare(b, "de"));
  const values = { overall: r.overall, food: r.food, service: r.service, ambience: r.ambience, value: r.value };
  let wouldReturn = r.would_return;

  openSheet(`
    <h2 class="h2 sheet-title">${esc(s.name)}</h2>
    <form id="rate-form" class="stack">
      <label>Wann wart ihr da?<input type="date" name="visited_on" value="${esc(r.visited_on ?? today())}" max="${today()}" required></label>
      <div><div class="h3">Gesamtnote</div>${starInput("overall", values.overall)}</div>
      <details ${SUB.some(([k]) => r[k]) ? "open" : ""}><summary style="font-weight:700;cursor:pointer">Im Detail (optional)</summary>
        <div class="stack" style="margin-top:10px">${SUB.map(([k, l]) => `<div class="sub-row"><span>${l}</span>${starInput(k, values[k], true)}</div>`).join("")}</div>
      </details>
      <div><div class="h3">Würdest du wieder hingehen?</div>
        <div class="seg" id="r-return">${[["true", "Ja 👍"], ["false", "Eher nicht"], ["", "Weiß nicht"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${String(wouldReturn ?? "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <label>Kommentar<textarea name="comment" maxlength="2000" placeholder="Wie war's?">${esc(r.comment)}</textarea></label>

      <div class="divider"></div>
      <div class="row between"><span class="h3" style="margin:0">Was hast du gegessen?</span><button type="button" class="btn btn-sm" id="r-add-dish">+ Gericht</button></div>
      <datalist id="dish-names">${known.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div id="r-dishes" class="stack"></div>

      <p class="form-error" id="r-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit" id="r-save">Bewertung speichern</button>
      ${mine ? '<button class="btn btn-ghost btn-danger" type="button" id="r-delete">Meine Bewertung löschen</button>' : ""}
    </form>
  `, "rating", s.id);

  const form = $("#rate-form");
  // ein Handler für alle Sterne: Gesamt/Unterpunkte und Gerichte
  bindStars(form, (name, v, w) => {
    if (name.startsWith("dish-")) {
      const d = dishes[+w.closest("[data-idx]").dataset.idx];
      d.stars = v; if (d._state === "keep") d._state = "update";
    } else if (name in values) values[name] = v;
  }, true);
  $("#r-return").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    wouldReturn = b.dataset.v === "" ? null : b.dataset.v === "true";
    $$("#r-return button").forEach((x) => x.classList.toggle("on", x === b));
  });

  const hint = (name) => {
    const other = allDishes.filter((d) => d.user_id !== state.me.id && norm(d.name) === norm(name) && d.stars);
    if (!other.length) return "";
    const avg = other.reduce((a, d) => a + d.stars, 0) / other.length;
    return `Hatte auch: ${esc([...new Set(other.map((d) => memberName(d.user_id)))].join(", "))} – Ø ${fmtNum(avg)} ★`;
  };

  const renderDishes = () => {
    const live = dishes.filter((d) => d._state !== "delete");
    $("#r-dishes").innerHTML = live.length ? live.map((d) => {
      const idx = dishes.indexOf(d);
      const img = d._preview ?? photoUrl(d.thumb_path);
      return `<div class="dish-edit" data-idx="${idx}">
        <label class="dish-photo ${img ? "has" : ""}" style="${img ? `background-image:url('${esc(img)}')` : ""}">📷<br>Foto<input type="file" accept="image/*" data-f="photo"></label>
        <div class="dish-fields">
          <input data-f="name" list="dish-names" placeholder="z. B. Gyros-Teller" value="${esc(d.name ?? "")}" maxlength="120">
          <div class="row" style="justify-content:space-between">${starInput(`dish-${idx}`, d.stars, true)}</div>
          <div class="row" style="flex-wrap:nowrap">
            <input data-f="price" inputmode="decimal" placeholder="Preis €" value="${d.price_cents != null ? (d.price_cents / 100).toFixed(2).replace(".", ",") : ""}" style="width:96px;flex:none">
            <input data-f="note" placeholder="Notiz" value="${esc(d.note ?? "")}" maxlength="500">
          </div>
          <div class="row between"><span class="muted small" data-hint>${hint(d.name ?? "")}</span><button type="button" class="btn btn-sm btn-ghost" data-remove>Entfernen</button></div>
        </div>
      </div>`;
    }).join("") : `<div class="hint">Trag ein, was du hattest – mit Foto sieht die Gruppe gleich, was sich lohnt.</div>`;
  };
  renderDishes();

  const dishBox = $("#r-dishes");
  dishBox.addEventListener("input", (e) => {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const card = el.closest("[data-idx]"); const d = dishes[+card.dataset.idx];
    if (d._state === "keep") d._state = "update";
    if (el.dataset.f === "name") { d.name = el.value; $("[data-hint]", card).innerHTML = hint(el.value); }
    if (el.dataset.f === "note") d.note = el.value;
    if (el.dataset.f === "price") { const n = parseFloat(el.value.replace(",", ".")); d.price_cents = Number.isFinite(n) ? Math.round(n * 100) : null; }
  });
  dishBox.addEventListener("change", async (e) => {
    const el = e.target.closest('[data-f="photo"]'); if (!el || !el.files?.[0]) return;
    const card = el.closest("[data-idx]"); const d = dishes[+card.dataset.idx];
    const lbl = el.parentElement; lbl.classList.add("has"); lbl.style.backgroundImage = ""; lbl.firstChild.textContent = "…";
    try {
      d._photo = await processPhoto(el.files[0]);
      if (d._preview) URL.revokeObjectURL(d._preview);
      d._preview = URL.createObjectURL(d._photo.thumb);
      lbl.style.backgroundImage = `url('${d._preview}')`;
      if (d._state === "keep") d._state = "update";
    } catch { toast("Foto konnte nicht gelesen werden"); lbl.classList.remove("has"); }
  });
  dishBox.addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]")) return;
    const idx = +e.target.closest("[data-idx]").dataset.idx;
    if (dishes[idx].id) dishes[idx]._state = "delete"; else dishes.splice(idx, 1);
    renderDishes();
  });
  $("#r-add-dish").addEventListener("click", () => {
    dishes.push({ name: "", stars: null, price_cents: null, note: "", _state: "new" });
    renderDishes();
    const cards = $$(".dish-edit", dishBox); $('[data-f="name"]', cards[cards.length - 1])?.focus();
  });
  sheetCleanup = () => dishes.forEach((d) => d._preview && URL.revokeObjectURL(d._preview));

  $("#r-delete")?.addEventListener("click", async () => {
    if (!confirm("Deine Bewertung samt Gerichten löschen?")) return;
    const paths = myDishes.flatMap((d) => [d.photo_path, d.thumb_path]).filter(Boolean);
    const { error } = await sb.from("ratings").delete().eq("id", mine.id);
    if (error) return toast(errMsg(error));
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    await loadSpots(); openDetail(s.id); toast("Bewertung gelöscht");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#r-error"), btn = $("#r-save");
    errEl.hidden = true;
    if (!values.overall) { errEl.textContent = "Bitte eine Gesamtnote vergeben."; errEl.hidden = false; return; }
    const bad = dishes.find((d) => d._state !== "delete" && !String(d.name ?? "").trim());
    if (bad) { errEl.textContent = "Jedes Gericht braucht einen Namen (oder entfernen)."; errEl.hidden = false; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Speichere …';
    try {
      const row = { ...values, would_return: wouldReturn, comment: form.comment.value.trim(), visited_on: form.visited_on.value || today() };
      let ratingId = mine?.id;
      if (ratingId) {
        const { error } = await sb.from("ratings").update(row).eq("id", ratingId); if (error) throw error;
      } else {
        const { data, error } = await sb.from("ratings").insert({ ...row, spot_id: s.id, user_id: state.me.id }).select("id").single();
        if (error) throw error; ratingId = data.id;
      }
      const gid = state.group.id;
      const stale = [];
      for (const d of dishes) {
        const fields = { name: String(d.name).trim(), stars: d.stars ?? null, price_cents: d.price_cents ?? null, note: String(d.note ?? "").trim() };
        if (d._state === "delete") {
          const { error } = await sb.from("dishes").delete().eq("id", d.id); if (error) throw error;
          stale.push(d.photo_path, d.thumb_path); continue;
        }
        let id = d.id;
        if (d._state === "new") {
          const { data, error } = await sb.from("dishes").insert({ ...fields, rating_id: ratingId, spot_id: s.id, user_id: state.me.id }).select("id").single();
          if (error) throw error; id = data.id;
        } else if (d._state === "update") {
          const { error } = await sb.from("dishes").update(fields).eq("id", id); if (error) throw error;
        }
        if (d._photo) {
          const ext = d._photo.full.type === "image/webp" ? "webp" : "jpg";
          const stamp = Date.now().toString(36);
          const base = `${gid}/${s.id}/${id}-${stamp}`;
          const up1 = await sb.storage.from(BUCKET).upload(`${base}.${ext}`, d._photo.full, { contentType: d._photo.full.type });
          if (up1.error) throw up1.error;
          const up2 = await sb.storage.from(BUCKET).upload(`${base}_t.${ext}`, d._photo.thumb, { contentType: d._photo.thumb.type });
          if (up2.error) throw up2.error;
          const { error } = await sb.from("dishes").update({ photo_path: `${base}.${ext}`, thumb_path: `${base}_t.${ext}` }).eq("id", id);
          if (error) throw error;
          if (d.photo_path) stale.push(d.photo_path, d.thumb_path);
        }
      }
      const rm = stale.filter(Boolean);
      if (rm.length) await sb.storage.from(BUCKET).remove(rm);
      await loadSpots();
      $("#sheet").dataset.tab = "ratings";
      openDetail(s.id);
      toast("Bewertung gespeichert ⭐");
    } catch (err) {
      errEl.textContent = errMsg(err); errEl.hidden = false;
      btn.disabled = false; btn.textContent = "Bewertung speichern";
    }
  });
}

// =====================================================================
// Wohin heute?
// =====================================================================
function randomPick() {
  const pool = filtered().filter((s) => !isRated(s));
  if (!pool.length) return toast("Keine offenen Spots auf der Wunschliste (mit diesen Filtern)");
  // mehr „Will ich auch“ = höhere Chance
  const weighted = pool.flatMap((s) => Array(1 + (s.want_count ?? 0)).fill(s));
  const s = weighted[Math.floor(Math.random() * weighted.length)];
  if (map) map.setView([s.lat, s.lng], 16);
  openDetail(s.id).then(() => {
    const bar = document.createElement("div");
    bar.className = "row";
    bar.innerHTML = `<div class="hint" style="flex:1">🎲 Wie wär's damit?</div><button type="button" class="btn btn-sm" id="pick-again">Nochmal</button>`;
    $("#sheet-body").prepend(bar);
    $("#pick-again").addEventListener("click", randomPick);
  });
}

// =====================================================================
// Gruppe & Konto
// =====================================================================
async function openMenu() {
  const g = state.group, isAdmin = g.role === "admin" || state.me.isSuper;
  const link = `${location.origin}${location.pathname}?code=${g.invite_code}`;
  const members = [...state.members.entries()].sort((a, b) => a[1].username.localeCompare(b[1].username, "de"));
  const { data: invites } = await sb.rpc("my_signup_invites");
  openSheet(`
    <h2 class="h2 sheet-title">${esc(g.name)}</h2>
    ${state.groups.length > 1 ? `<label>Gruppe wechseln<select id="m-switch">${state.groups.map((x) => `<option value="${x.id}" ${x.id === g.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}

    <div class="card stack">
      <div class="h3" style="margin:0">Leute einladen</div>
      <p class="muted small" style="margin:0">Mit diesem Code kann man sich registrieren und landet direkt in der Gruppe. Wer schon ein Konto hat, tritt damit bei.</p>
      <div class="code-box">${esc(g.invite_code)}</div>
      <div class="row">
        <button class="btn btn-primary" type="button" id="m-share" style="flex:1">Link teilen</button>
        <button class="btn" type="button" id="m-copy">Kopieren</button>
      </div>
      ${isAdmin ? '<button class="btn btn-sm btn-ghost" type="button" id="m-regen">Neuen Code erzeugen (alter wird ungültig)</button>' : ""}
    </div>

    <div class="card">
      <div class="h3">Mitglieder (${members.length})</div>
      ${members.map(([uid, m]) => `<div class="member"><span><b>${esc(m.username)}</b>${uid === state.me.id ? " (du)" : ""} ${m.role === "admin" ? '<span class="tag">Admin</span>' : ""}</span>
        ${isAdmin && uid !== state.me.id ? `<span class="row" style="gap:4px"><button class="btn btn-sm" type="button" data-role="${uid}" data-to="${m.role === "admin" ? "member" : "admin"}">${m.role === "admin" ? "Admin entziehen" : "Zum Admin"}</button><button class="btn btn-sm btn-danger" type="button" data-kick="${uid}">Entfernen</button></span>` : ""}
      </div>`).join("")}
    </div>

    ${isAdmin ? `<form id="m-rename" class="row-form"><input name="name" value="${esc(g.name)}" maxlength="80" required><button class="btn" type="submit">Umbenennen</button></form>` : ""}

    <div class="card stack">
      <div class="h3" style="margin:0">Weitere Gruppe</div>
      <form id="m-create" class="row-form"><input name="name" placeholder="Name der neuen Gruppe" maxlength="80" required><button class="btn" type="submit">Anlegen</button></form>
      <form id="m-join" class="row-form"><input name="code" placeholder="Einladungscode" required><button class="btn" type="submit">Beitreten</button></form>
    </div>

    <details class="card"><summary style="font-weight:700;cursor:pointer">Einladung ohne Gruppe (nur Konto)</summary>
      <div class="stack" style="margin-top:10px">
        <p class="muted small" style="margin:0">Einmal-Code, 30 Tage gültig – für jemanden, der eine eigene Gruppe anlegen soll.</p>
        <form id="m-invite" class="row-form"><input name="note" placeholder="Für wen? (optional)" maxlength="60"><button class="btn" type="submit">Code erzeugen</button></form>
        ${(invites ?? []).map((i) => `<div class="member"><span><b style="font-family:ui-monospace,monospace">${esc(i.code)}</b> ${i.note ? `· ${esc(i.note)}` : ""}<br><span class="muted small">${{ open: `offen bis ${fmtDate(i.expires_at)}`, used: `benutzt von ${esc(i.used_by_name ?? "?")}`, revoked: "widerrufen", expired: "abgelaufen" }[i.status]}</span></span>
          ${i.status === "open" ? `<button class="btn btn-sm" type="button" data-revoke="${esc(i.code)}">Widerrufen</button>` : ""}</div>`).join("")}
      </div>
    </details>

    <div class="card stack">
      <div class="h3" style="margin:0">Dein Konto: ${esc(state.me.username)}</div>
      <form id="m-me" class="row-form"><input name="name" value="${esc(state.me.username)}" required><button class="btn" type="submit">Name ändern</button></form>
      <div class="row">
        <button class="btn" type="button" id="m-leave">Gruppe verlassen</button>
        <button class="btn btn-ghost" type="button" data-action="logout">Abmelden</button>
      </div>
    </div>
  `, "menu");

  const run = async (p, ok) => { const { error } = await p; if (error) { toast(errMsg(error)); return false; } if (ok) toast(ok); return true; };
  $("#m-switch")?.addEventListener("change", async (e) => { closeSheet(); didFit = false; state.filters = freshFilters(); await selectGroup(state.groups.find((x) => x.id === e.target.value)); });
  $("#m-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); toast("Link kopiert"); } catch { prompt("Link kopieren:", link); } });
  $("#m-share").addEventListener("click", async () => {
    const text = `Komm in unsere FoodiSpots-Gruppe „${g.name}“! Code: ${g.invite_code}`;
    if (navigator.share) { try { await navigator.share({ title: "FoodiSpots", text, url: link }); } catch {} }
    else { try { await navigator.clipboard.writeText(`${text}\n${link}`); toast("Einladung kopiert"); } catch { prompt("Link kopieren:", link); } }
  });
  $("#m-regen")?.addEventListener("click", async () => {
    if (!confirm("Neuen Code erzeugen? Der alte Link funktioniert dann nicht mehr.")) return;
    const { data, error } = await sb.rpc("regenerate_invite_code", { gid: g.id });
    if (error) return toast(errMsg(error));
    g.invite_code = data; openMenu();
  });
  $("#sheet-body").addEventListener("click", async (e) => {
    const r = e.target.closest("[data-role]"), k = e.target.closest("[data-kick]"), v = e.target.closest("[data-revoke]");
    if (r && await run(sb.rpc("set_member_role", { gid: g.id, uid: r.dataset.role, new_role: r.dataset.to }), "Rolle geändert")) { await loadMembers(); openMenu(); }
    if (k && confirm(`${memberName(k.dataset.kick)} aus der Gruppe entfernen?`) && await run(sb.from("group_members").delete().eq("group_id", g.id).eq("user_id", k.dataset.kick), "Entfernt")) { await loadMembers(); openMenu(); }
    if (v && await run(sb.rpc("revoke_signup_invite", { code: v.dataset.revoke }), "Widerrufen")) openMenu();
  });
  $("#m-rename")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const name = e.target.name.value.trim();
    if (await run(sb.from("groups").update({ name }).eq("id", g.id), "Umbenannt")) { g.name = name; $("#group-name").textContent = name; }
  });
  $("#m-create").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc("create_group", { group_name: e.target.name.value });
    if (error) return toast(errMsg(error));
    closeSheet(); didFit = false; await loadGroups(data.id); toast("Gruppe angelegt");
  });
  $("#m-join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc("join_group", { code: e.target.code.value });
    if (error) return toast(errMsg(error));
    closeSheet(); didFit = false; await loadGroups(data.id); toast(`Willkommen in „${data.name}“`);
  });
  $("#m-invite").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("create_signup_invite", { note: e.target.note.value });
    if (error) return toast(errMsg(error));
    openMenu();
  });
  $("#m-me").addEventListener("submit", async (e) => {
    e.preventDefault(); const name = e.target.name.value.trim();
    if (await run(sb.rpc("rename_me", { new_name: name }), "Name geändert – ab jetzt damit anmelden")) { state.me.username = name; await loadMembers(); }
  });
  $("#m-leave").addEventListener("click", async () => {
    if (!confirm(`„${g.name}“ verlassen? Deine Bewertungen bleiben für die anderen sichtbar.`)) return;
    if (await run(sb.from("group_members").delete().eq("group_id", g.id).eq("user_id", state.me.id), "Gruppe verlassen")) {
      closeSheet(); teardown(); didFit = false; localStorage.removeItem("fs-group"); await loadGroups();
    }
  });
}

// =====================================================================
// Events
// =====================================================================
document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-action]");
  if (a) {
    const act = a.dataset.action;
    if (act === "close-sheet") closeSheet();
    if (act === "logout") { await sb.auth.signOut(); localStorage.removeItem("fs-group"); }
    if (act === "open-menu") openMenu();
    if (act === "open-filter") openFilter();
    if (act === "add-spot") openAdd();
    if (act === "random") randomPick();
    if (act === "locate") locate();
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) { openDetail(open.dataset.open); return; }
  const cg = e.target.closest("[data-cuisine]");
  if (cg) { state.filters = freshFilters(); state.filters.cuisines.add(cg.dataset.cuisine); setView("list"); }
  const v = e.target.closest("[data-view]");
  if (v) setView(v.dataset.view);
  const t = e.target.closest("[data-auth-tab]");
  if (t) setAuthTab(t.dataset.authTab);
});
$("#sheet-backdrop").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
$("#auth-form").addEventListener("submit", onAuthSubmit);
$("#list-search").addEventListener("input", debounce(renderList, 150));
$("#list-sort").addEventListener("change", renderList);
$("#form-create-group").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data, error } = await sb.rpc("create_group", { group_name: e.target.name.value });
  if (error) return toast(errMsg(error));
  await loadGroups(data.id);
});
$("#form-join-group").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data, error } = await sb.rpc("join_group", { code: e.target.code.value });
  if (error) return toast(errMsg(error));
  await loadGroups(data.id);
});
window.addEventListener("online", () => state.group && loadSpots());
window.addEventListener("offline", () => ($("#offline-banner").hidden = false));

boot().catch((err) => { console.error(err); showAuth(); });
})();
