-- FoodiSpots – Angleichen an den Pilzkarte-Standard (Version 2.0)
-- Nicht-destruktiv: Spalten werden umbenannt bzw. ergänzt, nichts gelöscht.

-- ---------- Einheitlich created_by (wie in der Pilzkarte) ----------
alter table public.ratings    rename column user_id to created_by;
alter table public.dishes     rename column user_id to created_by;
alter table public.spot_wants rename column user_id to created_by;
-- eigene ID für Offline-Warteschlange und Echtzeit
alter table public.spot_wants add column if not exists id uuid not null default gen_random_uuid();
alter table public.spot_wants add constraint spot_wants_id_key unique (id);
alter table public.ratings add column if not exists visit_id uuid references public.visits(id) on delete set null;
alter table public.spots add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.super_admins add column if not exists granted_by uuid references auth.users(id) on delete set null;
alter table public.groups add column if not exists share_token text unique;

create or replace function public.fill_group_from_spot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.group_id into new.group_id from public.spots s where s.id = new.spot_id;
  if new.group_id is null then raise exception 'Spot nicht gefunden'; end if;
  if tg_table_name = 'dishes' then
    if not exists (select 1 from public.ratings r where r.id = new.rating_id
                   and r.spot_id = new.spot_id and r.created_by = new.created_by) then
      raise exception 'Gericht gehört nicht zu deiner Bewertung';
    end if;
  end if;
  return new;
end $$;

-- ---------- Kommentare ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists comments_spot_idx on public.comments(spot_id);
create index if not exists comments_group_idx on public.comments(group_id);
alter table public.comments enable row level security;
create trigger fill_group before insert on public.comments for each row execute function public.fill_group_from_spot();
create trigger lock_cols before update on public.comments for each row execute function public.lock_owner_cols();
create policy comments_select on public.comments for select to authenticated using (public.is_member(group_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(group_id));
create policy comments_update on public.comments for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (created_by = auth.uid() or public.is_admin(group_id));

-- Löschen/Wiederherstellen von Besuchen und Wünschen auch für Admins
alter policy wants_delete on public.spot_wants
  using (created_by = auth.uid() or public.is_admin(group_id));
create policy wants_update on public.spot_wants for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy visits_update on public.visits for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- ---------- Indizes auf Fremdschlüsseln ----------
create index if not exists spots_created_by_idx  on public.spots(created_by);
create index if not exists spots_updated_by_idx  on public.spots(updated_by) where updated_by is not null;
create index if not exists spots_deleted_by_idx  on public.spots(deleted_by) where deleted_by is not null;
create index if not exists ratings_created_by_idx on public.ratings(created_by);
create index if not exists ratings_group_idx     on public.ratings(group_id);
create index if not exists ratings_visit_idx     on public.ratings(visit_id) where visit_id is not null;
create index if not exists dishes_created_by_idx on public.dishes(created_by);
create index if not exists dishes_group_idx      on public.dishes(group_id);
create index if not exists wants_created_by_idx  on public.spot_wants(created_by);
create index if not exists wants_group_idx       on public.spot_wants(group_id);
create index if not exists visits_created_by_idx on public.visits(created_by);
create index if not exists visits_group_idx      on public.visits(group_id);
create index if not exists comments_created_by_idx on public.comments(created_by);
create index if not exists groups_created_by_idx on public.groups(created_by);
create index if not exists invites_created_by_idx on public.signup_invites(created_by);
create index if not exists invites_used_by_idx   on public.signup_invites(used_by) where used_by is not null;
create index if not exists super_admins_granted_by_idx on public.super_admins(granted_by) where granted_by is not null;

-- ---------- Super-Admin: das Konto „Marcel“ ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text; v_code text; gid uuid; inv text; first_user boolean;
begin
  if new.email is null or new.email !~ '@nutzer\.foodispots\.invalid$' then
    raise exception 'Registrierung nur mit Name und Passwort möglich';
  end if;
  first_user := not exists (select 1 from auth.users u where u.id <> new.id);
  v_code := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  select g.id into gid from public.groups g where g.invite_code = v_code;
  if gid is null then
    select s.code into inv from public.signup_invites s where s.code = v_code and public.invite_open(s) for update;
  end if;
  if gid is null and inv is null and not first_user then
    raise exception 'Einladungscode ungültig';
  end if;
  uname := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1));
  if public.login_email(uname) <> lower(new.email) or not public.valid_username(uname) then
    uname := split_part(new.email, '@', 1);
  end if;
  if public.name_taken(uname, new.id) then
    raise exception 'Name ist schon vergeben (oder zu ähnlich zu einem anderen)';
  end if;
  insert into public.profiles (id, display_name, username) values (new.id, uname, uname)
  on conflict (id) do update set display_name = excluded.display_name, username = excluded.username;
  -- Super-Admin ist das Konto „Marcel“ (solange es noch keinen gibt)
  if public.login_slug(uname) = 'marcel' and not exists (select 1 from public.super_admins) then
    insert into public.super_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  if gid is not null then
    insert into public.group_members (group_id, user_id, role) values (gid, new.id, 'member') on conflict do nothing;
  elsif inv is not null then
    update public.signup_invites s set used_by = new.id, used_at = now() where s.code = inv;
  end if;
  return new;
