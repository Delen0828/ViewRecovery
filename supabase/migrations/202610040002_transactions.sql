begin;
-- JSON numbers must be numbers, never strings or null. SQL casts alone accept NaN.
create function private.number(value jsonb, label text, minimum float8, maximum float8) returns float8
language plpgsql immutable set search_path='' as $$
declare n float8;
begin
 if jsonb_typeof(value) is distinct from 'number' then raise exception 'Invalid %',label using errcode='22023'; end if;
 n := value::text::float8;
 if not(n between minimum and maximum) then raise exception 'Invalid %',label using errcode='22023'; end if;
 return n;
end $$;

create function private.geometry(display jsonb, settings jsonb, task text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare w float8; h float8; sw float8; sh float8; cmw float8; cmh float8; distance float8; dpr float8;
 x float8; y float8; px float8; py float8; radius float8; halfw float8; halfh float8; cx float8; cy float8;
 p text; positions jsonb; bounds jsonb := '[]';
begin
 w := private.number(display->'viewport_width','viewport width',1,20000);
 h := private.number(display->'viewport_height','viewport height',1,20000);
 sw := private.number(display->'screen_width','screen width',1,20000);
 sh := private.number(display->'screen_height','screen height',1,20000);
 cmw := private.number(display->'width_cm','width cm',1,1000);
 cmh := private.number(display->'height_cm','height cm',1,1000);
 distance := private.number(display->'distance_cm','distance cm',1,1000);
 dpr := private.number(display->'dpr','dpr',0.1,10);
 if display->'fullscreen' is distinct from 'true'::jsonb then raise exception 'Fullscreen confirmation required'; end if;
 x := private.number(settings->'x_deg','x degrees',-80,80);
 y := private.number(settings->'y_deg','y degrees',-80,80);
 if task not in ('Motion','Orientation','Centrality','Bar') then raise exception 'Unknown task'; end if;
 if task='Bar' and x < 0 then raise exception 'Bar x must be nonnegative'; end if;
 positions := settings->'positions';
 if jsonb_typeof(positions) is distinct from 'array' or jsonb_array_length(positions) <> 1
   or positions->>0 is distinct from (case when task='Bar' then 'upper' else 'left_upper' end)
 then raise exception 'Protocol requires the prescribed position'; end if;
 -- Screen dimensions are CSS pixels; physical measurements describe the entire visible screen.
 px := distance*tan(radians(x))*sw/cmw; py := distance*tan(radians(y))*sh/cmh;
 -- Preserve current renderer diameter conversion; offsets have separate X/Y factors.
 radius := distance*tan(radians(1))*(sw/cmw + sh/cmh)/2*2.5;
 halfw := case when task='Bar' then 15 when task='Centrality' then 50 else radius + case when task='Motion' then 4 else 0 end end;
 halfh := case when task='Bar' then 50 when task='Centrality' then 50 else halfw end;
 for p in select jsonb_array_elements_text(positions) loop
   cy := h/2 - py;
   cx := w/2 - px;
   if cx-halfw < 0 or cx+halfw > w or cy-halfh < 0 or cy+halfh > h
     or (task='Bar' and (w/2+px+halfw > w or w/2+px-halfw < 0))
   then raise exception 'Full stimulus bounds are offscreen'; end if;
   bounds := bounds || jsonb_build_array(jsonb_build_object('x',cx,'y',cy,'half_width',halfw,'half_height',halfh));
   if task='Bar' then bounds := bounds || jsonb_build_array(jsonb_build_object('x',w/2+px,'y',cy,'half_width',halfw,'half_height',halfh)); end if;
 end loop;
 return jsonb_build_object('x_px',px,'y_px',py,'pixels_per_cm_x',sw/cmw,'pixels_per_cm_y',sh/cmh,
   'pixels_per_degree',distance*tan(radians(1))*(sw/cmw+sh/cmh)/2,'bounds',bounds);
end $$;

create function public.save_settings(display_id uuid, display_name text, display jsonb, study uuid, task_name text, settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare participant uuid; dp public.display_profiles; ts public.training_settings;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select id into participant from public.participants where auth_user_id=auth.uid();
 if not exists(select 1 from public.enrollments where participant_id=participant and study_id=study and active)
 then raise exception 'Enrollment required' using errcode='42501'; end if;
 perform private.geometry(display,settings,task_name);
 if display_id is not null and not exists(select 1 from public.display_profiles where id=display_id and auth_user_id=auth.uid())
 then raise exception 'Display ownership required' using errcode='42501'; end if;
 if display_id is null then
   insert into public.display_profiles(auth_user_id,name,settings) values(auth.uid(),display_name,display)
     on conflict(auth_user_id,name) do update set settings=excluded.settings,version=public.display_profiles.version+1,confirmed_at=null,updated_at=now() returning * into dp;
 else
   update public.display_profiles set name=display_name,settings=display,version=version+1,confirmed_at=null,updated_at=now()
     where id=display_id and auth_user_id=auth.uid() returning * into dp;
 end if;
 update public.training_settings set confirmed_at=null where display_profile_id=dp.id;
 insert into public.training_settings(participant_id,study_id,task,display_profile_id,settings)
 values(participant,study,task_name,dp.id,settings)
 on conflict(participant_id,study_id,task) do update set settings=excluded.settings,display_profile_id=excluded.display_profile_id,
   version=public.training_settings.version+1,confirmed_at=null returning * into ts;
 return jsonb_build_object('display',to_jsonb(dp),'training',to_jsonb(ts));
end $$;

create function public.create_run(training_id uuid, display_version integer, training_version integer, observed_display jsonb)
returns public.experiment_runs language plpgsql security definer set search_path='' as $$
declare ts public.training_settings; dp public.display_profiles; s public.studies; result public.experiment_runs; derived jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into ts from public.training_settings where id=training_id for update;
 if not found or not private.owns_participant(ts.participant_id) then raise exception 'Ownership required' using errcode='42501'; end if;
 select * into dp from public.display_profiles where id=ts.display_profile_id for update;
 if dp.auth_user_id<>auth.uid() or dp.version<>display_version or ts.version<>training_version or dp.settings<>observed_display
 then raise exception 'Display or settings changed; reconfirm'; end if;
 select * into s from public.studies where id=ts.study_id and active;
 if not found or not ts.task=any(s.tasks) then raise exception 'Study/task unavailable'; end if;
 if s.protocol_version<>'legacy-2026-10-04' then raise exception 'Unsupported protocol version'; end if;
 if not exists(select 1 from public.enrollments where study_id=s.id and participant_id=ts.participant_id and active
   and consent_version=s.consent_version and consented_at is not null)
 then raise exception 'Valid enrollment/consent required'; end if;
 derived := private.geometry(dp.settings,ts.settings,ts.task);
 update public.display_profiles set confirmed_at=now() where id=dp.id;
 update public.training_settings set confirmed_at=now() where id=ts.id;
 insert into public.experiment_runs(participant_id,study_id,task,protocol_version,code_version,parameter_snapshot)
 values(ts.participant_id,ts.study_id,ts.task,s.protocol_version,'refactor-v1',jsonb_build_object(
  'display',dp.settings,'training',ts.settings,'geometry',derived,'display_version',dp.version,
  'training_version',ts.version,'confirmed_at',now(),'protocol_version',s.protocol_version)) returning * into result;
 return result;
end $$;

-- Exact legacy LCG catch-slot shuffle: 13 of 256 slots, seeded by task name.
create function private.catch_slots(task text) returns integer[]
language plpgsql immutable set search_path='' as $$
declare slots integer[] := array(select generate_series(1,256)); rng bigint := 5000;
 i integer; j integer; temp integer;
begin
 if task not in ('Motion','Orientation','Centrality','Bar') then raise exception 'Unknown task'; end if;
 for i in 1..length(task) loop rng := rng + ascii(substr(task,i,1)); end loop;
 for i in reverse 256..2 loop
   rng := (1664525*rng+1013904223) % 4294967296;
   j := floor((rng::float8/4294967296)*i)::integer+1;
   temp := slots[i]; slots[i] := slots[j]; slots[j] := temp;
 end loop;
 return slots[1:13];
end $$;

-- Validate/canonicalize a bounded batch in one transaction; caller cannot choose owner or alter run parameters.
create function public.ingest_events(run uuid, batch_key uuid, schema_version integer, events jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.experiment_runs; prior public.ingest_batches; hash text; ack jsonb; event jsonb; p jsonb;
 aid uuid; logical integer; attempt integer; seq integer; interrupted boolean; is_response boolean; caught boolean;
 attempt_state text; existing public.experiment_events;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into r from public.experiment_runs where id=run for update;
 if not found or not private.owns_participant(r.participant_id) then raise exception 'Run ownership required' using errcode='42501'; end if;
 if schema_version<>1 or schema_version is null or jsonb_typeof(events) is distinct from 'array'
 then raise exception 'Invalid batch schema'; end if;
 if jsonb_array_length(events) not between 1 and 100 or octet_length(events::text)>262144 then raise exception 'Batch size limit'; end if;
 hash := encode(sha256(convert_to(events::text,'UTF8')),'hex');
 select * into prior from public.ingest_batches b where b.run_id=run and b.batch_key=ingest_events.batch_key;
 if found then
   if prior.payload_hash<>hash then raise exception 'Batch key payload conflict' using errcode='23505'; end if;
   return prior.acknowledgement;
 end if;
 if r.status not in ('active','paused') or not exists(select 1 from public.enrollments where study_id=r.study_id and participant_id=r.participant_id and active)
 then raise exception 'Run is not accepting events'; end if;
 for event in select jsonb_array_elements(events) loop
   if jsonb_typeof(event) is distinct from 'object' or jsonb_typeof(event->'payload') is distinct from 'object'
     or event->>'id' is null or event->>'phase' is null or length(event->>'phase') not between 1 and 80
     or (event - array['id','sequence','attempt_id','logical_trial','attempt_number','phase','payload']) <> '{}'::jsonb
   then raise exception 'Invalid event schema'; end if;
   seq := private.number(event->'sequence','sequence',0,2147483647)::integer;
   if (event->>'sequence')::numeric<>seq then raise exception 'Sequence must be integer'; end if;
   p := event->'payload';
   if p ? 'task_type' and p->>'task_type'<>r.task then raise exception 'Task mismatch'; end if;
   if p ? 'rt' and p->'rt'<>'null'::jsonb then perform private.number(p->'rt','rt',0,86400000); end if;
   if p ? 'time_elapsed' then perform private.number(p->'time_elapsed','elapsed',0,604800000); end if;
   if p ? 'difficulty_level' then perform private.number(p->'difficulty_level','difficulty',0,case when r.task in ('Motion','Centrality') then 8 else 7 end); end if;
   if p ? 'correct' and jsonb_typeof(p->'correct')<>'boolean' then raise exception 'Correctness must be boolean'; end if;
   if p ? 'fixation_catch_trial' and jsonb_typeof(p->'fixation_catch_trial')<>'boolean' then raise exception 'Catch flag must be boolean'; end if;
   if p ? 'manual_pause_interrupted' and jsonb_typeof(p->'manual_pause_interrupted')<>'boolean' then raise exception 'Interruption flag must be boolean'; end if;
   if p ? 'difficulty_level' and trunc((p->>'difficulty_level')::numeric)<>(p->>'difficulty_level')::numeric then raise exception 'Difficulty level must be integer'; end if;
   aid := null; logical := null; attempt := null;
   if event->>'attempt_id' is not null then
     aid := (event->>'attempt_id')::uuid;
     logical := private.number(event->'logical_trial','logical trial',1,256)::integer;
     attempt := private.number(event->'attempt_number','attempt number',1,10000)::integer;
     if (event->>'logical_trial')::numeric<>logical or (event->>'attempt_number')::numeric<>attempt then raise exception 'Trial identifiers must be integer'; end if;
     if p ? 'overall_trial_number' and p->>'overall_trial_number'<>logical::text then raise exception 'Logical trial mismatch'; end if;
   elsif event->>'logical_trial' is not null or event->>'attempt_number' is not null or p ? 'overall_trial_number' then
     raise exception 'Missing attempt identity';
   end if;
   select * into existing from public.experiment_events where id=(event->>'id')::uuid;
   if found then
     if existing.run_id<>run or existing.client_sequence<>seq or existing.payload<>p or existing.phase<>event->>'phase'
       or existing.attempt_id is distinct from aid then raise exception 'Event identity conflict' using errcode='23505'; end if;
     continue;
   end if;
   if aid is not null then
     interrupted := coalesce(p->'manual_pause_interrupted'='true'::jsonb,false) or event->>'phase'='interrupted';
     caught := coalesce(p->'fixation_catch_trial'='true'::jsonb,false);
     is_response := p ? 'correct' and not interrupted;
     if is_response and caught is distinct from (logical=any(private.catch_slots(r.task))) then raise exception 'Catch slot does not match protocol'; end if;
     if is_response and (not (p ? 'rt') or p->'rt'='null'::jsonb) then raise exception 'Response requires reaction time'; end if;
     if is_response and not caught and not (p ? 'difficulty_level') then raise exception 'Response requires difficulty'; end if;
     attempt_state := case when interrupted then 'interrupted' when is_response then 'completed' else 'active' end;
     if exists(select 1 from public.trial_attempts where id=aid and (run_id<>run or logical_trial_number<>logical or attempt_number<>attempt)) then raise exception 'Attempt identity conflict'; end if;
     if exists(select 1 from public.trial_attempts where id=aid and state='interrupted') and not interrupted then raise exception 'Interrupted attempt cannot complete'; end if;
     if exists(select 1 from public.trial_attempts where id=aid and state='completed') and (interrupted or is_response) then raise exception 'Attempt already complete'; end if;
     insert into public.trial_attempts(id,run_id,logical_trial_number,attempt_number,task,position,correct,reaction_time,difficulty,is_catch,state)
     values(aid,run,logical,attempt,r.task,coalesce(p->>'motion_position',p->>'orientation_position',p->>'centrality_position',p->>'bar_position',r.parameter_snapshot->'training'->'positions'->>0),
       case when is_response then (p->>'correct')::boolean else null end,case when is_response then (p->>'rt')::float8 else null end,p->'difficulty_value',caught,attempt_state)
     on conflict(id) do update set state=case when excluded.state='active' then public.trial_attempts.state else excluded.state end,
       correct=coalesce(excluded.correct,public.trial_attempts.correct),reaction_time=coalesce(excluded.reaction_time,public.trial_attempts.reaction_time),
       difficulty=coalesce(excluded.difficulty,public.trial_attempts.difficulty),is_catch=public.trial_attempts.is_catch or excluded.is_catch;
   end if;
   insert into public.experiment_events(id,run_id,attempt_id,client_sequence,phase,payload)
   values((event->>'id')::uuid,run,aid,seq,event->>'phase',p);
 end loop;
 ack := jsonb_build_object('run_id',run,'batch_key',batch_key,'accepted',jsonb_array_length(events),'max_sequence',
   (select max(client_sequence) from public.experiment_events where run_id=run));
 insert into public.ingest_batches values(run,batch_key,hash,ack,now());
 return ack;
end $$;

create function public.complete_run(run uuid, expected_events integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.experiment_runs; count_events integer; count_trials integer;
begin
 select * into r from public.experiment_runs where id=run for update;
 if not found or auth.uid() is null or not private.owns_participant(r.participant_id) then raise exception 'Ownership required' using errcode='42501'; end if;
 select count(*) into count_events from public.experiment_events where run_id=run;
 select count(distinct logical_trial_number) into count_trials from public.trial_attempts where run_id=run and state='completed';
 if expected_events is null or count_events<>expected_events or count_trials<>256
   or exists(select 1 from generate_series(0,expected_events-1) n where not exists(select 1 from public.experiment_events e where e.run_id=run and e.client_sequence=n))
 then raise exception 'Run has unacknowledged or incomplete records'; end if;
 if r.status not in ('active','paused','complete') then raise exception 'Run cannot complete'; end if;
 update public.experiment_runs set status='complete',ended_at=coalesce(ended_at,now()) where id=run;
 return jsonb_build_object('status','complete','events',count_events);
end $$;

-- Preserve historical snapshots even for privileged updates.
create function private.immutable_run() returns trigger language plpgsql set search_path='' as $$
begin
 if new.parameter_snapshot<>old.parameter_snapshot or new.participant_id<>old.participant_id or new.study_id<>old.study_id
   or new.task<>old.task or new.protocol_version<>old.protocol_version or new.code_version<>old.code_version then raise exception 'Run identity and snapshot are immutable'; end if;
 return new;
end $$;
create trigger immutable_run before update on public.experiment_runs for each row execute function private.immutable_run();
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(),private.researches(uuid),private.owns_participant(uuid),private.can_read_run(uuid) to authenticated;
revoke all on function public.save_settings(uuid,text,jsonb,uuid,text,jsonb),public.create_run(uuid,integer,integer,jsonb),public.ingest_events(uuid,uuid,integer,jsonb),public.complete_run(uuid,integer) from public,anon;
grant execute on function public.save_settings(uuid,text,jsonb,uuid,text,jsonb),public.create_run(uuid,integer,integer,jsonb),public.ingest_events(uuid,uuid,integer,jsonb),public.complete_run(uuid,integer) to authenticated;
commit;
