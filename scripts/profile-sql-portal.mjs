// Read-only SQL-summary benchmark. Output contains timings/counts only.
import fs from 'node:fs';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv} from './lib/local-env.mjs';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';
const env=readLocalEnv(),db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-sql-summary-profile'));
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const report={measuredAt:new Date().toISOString(),method:'Read-only SQL-summary HTTP replay with server API key; SQL EXPLAIN uses authenticated admin RLS. Excludes browser auth/rendering.',samples:[]};
try{
 await db.connect();await db.query('begin read only');
 const selected=(await db.query("select participant_id,count(*)::int as sessions from public.portal_sessions where source='historical' group by participant_id order by count(*) desc limit 1")).rows[0];
 if(!selected)throw new Error('NO_SESSIONS');
 for(let i=0;i<3;i++){
  const start=performance.now();
  const {data,error,count}=await client.from('portal_sessions').select('id,participant_id,task,session_date,label,username,metrics,error_code',{count:'exact'}).eq('source','historical').eq('participant_id',selected.participant_id).order('session_date').order('id').range(0,499);
  if(error||data.length!==selected.sessions||count!==selected.sessions||data.some(s=>!s.metrics))throw new Error('SUMMARY_QUERY_FAILED');
  report.samples.push({ms:Math.round((performance.now()-start)*100)/100,httpRequests:1,sessions:data.length,jsonBytes:Buffer.byteLength(JSON.stringify(data))});
 }
 const admin=(await db.query('select auth_user_id from private.administrators limit 1')).rows[0].auth_user_id;
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:admin,role:'authenticated'})]);
 await db.query('set local role authenticated');
 const plan=(await db.query("explain (analyze,buffers,format json) select id,participant_id,task,session_date,label,username,metrics,error_code from public.portal_sessions where source='historical' and participant_id=$1 order by session_date,id limit 500",[selected.participant_id])).rows[0]['QUERY PLAN'][0];
 report.sql={planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],rows:plan.Plan['Actual Rows']};
 await db.query('rollback');
 report.passed=true;
 fs.mkdirSync('test/results',{recursive:true});fs.writeFileSync('test/results/portal-sql-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({failed:true,code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'PROFILE_FAILED'}));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
