begin;
-- Only server-managed roles can reserve names or inspect identity mappings.
create function private.reserve_username(username text) returns uuid
language plpgsql security definer set search_path='' as $$
declare normalized text := lower(btrim(username)); token uuid;
begin
 if normalized !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then raise exception 'Invalid username'; end if;
 -- Unique constraint arbitrates concurrent claims. Expired pending reservations may be replaced.
 insert into private.account_identifiers(normalized_username,expires_at)
 values(normalized,now()+interval '15 minutes')
 on conflict(normalized_username) do update set reservation_id=gen_random_uuid(),expires_at=excluded.expires_at
 where private.account_identifiers.auth_user_id is null and private.account_identifiers.expires_at<now()
 returning reservation_id into token;
 if token is null then raise exception 'Username unavailable' using errcode='23505'; end if;
 return token;
end $$;

create function private.register_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare label text; normalized text; token uuid;
begin
 label := btrim(new.raw_user_meta_data->>'username'); normalized := lower(label);
 token := (new.raw_user_meta_data->>'username_reservation')::uuid;
 if token is null or normalized is null then raise exception 'Controlled registration required'; end if;
 update private.account_identifiers set auth_user_id=new.id,expires_at=null
 where normalized_username=normalized and reservation_id=token and auth_user_id is null and expires_at>now();
 if not found then raise exception 'Invalid or expired username reservation'; end if;
 insert into public.profiles(auth_user_id,display_username) values(new.id,label);
 insert into public.participants(auth_user_id,provenance) values(new.id,'registration');
 -- Never grant study scope, enroll, or attach legacy identities based on user metadata.
 return new;
end $$;
create trigger registered_identity after insert on auth.users for each row execute function private.register_auth_user();

create table private.auth_rate_limits (
 key_hash text primary key, window_start timestamptz not null, attempts integer not null check(attempts>0)
);
create function private.consume_auth_limit(key_hash text, maximum integer, window_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if maximum not between 1 and 100 or window_seconds not between 1 and 3600 or length(key_hash)<>64 then raise exception 'Invalid rate limit'; end if;
 insert into private.auth_rate_limits values(key_hash,now(),1)
 on conflict on constraint auth_rate_limits_pkey do update set
  attempts=case when private.auth_rate_limits.window_start < now()-make_interval(secs=>window_seconds) then 1 else private.auth_rate_limits.attempts+1 end,
  window_start=case when private.auth_rate_limits.window_start < now()-make_interval(secs=>window_seconds) then now() else private.auth_rate_limits.window_start end
 returning attempts into used;
 return used<=maximum;
end $$;

-- Permit a narrow server wrapper through the exposed schema; never grant clients this RPC.
create function public.reserve_username(username text) returns uuid language sql security definer set search_path='' as $$
 select private.reserve_username(username);
$$;
create function public.consume_auth_limit(key_hash text, maximum integer, window_seconds integer) returns boolean language sql security definer set search_path='' as $$
 select private.consume_auth_limit(key_hash,maximum,window_seconds);
$$;
create function public.username_auth_email(username text) returns text language sql stable security definer set search_path='' as $$
 select u.email from private.account_identifiers i join auth.users u on u.id=i.auth_user_id where i.normalized_username=lower(btrim(username));
$$;
revoke all on function public.reserve_username(text),public.consume_auth_limit(text,integer,integer),public.username_auth_email(text) from public,anon,authenticated;
grant execute on function public.reserve_username(text),public.consume_auth_limit(text,integer,integer),public.username_auth_email(text) to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(),private.researches(uuid),private.owns_participant(uuid),private.can_read_run(uuid) to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;

create unique index one_completed_attempt on public.trial_attempts(run_id,logical_trial_number) where state='completed';
commit;