end $$;

create or replace function public._set_username(uid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
declare mail text;
begin
  new_name := trim(new_name);
  if not public.valid_username(new_name) then
    raise exception 'Name ungültig: 3–30 Zeichen, nur Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich';
  end if;
  if public.name_taken(new_name, uid) then
    raise exception 'Name ist schon vergeben (oder zu ähnlich zu einem anderen)';
  end if;
  mail := public.login_email(new_name);
  update public.profiles set username = new_name, display_name = new_name where id = uid;
  update auth.users set email = mail, updated_at = now(),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', new_name, 'email', mail)
   where id = uid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', mail), updated_at = now()
   where user_id = uid and provider = 'email';
end $$;

create or replace function public.rename_me(new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  perform public._set_username(auth.uid(), new_name);
end $$;

-- ---------- Öffentlicher Lese-Link ----------
create or replace function public.set_public_share(gid uuid, enabled boolean) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin(gid) then raise exception 'Nur Admins'; end if;
  t := case when enabled then replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) end;
  update public.groups set share_token = t where id = gid;
  return t;
end $$;

-- Nur lesend: keine Namen, keine Kommentare, keine Einzelbewertungen
create or replace function public.public_group_data(token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.groups;
begin
  if token is null or length(token) < 24 then return null; end if;
  select * into g from public.groups gr where gr.share_token = token;
  if g.id is null then return null; end if;
  return jsonb_build_object(
    'group', jsonb_build_object('id', g.id, 'name', g.name),
    'spots', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'group_id', s.group_id, 'name', s.name, 'lat', s.lat, 'lng', s.lng, 'address', s.address, 'city', s.city,
        'cuisines', s.cuisines, 'category', s.category, 'focus', s.focus, 'price_level', s.price_level,
        'description', s.description, 'specialties', s.specialties, 'website', s.website, 'opening_hours', s.opening_hours,
        'diet_veg', s.diet_veg, 'diet_vegan', s.diet_vegan, 'created_at', s.created_at,
        'avg_overall', (select round(avg(r.overall)::numeric, 2) from public.ratings r where r.spot_id = s.id),
        'rating_count', (select count(*) from public.ratings r where r.spot_id = s.id),
        'want_count', (select count(*) from public.spot_wants w where w.spot_id = s.id)))
      from public.spots s where s.group_id = g.id and s.deleted_at is null), '[]'::jsonb),
    'dishes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'spot_id', d.spot_id, 'group_id', d.group_id, 'name', d.name, 'stars', d.stars,
        'photo_path', d.photo_path, 'thumb_path', d.thumb_path, 'created_at', d.created_at))
      from public.dishes d join public.spots s on s.id = d.spot_id
      where d.group_id = g.id and s.deleted_at is null), '[]'::jsonb)
  );
end $$;

-- Fotos im Lese-Link nur mit dem Link-Schlüssel (Header x-foodi-share)
create or replace function public.share_token_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare g text := split_part(object_name, '/', 1); t text;
begin
  if g !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  begin
    t := nullif(current_setting('request.headers', true), '')::json ->> 'x-foodi-share';
  exception when others then return false;
  end;
  if t is null or length(t) < 24 then return false; end if;
  return exists (select 1 from public.groups gr where gr.id = g::uuid and gr.share_token = t);
end $$;

create policy food_photos_share_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'food-photos' and public.share_token_path(name));

