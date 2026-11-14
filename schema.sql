-- =====================================================================
-- FoodiSpots – komplettes Datenbankschema für eine Neuinstallation
-- Entspricht den Migrationen in supabase/migrations/ (in dieser Reihenfolge).
-- Im Supabase SQL-Editor komplett einfügen und ausführen.
-- =====================================================================

-- ---------- 01_schema.sql ----------
-- FoodiSpots – Grundschema (Benutzer/Gruppen nach Vorbild der Pilzkarte)
create extension if not exists pgcrypto with schema extensions;

-- ---------- Hilfsfunktionen für Namen ----------
create or replace function public.login_slug(n text) returns text
language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(lower(trim(n)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss');
$$;

create or replace function public.login_email(n text) returns text
language sql immutable set search_path = public as $$
  select public.login_slug(n) || '@nutzer.foodispots.invalid';
$$;

create or replace function public.name_skeleton(n text) returns text
language sql immutable set search_path = public as $$
  select translate(
           replace(replace(replace(replace(lower(trim(n)), 'ae', 'a'), 'oe', 'o'), 'ue', 'u'), 'ß', 'ss'),
           'äöü0._-', 'aouo');
$$;

create or replace function public.valid_username(n text) returns boolean
language sql immutable set search_path = public as $$
  select n is not null and n ~ '^[A-Za-zÄÖÜäöüß0-9._-]{3,30}$';
$$;

-- ---------- Tabellen: Benutzer & Gruppen ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.signup_invites (
  code text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  note text check (note is null or length(note) <= 60),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);

-- ---------- Rechte-Helfer ----------
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (select 1 from public.group_members
         where group_id = gid and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.shares_group_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members a
                 join public.group_members b on a.group_id = b.group_id
                 where a.user_id = auth.uid() and b.user_id = uid);
$$;

create or replace function public.invite_open(i public.signup_invites) returns boolean
language sql stable set search_path = public as $$
  select i.used_by is null and i.used_at is null and i.revoked_at is null and i.expires_at > now();
$$;

create or replace function public.name_taken(new_name text, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id is distinct from uid and p.username is not null
                   and (public.login_slug(p.username) = public.login_slug(new_name)
                        or public.name_skeleton(p.username) = public.name_skeleton(new_name)))
      or exists (select 1 from auth.users u where u.id is distinct from uid and lower(u.email) = public.login_email(new_name));
$$;

-- ---------- Registrierung ----------
create or replace function public.check_invite(code text) returns text
language plpgsql stable security definer set search_path = public as $$
declare c text := upper(trim(coalesce(code, '')));
begin
  if not exists (select 1 from auth.users) then return 'open'; end if;
  if exists (select 1 from public.groups g where g.invite_code = c) then return 'ok'; end if;
  if exists (select 1 from public.signup_invites s where s.code = c and public.invite_open(s)) then return 'ok'; end if;
  return 'invalid';
end $$;

-- Vorprüfung für die Edge Function "signup" (nur service_role)
create or replace function public.signup_precheck(username text, code text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.valid_username(trim(username)) then
    return 'Name ungültig: 3–30 Zeichen, nur Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich';
  end if;
  if public.name_taken(trim(username), null) then
    return 'Name ist schon vergeben (oder zu ähnlich zu einem anderen)';
  end if;
  if public.check_invite(code) = 'invalid' then
    return 'Einladungscode ungültig oder abgelaufen';
  end if;
  return 'ok';
end $$;

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
  if first_user then
    insert into public.super_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  if gid is not null then
    insert into public.group_members (group_id, user_id, role) values (gid, new.id, 'member') on conflict do nothing;
  elsif inv is not null then
    update public.signup_invites s set used_by = new.id, used_at = now() where s.code = inv;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_signup_invite(note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c text; alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; i int; inv public.signup_invites;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  if (select count(*) from public.signup_invites s where s.created_by = me and public.invite_open(s)) >= 10 then
    raise exception 'Höchstens 10 offene Einladungen gleichzeitig. Widerrufe zuerst eine alte.';
  end if;
  loop
    b := extensions.gen_random_bytes(10); c := '';
    for i in 0..9 loop c := c || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1); end loop;
    exit when not exists (select 1 from public.signup_invites s where s.code = c);
  end loop;
  insert into public.signup_invites (code, created_by, note) values (c, me, nullif(trim(note), ''))
  returning * into inv;
  return jsonb_build_object('code', inv.code, 'expires_at', inv.expires_at, 'note', inv.note);
end $$;

create or replace function public.my_signup_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', s.code, 'note', s.note, 'created_at', s.created_at, 'expires_at', s.expires_at,
    'used_at', s.used_at, 'used_by_name', p.username, 'revoked_at', s.revoked_at,
    'status', case when s.used_at is not null then 'used' when s.revoked_at is not null then 'revoked'
                   when s.expires_at <= now() then 'expired' else 'open' end
  ) order by s.created_at desc), '[]'::jsonb)
  from public.signup_invites s left join public.profiles p on p.id = s.used_by
  where s.created_by = auth.uid();
