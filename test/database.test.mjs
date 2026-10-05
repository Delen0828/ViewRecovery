import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import {readLocalEnv,validateStagingEnv} from '../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../scripts/lib/staging-db.mjs';
import {analyzeRows} from '../src/portal-metrics.js';
import {metricsMatch,summaryMetrics,storeArtifactMetrics} from '../scripts/lib/portal-metrics.mjs';
const live=process.env.VIEWRECOVERY_LIVE_DATABASE==='1';
let db;
if(live) {
  try {
    const env=readLocalEnv();
    if(validateStagingEnv(env).length) throw new Error('INVALID_CONFIG');
    const client=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-staging-acceptance'));
    await client.connect(); await client.query('begin');
    db={
      async query(sql,params=[]) {
        await client.query('savepoint acceptance_check');
        try { const result=await client.query(sql,params); await client.query('release savepoint acceptance_check'); return result; }
        catch(e) { await client.query('rollback to savepoint acceptance_check'); await client.query('release savepoint acceptance_check'); throw e; }
      },
      async exec(sql) { return this.query(sql); },
      async close() { await client.query('rollback'); await client.end(); }
    };
  } catch(e) { console.error('Staging test connection failed (credentials omitted)',e.code||'unavailable');process.exit(1); }
} else db=new PGlite();
const ids = {a:'10000000-0000-0000-0000-000000000001',b:'10000000-0000-0000-0000-000000000002',r:'10000000-0000-0000-0000-000000000003',admin:'10000000-0000-0000-0000-000000000004',pa:'20000000-0000-0000-0000-000000000001',pb:'20000000-0000-0000-0000-000000000002',s:'30000000-0000-0000-0000-000000000001',other:'30000000-0000-0000-0000-000000000002'};
const display = {viewport_width:1920,viewport_height:1080,screen_width:1920,screen_height:1080,width_cm:47.6,height_cm:26.8,distance_cm:50,dpr:1,fullscreen:true};
const settings = {x_deg:5,y_deg:5,positions:['left_upper']};
const q = (sql,params=[]) => db.query(sql,live?params.map((value,index)=>value && typeof value==='object'&&!sql.includes(`$${index+1}::uuid[]`)?JSON.stringify(value):value):params);
async function as(user,fn,role='authenticated') {
  await db.exec(`set role ${role}`);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
let run;
function functionSource(name) {
  const source=fs.readFileSync('src/main.js','utf8');
  const start=source.indexOf(`function ${name}(`);
  const end=source.indexOf('\n}',start)+2;
  return source.slice(start,end);
}
const catchSlots=new Function('CENTRAL_FIXATION_CATCH_TRIAL_PROPORTION',[
  'getCentralFixationCatchTrialProportion','getCentralFixationCatchTrialCount','getCentralFixationCatchTrialSlots','shuffleArrayDeterministic'
].map(functionSource).join('\n')+'; return getCentralFixationCatchTrialSlots;')(0.05);

if(!live) await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 alter table storage.objects enable row level security; grant usage on schema storage to authenticated;
 grant select on storage.objects to authenticated;
`);
if(!live) for (const path of fs.readdirSync('supabase/migrations').sort()) { try { await db.exec(fs.readFileSync(`supabase/migrations/${path}`,'utf8')); } catch(e) { console.error(path, e.message, e.position); process.exit(1); } }
if(live) {
  for(const id of [ids.a,ids.b,ids.r,ids.admin]) {
    assert.equal((await q('select count(*)::int n from auth.users where id=$1',[id])).rows[0].n,0,'Staging fixture ID collision; do not overwrite existing identities');
    const label=`fixture_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
    const token=(await q('select public.reserve_username($1) token',[label])).rows[0].token;
    await q('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${label}@example.invalid`,JSON.stringify({username:label,username_reservation:token})]);
    await q('delete from public.participants where auth_user_id=$1',[id]);
  }
} else {
  await db.exec('alter table auth.users disable trigger registered_identity');
  for (const id of [ids.a,ids.b,ids.r,ids.admin]) await q('insert into auth.users(id) values($1)',[id]);
  await db.exec('alter table auth.users enable trigger registered_identity');
}
await q("insert into public.participants(id,auth_user_id,provenance) values($1,$2,'registration'),($3,$4,'registration')",[ids.pa,ids.a,ids.pb,ids.b]);
await q("insert into public.studies(id,name,protocol_version,consent_version,active) values($1,'Fixture','legacy-2026-10-04','v1',true),($2,'Other','v1','v1',true)",[ids.s,ids.other]);
await q("insert into public.enrollments values($1,$2,'v1',now(),true),($1,$3,'v1',now(),true)",[ids.s,ids.pa,ids.pb]);
await q("insert into public.study_memberships values($1,$2,'researcher')",[ids.s,ids.r]);
await q('insert into private.administrators values($1)',[ids.admin]);

