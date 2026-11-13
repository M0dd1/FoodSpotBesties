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