$$;

create or replace function public.revoke_signup_invite(code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.signup_invites s set revoked_at = now()
   where s.code = upper(trim(revoke_signup_invite.code)) and s.used_at is null and s.revoked_at is null
     and (s.created_by = auth.uid() or public.is_super_admin());
  if not found then raise exception 'Einladung nicht gefunden oder schon benutzt'; end if;
end $$;

-- ---------- Gruppen-RPCs ----------
create or replace function public.create_group(group_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.groups (name, created_by) values (trim(group_name), auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, auth.uid(), 'admin');
  return g;
end $$;

create or replace function public.join_group(code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into g from public.groups where invite_code = upper(trim(code));
  if not found then raise exception 'Einladungscode ungültig'; end if;
  insert into public.group_members (group_id, user_id, role) values (g.id, auth.uid(), 'member') on conflict do nothing;
  return g;
end $$;

create or replace function public.regenerate_invite_code(gid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin(gid) then raise exception 'Nur Admins'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.groups set invite_code = c where id = gid;
  return c;
end $$;

create or replace function public.set_member_role(gid uuid, uid uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(gid) then raise exception 'Nur Admins'; end if;
  if new_role not in ('admin', 'member') then raise exception 'Ungültige Rolle'; end if;
  update public.group_members set role = new_role where group_id = gid and user_id = uid;
end $$;

create or replace function public.keep_group_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin'
     and exists (select 1 from public.groups g where g.id = old.group_id)
     and not exists (select 1 from public.group_members m where m.group_id = old.group_id and m.role = 'admin') then
    update public.group_members set role = 'admin'
     where group_id = old.group_id
       and user_id = (select m.user_id from public.group_members m where m.group_id = old.group_id order by m.joined_at limit 1);
  end if;
  return null;
end $$;

create trigger keep_group_admin after update or delete on public.group_members
  for each row execute function public.keep_group_admin();

create or replace function public.rename_me(new_name text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text;
begin
  if uid is null then raise exception 'Nicht angemeldet'; end if;
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

-- ---------- RLS: Benutzer & Gruppen ----------
alter table public.profiles enable row level security;
alter table public.super_admins enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.signup_invites enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id) or public.is_super_admin());

create policy super_admins_select on public.super_admins for select to authenticated
  using (user_id = auth.uid());

create policy groups_select on public.groups for select to authenticated
  using (public.is_member(id) or public.is_super_admin());
create policy groups_update on public.groups for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.is_admin(id));

create policy members_select on public.group_members for select to authenticated
  using (public.is_member(group_id) or public.is_super_admin());
create policy members_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() or public.is_admin(group_id));
-- signup_invites: nur über RPCs

revoke all on function public.signup_precheck(text, text) from public, anon, authenticated;
grant execute on function public.signup_precheck(text, text) to service_role;

-- ---------- 02_food.sql ----------
-- FoodiSpots – Spots, Wünsche, Besuche, Bewertungen, Gerichte

create table public.cuisines (
  key text primary key,
  name_de text not null,
  emoji text not null default '🍽️',
  region text not null default 'Sonstige',
  sort int not null default 100
);

insert into public.cuisines (key, name_de, emoji, region, sort) values
 ('german','Deutsch','🇩🇪','Europa',10),
 ('austrian','Österreichisch','🇦🇹','Europa',11),
 ('swiss','Schweizerisch','🇨🇭','Europa',12),
 ('french','Französisch','🇫🇷','Europa',13),
 ('belgian','Belgisch','🇧🇪','Europa',14),
 ('dutch','Niederländisch','🇳🇱','Europa',15),
 ('british','Britisch','🇬🇧','Europa',16),
 ('irish','Irisch','🇮🇪','Europa',17),
 ('scandinavian','Skandinavisch','🇸🇪','Europa',18),
 ('polish','Polnisch','🇵🇱','Osteuropa',20),
 ('czech','Tschechisch','🇨🇿','Osteuropa',21),
 ('hungarian','Ungarisch','🇭🇺','Osteuropa',22),
 ('russian','Russisch','🇷🇺','Osteuropa',23),
 ('ukrainian','Ukrainisch','🇺🇦','Osteuropa',24),
 ('georgian','Georgisch','🇬🇪','Osteuropa',25),
 ('italian','Italienisch','🇮🇹','Mittelmeer',30),
 ('spanish','Spanisch','🇪🇸','Mittelmeer',31),
 ('portuguese','Portugiesisch','🇵🇹','Mittelmeer',32),
 ('greek','Griechisch','🇬🇷','Mittelmeer',33),
 ('croatian','Kroatisch','🇭🇷','Balkan',40),
 ('serbian','Serbisch','🇷🇸','Balkan',41),
 ('bosnian','Bosnisch','🇧🇦','Balkan',42),
 ('albanian','Albanisch','🇦🇱','Balkan',43),
 ('bulgarian','Bulgarisch','🇧🇬','Balkan',44),
 ('balkan','Balkan','🌶️','Balkan',45),
 ('turkish','Türkisch','🇹🇷','Orient',50),
 ('lebanese','Libanesisch','🇱🇧','Orient',51),
 ('syrian','Syrisch','🇸🇾','Orient',52),
 ('persian','Persisch','🇮🇷','Orient',53),
 ('israeli','Israelisch','🇮🇱','Orient',54),
 ('arab','Arabisch','🧆','Orient',55),
 ('moroccan','Marokkanisch','🇲🇦','Afrika',60),
 ('ethiopian','Äthiopisch','🇪🇹','Afrika',61),
 ('african','Afrikanisch','🌍','Afrika',62),
 ('indian','Indisch','🇮🇳','Asien',70),
 ('pakistani','Pakistanisch','🇵🇰','Asien',71),
 ('nepalese','Nepalesisch','🇳🇵','Asien',72),
 ('chinese','Chinesisch','🇨🇳','Asien',73),
 ('japanese','Japanisch','🇯🇵','Asien',74),
 ('korean','Koreanisch','🇰🇷','Asien',75),
 ('vietnamese','Vietnamesisch','🇻🇳','Asien',76),
 ('thai','Thailändisch','🇹🇭','Asien',77),
 ('indonesian','Indonesisch','🇮🇩','Asien',78),
 ('filipino','Philippinisch','🇵🇭','Asien',79),
 ('asian','Asiatisch','🥢','Asien',80),
 ('american','Amerikanisch','🇺🇸','Amerika',90),
 ('mexican','Mexikanisch','🇲🇽','Amerika',91),
 ('peruvian','Peruanisch','🇵🇪','Amerika',92),
 ('brazilian','Brasilianisch','🇧🇷','Amerika',93),
 ('argentinian','Argentinisch','🇦🇷','Amerika',94),
 ('caribbean','Karibisch','🌴','Amerika',95),
 ('hawaiian','Hawaiianisch','🌺','Amerika',96),
 ('international','International','🌐','Sonstige',200),
 ('fusion','Fusion','✨','Sonstige',201);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  address text not null default '',
  city text not null default '',
  osm_type text,
  osm_id bigint,
  cuisines text[] not null default '{}',
  cuisine_guessed boolean not null default false,
  category text not null default 'restaurant'
    check (category in ('restaurant','imbiss','cafe','bar','foodtruck','eis','baeckerei','sonstiges')),
  focus text[] not null default '{}',
  price_level smallint check (price_level between 1 and 4),
  description text not null default '' check (char_length(description) <= 1000),
  specialties text[] not null default '{}',
  website text not null default '',
  phone text not null default '',
  opening_hours text not null default '',
  diet_veg boolean,
  diet_vegan boolean,
  source_urls text[] not null default '{}',
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz
);
create index on public.spots (group_id) where deleted_at is null;

create table public.spot_wants (
  spot_id uuid not null references public.spots(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (spot_id, user_id)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  visited_on date not null default current_date,
  participants uuid[] not null default '{}',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.visits (spot_id);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  overall smallint not null check (overall between 1 and 5),
  food smallint check (food between 1 and 5),
  service smallint check (service between 1 and 5),
  ambience smallint check (ambience between 1 and 5),
  value smallint check (value between 1 and 5),
  would_return boolean,
  comment text not null default '' check (char_length(comment) <= 2000),
  visited_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (spot_id, user_id)
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null references public.ratings(id) on delete cascade,
  spot_id uuid not null references public.spots(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  stars smallint check (stars between 1 and 5),
  price_cents integer check (price_cents between 0 and 1000000),
  note text not null default '' check (char_length(note) <= 500),
  photo_path text,
  thumb_path text,
  created_at timestamptz not null default now()
);
create index on public.dishes (spot_id);
create index on public.dishes (rating_id);

-- ---------- Trigger: Gruppe vom Spot übernehmen, Felder sperren ----------
create or replace function public.fill_group_from_spot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.group_id into new.group_id from public.spots s where s.id = new.spot_id and s.deleted_at is null;
  if new.group_id is null then raise exception 'Spot nicht gefunden'; end if;
  if tg_table_name = 'dishes' then
    if not exists (select 1 from public.ratings r where r.id = new.rating_id
                   and r.spot_id = new.spot_id and r.user_id = new.user_id) then
      raise exception 'Gericht gehört nicht zu deiner Bewertung';
    end if;
  end if;
  return new;
end $$;

create trigger fill_group before insert on public.spot_wants for each row execute function public.fill_group_from_spot();
create trigger fill_group before insert on public.visits for each row execute function public.fill_group_from_spot();
create trigger fill_group before insert on public.ratings for each row execute function public.fill_group_from_spot();
create trigger fill_group before insert on public.dishes for each row execute function public.fill_group_from_spot();

create or replace function public.lock_owner_cols() returns trigger
language plpgsql set search_path = public as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); c text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  foreach c in array array['created_by', 'group_id', 'spot_id', 'user_id', 'rating_id', 'photo_path', 'thumb_path'] loop
    if o ? c and (o -> c) is distinct from (n -> c) then
      if c in ('photo_path', 'thumb_path') and (o -> c) = 'null'::jsonb then continue; end if;
      raise exception 'Feld % kann nicht geändert werden', c using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create trigger lock_cols before update on public.spots for each row execute function public.lock_owner_cols();
create trigger lock_cols before update on public.visits for each row execute function public.lock_owner_cols();
create trigger lock_cols before update on public.ratings for each row execute function public.lock_owner_cols();
create trigger lock_cols before update on public.dishes for each row execute function public.lock_owner_cols();
create trigger lock_cols before update on public.groups for each row execute function public.lock_owner_cols();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  if tg_table_name = 'spots' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

create trigger touch before update on public.spots for each row execute function public.touch_updated_at();
create trigger touch before update on public.ratings for each row execute function public.touch_updated_at();

-- ---------- Übersicht pro Spot (RLS greift über security_invoker) ----------
create view public.spot_summary with (security_invoker = true) as
select s.*,
  (select round(avg(r.overall)::numeric, 2) from public.ratings r where r.spot_id = s.id) as avg_overall,
  (select count(*) from public.ratings r where r.spot_id = s.id)::int as rating_count,
  (select count(*) from public.spot_wants w where w.spot_id = s.id)::int as want_count,
  exists (select 1 from public.spot_wants w where w.spot_id = s.id and w.user_id = auth.uid()) as i_want,
  (select r.overall from public.ratings r where r.spot_id = s.id and r.user_id = auth.uid()) as my_rating,
  greatest((select max(v.visited_on) from public.visits v where v.spot_id = s.id),
           (select max(r.visited_on) from public.ratings r where r.spot_id = s.id)) as last_visit,
  (exists (select 1 from public.visits v where v.spot_id = s.id)
   or exists (select 1 from public.ratings r where r.spot_id = s.id)) as visited,
  (select d.thumb_path from public.dishes d where d.spot_id = s.id and d.thumb_path is not null
     order by d.stars desc nulls last, d.created_at desc limit 1) as cover_thumb
from public.spots s
where s.deleted_at is null;

-- ---------- RLS ----------
alter table public.cuisines enable row level security;
alter table public.spots enable row level security;
alter table public.spot_wants enable row level security;
alter table public.visits enable row level security;
alter table public.ratings enable row level security;
alter table public.dishes enable row level security;

create policy cuisines_read on public.cuisines for select to anon, authenticated using (true);

create policy spots_select on public.spots for select to authenticated using (public.is_member(group_id));
create policy spots_insert on public.spots for insert to authenticated
  with check (public.is_member(group_id) and created_by = auth.uid());
create policy spots_update on public.spots for update to authenticated
  using (public.is_member(group_id)) with check (public.is_member(group_id));
create policy spots_delete on public.spots for delete to authenticated
  using (created_by = auth.uid() or public.is_admin(group_id));

create policy wants_select on public.spot_wants for select to authenticated using (public.is_member(group_id));
create policy wants_insert on public.spot_wants for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));
create policy wants_delete on public.spot_wants for delete to authenticated using (user_id = auth.uid());