test('migrations enforce anonymous denial, owner isolation, researcher scope and no self-grants', async () => {
  await as(null,async()=>{
    await assert.rejects(q('select * from public.participants'),/permission denied/);
    await assert.rejects(q('select public.complete_run($1,0)',[crypto.randomUUID()]),/permission denied/);
  },'anon');
  await as(ids.a,async()=>{
    assert.equal((await q('select * from public.participants')).rows.length,1);
    assert.equal((await q('select * from public.studies')).rows.length,1);
    await assert.rejects(q('insert into public.study_memberships values($1,$2,\'researcher\')',[ids.other,ids.a]),/permission denied/);
    await assert.rejects(q('update public.participants set auth_user_id=$1 where id=$2',[ids.a,ids.pb]),/permission denied/);
    await assert.rejects(q('select * from private.account_identifiers'),/permission denied/);
    await assert.rejects(q('insert into public.enrollments(study_id,participant_id) values($1,$2)',[ids.other,ids.pa]),/permission denied/);
  });
  await as(ids.r,async()=>{
    assert.equal((await q('select * from public.participants')).rows.length,2);
    assert.equal((await q('select * from public.studies')).rows.length,1);
    await assert.rejects(q('select * from private.legacy_identity_links'),/permission denied/);
  });
});

test('settings reject missing and offscreen geometry, scope owners, bind immutable versioned snapshots', async()=>{
  await as(ids.a,async()=>{
    for (const invalid of [{...display,width_cm:null},{...display,fullscreen:false},{...display,distance_cm:'NaN'}]) {
      await assert.rejects(q('select public.save_settings(null,\'Primary\',$1,$2,\'Motion\',$3)',[invalid,ids.s,settings]));
    }
    await assert.rejects(q('select public.save_settings(null,\'Primary\',$1,$2,\'Motion\',$3)',[display,ids.s,{...settings,x_deg:79}]));
    await assert.rejects(q('select public.save_settings(null,\'Primary\',$1,$2,\'Motion\',$3)',[display,ids.other,settings]),/Enrollment required/);
    const saved=(await q('select public.save_settings(null,\'Primary\',$1,$2,\'Motion\',$3) result',[display,ids.s,settings])).rows[0].result;
    const dp=saved.display,ts=saved.training;
    await assert.rejects(q('select public.create_run($1,1,1,$2)',[ts.id,{...display,dpr:2}]),/changed/);
    run=(await q('select (public.create_run($1,1,1,$2)).*',[ts.id,display])).rows[0];
    assert.equal(run.parameter_snapshot.training.x_deg,5);
    await q('select public.save_settings($1,\'Primary\',$2,$3,\'Motion\',$4)',[dp.id,display,ids.s,{...settings,x_deg:4}]);
    await assert.rejects(q('select public.create_run($1,1,1,$2)',[ts.id,display]),/changed/);
    assert.equal((await q('select parameter_snapshot from public.experiment_runs where id=$1',[run.id])).rows[0].parameter_snapshot.training.x_deg,5);
  });
  await as(ids.b,async()=>{
    assert.equal((await q('select * from public.experiment_runs')).rows.length,0);
    await assert.rejects(q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[]]),/ownership/);
  });
  await assert.rejects(q("update public.experiment_runs set parameter_snapshot='{}' where id=$1",[run.id]),/immutable/);
});

