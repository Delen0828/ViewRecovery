begin;
-- Short identifiers exist in the legacy archive. New registrations still use
-- the 3-character reservation rule; only the protected importer creates these.
alter table public.profiles drop constraint profiles_display_username_check;
alter table public.profiles add constraint profiles_display_username_check check(length(display_username) between 1 and 32);
alter table private.account_identifiers drop constraint account_identifiers_normalized_username_check;
alter table private.account_identifiers add constraint account_identifiers_normalized_username_check check(normalized_username ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

alter table public.artifacts add column kind text;
alter table public.artifacts add column bytes bigint check(bytes>=0);
alter table public.artifacts add column row_count integer check(row_count>=0);
alter table public.artifacts add column legacy_user_id text;
alter table public.artifacts add column task text;
alter table public.artifacts add column identity_status text check(identity_status in ('matched','row-only','conflict','unassigned'));
create index artifacts_participant on public.artifacts(participant_id,created_at);

create function public.account_access() returns text language sql stable security definer set search_path='' as $$
 select case when private.is_admin() then 'admin' else 'participant' end;
$$;
revoke all on function public.account_access() from public,anon;
grant execute on function public.account_access() to authenticated;

create function public.admin_user_status(search text default '', page_offset integer default 0)
returns table(auth_user_id uuid,participant_id uuid,username text,provenance text,
              file_count bigint,source_rows bigint,run_count bigint,last_run_at timestamptz,total_users bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if page_offset<0 or page_offset>1000000 or length(search)>32 then raise exception 'Invalid user page'; end if;
 return query select p.auth_user_id,t.id,p.display_username,t.provenance,
 (select count(*) from public.artifacts a where a.participant_id=t.id),
 (select coalesce(sum(a.row_count),0)::bigint from public.artifacts a where a.participant_id=t.id),
 (select count(*) from public.experiment_runs r where r.participant_id=t.id),
 (select max(r.started_at) from public.experiment_runs r where r.participant_id=t.id),count(*) over()
 from public.profiles p join public.participants t on t.auth_user_id=p.auth_user_id
 where strpos(lower(p.display_username),lower(search))>0
 order by lower(p.display_username),p.auth_user_id limit 50 offset page_offset;
end $$;
revoke all on function public.admin_user_status(text,integer) from public,anon;
grant execute on function public.admin_user_status(text,integer) to authenticated;

drop policy display_read on public.display_profiles;
create policy display_read on public.display_profiles for select to authenticated using(auth_user_id=auth.uid() or private.is_admin());
drop policy training_read on public.training_settings;
create policy training_read on public.training_settings for select to authenticated using(private.owns_participant(participant_id) or private.is_admin());
commit;