create policy visits_select on public.visits for select to authenticated using (public.is_member(group_id));
create policy visits_insert on public.visits for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(group_id));
create policy visits_delete on public.visits for delete to authenticated
  using (created_by = auth.uid() or public.is_admin(group_id));

create policy ratings_select on public.ratings for select to authenticated using (public.is_member(group_id));
create policy ratings_insert on public.ratings for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));
create policy ratings_update on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(group_id));
create policy ratings_delete on public.ratings for delete to authenticated using (user_id = auth.uid());

create policy dishes_select on public.dishes for select to authenticated using (public.is_member(group_id));
create policy dishes_insert on public.dishes for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));
create policy dishes_update on public.dishes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dishes_delete on public.dishes for delete to authenticated using (user_id = auth.uid());

-- ---------- Storage für Gerichtfotos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function public.path_group(object_name text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy food_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'food-photos' and public.is_member(public.path_group(name)));
create policy food_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'food-photos' and public.is_member(public.path_group(name)));
create policy food_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'food-photos' and owner_id = auth.uid()::text);

-- ---------- Cache für die Restaurant-Suche (nur Edge Function) ----------
create table public.lookup_cache (
  key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.lookup_cache enable row level security;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.spots, public.ratings, public.dishes, public.spot_wants, public.visits;

-- ---------- 03_allow_photo_replace.sql ----------
create or replace function public.lock_owner_cols() returns trigger
language plpgsql set search_path = public as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); c text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  foreach c in array array['created_by', 'group_id', 'spot_id', 'user_id', 'rating_id'] loop
    if o ? c and (o -> c) is distinct from (n -> c) then
      raise exception 'Feld % kann nicht geändert werden', c using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Fotos dürfen nur im Ordner der eigenen Gruppe/des eigenen Spots liegen
