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