test('ingestion commits atomically, acknowledges retries, rejects conflicts and false completion',async()=>{
  const event={id:crypto.randomUUID(),sequence:0,phase:'instructions',payload:{task_type:'Motion',time_elapsed:100}};
  const key=crypto.randomUUID();
  await as(ids.a,async()=>{
    const first=(await q('select public.ingest_events($1,$2,1,$3) ack',[run.id,key,[event]])).rows[0].ack;
    const retry=(await q('select public.ingest_events($1,$2,1,$3) ack',[run.id,key,[event]])).rows[0].ack;
    assert.deepEqual(first,retry);
    assert.equal((await q('select count(*)::int n from public.experiment_events')).rows[0].n,1);
    await assert.rejects(q('select public.ingest_events($1,$2,1,$3)',[run.id,key,[{...event,payload:{time_elapsed:101}}]]),/payload conflict/);
    await assert.rejects(q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[
      {id:crypto.randomUUID(),sequence:1,phase:'valid',payload:{}},
      {id:crypto.randomUUID(),sequence:2,phase:'bad',payload:{rt:-1}}
    ]]),/Invalid rt/);
    assert.equal((await q('select count(*)::int n from public.experiment_events')).rows[0].n,1);
    await assert.rejects(q('select public.complete_run($1,1)',[run.id]),/incomplete/);
    const aid=crypto.randomUUID();
    await q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[
      {id:crypto.randomUUID(),sequence:1,phase:'response',attempt_id:aid,logical_trial:1,attempt_number:1,
       payload:{overall_trial_number:1,task_type:'Motion',correct:true,rt:250,difficulty_level:0,fixation_catch_trial:catchSlots('Motion',256).has(1)}}
    ]]);
    assert.equal((await q('select state from public.trial_attempts')).rows[0].state,'completed');
    await assert.rejects(q('delete from public.experiment_events'),/permission denied/);
  });
});

test('private storage exposes only authorized artifact objects',async()=>{
  await q("insert into storage.objects(bucket_id,name) values('legacy-archive','owned'),('legacy-archive','other')");
  await q("insert into public.artifacts(study_id,participant_id,bucket,object_key,sha256,original_path) values($1,$2,'legacy-archive','owned','hash','fixture')",[ids.s,ids.pa]);
  await as(ids.a,async()=>assert.equal((await q('select * from storage.objects')).rows.length,1));
  await as(ids.b,async()=>assert.equal((await q('select * from storage.objects')).rows.length,0));
  await as(ids.r,async()=>assert.equal((await q('select * from storage.objects')).rows.length,1));
});

test('username reservations are unique, transactional, expire, and never grant legacy or study access',async()=>{
  const uid=crypto.randomUUID();
  const token=(await q("select public.reserve_username('  Test_User  ') token")).rows[0].token;
  await assert.rejects(q("select public.reserve_username('test_user')"),/unavailable/);
  await assert.rejects(q("insert into auth.users(id,raw_user_meta_data) values($1,$2)",[uid,{username:'Test_User',username_reservation:crypto.randomUUID()}]),/reservation/);
  assert.equal((await q('select count(*)::int n from auth.users where id=$1',[uid])).rows[0].n,0);
  await q("insert into auth.users(id,email,raw_user_meta_data) values($1,'fixture@example.invalid',$2)",[uid,{username:'Test_User',username_reservation:token,role:'admin',participant_id:ids.pa}]);
  assert.equal((await q('select provenance from public.participants where auth_user_id=$1',[uid])).rows[0].provenance,'registration');
  assert.equal((await q('select count(*)::int n from private.administrators where auth_user_id=$1',[uid])).rows[0].n,0);
  await as(uid,async()=>{
    assert.equal((await q('select * from public.enrollments')).rows.length,0);
    await assert.rejects(q("select public.reserve_username('hijack')"),/permission denied/);
    await assert.rejects(q("select public.username_auth_email('test_user')"),/permission denied/);
  });
  await q("select public.reserve_username('expired')");
  await q("update private.account_identifiers set expires_at=now()-interval '1 second' where normalized_username='expired'");
  await q("select public.reserve_username('expired')");
});