-- ---------- Admin-Bereich (nur Super-Admins) ----------
create or replace function public._require_super_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Nur Super-Admins'; end if;
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  return jsonb_build_object(
    'me', auth.uid(),
    'stats', jsonb_build_object(
      'users', (select count(*) from auth.users), 'groups', (select count(*) from public.groups),
      'spots', (select count(*) from public.spots where deleted_at is null), 'ratings', (select count(*) from public.ratings),
      'dishes', (select count(*) from public.dishes), 'photos', (select count(*) from public.dishes where photo_path is not null),
      'lookups', (select coalesce(sum(n), 0) from public.lookup_usage where day > current_date - 30)),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'username', coalesce(p.username, p.display_name), 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'banned', coalesce(u.banned_until > now(), false),
        'super_admin', exists (select 1 from public.super_admins sa where sa.user_id = u.id),
        'spots', (select count(*) from public.spots s where s.created_by = u.id),
        'ratings', (select count(*) from public.ratings r where r.created_by = u.id),
        'photos', (select count(*) from public.dishes d where d.created_by = u.id and d.photo_path is not null),
        'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role) order by g.name)
                   from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = u.id), '[]'::jsonb))
      order by lower(coalesce(p.username, p.display_name)))
      from auth.users u left join public.profiles p on p.id = u.id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'created_at', g.created_at, 'invite_code', g.invite_code,
        'public_link', g.share_token is not null,
        'spots', (select count(*) from public.spots s where s.group_id = g.id and s.deleted_at is null),
        'ratings', (select count(*) from public.ratings r where r.group_id = g.id),
        'photos', (select count(*) from public.dishes d where d.group_id = g.id and d.photo_path is not null),
        'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', coalesce(p.username, p.display_name), 'role', m.role)
                    order by m.role, lower(coalesce(p.username, p.display_name)))
                    from public.group_members m left join public.profiles p on p.id = m.user_id where m.group_id = g.id), '[]'::jsonb))
      order by lower(g.name))
      from public.groups g), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_set_password(uid uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_super_admin();
  if length(coalesce(new_password, '')) < 6 then raise exception 'Passwort zu kurz (mind. 6 Zeichen)'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)), updated_at = now() where id = uid;
  if not found then raise exception 'Nutzer nicht gefunden'; end if;
  delete from auth.sessions where user_id = uid;
  delete from auth.refresh_tokens where user_id = uid::text;
end $$;

