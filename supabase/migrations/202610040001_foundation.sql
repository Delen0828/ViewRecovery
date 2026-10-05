begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  auth_user_id uuid primary key references auth.users(id),
  display_username text not null check (length(display_username) between 3 and 32),
  preferences jsonb not null default '{}', created_at timestamptz not null default now()
);
create table private.account_identifiers (
  normalized_username text primary key check (normalized_username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  auth_user_id uuid unique references auth.users(id),
  reservation_id uuid unique not null default gen_random_uuid(),
  expires_at timestamptz, created_at timestamptz not null default now(),
  check ((auth_user_id is null) = (expires_at is not null))
);
create table private.administrators (auth_user_id uuid primary key references auth.users(id));
create table public.participants (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id),
  provenance text not null check (provenance in ('registration', 'legacy')), created_at timestamptz not null default now()
);
create table public.studies (
  id uuid primary key default gen_random_uuid(), name text not null,
  protocol_version text not null, consent_version text not null,
  tasks text[] not null default array['Motion','Orientation','Centrality','Bar'],
  active boolean not null default false, created_at timestamptz not null default now(),
  check (tasks <@ array['Motion','Orientation','Centrality','Bar']::text[])
);
create table public.study_memberships (
  study_id uuid not null references public.studies(id), auth_user_id uuid not null references auth.users(id),
  role text not null check (role = 'researcher'), primary key(study_id, auth_user_id)
);
create table public.enrollments (
  study_id uuid not null references public.studies(id), participant_id uuid not null references public.participants(id),
  consent_version text, consented_at timestamptz, active boolean not null default false,
  primary key(study_id, participant_id), check ((consent_version is null) = (consented_at is null))
);
create table public.display_profiles (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id),
  name text not null, settings jsonb not null, version integer not null default 1 check (version > 0),
  confirmed_at timestamptz, updated_at timestamptz not null default now(), unique(auth_user_id,name)
);
create table public.training_settings (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references public.participants(id),
  study_id uuid not null references public.studies(id), task text not null check (task in ('Motion','Orientation','Centrality','Bar')),
  display_profile_id uuid not null references public.display_profiles(id), settings jsonb not null,
  version integer not null default 1 check (version > 0), confirmed_at timestamptz,
  unique(participant_id,study_id,task)
);
create table public.experiment_runs (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references public.participants(id),
  study_id uuid not null references public.studies(id), task text not null check (task in ('Motion','Orientation','Centrality','Bar')),
  protocol_version text not null, code_version text not null,
  status text not null default 'active' check (status in ('active','paused','complete','abandoned','imported')),
  started_at timestamptz not null default now(), ended_at timestamptz,
  parameter_snapshot jsonb not null, import_origin text,
  foreign key (study_id,participant_id) references public.enrollments(study_id,participant_id)
);
create table public.run_chunks (
  run_id uuid not null references public.experiment_runs(id), chunk_number integer not null check (chunk_number between 1 and 8),
  status text not null check (status in ('active','complete')), response_count integer not null default 0,
  primary key(run_id,chunk_number)
);
create table public.trial_attempts (
  id uuid primary key, run_id uuid not null references public.experiment_runs(id),
  logical_trial_number integer not null check (logical_trial_number > 0), attempt_number integer not null check (attempt_number > 0),
  task text not null check(task in ('Motion','Orientation','Centrality','Bar')), position text,
  correct boolean, reaction_time double precision check (reaction_time >= 0 and reaction_time < 'Infinity'::float8),
  difficulty jsonb, is_catch boolean not null default false,
  state text not null check (state in ('active','completed','interrupted')),
  unique(run_id,logical_trial_number,attempt_number), unique(id,run_id)
);
create table public.experiment_events (
  id uuid primary key, run_id uuid not null references public.experiment_runs(id), attempt_id uuid,
  client_sequence integer not null check(client_sequence >= 0), phase text not null check(length(phase) between 1 and 80),
  payload jsonb not null, created_at timestamptz not null default now(),
  unique(run_id,client_sequence), foreign key(attempt_id,run_id) references public.trial_attempts(id,run_id)
);
create table public.ingest_batches (
  run_id uuid not null references public.experiment_runs(id), batch_key uuid not null,
  payload_hash text not null, acknowledgement jsonb not null, created_at timestamptz not null default now(),
  primary key(run_id,batch_key)
);
create table private.import_jobs (
  id uuid primary key, archive_hash text unique not null, mapping_version text not null,
  report jsonb not null, created_at timestamptz not null default now()
);
create table private.source_files (
  id uuid primary key, import_job_id uuid not null references private.import_jobs(id),
  original_path text not null, file_hash text not null, bytes bigint not null,
  header jsonb, kind text not null, unique(import_job_id,original_path)
);
create table private.source_rows (
  source_file_id uuid not null references private.source_files(id), ordinal integer not null check (ordinal > 0),
  raw_cells jsonb not null, status text not null check (status in ('mapped','duplicate occurrence','conflict','nontrial event','unresolved')),
  primary key(source_file_id,ordinal)
);
create table private.source_row_links (
  source_file_id uuid not null, ordinal integer not null, event_id uuid not null references public.experiment_events(id),
  primary key(source_file_id,ordinal,event_id),
  foreign key(source_file_id,ordinal) references private.source_rows(source_file_id,ordinal)
);
create table private.legacy_identity_links (
  namespace text not null, original_participant_id text not null, participant_id uuid not null references public.participants(id),
  verified_by uuid references auth.users(id), verified_at timestamptz, evidence_reference text,
  primary key(namespace,original_participant_id),
  check ((verified_by is null) = (verified_at is null))
);
create table public.artifacts (
  id uuid primary key default gen_random_uuid(), study_id uuid references public.studies(id),
  participant_id uuid references public.participants(id), bucket text not null, object_key text not null,
  sha256 text not null, original_path text not null, created_at timestamptz not null default now(),
  unique(bucket,object_key)
);
create index on public.experiment_runs(participant_id,study_id,started_at);
create index on public.experiment_runs(study_id,task,started_at);
create index on public.study_memberships(auth_user_id,study_id);
create index on public.enrollments(participant_id,study_id);
create index on public.training_settings(participant_id,task);
create index on public.experiment_events(attempt_id);

