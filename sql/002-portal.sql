-- SQL summaries retain the metric definitions already used on beta.
CREATE TABLE IF NOT EXISTS experiment_data.portal_metrics (
  reference text PRIMARY KEY,
  source_file_id bigint REFERENCES experiment_data.source_files(id) ON DELETE CASCADE,
  save_id bigint REFERENCES experiment_data.saves(id) ON DELETE CASCADE,
  run_id uuid REFERENCES experiment_data.runs(id) ON DELETE CASCADE,
  version text NOT NULL,
  metrics jsonb NOT NULL,
  CHECK (num_nonnulls(source_file_id, save_id, run_id) = 1)
);
CREATE TABLE IF NOT EXISTS experiment_data.portal_sessions (
  id_hash text PRIMARY KEY,
  csrf_token text NOT NULL,
  role text NOT NULL DEFAULT 'anonymous' CHECK (role IN ('anonymous', 'admin', 'user')),
  user_id text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION experiment_data.portal_date(value text, fallback timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(value, '(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})');
  IF m IS NULL THEN RETURN fallback; END IF;
  BEGIN RETURN (m[1] || 'T' || m[2] || ':' || m[3] || ':' || m[4] || 'Z')::timestamptz;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN fallback;
  END;
END $$;
CREATE OR REPLACE FUNCTION experiment_data.portal_type(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(value, '^.*/', '') ~ '^(final|user_)' THEN 'final'
    WHEN regexp_replace(value, '^.*/', '') LIKE 'session%' THEN 'session'
    WHEN regexp_replace(value, '^.*/', '') LIKE 'pause%' THEN 'pause'
    ELSE 'other' END;
$$;

CREATE OR REPLACE VIEW experiment_data.portal_files AS
SELECT 'source:' || f.id AS reference, 'source'::text AS source_kind,
  f.id::text AS source_id, f.original_path AS name,
  coalesce(f.user_id,(regexp_match(f.original_path,'user_([^_/]+)_','i'))[1]) AS user_id, f.task,
  f.kind AS status, f.kind IN ('csv', 'backup') AS has_rows,
  experiment_data.portal_type(f.original_path) AS metric_type,
  experiment_data.portal_date(coalesce(f.run_timestamp,f.original_path), j.completed_at) AS session_date,
  experiment_data.portal_date(coalesce(f.run_timestamp,f.original_path), j.completed_at) AS created_at,
  experiment_data.portal_date(coalesce(f.run_timestamp,f.original_path), j.completed_at) AS modified_at,
  octet_length(f.bytes)::bigint AS size_bytes, f.row_count, f.sha256 AS version
FROM experiment_data.source_files f JOIN experiment_data.import_jobs j ON j.id = f.import_job_id
UNION ALL
SELECT 'save:' || s.id, 'save', s.id::text, s.save_key, r.user_id, r.task,
  s.prefix, true, experiment_data.portal_type(s.save_key),
  experiment_data.portal_date(r.run_timestamp, r.created_at), s.created_at, s.updated_at,
  NULL::bigint, s.row_count, s.payload_hash
FROM experiment_data.saves s JOIN experiment_data.runs r ON r.id = s.run_id
UNION ALL
SELECT 'run:' || r.id, 'run', r.id::text,
  (CASE WHEN r.status = 'complete' THEN 'final_complete' ELSE 'session_active' END) || '_user_' || r.user_id || '_' || r.task || '_' || r.run_timestamp || '_' || r.id || '.json',
  r.user_id, r.task, r.status, true,
  CASE WHEN r.status = 'complete' THEN 'final' ELSE 'session' END,
  experiment_data.portal_date(r.run_timestamp, r.created_at), r.created_at, r.updated_at,
  NULL::bigint, NULL::integer, r.updated_at::text
FROM experiment_data.runs r;
create or replace function experiment_data.metric_number(value jsonb) returns float8
language plpgsql immutable set search_path='' as $$
declare n float8; value_text text;
begin
 value_text:=value#>>'{}';
 if value_text is null or btrim(value_text)='' then return null; end if;
 begin n:=value_text::float8; exception when invalid_text_representation or numeric_value_out_of_range then return null; end;
 if n::text in ('NaN','Infinity','-Infinity') then return null; end if;
 return n;
end $$;
create or replace function experiment_data.metric_boolean(value text) returns boolean
language sql immutable set search_path='' as $$
 select case when lower(btrim(value)) in ('true','1','yes','correct') then true
 when lower(btrim(value)) in ('false','0','no','incorrect') then false end;
$$;
create or replace function experiment_data.metric_task(value jsonb) returns text
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
create or replace function experiment_data.summarize_portal_rows(data jsonb, fallback_task text, exclude_interrupted boolean default false)
returns jsonb language sql immutable set search_path='' as $$
 with input as (
  select value as row,ordinality as ordinal from jsonb_array_elements(data) with ordinality
 ), interrupted as (
  select concat(coalesce(row->>'overall_trial_number','undefined'),'|',coalesce(row->>'attempt_number','undefined')) as attempt_key
  from input where experiment_data.metric_boolean(row->>'manual_pause_interrupted') is true
 ), filtered as (
  select * from input where not exclude_interrupted or not exists(
   select 1 from interrupted i where i.attempt_key=concat(coalesce(row->>'overall_trial_number','undefined'),'|',coalesce(row->>'attempt_number','undefined')))
 ), parsed as (
  select *,experiment_data.metric_number(row->'time_elapsed') as elapsed,experiment_data.metric_number(row->'rt') as rt,
   coalesce(nullif(experiment_data.metric_task(row),''),fallback_task,'') as task,
   btrim(coalesce(row->>'overall_trial_number','')) as trial_number,
   btrim(coalesce(row->>'difficulty_level','')) as level,
   experiment_data.metric_boolean(row->>'correct') as correct,
   experiment_data.metric_boolean(row->>'manual_pause_interrupted') is true as is_interrupted,
   coalesce(row->>'trial_category','') in ('scheduled_break','manual_pause_screen') as is_rest,
   coalesce(row->>'trial_category'='fixation_catch_response',false) or
    (experiment_data.metric_boolean(row->>'fixation_catch_trial') is true and lower(row->>'correct_direction')='x'
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
 select jsonb_build_object('rowCount',(select count(*) from input),'jsonBytes',octet_length(jsonb_pretty(data)),
  'trainingMs',training,'restingMs',resting,'totalMs',training+resting,
  'catchTotal',catches,'catchCorrect',caught,'total',(select count(*) from responses),
  'correct',(select count(*) from responses where correct),
  'meanDifficulty',(select coalesce(avg(coalesce(experiment_data.metric_number(to_jsonb(level)),0)),0) from responses),
  'task',coalesce((select task from responses order by ordinal limit 1),fallback_task,''),
  'levels',coalesce((select jsonb_agg(jsonb_build_object('task',task,'level',level,'total',total,'correct',correct,
    'durationMs',duration_ms,'accuracy',correct*100.0/total,'averageDurationMs',duration_ms/total)
    order by experiment_data.metric_number(to_jsonb(level)) nulls last,level,task) from level_groups),'[]'::jsonb)) from totals;
$$;


-- Refresh only stale sources requested by the authorized API. Rows and summaries
-- are read from one statement snapshot, so a concurrent ingest is picked up on
-- the next read rather than marking an older summary with a newer version.
CREATE OR REPLACE FUNCTION experiment_data.ensure_portal_metrics(requested_refs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; summary jsonb;
BEGIN
  FOR f IN SELECT * FROM experiment_data.portal_files
    WHERE reference = ANY(requested_refs) AND has_rows
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('portal-metrics:' || f.reference));
    IF EXISTS (SELECT 1 FROM experiment_data.portal_metrics m WHERE m.reference = f.reference AND m.version = '1:' || f.version) THEN
      CONTINUE;
    END IF;
    IF f.source_kind = 'source' THEN
      SELECT experiment_data.summarize_portal_rows(coalesce(jsonb_agg(payload ORDER BY ordinal), '[]'::jsonb), f.task, false)
      INTO summary FROM experiment_data.source_rows WHERE source_file_id = f.source_id::bigint;
    ELSIF f.source_kind = 'save' THEN
      SELECT experiment_data.summarize_portal_rows(coalesce(jsonb_agg(payload ORDER BY ordinal), '[]'::jsonb), f.task, false)
      INTO summary FROM experiment_data.save_rows WHERE save_id = f.source_id::bigint;
    ELSE
      SELECT experiment_data.summarize_portal_rows(coalesce(jsonb_agg(payload ORDER BY event_sequence), '[]'::jsonb), f.task, true)
      INTO summary FROM experiment_data.events WHERE run_id = f.source_id::uuid AND included;
    END IF;
    INSERT INTO experiment_data.portal_metrics(reference,source_file_id,save_id,run_id,version,metrics)
      VALUES(f.reference,CASE WHEN f.source_kind='source' THEN f.source_id::bigint END,
        CASE WHEN f.source_kind='save' THEN f.source_id::bigint END,
        CASE WHEN f.source_kind='run' THEN f.source_id::uuid END,'1:' || f.version,summary)
    ON CONFLICT(reference) DO UPDATE SET version=excluded.version, metrics=excluded.metrics;
  END LOOP;
END $$;