test('durable rate limit survives requests and expires by database time',async()=>{
  const key='a'.repeat(64);
  assert.equal((await q('select public.consume_auth_limit($1,2,60) allowed',[key])).rows[0].allowed,true);
  assert.equal((await q('select public.consume_auth_limit($1,2,60) allowed',[key])).rows[0].allowed,true);
  assert.equal((await q('select public.consume_auth_limit($1,2,60) allowed',[key])).rows[0].allowed,false);
  await q("update private.auth_rate_limits set window_start=now()-interval '61 seconds'");
  assert.equal((await q('select public.consume_auth_limit($1,2,60) allowed',[key])).rows[0].allowed,true);
});

test('interruption excludes a response, replay gets a new identity, all 256 responses are required',async()=>{
  await as(ids.a,async()=>{
    const aid=crypto.randomUUID();
    await q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[
      {id:crypto.randomUUID(),sequence:2,phase:'interrupted',attempt_id:aid,logical_trial:2,attempt_number:1,
       payload:{manual_pause_interrupted:true,overall_trial_number:2}}
    ]]);
    await assert.rejects(q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[
      {id:crypto.randomUUID(),sequence:3,phase:'response',attempt_id:aid,logical_trial:2,attempt_number:1,
       payload:{correct:true,rt:250,difficulty_level:0}}
    ]]),/Interrupted/);
    const events=Array.from({length:255},(_,i)=>({id:crypto.randomUUID(),sequence:i+3,phase:'response',attempt_id:crypto.randomUUID(),logical_trial:i+2,attempt_number:i===0?2:1,
      payload:{overall_trial_number:i+2,correct:i%2===0,rt:250,difficulty_level:0,task_type:'Motion',fixation_catch_trial:catchSlots('Motion',256).has(i+2)}}));
    for(let offset=0;offset<events.length;offset+=100) await q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),events.slice(offset,offset+100)]);
    const complete=(await q('select public.complete_run($1,258) result',[run.id])).rows[0].result;
    assert.equal(complete.status,'complete');
    assert.equal((await q("select count(*)::int n from public.trial_attempts where run_id=$1 and state='interrupted'",[run.id])).rows[0].n,1);
    await assert.rejects(q('select public.ingest_events($1,$2,1,$3)',[run.id,crypto.randomUUID(),[{id:crypto.randomUUID(),sequence:258,phase:'extra',payload:{}}]]),/not accepting/);
  });
});

test('database catch slots exactly match the current scientific task generator',async()=>{
  for(const task of ['Motion','Orientation','Centrality','Bar']) {
    const sql=(await q('select private.catch_slots($1) slots',[task])).rows[0].slots;
    assert.deepEqual(sql,Array.from(catchSlots(task,256)));
  }
});

test('admin directory, legacy artifacts and settings enforce admin/owner isolation',async()=>{
  await q("insert into public.profiles(auth_user_id,display_username) values($1,'FixtureOwner') on conflict do nothing",[ids.a]);
  const asset='40000000-0000-0000-0000-000000000004';
  await q("insert into public.artifacts(id,participant_id,bucket,object_key,sha256,original_path,kind,row_count,identity_status) values($1,$2,'legacy-archive','acceptance/legacy.csv','test','legacy.csv','.csv',10,'matched')",[asset,ids.pa]);
  await as(ids.a,async()=>{
    assert.equal((await q('select public.account_access() access')).rows[0].access,'participant');
    await assert.rejects(q('select * from public.admin_user_status()'),/Administrator/);
    assert.equal((await q('select count(*)::int n from public.artifacts where id=$1',[asset])).rows[0].n,1);
    await assert.rejects(q('insert into private.administrators values($1)',[ids.a]),/permission/);
  });
  await as(ids.b,async()=>assert.equal((await q('select count(*)::int n from public.artifacts where id=$1',[asset])).rows[0].n,0));
  await as(ids.admin,async()=>{
    assert.equal((await q('select public.account_access() access')).rows[0].access,'admin');
    const directory=(await q('select * from public.admin_user_status()')).rows;
    assert.ok(directory.some(row=>row.participant_id===ids.pa && Number(row.source_rows)===10));
    assert.ok((await q('select count(*)::int n from public.display_profiles')).rows[0].n>0);
  });
  await as(null,async()=>assert.rejects(q('select public.account_access()'),/permission/),'anon');
});

