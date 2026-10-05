import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
const env=readLocalEnv();
const report={migrations:[],passed:false};
const failures=validateStagingEnv(env);
if(failures.length) {console.error('FAIL configuration: '+failures.join('; '));process.exit(1);}
const url=new URL(env.DATABASE_URL), ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
if(url.hostname!==`db.${ref}.supabase.co` && decodeURIComponent(url.username)!==`postgres.${ref}`) {
 console.error('FAIL database connection target does not match the configured staging project');process.exit(1);
}
const client=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-staging-migrations'));
try {
 await client.connect();
 await client.query("select pg_advisory_lock(hashtext('viewrecovery-migrations'))");
 await client.query('create schema if not exists private');
 await client.query('create table if not exists private.schema_migrations(version text primary key,sha256 text not null,applied_at timestamptz not null default now())');
 await client.query('revoke all on private.schema_migrations from public,anon,authenticated');
 for(const filename of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
  const sql=fs.readFileSync(path.join('supabase/migrations',filename),'utf8');
  const hash=crypto.createHash('sha256').update(sql).digest('hex');
  const applied=await client.query('select sha256 from private.schema_migrations where version=$1',[filename]);
  if(applied.rowCount) {
   if(applied.rows[0].sha256!==hash) throw new Error('MIGRATION_HASH_MISMATCH');
   report.migrations.push({version:filename,status:'already applied'});console.log(`PASS ${filename}: already applied`);continue;
  }
  // Keep migration and its ledger entry in a single transaction; prevent partial acceptance.
  const body=sql.replace(/^\s*begin\s*;/i,'').replace(/commit\s*;\s*$/i,'');
  await client.query('begin');
  try {
   await client.query(body);
   await client.query('insert into private.schema_migrations(version,sha256) values($1,$2)',[filename,hash]);
   await client.query('commit');
  } catch(e) {await client.query('rollback');throw e;}
  report.migrations.push({version:filename,status:'applied'});console.log(`PASS ${filename}: applied`);
 }
 report.passed=true;
} catch(e) {
 const code=/^[A-Z0-9_]+$/.test(e.code??e.message??'')?(e.code??e.message):'unavailable';
 console.error(`FAIL staging migration (code ${code}); raw connection/errors omitted`);
 report.error_code=code;process.exitCode=1;
} finally {
 await client.query("select pg_advisory_unlock(hashtext('viewrecovery-migrations'))").catch(()=>{});
 await client.end().catch(()=>{});
 fs.writeFileSync('test/results/staging-migrations.json',JSON.stringify(report,null,2)+'\n');
}
