// Test-Backend: minimaler In-Memory-Ersatz für supabase-js (Daten im localStorage des Test-Browsers).
// Bildet nur das ab, was die App benutzt – inkl. der Edge Functions „signup“ und „lookup-spot“ mit festen Testdaten.
// Zugriffsregeln (RLS) werden nur teilweise nachgebildet – dafür sind die SQL-Tests da.
(() => {
  const LS = 'mockdb';
  const TABLES = ['spots', 'ratings', 'dishes', 'spot_wants', 'visits', 'comments'];
  const db = JSON.parse(localStorage.getItem(LS) || 'null') || {
    users: [], profiles: [], super_admins: [], groups: [], group_members: [], signup_invites: [], files: {}, cuisines_extra: [],
    ...Object.fromEntries(TABLES.map((t) => [t, []])),
  };
  const save = () => localStorage.setItem(LS, JSON.stringify(db));
  const inviteOpen = (i) => !i.used_at && !i.revoked_at && Date.parse(i.expires_at) > Date.now();
  let session = JSON.parse(localStorage.getItem('mocksession') || 'null');
  const listeners = [];
  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  let stampN = 0; const stamp = () => new Date().toISOString().replace('Z', String(++stampN % 1000).padStart(3, '0') + 'Z');
  const slug = (n) => String(n).trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  window.__mockOffline = false;
  const netErr = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  const touched = (t) => t === 'spots' || t === 'ratings';
  const cuisines = () => [...(window.FOODI_CUISINES || []), ...db.cuisines_extra];

  function cascade(t, gone) {
    const ids = new Set(gone.map((g) => g.id));
    if (t === 'spots') for (const c of ['ratings', 'dishes', 'spot_wants', 'visits', 'comments']) db[c] = db[c].filter((r) => !ids.has(r.spot_id));
    if (t === 'ratings') db.dishes = db.dishes.filter((r) => !ids.has(r.rating_id));
    if (t === 'groups') for (const c of [...TABLES, 'group_members']) db[c] = db[c].filter((r) => !ids.has(r.group_id));
  }
  // wie der Trigger fill_group_from_spot
  const fillGroup = (t, r) => { if (TABLES.includes(t) && t !== 'spots' && r.spot_id) { const s = db.spots.find((x) => x.id === r.spot_id); if (s) r.group_id = s.group_id; } return r; };

  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select(cols) { if (this.op === 'select') this.cols = cols; else this.returning = true; return this; }
    eq(k, v) { this.f.push((r) => r[k] === v); return this; }
    neq(k, v) { this.f.push((r) => r[k] !== v); return this; }
    is(k, v) { this.f.push((r) => (r[k] ?? null) === v); return this; }
    in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
    order() { return this; }
    range(a, b) { this.rg = [a, b]; return this; }
    maybeSingle() { this._one = true; return this; }
    single() { this._one = true; return this; }
    update(row) { this.op = 'update'; this.row = row; return this; }
    upsert(row) { this.op = 'upsert'; this.row = row; return this; }
    insert(row) { this.op = 'upsert'; this.row = row; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      if (window.__mockOffline) return netErr();
      const u = session?.user?.id;
      if (this.t === 'cuisines') { window.__mock.selects++; return { data: JSON.parse(JSON.stringify(cuisines())), error: null }; }
      const tbl = db[this.t] || (db[this.t] = []);
      if (this.op === 'upsert') {
        const rows = Array.isArray(this.row) ? this.row : [this.row];
        const evs = [];
        for (const r0 of rows) {
          const r = fillGroup(this.t, { ...r0 });
          if (this.t === 'dishes' && !db.ratings.some((x) => x.id === r.rating_id && x.created_by === (r.created_by || u))) return { data: null, error: { message: 'Gericht gehört nicht zu deiner Bewertung' } };
          if (this.t === 'ratings' && db.ratings.some((x) => x.id !== r.id && x.spot_id === r.spot_id && x.created_by === (r.created_by || u))) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          const i = tbl.findIndex((x) => x.id === r.id);
          if (i >= 0) {
            if (TABLES.includes(this.t) && this.t !== 'spots' && tbl[i].created_by !== u) return { data: null, error: { message: 'new row violates row-level security policy' } };
            tbl[i] = { ...tbl[i], ...r }; if (touched(this.t)) { tbl[i].updated_at = stamp(); if (this.t === 'spots') tbl[i].updated_by = u; }
            evs.push({ eventType: 'UPDATE', new: { ...tbl[i] }, old: { id: r.id } });
          } else {
            const n = { id: uid(), created_at: now(), created_by: u, ...r };
            if (touched(this.t)) { n.updated_at = stamp(); if (this.t === 'spots') n.updated_by = u; }
            tbl.push(n); evs.push({ eventType: 'INSERT', new: { ...n }, old: {} });
          }
        }
        save(); fire(this.t, evs); return { data: this.returning ? evs.map((e) => e.new) : null, error: null };
      }
      if (this.op === 'update') {
        const evs = [];
        for (const r of tbl) if (this.f.every((fn) => fn(r))) {
          if (['ratings', 'dishes', 'comments'].includes(this.t) && r.created_by !== u) continue;   // wie RLS: nur eigene
          Object.assign(r, this.row);
          if (touched(this.t)) { r.updated_at = stamp(); if (this.t === 'spots') r.updated_by = u; }
          evs.push({ eventType: 'UPDATE', new: { ...r }, old: { id: r.id } });
        }
        save(); fire(this.t, evs);
        return { data: this.returning ? evs.map((e) => ({ ...e.new })) : null, error: null };
      }
      if (this.op === 'delete') {
        const gone = tbl.filter((r) => this.f.every((fn) => fn(r)));
        db[this.t] = tbl.filter((r) => !gone.includes(r));
        cascade(this.t, gone);
        save(); fire(this.t, gone.map((g) => ({ eventType: 'DELETE', new: {}, old: { id: g.id } }))); return { data: null, error: null };
      }
      window.__mock.selects++;
      let rows = tbl.filter((r) => this.f.every((fn) => fn(r)));
      if (this.t === 'group_members' && /groups\(/.test(this.cols || '')) rows = rows.map((m) => ({ role: m.role, groups: db.groups.find((g) => g.id === m.group_id) }));
      if (this.rg) rows = rows.slice(this.rg[0], this.rg[1] + 1);
      rows = JSON.parse(JSON.stringify(rows));
      return { data: this._one ? rows[0] || null : rows, error: null };
    }
  }
  const chans = [];
  function fire(table, payloads = [{}]) { setTimeout(() => chans.forEach((c) => c.cbs.forEach((cb) => { if (cb.t === table) payloads.forEach((pl) => cb.fn(pl)); })), 50); }
  window.__mock = { db: () => db, save: () => save(), fire, selects: 0, lookups: [], noKey: false };

  // Edge Functions: Fehler wie supabase-js (FunctionsHttpError mit context.json())
  const fnErr = (msg) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: msg }) } } });
  const LOOKUP = {
    delphi: [
      { name: 'Delphi', lat: 50.3601, lng: 7.5978, address: 'Görgenstraße 12, 56068 Koblenz', city: 'Koblenz', osm_type: 'node', osm_id: 1001, is_food: true,
        category: 'restaurant', cuisines: ['greek'], focus: [], cuisine_generic: false, osm_cuisine: 'greek', website: '', phone: '0261 123456',
        opening_hours: 'Tu-Su 17:00-23:00', diet_veg: null, diet_vegan: null, display_name: 'Delphi, Görgenstraße, Koblenz' },
      { name: 'Delphi Grill', lat: 50.3402, lng: 7.6011, address: 'Hauptstraße 5, 56072 Koblenz', city: 'Koblenz', osm_type: 'node', osm_id: 1002, is_food: true,
        category: 'imbiss', cuisines: [], focus: ['Döner/Kebab'], cuisine_generic: false, osm_cuisine: 'kebab', website: '', phone: '', opening_hours: '', diet_veg: null, diet_vegan: null },
    ],
    konoba: [
      { name: 'Konoba Dalmacija', lat: 50.3555, lng: 7.6012, address: 'Rheinstraße 3, 56068 Koblenz', city: 'Koblenz', osm_type: 'way', osm_id: 2001, is_food: true,
        category: 'restaurant', cuisines: [], focus: [], cuisine_generic: true, osm_cuisine: 'regional', website: '', phone: '', opening_hours: '', diet_veg: null, diet_vegan: null },
    ],
  };
  async function invoke(name, { body } = {}) {
    if (window.__mockOffline) return netErr();
    if (name === 'signup') {
      const { username = '', password = '', invite_code = '' } = body || {};
      if (!/^[A-Za-zÄÖÜäöüß0-9._-]{3,30}$/.test(username.trim())) return fnErr('Name ungültig');
      if (password.length < 6) return fnErr('Passwort: 6–72 Zeichen');
      const email = slug(username) + '@nutzer.foodispots.invalid';
      if (db.users.some((x) => x.email === email)) return fnErr('Name ist schon vergeben (oder zu ähnlich zu einem anderen)');
      const code = String(invite_code).trim().toUpperCase();
      const g = db.groups.find((x) => x.invite_code === code);
      const acc = !g && db.signup_invites.find((i) => i.code === code && inviteOpen(i));
      if (db.users.length && !g && !acc) return fnErr('Einladungscode ungültig oder abgelaufen');
      const user = { id: uid(), email, password, created_at: now() };
      db.users.push(user);
      db.profiles.push({ id: user.id, display_name: username.trim(), username: username.trim() });
      if (slug(username) === 'marcel' && !db.super_admins.length) db.super_admins.push(user.id);
      if (g) db.group_members.push({ group_id: g.id, user_id: user.id, role: 'member', joined_at: now() });
      if (acc) { acc.used_by = user.id; acc.used_at = now(); }
      save(); return { data: { ok: true }, error: null };
    }
    if (name === 'lookup-spot') {
      if (!session) return fnErr('Bitte anmelden.');
      window.__mock.lookups.push(body);
      if (body.action === 'search') {
        const q = String(body.q || '').toLowerCase();
        const key = Object.keys(LOOKUP).find((k) => q.includes(k));
        if (window.__mockLookup) return { data: { candidates: window.__mockLookup(q) }, error: null };
        return { data: { candidates: key ? LOOKUP[key] : [] }, error: null };
      }
      if (body.action === 'enrich') {
        await new Promise((r) => setTimeout(r, 150));
        if (window.__mock.noKey) return { data: { enriched: false, reason: 'no_key' }, error: null };
        const c = body.candidate || {};
        const base = { enriched: true, focus: [], specialties: [], source_urls: ['https://example.org/quelle'] };
        if (/delphi/i.test(c.name || body.q || '')) return { data: { ...base, cuisines: ['greek'], category: 'restaurant', focus: ['Grill'], price_level: 2,
          description: 'Familiengeführtes griechisches Restaurant mit Grillspezialitäten.', specialties: ['Gyros', 'Bifteki'], website: 'https://delphi.example' }, error: null };
        if (/konoba/i.test(c.name || body.q || '')) return { data: { ...base, cuisines: ['croatian'], category: 'restaurant', price_level: 3,
          description: 'Dalmatinische Küche mit Fisch vom Grill.', specialties: ['Ćevapčići', 'Pljeskavica'], website: '' }, error: null };
        if (!c.name && body.q) return { data: { ...base, name: body.q, address: 'Teststraße 1, 56068 Koblenz', city: 'Koblenz', lat: 50.359, lng: 7.59,
          cuisines: ['spanish'], category: 'bar', focus: ['Tapas'], price_level: 2, description: 'Tapas-Bar.', specialties: [], website: '' }, error: null };
        return { data: { enriched: false, reason: 'nothing' }, error: null };
      }
    }
    return fnErr('unknown function');
  }

  const client = {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        if (window.__mockOffline) return netErr();
        const user = db.users.find((x) => x.email === email && x.password === password);
        if (!user) return { data: {}, error: { message: 'Invalid login credentials' } };
        if (user.banned) return { data: {}, error: { message: 'User is banned' } };
        user.last_sign_in_at = now(); save();
        session = { user: { id: user.id, email: user.email } };
        localStorage.setItem('mocksession', JSON.stringify(session));
        setTimeout(() => listeners.forEach((l) => l('SIGNED_IN', session)), 10);
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() { session = null; localStorage.removeItem('mocksession'); listeners.forEach((l) => l('SIGNED_OUT', null)); return {}; },
    },
    from: (t) => new Q(t),
    functions: { invoke },
    async rpc(name, args) {
      if (window.__mockOffline) return netErr();
      if (name === 'check_invite') {
        if (!db.users.length) return { data: 'open', error: null };
        const c = String(args.code || '').trim().toUpperCase();
        const ok = db.groups.some((g) => g.invite_code === c) || db.signup_invites.some((i) => i.code === c && inviteOpen(i));
        return { data: ok ? 'ok' : 'invalid', error: null };
      }
      if (name === 'public_group_data') {
        const g = db.groups.find((x) => x.share_token && x.share_token === args.token);
        if (!g) return { data: null, error: null };
        const spots = db.spots.filter((s) => s.group_id === g.id && !s.deleted_at).map((s) => {
          const rs = db.ratings.filter((r) => r.spot_id === s.id);
          const { created_by, updated_by, notes, deleted_at, deleted_by, ...pub } = s;
          return { ...pub, avg_overall: rs.length ? rs.reduce((a, r) => a + r.overall, 0) / rs.length : null, rating_count: rs.length,
            want_count: db.spot_wants.filter((w) => w.spot_id === s.id).length };
        });
        const ids = new Set(spots.map((s) => s.id));
        const dishes = db.dishes.filter((d) => ids.has(d.spot_id)).map(({ created_by, note, price_cents, rating_id, ...d }) => d);
        return { data: { group: { id: g.id, name: g.name }, spots, dishes }, error: null };
      }
      if (!session) return { data: null, error: { message: 'permission denied' } };
      const u = session.user.id;
      const isSA = () => db.super_admins.includes(u);
      const deny = () => ({ data: null, error: { message: 'Nur Super-Admins' } });
      const setName = (id, n) => {
        if (!/^[A-Za-zÄÖÜäöüß0-9._-]{3,30}$/.test(n.trim())) return { data: null, error: { message: 'Name ungültig' } };
        if (db.profiles.some((p) => p.id !== id && slug(p.username || '') === slug(n))) return { data: null, error: { message: 'Name ist schon vergeben' } };
        const p = db.profiles.find((x) => x.id === id); p.username = p.display_name = n.trim();
        db.users.find((x) => x.id === id).email = slug(n) + '@nutzer.foodispots.invalid'; save(); return { data: null, error: null };
      };
      if (name === 'create_signup_invite') {
        const mine = db.signup_invites.filter((i) => i.created_by === u && inviteOpen(i));
        if (mine.length >= 10) return { data: null, error: { message: 'Höchstens 10 offene Einladungen gleichzeitig. Widerrufe zuerst eine alte.' } };
        const inv = { code: 'INV' + Math.random().toString(36).slice(2, 9).toUpperCase(), created_by: u, created_at: now(),
          expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), note: args.note || null, used_by: null, used_at: null, revoked_at: null };
        db.signup_invites.push(inv); save();
        return { data: { code: inv.code, expires_at: inv.expires_at, note: inv.note }, error: null };
      }
      if (name === 'my_signup_invites') {
        const st = (i) => i.used_at ? 'used' : i.revoked_at ? 'revoked' : Date.parse(i.expires_at) <= Date.now() ? 'expired' : 'open';
        return { data: db.signup_invites.filter((i) => i.created_by === u).reverse()
          .map((i) => ({ ...i, status: st(i), used_by_name: db.profiles.find((p) => p.id === i.used_by)?.username || null })), error: null };
      }
      if (name === 'revoke_signup_invite') {
        const i = db.signup_invites.find((x) => x.code === String(args.code).toUpperCase() && x.created_by === u && !x.used_at && !x.revoked_at);
        if (!i) return { data: null, error: { message: 'Einladung nicht gefunden oder schon benutzt' } };
        i.revoked_at = now(); save(); return { data: null, error: null };
      }
      if (name === 'is_super_admin') return { data: isSA(), error: null };
      if (name === 'rename_me') return setName(u, args.new_name);
      if (name.startsWith('admin_') && !isSA()) return deny();
      if (name === 'admin_overview') {
        const cnt = (t, f) => db[t].filter(f).length;
        return { data: {
          me: u,
          stats: { users: db.users.length, groups: db.groups.length, spots: cnt('spots', (s) => !s.deleted_at), ratings: db.ratings.length, dishes: db.dishes.length,
            photos: cnt('dishes', (d) => d.photo_path), lookups: window.__mock.lookups.length },
          users: db.users.map((x) => ({ id: x.id, username: db.profiles.find((p) => p.id === x.id)?.username, created_at: x.created_at, last_sign_in_at: x.last_sign_in_at,
            banned: !!x.banned, super_admin: db.super_admins.includes(x.id), spots: cnt('spots', (s) => s.created_by === x.id), ratings: cnt('ratings', (r) => r.created_by === x.id),
            photos: cnt('dishes', (d) => d.created_by === x.id && d.photo_path),
            groups: db.group_members.filter((m) => m.user_id === x.id).map((m) => ({ id: m.group_id, name: db.groups.find((g) => g.id === m.group_id)?.name, role: m.role })) })),
          groups: db.groups.map((g) => ({ id: g.id, name: g.name, created_at: g.created_at, invite_code: g.invite_code, public_link: !!g.share_token,
            spots: cnt('spots', (s) => s.group_id === g.id), ratings: cnt('ratings', (r) => r.group_id === g.id), photos: cnt('dishes', (d) => d.group_id === g.id && d.photo_path),
            members: db.group_members.filter((m) => m.group_id === g.id).map((m) => ({ user_id: m.user_id, role: m.role, username: db.profiles.find((p) => p.id === m.user_id)?.username })) })),
        }, error: null };
      }
      if (name === 'admin_upsert_cuisine') {
        db.cuisines_extra = db.cuisines_extra.filter((c) => c.key !== args.c_key);
        db.cuisines_extra.push({ key: args.c_key, name_de: args.c_name, emoji: args.c_emoji || '🍽️', region: args.c_region, sort: args.c_sort }); save();
        return { data: null, error: null };
      }
      if (name === 'admin_rename_user') return setName(args.uid, args.new_name);
      if (name === 'admin_set_password') { db.users.find((x) => x.id === args.uid).password = args.new_password; save(); return { data: null, error: null }; }
      if (name === 'admin_set_banned') { if (args.uid === u) return { data: null, error: { message: 'Du kannst dich nicht selbst sperren' } }; db.users.find((x) => x.id === args.uid).banned = args.banned; save(); return { data: null, error: null }; }
      if (name === 'admin_set_super_admin') { db.super_admins = db.super_admins.filter((x) => x !== args.uid); if (args.enabled) db.super_admins.push(args.uid); save(); return { data: null, error: null }; }
      if (name === 'admin_set_member') {
        const m = db.group_members.find((x) => x.group_id === args.gid && x.user_id === args.uid);
        if (m) m.role = args.new_role; else db.group_members.push({ group_id: args.gid, user_id: args.uid, role: args.new_role, joined_at: now() });
        save(); return { data: null, error: null };
      }
      if (name === 'admin_remove_member') { db.group_members = db.group_members.filter((x) => !(x.group_id === args.gid && x.user_id === args.uid)); save(); return { data: null, error: null }; }
      if (name === 'admin_rename_group') { db.groups.find((g) => g.id === args.gid).name = args.new_name.trim(); save(); return { data: null, error: null }; }
      if (name === 'admin_delete_user') {
        if (args.uid === u) return { data: null, error: { message: 'Du kannst dich nicht selbst löschen' } };
        let paths = [];
        if (args.keep_content) for (const t of TABLES) db[t].forEach((r) => { if (r.created_by === args.uid) r.created_by = u; });
        else {
          const sp = db.spots.filter((s) => s.created_by === args.uid);
          paths = db.dishes.filter((d) => d.photo_path && (d.created_by === args.uid || sp.some((s) => s.id === d.spot_id))).map((d) => d.photo_path);
          db.spots = db.spots.filter((s) => s.created_by !== args.uid); cascade('spots', sp);
          for (const t of TABLES) db[t] = db[t].filter((r) => r.created_by !== args.uid);
        }
        db.users = db.users.filter((x) => x.id !== args.uid); db.profiles = db.profiles.filter((x) => x.id !== args.uid);
        db.group_members = db.group_members.filter((x) => x.user_id !== args.uid); save();
        return { data: { photo_paths: paths }, error: null };
      }
      if (name === 'admin_delete_group') {
        const paths = db.dishes.filter((d) => d.group_id === args.gid && d.photo_path).map((d) => d.photo_path);
        const gone = db.groups.filter((g) => g.id === args.gid); db.groups = db.groups.filter((g) => g.id !== args.gid); cascade('groups', gone);
        save(); return { data: { photo_paths: paths }, error: null };
      }
      if (name === 'create_group') {
        const g = { id: uid(), name: args.group_name, invite_code: Math.random().toString(16).slice(2, 10).toUpperCase(), created_by: u, created_at: now(), share_token: null };
        db.groups.push(g); db.group_members.push({ group_id: g.id, user_id: u, role: 'admin', joined_at: now() }); save();
        return { data: g, error: null };
      }
      if (name === 'join_group') {
        const g = db.groups.find((x) => x.invite_code === String(args.code).trim().toUpperCase());
        if (!g) return { data: null, error: { message: 'Einladungscode ungültig' } };
        if (!db.group_members.some((m) => m.group_id === g.id && m.user_id === u)) db.group_members.push({ group_id: g.id, user_id: u, role: 'member', joined_at: now() });
        save(); return { data: g, error: null };
      }
      if (name === 'set_public_share') { const g = db.groups.find((x) => x.id === args.gid); g.share_token = args.enabled ? (crypto.randomUUID().replace(/-/g, '') + 'abcdefgh') : null; save(); return { data: g.share_token, error: null }; }
      if (name === 'regenerate_invite_code') { const g = db.groups.find((x) => x.id === args.gid); g.invite_code = 'NEU12345'; save(); return { data: g.invite_code, error: null }; }
      if (name === 'set_member_role') { const m = db.group_members.find((x) => x.group_id === args.gid && x.user_id === args.uid); m.role = args.new_role; save(); return { data: null, error: null }; }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    storage: {
      from: () => ({
        async upload(path, blob) {
          if (window.__mockOffline) return netErr();
          if (db.files[path]) return { data: null, error: { message: 'The resource already exists' } };
          const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          db.files[path] = b64; save(); return { data: { path }, error: null };
        },
        async download(path) {
          if (window.__mockOffline) return netErr();
          const d = db.files[path]; if (!d) return { data: null, error: { message: 'not found' } };
          // wie auf dem Server: ohne Mitgliedschaft nur mit passendem Lese-Link-Schlüssel
          const gid = path.split('/')[0], tok = clientHeaders['x-foodi-share'];
          const member = session && db.group_members.some((m) => m.group_id === gid && m.user_id === session.user.id);
          if (!member && !(tok && db.groups.some((g) => g.id === gid && g.share_token === tok))) return { data: null, error: { message: 'Object not found' } };
          const [meta, b64] = d.split(','); const bin = atob(b64);
          const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return { data: new Blob([bytes], { type: meta.slice(5).split(';')[0] }), error: null };
        },
        async remove(paths) { for (const p of paths) delete db.files[p]; save(); return { data: null, error: null }; },
      }),
    },
    channel() { const c = { cbs: [], state: 'joining', on(_, o, fn) { this.cbs.push({ t: o.table, fn }); return this; }, subscribe() { this.state = 'joined'; chans.push(this); return this; } }; return c; },
    removeChannel(c) { const i = chans.indexOf(c); if (i >= 0) chans.splice(i, 1); },
  };
  let clientHeaders = {};
  window.supabase = { createClient: (url, key, opts) => { clientHeaders = opts?.global?.headers || {}; return client; } };
})();