test('SQL summaries reconcile response, duration, catch, replay and empty-session definitions',async()=>{
 const cases=[[],[
  {time_elapsed:'0',task_type:'Motion'},
  {overall_trial_number:'1',attempt_number:'1',task_type:'Motion',time_elapsed:'500',rt:'100'},
  {overall_trial_number:'1',attempt_number:'1',task_type:'Motion',time_elapsed:'900',correct:'yes',difficulty_level:'0',rt:'250'},
  {overall_trial_number:'2',task_type:'Motion',time_elapsed:'1800',correct:'false',difficulty_level:'2',rt:'300'},
  {trial_category:'scheduled_break',time_elapsed:'6800'},
  {overall_trial_number:'3',task_type:'Motion',time_elapsed:'7300',trial_category:'fixation_catch_response',correct:'true',rt:'200'},
  {overall_trial_number:'4',task_type:'Bar',time_elapsed:'200',correct:'true',difficulty_level:'7',rt:'100'},
  {overall_trial_number:'5',correct_direction:'vertical',time_elapsed:'',correct:'0',difficulty_level:'1',rt:'NaN'},
  {overall_trial_number:'6',task_type:'Motion',time_elapsed:'900',correct:'incorrect',difficulty_level:'',fixation_catch_trial:'true',correct_direction:'x',fixation_response_key:'x'},
  {overall_trial_number:'7',attempt_number:1,time_elapsed:'1000',task_type:'Motion',correct:true,difficulty_level:3,rt:100},
  {overall_trial_number:'7',attempt_number:1,time_elapsed:'1100',manual_pause_interrupted:true},
  {overall_trial_number:'7',attempt_number:2,time_elapsed:'1300',task_type:'Motion',correct:false,difficulty_level:3,rt:200},
  {trial_category:'manual_pause_screen',time_elapsed:'1400'},
  {overall_trial_number:'8',task_type:'Orientation',time_elapsed:'1600',correct:true,difficulty_level:2,attempt_state:'interrupted'}
 ],Array.from({length:600},(_,i)=>({task_type:'Centrality',overall_trial_number:Math.floor(i/3)+1,
  attempt_number:1,time_elapsed:i*123.5,...(i%3===2?{correct:i%2===0,difficulty_level:i%8,rt:100}:{} )}))];
 for(const rows of cases)for(const exclude of [false,true]){
  const interrupted=new Set(rows.filter(r=>r.manual_pause_interrupted).map(r=>`${r.overall_trial_number}|${r.attempt_number}`));
  const filtered=exclude?rows.filter(r=>!interrupted.has(`${r.overall_trial_number}|${r.attempt_number}`)):rows;
  const actual=(await q('select private.summarize_portal_rows($1,\'Motion\',$2) as metrics',[rows,exclude])).rows[0].metrics;
  actual.levels.sort((a,b)=>a.level.localeCompare(b.level,undefined,{numeric:true}));
  assert.ok(metricsMatch(actual,summaryMetrics(analyzeRows(filtered,'Motion'),'Motion')),JSON.stringify({actual,expected:summaryMetrics(analyzeRows(filtered,'Motion'),'Motion')}));
 }
});

