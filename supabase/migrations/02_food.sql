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
