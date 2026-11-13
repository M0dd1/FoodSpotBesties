-- FoodiSpots – Prüfung der Zugriffsrechte (RLS) gegen die echte Datenbank.
-- Läuft komplett in einer Transaktion und wird am Ende zurückgerollt: es bleiben keine Daten übrig.
-- Ergebnis: Tabelle mit Schritt und Ergebnis; „FEHLER“ darf nirgends stehen.
begin;
create temp table t_out(n serial, step text, val text) on commit drop;
grant all on t_out to authenticated, anon; grant all on sequence t_out_n_seq to authenticated, anon;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','marcel@nutzer.foodispots.invalid','{"username":"Marcel"}', now());
insert into t_out(step,val) select 'Marcel ist Super-Admin', count(*)::text from public.super_admins where user_id='11111111-1111-1111-1111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into t_out(step,val) select 'Gruppe gegründet', (public.create_group('Foodies')).name;
insert into public.spots (group_id, name, lat, lng, cuisines, created_by) select id, 'Delphi', 50.36, 7.59, '{greek}', auth.uid() from public.groups;
reset role;
do $$ begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bernd@nutzer.foodispots.invalid','{"username":"Bernd"}');
  insert into t_out(step,val) values ('Registrierung ohne Code','FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Registrierung ohne Code', 'abgelehnt ✓'); end $$;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select '22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bernd@nutzer.foodispots.invalid', jsonb_build_object('username','Bernd','invite_code', invite_code) from public.groups;
insert into t_out(step,val) select 'Bernd per Gruppencode Mitglied', count(*)::text from public.group_members where user_id='22222222-2222-2222-2222-222222222222';
insert into t_out(step,val) select 'Bernd ist kein Super-Admin', (count(*) = 0)::text from public.super_admins where user_id='22222222-2222-2222-2222-222222222222';
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select '33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','carla@nutzer.foodispots.invalid', jsonb_build_object('username','Carla','invite_code', invite_code) from public.groups;
delete from public.group_members where user_id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into public.spot_wants (spot_id, created_by, group_id) select id, auth.uid(), group_id from public.spots;
insert into public.ratings (spot_id, created_by, group_id, overall, comment) select id, auth.uid(), group_id, 4, 'lecker' from public.spots;
insert into public.dishes (rating_id, spot_id, group_id, created_by, name, stars) select r.id, r.spot_id, r.group_id, auth.uid(), 'Gyros-Teller', 5 from public.ratings r;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.ratings (spot_id, created_by, group_id, overall) select id, auth.uid(), group_id, 2 from public.spots;
insert into t_out(step,val) select 'Marcel sieht Bewertungen', count(*)::text from public.ratings;
with u as (update public.ratings set overall = 1 where created_by='22222222-2222-2222-2222-222222222222' returning 1)
insert into t_out(step,val) select 'Marcel ändert Bernds Bewertung', count(*)||' Zeilen geändert (0 erwartet)' from u;
do $$ begin
  insert into public.dishes (rating_id, spot_id, group_id, created_by, name) select r.id, r.spot_id, r.group_id, auth.uid(), 'Hack' from public.ratings r where r.created_by='22222222-2222-2222-2222-222222222222';
  insert into t_out(step,val) values ('Gericht an fremde Bewertung','FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Gericht an fremde Bewertung', 'abgelehnt ✓'); end $$;
do $$ begin
  update public.spots set created_by = '22222222-2222-2222-2222-222222222222';
  insert into t_out(step,val) values ('Urheber eines Spots ändern','FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Urheber eines Spots ändern', 'abgelehnt ✓'); end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  update public.dishes set photo_path = 'fremde-gruppe/x/y.webp';
  insert into t_out(step,val) values ('Fotopfad außerhalb der Gruppe','FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Fotopfad außerhalb der Gruppe', 'abgelehnt ✓'); end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
insert into t_out(step,val) select 'Carla (fremd) sieht Spots / Bewertungen / Gerichte', (select count(*) from public.spots)||' / '||(select count(*) from public.ratings)||' / '||(select count(*) from public.dishes)||' (0/0/0 erwartet)';
do $$ begin
  insert into public.spots (group_id, name, lat, lng, created_by) values ((select id from public.groups limit 1), 'Hack', 1, 1, auth.uid());
  insert into t_out(step,val) values ('Carla trägt in fremde Gruppe ein', 'FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Carla trägt in fremde Gruppe ein', 'abgelehnt ✓'); end $$;
do $$ begin
  perform public.admin_overview();
  insert into t_out(step,val) values ('Carla öffnet Admin-Übersicht', 'FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Carla öffnet Admin-Übersicht', 'abgelehnt ✓'); end $$;
reset role;
set local role anon;
do $$ begin
  perform public.create_group('anon');
  insert into t_out(step,val) values ('Ohne Anmeldung Gruppe gründen','FEHLER: durchgelassen');
exception when others then insert into t_out(step,val) values ('Ohne Anmeldung Gruppe gründen', 'abgelehnt ✓'); end $$;
insert into t_out(step,val) select 'Ohne Anmeldung sichtbare Spots', count(*)::text || ' (0 erwartet)' from public.spots;
reset role;
select step, val from t_out order by n;
rollback;