test('recorded summary updates atomically on ingestion/completion and follows source authorization',async()=>{
 const rows=(await q('select payload from public.experiment_events where run_id=$1 order by client_sequence',[run.id])).rows.map(e=>e.payload);
 const interrupted=new Set(rows.filter(r=>r.manual_pause_interrupted).map(r=>`${r.overall_trial_number}|${r.attempt_number}`));
 const expected=summaryMetrics(analyzeRows(rows.filter(r=>!interrupted.has(`${r.overall_trial_number}|${r.attempt_number}`)),'Motion'),'Motion');
 const actual=(await q('select metrics from public.session_metrics where run_id=$1',[run.id])).rows[0].metrics;
 assert.ok(metricsMatch(actual,expected));
 await as(ids.a,async()=>{
  assert.ok((await q("select * from public.portal_sessions where source='recorded' and id=$1",[run.id])).rowCount===1);
  await assert.rejects(q("update public.session_metrics set metrics='{}' where run_id=$1",[run.id]),/permission/);
  await assert.rejects(q('select private.refresh_run_metrics($1)',[run.id]),/permission/);
 });
 await as(ids.b,async()=>assert.equal((await q('select * from public.session_metrics where run_id=$1',[run.id])).rowCount,0));
 await as(ids.r,async()=>assert.equal((await q('select * from public.session_metrics where run_id=$1',[run.id])).rowCount,1));
 await as(null,async()=>assert.rejects(q('select * from public.portal_sessions'),/permission/),'anon');
});

test('one dashboard RPC preserves account access, selected-user isolation and run pagination',async()=>{
 await q("insert into public.profiles(auth_user_id,display_username) values($1,'OtherOwner'),($2,'AdminOwner') on conflict do nothing",[ids.b,ids.admin]);
 await as(ids.a,async()=>{
  const dashboard=(await q('select public.portal_dashboard() as data')).rows[0].data;
  assert.equal(dashboard.access,'participant');assert.equal(dashboard.participant.id,ids.pa);
  assert.equal(dashboard.studies.length,1);assert.equal(dashboard.enrollments.length,1);
  assert.equal(dashboard.totalRuns,Number((await q('select count(*) as n from public.experiment_runs')).rows[0].n));
  assert.ok(dashboard.runs.some(r=>r.id===run.id));
  assert.equal((await q('select public.portal_dashboard(null,null,25) as data')).rows[0].data.runs.length,0);
  await assert.rejects(q('select public.portal_dashboard(null,$1)',[ids.pb]),/unavailable/);
  await assert.rejects(q('select public.portal_dashboard($1)',[ids.b]),/unavailable/);
  await assert.rejects(q('select public.portal_dashboard(null,null,-1)'),/Invalid/);
 });
 await as(ids.admin,async()=>{
  const selected=(await q('select public.portal_dashboard(null,$1) as data',[ids.pa])).rows[0].data;
  const expected=(await q('select display_username from public.profiles where auth_user_id=$1',[ids.a])).rows[0].display_username;
  assert.equal(selected.access,'admin');assert.equal(selected.participant.id,ids.pa);assert.equal(selected.profile.display_username,expected);
 });
 await as(null,async()=>assert.rejects(q('select public.portal_dashboard()'),/permission/),'anon');
});

