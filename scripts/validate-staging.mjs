// Never emit env values, response bodies, raw database errors, or connection strings.
import fs from 'node:fs';
import pg from 'pg';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
const report={checks:[],passed:false};
const record=(name,passed,detail)=>{report.checks.push({name,passed,...(detail?{detail}:{})});console.log(`${passed?'PASS':'FAIL'} ${name}${detail?`: ${detail}`:''}`);};
const env=readLocalEnv();
const failures=validateStagingEnv(env);
record('Configuration',failures.length===0,failures.join('; '));
const base=env.SUPABASE_URL?.replace(/\/$/,'');
async function request(path,key) {
  return fetch(`${base}${path}`,{headers:{apikey:key,...(key?.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})},signal:AbortSignal.timeout(15000)});
}
try {
  const response=await request('/auth/v1/settings',env.SUPABASE_PUBLISHABLE_KEY);
  record('Auth API / publishable key',response.ok,`HTTP ${response.status}`);
  if(response.ok) {
    const settings=await response.json();
    record('Email authentication enabled',settings.external?.email===true);
    record('Email confirmation required',settings.mailer_autoconfirm===false);
  }
} catch { record('Auth API / publishable key',false,'Connection failed; no credentials logged'); }
try {
  const response=await request('/storage/v1/bucket',env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY);
  record('Storage API / server key',response.ok,`HTTP ${response.status}`);
  if(response.ok) {
    const buckets=await response.json();
    for(const name of ['legacy-archive','exports']) {
      const bucket=buckets.find(b=>b.id===name);
      record(`Private bucket ${name}`,Boolean(bucket)&&bucket.public===false,bucket?'':'Not provisioned');
    }
  }
} catch { record('Storage API / server key',false,'Connection failed; no credentials logged'); }
if(!failures.some(f=>f.startsWith('DATABASE_URL'))) {
  const client=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-staging-preflight'));
  try {
    await client.connect();
    record('PostgreSQL connection',true);
    const {rows}=await client.query("select to_regclass('public.experiment_runs') is not null as schema_present");
    record('Research schema applied',rows[0].schema_present);
  } catch(e) {
    record('PostgreSQL connection',false,`Connection/check failed (code ${/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'unavailable'}); no credentials logged`);
  } finally { await client.end().catch(()=>{}); }
} else record('PostgreSQL connection',false,'Not attempted: invalid URI');
report.passed=report.checks.every(c=>c.passed);
fs.mkdirSync('test/results',{recursive:true});
fs.writeFileSync('test/results/staging-preflight.json',JSON.stringify(report,null,2)+'\n');
process.exitCode=report.passed?0:1;
