-- FoodiSpots – Prüfung der Zugriffsrechte (RLS) gegen die echte Datenbank.
-- Ein einziger Block, der am Ende absichtlich mit einem Fehler endet: dadurch wird ALLES zurückgerollt.
-- Die Fehlermeldung enthält das Ergebnis. „FEHLER“ darf darin nirgends stehen.
-- Läuft nur auf einer Datenbank ohne Nutzer sinnvoll (Marcel = erstes Konto).
do $t$
declare r text[] := '{}'; n int; g uuid; M uuid := '11111111-1111-1111-1111-111111111111'; B uuid := '22222222-2222-2222-2222-222222222222'; C uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
  values (M,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','marcel@nutzer.foodispots.invalid','{"username":"Marcel"}', now());
  select count(*) into n from public.super_admins where user_id=M; r := r || ('Marcel ist Super-Admin: '||n);
  perform set_config('request.jwt.claims', json_build_object('sub',M,'role','authenticated')::text, true);
  set local role authenticated;
  select id into g from public.create_group('Foodies'); r := r || ('Gruppe gegründet: '||(g is not null));
  insert into public.spots (group_id, name, lat, lng, cuisines, created_by) values (g, 'Delphi', 50.36, 7.59, '{greek}', M);
  reset role;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values (B,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bernd@nutzer.foodispots.invalid','{"username":"Bernd"}');
    r := r || 'Registrierung ohne Code: FEHLER durchgelassen'::text;
  exception when others then r := r || 'Registrierung ohne Code: abgelehnt ✓'::text; end;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select B,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bernd@nutzer.foodispots.invalid', jsonb_build_object('username','Bernd','invite_code', invite_code) from public.groups where id=g;
  select count(*) into n from public.group_members where user_id=B; r := r || ('Bernd per Gruppencode Mitglied: '||n);
  select count(*) into n from public.super_admins where user_id=B; r := r || ('Bernd Super-Admin (0 erwartet): '||n);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select C,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','carla@nutzer.foodispots.invalid', jsonb_build_object('username','Carla','invite_code', invite_code) from public.groups where id=g;
  delete from public.group_members where user_id=C;
  perform set_config('request.jwt.claims', json_build_object('sub',B,'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.spot_wants (spot_id, created_by) select id, B from public.spots;
  insert into public.ratings (spot_id, created_by, overall, comment) select id, B, 4, 'lecker' from public.spots;
  insert into public.dishes (rating_id, spot_id, created_by, name, stars) select r2.id, r2.spot_id, B, 'Gyros-Teller', 5 from public.ratings r2;
  perform set_config('request.jwt.claims', json_build_object('sub',M,'role','authenticated')::text, true);
  insert into public.ratings (spot_id, created_by, overall) select id, M, 2 from public.spots;
  select count(*) into n from public.ratings; r := r || ('Marcel sieht Bewertungen (2 erwartet): '||n);
  update public.ratings set overall = 1 where created_by=B; get diagnostics n = row_count;
  r := r || ('Marcel ändert Bernds Bewertung (0 erwartet): '||n);
  begin
    insert into public.dishes (rating_id, spot_id, created_by, name) select r2.id, r2.spot_id, M, 'Hack' from public.ratings r2 where r2.created_by=B;
    r := r || 'Gericht an fremde Bewertung: FEHLER durchgelassen'::text;
  exception when others then r := r || 'Gericht an fremde Bewertung: abgelehnt ✓'::text; end;
  begin
    update public.spots set created_by = B;
    if exists (select 1 from public.spots where created_by=B) then r := r || 'Urheber eines Spots ändern: FEHLER durchgelassen'::text;
    else r := r || 'Urheber eines Spots ändern: wirkungslos ✓'::text; end if;
  exception when others then r := r || 'Urheber eines Spots ändern: abgelehnt ✓'::text; end;
  begin
    perform public.admin_overview(); r := r || 'Marcel öffnet Admin-Übersicht: erlaubt ✓'::text;
  exception when others then r := r || ('Marcel öffnet Admin-Übersicht: FEHLER '||sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub',B,'role','authenticated')::text, true);
  begin
    update public.dishes set photo_path = 'fremde-gruppe/x/y.webp';
    if exists (select 1 from public.dishes where photo_path like 'fremde-gruppe/%') then r := r || 'Fotopfad außerhalb der Gruppe: FEHLER durchgelassen'::text;
    else r := r || 'Fotopfad außerhalb der Gruppe: wirkungslos ✓'::text; end if;
  exception when others then r := r || 'Fotopfad außerhalb der Gruppe: abgelehnt ✓'::text; end;
  begin
    perform public.admin_overview(); r := r || 'Bernd öffnet Admin-Übersicht: FEHLER durchgelassen'::text;
  exception when others then r := r || 'Bernd öffnet Admin-Übersicht: abgelehnt ✓'::text; end;
  perform set_config('request.jwt.claims', json_build_object('sub',C,'role','authenticated')::text, true);
  r := r || ('Carla (fremd) sieht Spots/Bewertungen/Gerichte (0/0/0 erwartet): '||(select count(*) from public.spots)||'/'||(select count(*) from public.ratings)||'/'||(select count(*) from public.dishes));
  begin
    insert into public.spots (group_id, name, lat, lng, created_by) values (g, 'Hack', 1, 1, C);
    r := r || 'Carla trägt in fremde Gruppe ein: FEHLER durchgelassen'::text;
  exception when others then r := r || 'Carla trägt in fremde Gruppe ein: abgelehnt ✓'::text; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.create_group('anon'); r := r || 'Ohne Anmeldung Gruppe gründen: FEHLER durchgelassen'::text;
  exception when others then r := r || 'Ohne Anmeldung Gruppe gründen: abgelehnt ✓'::text; end;
  begin
    select count(*) into n from public.spots; r := r || ('Ohne Anmeldung sichtbare Spots (0 erwartet): '||n);
  exception when others then r := r || 'Ohne Anmeldung Spots lesen: abgelehnt ✓'::text; end;
  begin
    select count(*) into n from public.profiles; r := r || ('Ohne Anmeldung sichtbare Profile (0 erwartet): '||n);
  exception when others then r := r || 'Ohne Anmeldung Profile lesen: abgelehnt ✓'::text; end;
  reset role;
  raise exception 'ERGEBNIS (alles zurückgerollt): %', array_to_string(r, ' | ');
end $t$;