test('historical SQL selection supersedes chunks, excludes backups and rejects stale or cross-account summaries',async()=>{
 const asset=crypto.randomUUID(),chunk=crypto.randomUUID(),backup=crypto.randomUUID(),standalone=crypto.randomUUID();
 for(const [id,name] of [[asset,'final_complete_user_Test_Motion_2026-10-01T14-30-00.csv'],[chunk,'session_chunk_complete_user_Test_Motion_2026-10-01T14-30-00.csv'],[backup,'final_complete_user_Test_Motion_2026-10-01T14-30-00.bak'],[standalone,'session_chunk_complete_user_Test_Motion_2026-10-02T14-30-00.csv']]){
  await q("insert into public.artifacts(id,study_id,participant_id,bucket,object_key,sha256,original_path,kind,task) values($1::uuid,$2,$3,'legacy-archive',$1::uuid::text,'hash',$4,$5,'Motion')",[id,ids.s,ids.pa,name,name.endsWith('.bak')?'.bak':'.csv']);
  await q('select private.refresh_artifact_metrics($1,\'hash\',$2)',[id,[{task_type:'Motion',overall_trial_number:1,correct:true,difficulty_level:1,rt:250}]]);
 }
 await as(ids.a,async()=>{
  const sessions=(await q('select id,metrics from public.portal_sessions where id=any($1::uuid[])',[ [asset,chunk,backup,standalone] ])).rows;
  assert.deepEqual(sessions.map(s=>s.id).sort(),[asset,standalone].sort());
  assert.ok(sessions.every(s=>s.metrics.total===1));
  await assert.rejects(q('select private.refresh_artifact_metrics($1,\'hash\',$2)',[asset,[]]),/permission/);
  await assert.rejects(q('insert into public.session_metrics(artifact_id,source_sha256,metrics) values($1,\'hash\',\'{}\')',[crypto.randomUUID()]),/permission/);
 });
 await as(ids.b,async()=>assert.equal((await q('select * from public.portal_artifacts where id=$1',[asset])).rowCount,0));
 await as(ids.admin,async()=>assert.equal((await q('select * from public.session_metrics where artifact_id=$1',[asset])).rowCount,1));
 await as(ids.r,async()=>assert.equal((await q('select * from public.portal_sessions where id=$1',[asset])).rowCount,1));
 await q("update public.artifacts set sha256='changed' where id=$1",[asset]);
 assert.equal((await q('select metrics from public.portal_sessions where id=$1',[asset])).rows[0].metrics,null);
 await assert.rejects(q('select private.refresh_artifact_metrics($1,\'hash\',$2)',[asset,[]]),/changed/);
 await q('delete from public.artifacts where id=any($1::uuid[])',[[asset,chunk,backup,standalone]]);
 assert.equal((await q('select * from public.session_metrics where artifact_id=any($1::uuid[])',[[asset,chunk,backup,standalone]])).rowCount,0);
});

test('backfill verifies byte checksums and retains invalid files without inventing metrics',async()=>{
 const id=crypto.randomUUID(),content=Buffer.from('task_type,correct,difficulty_level,rt\nMotion,true,1,250\n');
 const sha=await crypto.subtle.digest('SHA-256',content).then(b=>Buffer.from(b).toString('hex'));
 await q("insert into public.artifacts(id,participant_id,bucket,object_key,sha256,original_path,kind,task) values($1::uuid,$2,'legacy-archive',$1::uuid::text,$3,'user_Backfill.csv','.csv','Motion')",[id,ids.pa,sha]);
 // Live acceptance already owns a rollback-only transaction; never commit it.
 const adapter={query:(sql,params)=>live&&['begin','commit','rollback'].includes(sql)?Promise.resolve({rows:[]}):q(sql,params)};
 await assert.rejects(storeArtifactMetrics(adapter,{id,sha256:'wrong',task:'Motion'},content),/Checksum/);
 assert.equal((await q('select * from public.session_metrics where artifact_id=$1',[id])).rowCount,0);
 assert.deepEqual(await storeArtifactMetrics(adapter,{id,sha256:sha,task:'Motion'},content),{valid:true});
 const malformed=Buffer.from('duplicate,duplicate\n1,2\n'),badHash=await crypto.subtle.digest('SHA-256',malformed).then(b=>Buffer.from(b).toString('hex'));
 await q('update public.artifacts set sha256=$2 where id=$1',[id,badHash]);
 assert.deepEqual(await storeArtifactMetrics(adapter,{id,sha256:badHash,task:'Motion'},malformed),{valid:false});
 const metric=(await q('select metrics,error_code from public.portal_sessions where id=$1',[id])).rows[0];
 assert.deepEqual(metric,{metrics:null,error_code:'INVALID_CSV'});
 await q('delete from public.artifacts where id=$1',[id]);
});

test.after(()=>db.close());
