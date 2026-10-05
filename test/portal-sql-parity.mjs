// Reconcile SQL against every real historical file without logging source data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {parseCsv} from '../src/portal-csv.js';
import {analyzeRows,csvObjects} from '../src/portal-metrics.js';
import {metricsMatch,summaryMetrics} from '../scripts/lib/portal-metrics.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'viewrecovery-sql-parity-'));fs.chmodSync(directory,0o700);
const db=new PGlite(),report={passed:false,verified:0,invalid:0,sourceRows:0};
try{
 const prepared=spawnSync('python3',['scripts/prepare_legacy_access.py','server-data.zip','--output',directory],{encoding:'utf8'});
 if(prepared.status!==0)throw new Error('ARCHIVE_PREPARATION_FAILED');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 const migration=fs.readFileSync('supabase/migrations/202610050001_portal_metrics.sql','utf8');
 await db.exec('create schema private;'+migration.slice(migration.indexOf('create function private.metric_number'),migration.indexOf('create function private.refresh_artifact_metrics')));
 for(const entry of manifest.entries.filter(e=>['.csv','.bak'].includes(e.kind))){
  let rows;
  try{rows=csvObjects(parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(path.join(directory,entry.local_file)))));}
  catch{report.invalid++;continue;}
  const actual=(await db.query('select private.summarize_portal_rows($1,$2,false) as metrics',[rows,entry.task])).rows[0].metrics;
  actual.levels.sort((a,b)=>a.level.localeCompare(b.level,undefined,{numeric:true}));
  const expected=summaryMetrics(analyzeRows(rows,entry.task),entry.task);
  if(!metricsMatch(actual,expected))throw new Error('METRICS_MISMATCH');
  report.verified++;report.sourceRows+=rows.length;
 }
 report.passed=true;
}catch(error){report.errorCode=/^[A-Z0-9_]+$/.test(error.message)?error.message:'PARITY_FAILED';process.exitCode=1;}
finally{await db.close();fs.rmSync(directory,{recursive:true,force:true});fs.mkdirSync('test/results',{recursive:true});fs.writeFileSync('test/results/portal-sql-parity.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
