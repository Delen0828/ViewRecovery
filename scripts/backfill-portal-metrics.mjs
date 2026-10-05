// Server-only, resumable backfill. Logs counts only, never source identities/rows.
import fs from 'node:fs';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';
import {storeArtifactMetrics} from './lib/portal-metrics.mjs';
const env=readLocalEnv();
if(validateStagingEnv(env).length)throw new Error('INVALID_STAGING_CONFIG');
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,
 {auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-portal-metrics-backfill'));
const force=process.argv.includes('--force'),report={passed:false,processed:0,skipped:0,ready:0,invalid:0,checksumsVerified:0,metricsReconciled:0};
const start=performance.now();
try{
 await db.connect();await db.query("select pg_advisory_lock(hashtext('viewrecovery-portal-metrics'))");
 const {rows}=await db.query(`select a.id,a.bucket,a.object_key,a.sha256,a.task,
  m.metrics is not null as ready,m.error_code from public.artifacts a left join public.session_metrics m
  on m.artifact_id=a.id and m.source_sha256=a.sha256 and m.metrics_version=1
  where a.kind in ('.csv','.bak') order by a.id`);
 report.eligible=rows.length;
 for(const artifact of rows){
  if(!force&&(artifact.ready||artifact.error_code)){report.skipped++;continue;}
  const {data,error}=await client.storage.from(artifact.bucket).download(artifact.object_key);
  if(error)throw Object.assign(new Error('Could not download source'),{code:'SOURCE_DOWNLOAD_FAILED'});
  const result=await storeArtifactMetrics(db,artifact,await data.arrayBuffer());
  report.processed++;report.checksumsVerified++;
  if(result.valid){report.ready++;report.metricsReconciled++;}else report.invalid++;
  if(report.processed%10===0)console.log(JSON.stringify({processed:report.processed,eligible:report.eligible,ready:report.ready,invalid:report.invalid}));
 }
 const counts=await db.query(`select source,count(*)::int as sessions,count(*) filter(where metrics is null)::int as unavailable,
  coalesce(sum(octet_length(metrics::text)),0)::bigint as metric_bytes from public.portal_sessions group by source order by source`);
 report.overview=counts.rows;report.passed=true;
}catch(error){report.errorCode=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'BACKFILL_FAILED';process.exitCode=1;}
finally{
 await db.query("select pg_advisory_unlock(hashtext('viewrecovery-portal-metrics'))").catch(()=>{});await db.end().catch(()=>{});
 report.elapsedSeconds=Math.round((performance.now()-start)/10)/100;
 fs.mkdirSync('test/results',{recursive:true});fs.writeFileSync('test/results/portal-metrics-backfill.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
