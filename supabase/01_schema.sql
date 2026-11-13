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