alter table public.dishes add constraint dishes_photo_path_ok
  check (photo_path is null or photo_path like group_id::text || '/' || spot_id::text || '/%');
alter table public.dishes add constraint dishes_thumb_path_ok
  check (thumb_path is null or thumb_path like group_id::text || '/' || spot_id::text || '/%');

-- ---------- 04_tighten_function_grants.sql ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('handle_new_user', 'fill_group_from_spot', 'keep_group_admin', 'name_taken', 'check_invite',
                     'signup_precheck', 'lock_owner_cols', 'touch_updated_at') then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------- 05_pilzkarte_standard.sql ----------
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
-- FoodiSpots 2.1 – Vorschaubild je Spot (Webseite des Lokals, Wikimedia, eigenes Foto)
-- Dateien liegen im Bucket food-photos unter <group_id>/<spot_id>/cover-<stempel>.webp (+ -klein.webp)

alter table public.spots
  add column if not exists image_path text,
  add column if not exists image_thumb text,
  add column if not exists image_credit text,
  add column if not exists image_source text;

alter table public.spots drop constraint if exists spots_image_path_ok;
alter table public.spots add constraint spots_image_path_ok
  check (image_path is null or image_path like group_id::text || '/' || id::text || '/cover-%');
alter table public.spots drop constraint if exists spots_image_thumb_ok;
alter table public.spots add constraint spots_image_thumb_ok
  check (image_thumb is null or image_thumb like group_id::text || '/' || id::text || '/cover-%');
