import crypto from 'node:crypto';
import {parseCsv} from '../../src/portal-csv.js';
import {analyzeRows,csvObjects} from '../../src/portal-metrics.js';

export function summaryMetrics(metrics,fallbackTask='') {
 const {records,...summary}=metrics;
 return {...summary,meanDifficulty:records.length?records.reduce((n,r)=>n+(Number(r.level)||0),0)/records.length:0,
  task:records[0]?.task||fallbackTask||''};
}
export function metricsMatch(actual,expected) {
 if(typeof actual==='number'&&typeof expected==='number')return Math.abs(actual-expected)<=1e-8*Math.max(1,Math.abs(expected));
 if(Array.isArray(actual)&&Array.isArray(expected))return actual.length===expected.length&&actual.every((v,i)=>metricsMatch(v,expected[i]));
 if(actual&&expected&&typeof actual==='object'&&typeof expected==='object')return Object.keys(actual).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>metricsMatch(actual[k],v));
 return actual===expected;
}
export async function storeArtifactMetrics(db,artifact,content) {
 const bytes=Buffer.from(content),digest=crypto.createHash('sha256').update(bytes).digest('hex');
 if(digest!==artifact.sha256)throw Object.assign(new Error('Checksum mismatch'),{code:'CHECKSUM_MISMATCH'});
 let rows;
 try{rows=csvObjects(parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
 catch{
  const result=await db.query(`insert into public.session_metrics(artifact_id,source_sha256,metrics,error_code)
   select id,sha256,null,'INVALID_CSV' from public.artifacts where id=$1 and sha256=$2
   on conflict(artifact_id) do update set source_sha256=excluded.source_sha256,metrics_version=1,
    metrics=null,error_code=excluded.error_code,updated_at=now() returning id`,[artifact.id,digest]);
  if(!result.rowCount)throw Object.assign(new Error('Artifact changed'),{code:'ARTIFACT_CHANGED'});
  return {valid:false};
 }
 // Compute inside SQL, then independently reconcile with the existing definitions.
 // Roll back the new summary if reconciliation fails; never publish incorrect metrics.
 await db.query('begin');
 try{
  const actual=(await db.query('select private.refresh_artifact_metrics($1,$2,$3::jsonb) as metrics',[artifact.id,digest,JSON.stringify(rows)])).rows[0].metrics;
  actual.levels.sort((a,b)=>a.level.localeCompare(b.level,undefined,{numeric:true}));
  const expected=summaryMetrics(analyzeRows(rows,artifact.task),artifact.task);
  if(!metricsMatch(actual,expected))throw Object.assign(new Error('Metric reconciliation failed'),{code:'METRICS_MISMATCH'});
  await db.query('commit');return {valid:true};
 }catch(error){await db.query('rollback');throw error;}
}
