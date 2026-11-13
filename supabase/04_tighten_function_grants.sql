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
