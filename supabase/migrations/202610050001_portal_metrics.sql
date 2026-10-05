begin;
-- Derived summaries are server-written. Their access always follows the source.
create table public.session_metrics (
 id uuid primary key default gen_random_uuid(),
 artifact_id uuid unique references public.artifacts(id) on delete cascade,
 run_id uuid unique references public.experiment_runs(id) on delete cascade,
 source_sha256 text,
 metrics_version integer not null default 1 check(metrics_version=1),
 metrics jsonb,
 error_code text check(error_code='INVALID_CSV'),
 updated_at timestamptz not null default now(),
 check((artifact_id is null) <> (run_id is null)),
 check((metrics is not null and error_code is null) or (metrics is null and error_code is not null)),
 check(metrics is null or jsonb_typeof(metrics)='object'),
 check(artifact_id is null or source_sha256 is not null)
);
alter table public.session_metrics enable row level security;
revoke all on public.session_metrics from public,anon,authenticated;
grant select on public.session_metrics to authenticated;
grant all on public.session_metrics to service_role;
create policy metrics_read on public.session_metrics for select to authenticated using (
 exists(select 1 from public.artifacts a where a.id=artifact_id)
 or exists(select 1 from public.experiment_runs r where r.id=run_id)
);
create index artifacts_portal_order on public.artifacts(participant_id,original_path,id);

create function private.metric_number(value jsonb) returns float8
language plpgsql immutable set search_path='' as $$
declare n float8; value_text text;
begin
 value_text:=value#>>'{}';
 if value_text is null or btrim(value_text)='' then return null; end if;
 begin n:=value_text::float8; exception when invalid_text_representation or numeric_value_out_of_range then return null; end;
 if n::text in ('NaN','Infinity','-Infinity') then return null; end if;
 return n;
end $$;
create function private.metric_boolean(value text) returns boolean
language sql immutable set search_path='' as $$
 select case when lower(btrim(value)) in ('true','1','yes','correct') then true
 when lower(btrim(value)) in ('false','0','no','incorrect') then false end;
$$;
create function private.metric_task(value jsonb) returns text
language sql immutable set search_path='' as $$
 select case
 when lower(concat_ws(' ',value->>'task_type',value->>'selected_task',value->>'task_route')) like '%motion%' then 'Motion'
 when lower(concat_ws(' ',value->>'task_type',value->>'selected_task',value->>'task_route')) like '%orientation%' then 'Orientation'
 when lower(concat_ws(' ',value->>'task_type',value->>'selected_task',value->>'task_route')) like '%centrality%' then 'Centrality'
 when lower(concat_ws(' ',value->>'task_type',value->>'selected_task',value->>'task_route')) like '%bar%' then 'Bar'
 when lower(value->>'correct_direction') in ('up','down') then 'Motion'
 when lower(value->>'correct_direction') in ('vertical','horizontal') then 'Orientation'
 when lower(value->>'correct_direction') in ('black','white') then 'Centrality'
 when lower(value->>'correct_direction') in ('same','different') then 'Bar' else '' end;
$$;

