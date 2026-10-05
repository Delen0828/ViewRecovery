// Read-only diagnostic. Never logs credentials, signed URLs, identities or CSV rows.
// Run from the repository root: node scripts/profile-portal-load.mjs
import fs from 'node:fs';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv} from './lib/local-env.mjs';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';
import {parseCsv} from '../src/portal-csv.js';
import {analyzeRows,csvObjects,trendFiles} from '../src/portal-metrics.js';

const env=readLocalEnv();
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,
 {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})}});
const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-portal-profile-readonly'));
const report={measuredAt:new Date().toISOString(),apiHost:new URL(env.SUPABASE_URL).hostname,
 method:'Server-side read-only replay of current historical loader and proposed batching; HTTP uses server key. SQL EXPLAIN uses authenticated RLS. No browser auth, CORS or rendering included.',samples:[],sql:[]};
const rounded=n=>Math.round(n*100)/100;
const checked=r=>{if(r.error)throw Object.assign(new Error('API operation failed'),{code:r.error.code||'API_ERROR'});return r;};
async function timed(fn){const t=performance.now();const value=await fn();return {value,ms:performance.now()-t};}
async function limited(items,fn){let next=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;await fn(items[i],i);}}));}
function stats(values){const sorted=values.toSorted((a,b)=>a-b);return {sumMs:rounded(values.reduce((a,b)=>a+b,0)),meanMs:rounded(values.reduce((a,b)=>a+b,0)/values.length),medianMs:rounded(sorted[Math.floor(sorted.length/2)]),maxMs:rounded(sorted.at(-1))};}
const fields='id,participant_id,bucket,object_key,original_path,kind,bytes,row_count,task,identity_status,created_at,legacy_user_id';
async function manifest(participantId,includeHash){const files=[];let pages=0,total;do{const r=checked(await client.from('artifacts').select(fields+(includeHash?',sha256':''),{count:'exact'}).eq('participant_id',participantId).order('original_path').order('id').range(pages*25,pages*25+24));pages++;files.push(...r.data);total=r.count;if(!r.data.length)break;}while(files.length<total);return {files,pages};}
async function experiment(participantId,variant,label,iteration){
 const start=performance.now(),m=await timed(()=>manifest(participantId,variant==='batched'));
 const selected=trendFiles(m.value.files),durations={},metrics=new Map(),cacheStatus={};
 const add=(stage,ms)=>(durations[stage]??=[]).push(ms);
 const signed=new Map();let signingRequests=0;
 if(variant==='batched'){
  const buckets=[...new Set(selected.map(f=>f.bucket))];
  for(const bucket of buckets){const files=selected.filter(f=>f.bucket===bucket);const t=await timed(async()=>checked(await client.storage.from(bucket).createSignedUrls(files.map(f=>f.object_key),300)).data);add('signBatch',t.ms);signingRequests++;for(const item of t.value){if(item.error||!item.signedUrl)throw Object.assign(new Error('Signing failed'),{code:'SIGN_ERROR'});signed.set(bucket+'|'+item.path,item.signedUrl);}}
 }
 let downloadedBytes=0,sourceRows=0;
 const loadStart=performance.now();
 await limited(selected,async file=>{
  let url=signed.get(file.bucket+'|'+file.object_key);
  if(variant==='current'){const t=await timed(async()=>checked(await client.storage.from(file.bucket).createSignedUrl(file.object_key,300)).data.signedUrl);add('sign',t.ms);url=t.value;signingRequests++;}
  const download=await timed(async()=>{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Object.assign(new Error('Download failed'),{code:'HTTP_'+response.status});const status=response.headers.get('cf-cache-status')||'unspecified';cacheStatus[status]=(cacheStatus[status]||0)+1;return response.arrayBuffer();});add('download',download.ms);downloadedBytes+=download.value.byteLength;
  const digest=await timed(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',download.value)),n=>n.toString(16).padStart(2,'0')).join(''));add('digest',digest.ms);
  let expected=file.sha256;
  if(variant==='current'){const t=await timed(async()=>checked(await client.from('artifacts').select('sha256').eq('id',file.id).single()).data.sha256);add('checksumLookup',t.ms);expected=t.value;}
  if(expected!==digest.value)throw Object.assign(new Error('Checksum mismatch'),{code:'CHECKSUM_MISMATCH'});
  const decode=await timed(()=>new TextDecoder('utf-8',{fatal:true}).decode(download.value));add('decode',decode.ms);
  const parse=await timed(()=>parseCsv(decode.value));add('parse',parse.ms);sourceRows+=parse.value.rows.length;
  const objects=await timed(()=>csvObjects(parse.value));add('rowObjects',objects.ms);
  const analyzed=await timed(()=>analyzeRows(objects.value,file.task));add('analyze',analyzed.ms);metrics.set(file.id,analyzed.value);
 });
 const sample={label,iteration,variant,artifactCount:m.value.files.length,manifestRequests:m.value.pages,sessionCount:selected.length,manifestMs:rounded(m.ms),fileLoadMs:rounded(performance.now()-loadStart),totalMs:rounded(performance.now()-start),httpRequests:m.value.pages+signingRequests+selected.length+(variant==='current'?selected.length:0),downloadedBytes,sourceRows,cacheStatus,stages:Object.fromEntries(Object.entries(durations).map(([key,value])=>[key,stats(value)]))};
 report.samples.push(sample);console.log(JSON.stringify(sample));return metrics;
}
async function explain(label,sql,params){const {rows}=await db.query('explain (analyze,buffers,format json) '+sql,params);const p=rows[0]['QUERY PLAN'][0];report.sql.push({label,planningMs:p['Planning Time'],executionMs:p['Execution Time'],rows:p.Plan['Actual Rows'],node:p.Plan['Node Type'],sharedHits:p.Plan['Shared Hit Blocks'],sharedReads:p.Plan['Shared Read Blocks']});}

try{
 if(env.SUPABASE_ACCESS_TOKEN){const r=await fetch('https://api.supabase.com/v1/projects/'+report.apiHost.split('.')[0],{headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN},signal:AbortSignal.timeout(15000)});if(r.ok){const p=await r.json();report.project={region:p.region,status:p.status,databaseVersion:p.database?.version};}}
 await db.connect();await db.query('begin read only');await db.query("set local statement_timeout='15s'");
 const {rows:inventory}=await db.query('select '+fields+',sha256 from public.artifacts order by original_path,id');
 const ids=[...new Set(inventory.map(f=>f.participant_id).filter(Boolean))];
 const groups=ids.map(id=>({id,files:inventory.filter(f=>f.participant_id===id)})).map(g=>({...g,sessions:trendFiles(g.files)})).filter(g=>g.sessions.length).sort((a,b)=>a.sessions.length-b.sessions.length);
 report.inventory={artifacts:inventory.length,participantsWithTrendFiles:groups.length,sessionCounts:groups.map(g=>g.sessions.length),runCount:Number((await db.query('select count(*) as n from public.experiment_runs')).rows[0].n),eventCount:Number((await db.query('select count(*) as n from public.experiment_events')).rows[0].n)};
 console.log(JSON.stringify({inventory:report.inventory,project:report.project}));
 const largest=groups.at(-1),median=groups[Math.floor((groups.length-1)/2)];
 const admin=(await db.query('select auth_user_id from private.administrators limit 1')).rows[0]?.auth_user_id;
 const participant=(await db.query('select auth_user_id from public.participants where id=$1',[largest.id])).rows[0]?.auth_user_id;
 for(const [role,userId] of [['admin',admin],['participant',participant]]){
  if(!userId)continue;
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role:'authenticated'})]);await db.query('set local role authenticated');
  await explain(role+' artifact page','select '+fields+' from public.artifacts where participant_id=$1 order by original_path,id limit 25',[largest.id]);
  await explain(role+' artifact exact count','select count(*) from public.artifacts where participant_id=$1',[largest.id]);
  await explain(role+' checksum lookup','select sha256 from public.artifacts where id=$1',[largest.sessions[0].id]);
  await explain(role+' storage authorization','select id from storage.objects where bucket_id=$1 and name=$2',[largest.sessions[0].bucket,largest.sessions[0].object_key]);
  if(role==='admin')await explain('admin account access','select public.account_access()',[]);
  await db.query('reset role');
 }
 await db.query('rollback');await db.end();
 const targets=median.id===largest.id?[['largest',largest]]:[['median',median],['largest',largest]];
 for(const [label,group] of targets){
  let reference;
  for(const [iteration,order] of [[1,['current','batched']],[2,['batched','current']]]){
   for(const variant of order){const metrics=await experiment(group.id,variant,label,iteration);if(!reference)reference=metrics;else if([...reference].some(([id,m])=>JSON.stringify(m)!==JSON.stringify(metrics.get(id))))throw Object.assign(new Error('Metrics differ'),{code:'METRICS_MISMATCH'});}
  }
 }
 report.metricsIdentical=true;
 fs.mkdirSync('test/results',{recursive:true});fs.writeFileSync('test/results/portal-performance.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({sql:report.sql,metricsIdentical:true,report:'test/results/portal-performance.json'}));
}catch(error){console.error(JSON.stringify({failed:true,code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'DIAGNOSTIC_ERROR'}));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