create or replace function public.admin_set_banned(uid uuid, banned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  if uid = auth.uid() then raise exception 'Du kannst dich nicht selbst sperren'; end if;
  update auth.users set banned_until = case when banned then now() + interval '100 years' else null end, updated_at = now() where id = uid;
  if banned then
    delete from auth.sessions where user_id = uid;
    delete from auth.refresh_tokens where user_id = uid::text;
  end if;
end $$;

create or replace function public.admin_set_super_admin(uid uuid, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  if not enabled and uid = auth.uid() then raise exception 'Du kannst dir die Super-Admin-Rechte nicht selbst entziehen'; end if;
  if enabled then
    insert into public.super_admins (user_id, granted_by) values (uid, auth.uid()) on conflict do nothing;
  else
    delete from public.super_admins where user_id = uid;
  end if;
end $$;

-- Nutzer löschen. keep_content = true: Spots, Besuche, Bewertungen, Gerichte, Kommentare gehen auf den Admin über.
-- Rückgabe: Speicherpfade mitgelöschter Fotos (die App entfernt die Dateien).
create or replace function public.admin_delete_user(uid uuid, keep_content boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); paths jsonb;
begin
  perform public._require_super_admin();
  if uid = me then raise exception 'Du kannst dich nicht selbst löschen'; end if;
  update public.groups set created_by = me where created_by = uid;
  update public.group_members gm set role = 'admin'
   where (gm.group_id, gm.user_id) in (
     select distinct on (m.group_id) m.group_id, m.user_id from public.group_members m
      where m.user_id <> uid and m.group_id in (
        select a.group_id from public.group_members a where a.user_id = uid and a.role = 'admin'
          and not exists (select 1 from public.group_members b where b.group_id = a.group_id and b.role = 'admin' and b.user_id <> uid))
      order by m.group_id, m.joined_at);
  if keep_content then
    -- Bewertungen: wo der Admin selbst schon bewertet hat, bleibt seine eigene
    select coalesce(jsonb_agg(d.photo_path) filter (where d.photo_path is not null), '[]'::jsonb) into paths
      from public.dishes d join public.ratings r on r.id = d.rating_id
     where r.created_by = uid and exists (select 1 from public.ratings x where x.spot_id = r.spot_id and x.created_by = me);
    delete from public.ratings r where r.created_by = uid and exists (select 1 from public.ratings x where x.spot_id = r.spot_id and x.created_by = me);
    update public.spots    set created_by = me where created_by = uid;
    update public.visits   set created_by = me where created_by = uid;
    update public.ratings  set created_by = me where created_by = uid;
    update public.dishes   set created_by = me where created_by = uid;
    update public.comments set created_by = me where created_by = uid;
    delete from public.spot_wants w where w.created_by = uid and exists (select 1 from public.spot_wants x where x.spot_id = w.spot_id and x.created_by = me);
    update public.spot_wants set created_by = me where created_by = uid;
  else
    select coalesce(jsonb_agg(d.photo_path), '[]'::jsonb) into paths from public.dishes d
     where d.photo_path is not null and (d.created_by = uid or d.spot_id in (select id from public.spots where created_by = uid));
  end if;
  delete from auth.users where id = uid;
  return jsonb_build_object('photo_paths', paths);
end $$;

create or replace function public.admin_remove_member(gid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  delete from public.group_members where group_id = gid and user_id = uid;
end $$;

create or replace function public.admin_set_member(gid uuid, uid uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  if new_role not in ('admin', 'member') then raise exception 'Ungültige Rolle'; end if;
  insert into public.group_members (group_id, user_id, role) values (gid, uid, new_role)
  on conflict (group_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.admin_rename_group(gid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  if char_length(trim(coalesce(new_name, ''))) not between 1 and 80 then raise exception 'Name ungültig'; end if;
  update public.groups set name = trim(new_name) where id = gid;
end $$;

create or replace function public.admin_rename_user(uid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  perform public._set_username(uid, new_name);
end $$;

create or replace function public.admin_delete_group(gid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare paths jsonb;
begin
  perform public._require_super_admin();
  select coalesce(jsonb_agg(photo_path), '[]'::jsonb) into paths from public.dishes where group_id = gid and photo_path is not null;
  delete from public.groups where id = gid;
  return jsonb_build_object('photo_paths', paths);
end $$;

-- Länderküchen pflegen (Super-Admins)
create or replace function public.admin_upsert_cuisine(c_key text, c_name text, c_emoji text, c_region text, c_sort int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_super_admin();
  if c_key !~ '^[a-z_]{2,30}$' then raise exception 'Schlüssel ungültig (nur a–z und _)'; end if;
  if char_length(trim(coalesce(c_name, ''))) not between 1 and 40 then raise exception 'Name ungültig'; end if;
  insert into public.cuisines (key, name_de, emoji, region, sort)
  values (c_key, trim(c_name), coalesce(nullif(trim(c_emoji), ''), '🍽️'), coalesce(nullif(trim(c_region), ''), 'Sonstige'), coalesce(c_sort, 100))
  on conflict (key) do update set name_de = excluded.name_de, emoji = excluded.emoji, region = excluded.region, sort = excluded.sort;
end $$;

-- ---------- Mengenbegrenzung der Restaurant-Suche (nur Edge Function) ----------
create table if not exists public.lookup_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.lookup_usage enable row level security;

create or replace function public.count_lookup(uid uuid, max_per_day int) returns boolean
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.lookup_usage (user_id, day, n) values (uid, current_date, 1)
  on conflict (user_id, day) do update set n = public.lookup_usage.n + 1
  returning n into c;
  return c <= max_per_day;
end $$;

-- ---------- Echtzeit ----------
do $$
declare t text;
begin
  foreach t in array array['comments', 'group_members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Rechte für Funktionen ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('handle_new_user', 'fill_group_from_spot', 'keep_group_admin', 'name_taken', 'signup_precheck',
                     'lock_owner_cols', 'touch_updated_at', '_set_username', '_require_super_admin', 'count_lookup') then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- Ohne Anmeldung erreichbar: Einladungscode prüfen, Lese-Link
grant execute on function public.check_invite(text) to anon;
grant execute on function public.public_group_data(text) to anon;
grant execute on function public.share_token_path(text) to anon;