-- Same response, catch, break and full-trial duration definitions as analyzeRows.
-- Recorded runs remove every phase of an interrupted attempt before durations.
create function private.summarize_portal_rows(data jsonb, fallback_task text, exclude_interrupted boolean default false)
returns jsonb language sql immutable set search_path='' as $$
 with input as (
  select value as row,ordinality as ordinal from jsonb_array_elements(data) with ordinality
 ), interrupted as (
  select concat(coalesce(row->>'overall_trial_number','undefined'),'|',coalesce(row->>'attempt_number','undefined')) as attempt_key
  from input where private.metric_boolean(row->>'manual_pause_interrupted') is true
 ), filtered as (
  select * from input where not exclude_interrupted or not exists(
   select 1 from interrupted i where i.attempt_key=concat(coalesce(row->>'overall_trial_number','undefined'),'|',coalesce(row->>'attempt_number','undefined')))
 ), parsed as (
  select *,private.metric_number(row->'time_elapsed') as elapsed,private.metric_number(row->'rt') as rt,
   coalesce(nullif(private.metric_task(row),''),fallback_task,'') as task,
   btrim(coalesce(row->>'overall_trial_number','')) as trial_number,
   btrim(coalesce(row->>'difficulty_level','')) as level,
   private.metric_boolean(row->>'correct') as correct,
   private.metric_boolean(row->>'manual_pause_interrupted') is true as is_interrupted,
   coalesce(row->>'trial_category','') in ('scheduled_break','manual_pause_screen') as is_rest,
   coalesce(row->>'trial_category'='fixation_catch_response',false) or
    (private.metric_boolean(row->>'fixation_catch_trial') is true and lower(row->>'correct_direction')='x'
      and btrim(coalesce(row->>'fixation_response_key',''))<>'') as is_catch
  from filtered
 ), previous as (
  select *,max(ordinal) filter(where elapsed is not null) over(order by ordinal rows between unbounded preceding and 1 preceding) as previous_ordinal
  from parsed
 ), timed as (
  select p.*,greatest(0,case when p.elapsed is not null and prior.elapsed is not null and p.elapsed>=prior.elapsed
   then p.elapsed-prior.elapsed else coalesce(p.rt,0) end) as ms,
   concat(p.task,'|',p.trial_number,'|',coalesce(nullif(p.row->>'attempt_number',''),nullif(p.row->>'manual_pause_attempt_number',''),'1')) as trial_key
  from previous p left join parsed prior on prior.ordinal=p.previous_ordinal
 ), trials as (
  select trial_key,sum(ms) as ms from timed where not is_rest and trial_number<>'' and not is_interrupted group by trial_key
 ), responses as (
  select t.*,coalesce(nullif(trials.ms,0),t.rt,0) as duration_ms from timed t left join trials using(trial_key)
  where not t.is_interrupted and coalesce(t.row->>'attempt_state','')<>'interrupted'
   and t.correct is not null and t.is_catch is not true and t.task<>'' and t.level<>''
 ), level_groups as (
  select task,level,count(*) as total,count(*) filter(where correct) as correct,sum(duration_ms) as duration_ms
  from responses group by task,level
 ), totals as (
  select coalesce(sum(ms) filter(where is_rest),0) as resting,
   coalesce(sum(ms) filter(where not is_rest and trial_number<>'' and not is_interrupted),0) as training,
   count(*) filter(where not is_interrupted and coalesce(row->>'attempt_state','')<>'interrupted' and correct is not null and is_catch is true) as catches,
   count(*) filter(where not is_interrupted and coalesce(row->>'attempt_state','')<>'interrupted' and correct is true and is_catch is true) as caught
  from timed
 )
 select jsonb_build_object('trainingMs',training,'restingMs',resting,'totalMs',training+resting,
  'catchTotal',catches,'catchCorrect',caught,'total',(select count(*) from responses),
  'correct',(select count(*) from responses where correct),
  'meanDifficulty',(select coalesce(avg(coalesce(private.metric_number(to_jsonb(level)),0)),0) from responses),
  'task',coalesce((select task from responses order by ordinal limit 1),fallback_task,''),
  'levels',coalesce((select jsonb_agg(jsonb_build_object('task',task,'level',level,'total',total,'correct',correct,
    'durationMs',duration_ms,'accuracy',correct*100.0/total,'averageDurationMs',duration_ms/total)
    order by private.metric_number(to_jsonb(level)) nulls last,level,task) from level_groups),'[]'::jsonb)) from totals;
$$;

