import {createHash} from 'node:crypto';
import {readLocalEnv} from '../../../scripts/lib/local-env.mjs';
import {parseCsv} from '../../../src/portal-csv.js';
import {analyzeRows,csvObjects,fileDate} from '../../../src/portal-metrics.js';
import {summaryMetrics} from '../../../scripts/lib/portal-metrics.mjs';
const env=readLocalEnv(),project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const participant='20000000-0000-0000-0000-000000000001',study='30000000-0000-0000-0000-000000000001';
const user={id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',email_confirmed_at:'2026-10-04T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:'2026-10-04T00:00:00Z'};
function csv(task='Motion',shift=0) {
 const rows=['user_id,task_type,trial_category,overall_trial_number,time_elapsed,correct,difficulty_level,rt,stimulus'];
 rows.push(`Fixture,${task},instructions,,0,,,,`);
 for(let i=1;i<=60;i++)rows.push(`Fixture,${task},,${i},${i*1000},${(i+shift)%3!==0},${i%5},250,`);
 rows.push(`Fixture,${task},scheduled_break,,120000,,,,`);
 rows.push(`Fixture,${task},fixation_catch_response,61,121000,true,,200,`);
 rows.push(`Fixture,${task},,,121500,,,,"<script>alert(1)</script>\n<p>preserved</p>"`);
 return rows.join('\n')+'\n';
}
function files(count=4) {
 return Array.from({length:count},(_,i)=>({id:`file-${i}`,participant_id:participant,bucket:'legacy-archive',object_key:`file-${i}.csv`,original_path:`final_complete_user_Fixture_${i%2?'Centrality':'Motion'}_${new Date(Date.UTC(2026,9,1,14,30)+i*86400000).toISOString().replaceAll(':','-').replace('.000Z','')}.csv`,kind:'.csv',row_count:64,task:i%2?'Centrality':'Motion',identity_status:'matched',bytes:4000,legacy_user_id:'Fixture',created_at:'2026-10-04T14:30:00Z'}));
}
export async function mock(page,{count=4,role='participant'}={}) {
 const manifest=files(count).map(f=>({...f,sha256:createHash('sha256').update(csv(f.task,Number(f.id.split('-')[1]))).digest('hex'),metrics:summaryMetrics(analyzeRows(csvObjects(parseCsv(csv(f.task,Number(f.id.split('-')[1])))),f.task),f.task)})),saved={displays:[],training:[],runs:[],uploads:[],calls:[],requests:[],manifest};
 const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})).toString('base64url');
 const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
 await page.addInitScript(({key,session})=>{localStorage.setItem(key,JSON.stringify(session));},{key:`sb-${project}-auth-token`,session});
 await page.route(`${env.SUPABASE_URL}/auth/v1/**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)}));
 await page.route(`${env.SUPABASE_URL}/rest/v1/**`,route=>{
  const url=new URL(route.request().url()),resource=url.pathname.split('/').at(-1),args=route.request().postDataJSON();let data=[];
  saved.requests.push({resource,params:Object.fromEntries(url.searchParams),args});
  if(resource==='portal_dashboard')data={access:role,profile:{display_username:'Fixture',preferences:{}},participant:{id:participant,auth_user_id:user.id,provenance:'registration'},studies:[{id:study,name:'Visual recovery study',active:true,tasks:['Motion','Centrality','Orientation','Bar'],protocol_version:'legacy-2026-10-04',consent_version:'v1'}],enrollments:[{participant_id:participant,study_id:study,active:true,consent_version:'v1',consented_at:'2026-10-04T00:00:00Z'}],runs:saved.runs,totalRuns:saved.runs.length};
  else if(resource==='profiles')data={display_username:'Fixture',preferences:{}};
  else if(resource==='participants')data={id:participant,provenance:'registration'};
  else if(resource==='studies')data=[{id:study,name:'Visual recovery study',active:true,tasks:['Motion','Centrality','Orientation','Bar'],protocol_version:'legacy-2026-10-04',consent_version:'v1'}];
  else if(resource==='enrollments')data=[{participant_id:participant,study_id:study,active:true,consent_version:'v1',consented_at:'2026-10-04T00:00:00Z'}];
  else if(resource==='account_access')data=role;
  else if(resource==='admin_user_status')data=[{username:'Fixture',participant_id:participant,auth_user_id:user.id,total_users:1}];
  else if(resource==='display_profiles')data=saved.displays;
  else if(resource==='training_settings')data=saved.training;
  else if(resource==='artifacts'||resource==='portal_artifacts') {
   if(url.searchParams.get('select')==='sha256') {
    const f=manifest.find(f=>'eq.'+f.id===url.searchParams.get('id'));
    data={sha256:createHash('sha256').update(csv(f.task,Number(f.id.split('-')[1]))).digest('hex')};
   }else{const offset=Number(url.searchParams.get('offset')||0);data=manifest.slice(offset,offset+Number(url.searchParams.get('limit')||25));}
  }else if(resource==='portal_sessions'){
   const source=url.searchParams.get('source');
   const sessions=source==='eq.recorded'?saved.runs.map(r=>({id:r.id,participant_id:r.participant_id,task:r.task,session_date:r.started_at,label:r.task+' — '+r.status,username:'Fixture',metrics:r.metrics||summaryMetrics(analyzeRows([{task_type:r.task,overall_trial_number:1,difficulty_level:1,correct:true,rt:1000}],r.task),r.task)})):
    manifest.map(f=>({id:f.id,participant_id:f.participant_id,task:f.task,session_date:fileDate(f),label:f.original_path,username:f.legacy_user_id,metrics:f.metrics}));
   const id=url.searchParams.get('id');
   if(id)data={metrics:sessions.find(s=>'eq.'+s.id===id)?.metrics};
   else{const offset=Number(url.searchParams.get('offset')||0);data=sessions.slice(offset,offset+Number(url.searchParams.get('limit')||500));}
  }else if(resource==='experiment_runs')data=saved.runs;
  else if(resource==='save_settings') {
   saved.calls.push(args);
   const display={id:'40000000-0000-0000-0000-000000000001',name:args.display_name,settings:args.display,version:saved.displays.length?saved.displays[0].version+1:1};
   const training={id:'50000000-0000-0000-0000-000000000001',study_id:study,task:args.task_name,display_profile_id:display.id,settings:args.settings,version:display.version};
   saved.displays=[display];saved.training=[training];data={display,training};
  }else if(resource==='create_run') {
   const display=saved.displays[0].settings,d=display.distance_cm,ppx=display.screen_width/display.width_cm,ppy=display.screen_height/display.height_cm;
   const run={id:'60000000-0000-0000-0000-000000000001',participant_id:participant,task:saved.training[0].task,status:'active',started_at:'2026-10-04T14:30:00Z',parameter_snapshot:{confirmed_at:'2026-10-04T14:30:00Z',display,training:saved.training[0].settings,geometry:{pixels_per_cm_x:ppx,pixels_per_cm_y:ppy,pixels_per_degree:d*Math.tan(Math.PI/180)*(ppx+ppy)/2}}};
   saved.runs.push(run);data=run;
  }else if(resource==='ingest_events') {saved.uploads.push(args);data={accepted:args.events.length,batch_key:args.batch_key};}
  else if(resource==='complete_run')data={status:'complete'};
  const total=['artifacts','portal_artifacts'].includes(resource)?manifest.length:resource==='portal_sessions'?(url.searchParams.get('source')==='eq.recorded'?saved.runs.length:manifest.length):Array.isArray(data)?data.length:1;
  return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':`0-${Math.max(0,total-1)}/${total}`},body:JSON.stringify(data)});
 });
 await page.route(`${env.SUPABASE_URL}/storage/v1/object/sign/**`,route=>{
  saved.requests.push({resource:'storage'});
  const path=new URL(route.request().url()).pathname.replace('/storage/v1','');
  if(route.request().method()==='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signedURL:path+'?token=fixture'})});
  const f=manifest.find(f=>path.endsWith('/'+f.object_key));
  return route.fulfill({status:200,contentType:'text/csv',body:csv(f.task,Number(f.id.split('-')[1]))});
 });
 return saved;
}