alter table public.spots drop constraint if exists spots_image_credit_len;
alter table public.spots add constraint spots_image_credit_len check (char_length(coalesce(image_credit, '')) <= 300);
alter table public.spots drop constraint if exists spots_image_source_ok;
alter table public.spots add constraint spots_image_source_ok
  check (image_source is null or (image_source ~* '^https?://' and char_length(image_source) <= 600));

-- Vorschaubilder darf jedes Mitglied der Gruppe ersetzen – also auch das alte Bild löschen
drop policy if exists food_photos_delete_cover on storage.objects;
create policy food_photos_delete_cover on storage.objects for delete to authenticated
  using (bucket_id = 'food-photos' and name like '%/cover-%' and public.is_member(public.path_group(name)));

-- Lese-Link: Vorschaubild mitliefern
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
        'image_path', s.image_path, 'image_thumb', s.image_thumb, 'image_credit', s.image_credit, 'image_source', s.image_source,
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

-- Gruppe löschen (Super-Admin): Vorschaubilder der Spots mit aufräumen
create or replace function public.admin_delete_group(gid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare paths jsonb;
begin
  perform public._require_super_admin();
  select coalesce(jsonb_agg(p), '[]'::jsonb) into paths from (
    select photo_path p from public.dishes where group_id = gid and photo_path is not null
    union all select image_path from public.spots where group_id = gid and image_path is not null) x;
  delete from public.groups where id = gid;
  return jsonb_build_object('photo_paths', paths);
end $$;