create function private.refresh_artifact_metrics(artifact uuid,expected_sha256 text,rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.artifacts; result jsonb;
begin
 select * into strict a from public.artifacts where id=artifact for share;
 if a.sha256<>expected_sha256 then raise exception 'Artifact changed during summary generation'; end if;
 result:=private.summarize_portal_rows(rows,a.task,false);
 insert into public.session_metrics(artifact_id,source_sha256,metrics) values(a.id,a.sha256,result)
 on conflict(artifact_id) do update set source_sha256=excluded.source_sha256,metrics_version=1,
  metrics=excluded.metrics,error_code=null,updated_at=now();
 return result;
end $$;
create function private.refresh_run_metrics(run uuid) returns void
language plpgsql security definer set search_path='' as $$
declare result jsonb; task_name text;
begin
 select task into strict task_name from public.experiment_runs where id=run;
 select private.summarize_portal_rows(coalesce(jsonb_agg(payload order by client_sequence),'[]'::jsonb),task_name,true)
 into result from public.experiment_events where run_id=run;
 insert into public.session_metrics(run_id,metrics) values(run,result)
 on conflict(run_id) do update set metrics=excluded.metrics,metrics_version=1,error_code=null,updated_at=now();
end $$;
create function private.update_run_metrics() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='ingest_batches' then perform private.refresh_run_metrics(new.run_id);
 else perform private.refresh_run_metrics(new.id); end if;
 return new;
end $$;
-- One refresh per acknowledged batch, not one expensive refresh per event.
create trigger ingested_run_metrics after insert on public.ingest_batches for each row execute function private.update_run_metrics();
create trigger changed_run_metrics after insert or update of status on public.experiment_runs for each row execute function private.update_run_metrics();
create function private.invalidate_artifact_metrics() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.sha256 is distinct from old.sha256 or new.task is distinct from old.task then
  delete from public.session_metrics where artifact_id=new.id;
 end if;
 return new;
end $$;
create trigger changed_artifact_metrics after update of sha256,task on public.artifacts for each row execute function private.invalidate_artifact_metrics();

create function private.portal_file_type(path text) returns text language sql immutable set search_path='' as $$
 select case when regexp_replace(path,'^.*/','') like 'pause\_checkpoint\_%' escape '\' then 'pause'
 when regexp_replace(path,'^.*/','') like 'session\_chunk\_complete\_%' escape '\' then 'session'
 when regexp_replace(path,'^.*/','') like 'final\_complete\_%' escape '\' or regexp_replace(path,'^.*/','') like 'user\_%' escape '\' then 'final' else 'other' end;
$$;
create function private.portal_file_date(path text,created timestamptz) returns timestamptz
language sql stable set search_path='' as $$
 select coalesce((m[1]||'T'||m[2]||':'||m[3]||':'||m[4]||'Z')::timestamptz,created)
 from (select regexp_match(path,'(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})') as m) matched;
$$;

create view public.portal_artifacts with(security_invoker=true) as
 select a.*,m.metrics,m.error_code from public.artifacts a left join public.session_metrics m
 on m.artifact_id=a.id and m.source_sha256=a.sha256 and m.metrics_version=1;
create view public.portal_sessions with(security_invoker=true) as
 with historical as (
  select a.*,private.portal_file_type(a.original_path) as file_type,private.portal_file_date(a.original_path,a.created_at) as session_date
  from public.portal_artifacts a where a.kind='.csv' and a.participant_id is not null
 )
 select h.id,'historical'::text as source,h.participant_id,coalesce(h.task,h.metrics->>'task') as task,h.session_date,
  h.original_path as label,h.legacy_user_id as username,h.metrics,h.error_code
 from historical h where h.file_type='final' or (h.file_type='session' and not exists(
  select 1 from historical f where f.file_type='final' and f.participant_id=h.participant_id
   and f.task is not distinct from h.task and f.session_date=h.session_date))
 union all
 select r.id,'recorded',r.participant_id,r.task,r.started_at,r.task||' — '||r.status,null,m.metrics,m.error_code
 from public.experiment_runs r left join public.session_metrics m on m.run_id=r.id and m.metrics_version=1;
revoke all on public.portal_artifacts,public.portal_sessions from public,anon;
grant select on public.portal_artifacts,public.portal_sessions to authenticated,service_role;
revoke all on function private.metric_number(jsonb),private.metric_boolean(text),private.metric_task(jsonb),
 private.summarize_portal_rows(jsonb,text,boolean),private.refresh_artifact_metrics(uuid,text,jsonb),private.refresh_run_metrics(uuid),
 private.update_run_metrics(),private.invalidate_artifact_metrics(),private.portal_file_type(text),private.portal_file_date(text,timestamptz)
 from public,anon,authenticated;
grant execute on function private.portal_file_type(text),private.portal_file_date(text,timestamptz) to authenticated,service_role;

-- One request for authorized dashboard metadata instead of five/six round trips.
create function public.portal_dashboard(account_user uuid default null,selected_participant uuid default null,run_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid; participant uuid; profile jsonb; identity jsonb;
begin
 if auth.uid() is null or run_offset<0 or run_offset>25000000 then raise exception 'Invalid dashboard request'; end if;
 owner_id:=coalesce(account_user,auth.uid());
 if selected_participant is not null then
  select auth_user_id into owner_id from public.participants where id=selected_participant;
 end if;
 select jsonb_build_object('display_username',display_username,'preferences',preferences) into profile
 from public.profiles where auth_user_id=owner_id;
 if profile is null then raise exception 'Account unavailable' using errcode='42501'; end if;
 select id,jsonb_build_object('id',id,'auth_user_id',auth_user_id,'provenance',provenance) into participant,identity
 from public.participants where auth_user_id=owner_id;
 return jsonb_build_object('access',case when private.is_admin() then 'admin' else 'participant' end,
  'profile',profile,'participant',identity,
  'studies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'protocol_version',protocol_version,'consent_version',consent_version,'tasks',tasks)),'[]'::jsonb) from public.studies),
  'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('study_id',study_id,'participant_id',participant_id,'active',active,'consent_version',consent_version,'consented_at',consented_at)),'[]'::jsonb) from public.enrollments where participant_id=participant),
  'runs',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select id,participant_id,study_id,task,status,started_at,ended_at from public.experiment_runs where participant_id=participant order by started_at desc,id limit 25 offset run_offset) r),
  'totalRuns',(select count(*) from public.experiment_runs where participant_id=participant));
end $$;
revoke all on function public.portal_dashboard(uuid,uuid,integer) from public,anon;
grant execute on function public.portal_dashboard(uuid,uuid,integer) to authenticated;
do $$ declare r record; begin
 for r in select id from public.experiment_runs loop perform private.refresh_run_metrics(r.id); end loop;
end $$;
notify pgrst,'reload schema';
commit;