-- Definer helpers have fixed search paths and do not allow caller-supplied identity.
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from private.administrators where auth_user_id = auth.uid());
$$;
create function private.researches(study uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.study_memberships where study_id = study and auth_user_id = auth.uid());
$$;
create function private.owns_participant(participant uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.participants where id = participant and auth_user_id = auth.uid());
$$;
create function private.can_read_run(run uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.experiment_runs where id = run and
   (private.owns_participant(participant_id) or private.researches(study_id) or private.is_admin()));
$$;
grant usage on schema private to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.researches(uuid), private.owns_participant(uuid), private.can_read_run(uuid) to authenticated;

do $$ declare t text; begin
 foreach t in array array['profiles','participants','studies','study_memberships','enrollments','display_profiles','training_settings','experiment_runs','run_chunks','trial_attempts','experiment_events','ingest_batches','artifacts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy profile_read on public.profiles for select to authenticated using (auth_user_id = auth.uid() or private.is_admin());
grant update(preferences) on public.profiles to authenticated;
create policy profile_preferences on public.profiles for update to authenticated using (auth_user_id = auth.uid()) with check(auth_user_id = auth.uid());
create policy participant_read on public.participants for select to authenticated using (
  auth_user_id = auth.uid() or private.is_admin() or exists(select 1 from public.enrollments e where e.participant_id=id and private.researches(e.study_id)));
create policy study_read on public.studies for select to authenticated using (
  private.is_admin() or private.researches(id) or exists(select 1 from public.enrollments e where e.study_id=id and private.owns_participant(e.participant_id)));
create policy membership_read on public.study_memberships for select to authenticated using(auth_user_id=auth.uid() or private.is_admin());
create policy enrollment_read on public.enrollments for select to authenticated using(private.owns_participant(participant_id) or private.researches(study_id) or private.is_admin());
create policy display_read on public.display_profiles for select to authenticated using(auth_user_id=auth.uid());
-- Settings writes go through controlled functions, to increment version and clear confirmation.
create policy training_read on public.training_settings for select to authenticated using(private.owns_participant(participant_id));
create policy run_read on public.experiment_runs for select to authenticated using(private.owns_participant(participant_id) or private.researches(study_id) or private.is_admin());
create policy chunk_read on public.run_chunks for select to authenticated using(private.can_read_run(run_id));
create policy attempt_read on public.trial_attempts for select to authenticated using(private.can_read_run(run_id));
create policy event_read on public.experiment_events for select to authenticated using(private.can_read_run(run_id));
create policy batch_read on public.ingest_batches for select to authenticated using(private.can_read_run(run_id));
create policy artifact_read on public.artifacts for select to authenticated using(private.is_admin() or private.researches(study_id) or private.owns_participant(participant_id));

insert into storage.buckets(id,name,public) values ('legacy-archive','legacy-archive',false),('exports','exports',false) on conflict(id) do nothing;
-- No direct client upload. Matching artifact authorization is required for downloads.
create policy artifact_download on storage.objects for select to authenticated using (
  exists(select 1 from public.artifacts a where a.bucket=bucket_id and a.object_key=name));
commit;
