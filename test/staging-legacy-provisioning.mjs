// Rerun the actual provisioner and verify identities, password hashes and files
// remain unchanged. Raw identifiers/hashes never leave process memory.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readLocalEnv} from '../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../scripts/lib/staging-db.mjs';
const env=readLocalEnv(),db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-legacy-idempotency'));
const report={passed:false,checks:[]};
async function state() {
 const accounts=(await db.query("select id,encrypted_password from auth.users where raw_app_meta_data->>'legacy_access_namespace'='legacy-access-v1' order by id")).rows;
 const files=(await db.query("select id,participant_id,object_key,sha256 from public.artifacts where object_key like 'legacy-access/%' order by id")).rows;
 const links=(await db.query("select original_participant_id,participant_id,verified_by from private.legacy_identity_links where namespace='legacy-access-v1' order by original_participant_id")).rows;
 return {accounts,files,links};
}
try {
 await db.connect();const before=await state();
 assert.equal(before.accounts.length,14);assert.equal(before.files.length,421);assert.equal(before.links.length,13);
 const status=await new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/provision-legacy-access.mjs'],{stdio:['ignore','pipe','pipe']});
  // The provisioner only prints sanitized counts/outcomes.
  child.stdout.on('data',chunk=>process.stdout.write(chunk));
  child.stderr.on('data',chunk=>process.stderr.write(chunk));
  child.on('close',resolve);child.on('error',()=>resolve(1));
 });
 assert.equal(status,0);
 const after=await state();assert.deepEqual(after,before);
 const provisioning=JSON.parse(fs.readFileSync('test/results/admin-legacy-provisioning.json','utf8'));
 assert.equal(provisioning.created_accounts,0);assert.equal(provisioning.uploaded_files,0);
 assert.equal(provisioning.verified_files,421);assert.equal(provisioning.primary_rows,144369);
 report.checks.push({name:'Rerun preserves all account/password hashes, file identities and ownership links',passed:true});
 report.checks.push({name:'No duplicate accounts/files; all 421 stored objects verified again',passed:true});
 report.passed=true;console.log('PASS full provisioning idempotency; passwords unchanged');
} catch {console.error('FAIL legacy idempotency (raw errors and credentials omitted)');process.exitCode=1;}
finally {await db.end().catch(()=>{});fs.writeFileSync('test/results/admin-legacy-idempotency.json',JSON.stringify(report,null,2)+'\n');}
