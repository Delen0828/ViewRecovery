import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv} from '../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../scripts/lib/staging-db.mjs';
const env=readLocalEnv();
const options={auth:{persistSession:false,autoRefreshToken:false}};
const privileged=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,options);
const client=()=>createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options);
const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-legacy-acceptance'));
const report={passed:false,checks:[]},users=[],names=[];
const artifact=crypto.randomUUID(),object=`acceptance/${crypto.randomUUID()}/legacy.csv`;
let uploaded=false;
async function check(name,fn){try {await fn();report.checks.push({name,passed:true});console.log(`PASS ${name}`);}catch{report.checks.push({name,passed:false});throw new Error('FIXTURE_CHECK_FAILED');}}
async function create(label,password,isAdmin=false) {
 const token=crypto.randomUUID();names.push(label.toLowerCase());
 await db.query("insert into private.account_identifiers(normalized_username,reservation_id,expires_at) values(lower($1),$2,now()+interval '15 minutes')",[label,token]);
 const passwordHash=await bcrypt.hash(password,12);
 const result=await privileged.auth.admin.createUser({email:`legacy-fixture-${crypto.randomUUID()}@example.invalid`,password_hash:passwordHash,email_confirm:true,user_metadata:{username:label,username_reservation:token,role:'admin'}});
 assert.equal(result.error,null);const user=result.data.user;users.push(user.id);
 const participant=(await db.query('select id from public.participants where auth_user_id=$1',[user.id])).rows[0].id;
 if(isAdmin)await db.query('insert into private.administrators values($1)',[user.id]);
 return {label,user,participant,passwordHash};
}
try {
 await db.connect();
 let label;
 for(const candidate of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const exists=await db.query('select 1 from private.account_identifiers where normalized_username=lower($1)',[candidate]);
  if(!exists.rowCount){label=candidate;break;}
 }
 assert.ok(label);
 const owner=await create(label,label);
 const adminPassword=crypto.randomBytes(24).toString('base64url')+'!Aa1';
 const admin=await create(`la_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`,adminPassword,true);
 const ownerClient=client(),adminClient=client();
 await check('Imported one-character ID password works through deployed username login',async()=>{
  const result=await ownerClient.functions.invoke('username-auth',{body:{action:'login',username:label,password:label}});
  assert.equal(result.error,null);assert.ok(result.data.session);
  assert.equal((await ownerClient.auth.setSession(result.data.session)).error,null);
 });
 await check('Administrator hash import authenticates and server role permits all-user directory',async()=>{
  assert.equal((await adminClient.auth.signInWithPassword({email:admin.user.email,password:adminPassword})).error,null);
  const result=await adminClient.rpc('admin_user_status');assert.equal(result.error,null);assert.ok(result.data.some(row=>row.auth_user_id===owner.user.id));
  assert.equal((await adminClient.rpc('account_access')).data,'admin');
 });
 await check('Participant metadata does not grant administrator access',async()=>{
  assert.equal((await ownerClient.rpc('account_access')).data,'participant');
  assert.ok((await ownerClient.rpc('admin_user_status')).error);
  assert.equal((await ownerClient.from('participants').select('id').eq('id',admin.participant)).data.length,0);
 });
 await check('Private historical file can be signed by owner/admin but not anonymous',async()=>{
  const csv='user_id,rt\nFixture,250\n';
  assert.equal((await privileged.storage.from('legacy-archive').upload(object,Buffer.from(csv),{contentType:'text/csv'})).error,null);uploaded=true;
  await db.query("insert into public.artifacts(id,participant_id,bucket,object_key,sha256,original_path,kind,row_count,identity_status) values($1,$2,'legacy-archive',$3,$4,'fixture.csv','.csv',1,'matched')",[artifact,owner.participant,object,crypto.createHash('sha256').update(csv).digest('hex')]);
  for(const c of [ownerClient,adminClient]) {
   const result=await c.storage.from('legacy-archive').createSignedUrl(object,60);assert.equal(result.error,null);
   assert.equal(await (await fetch(result.data.signedUrl)).text(),csv);
  }
  assert.ok((await client().storage.from('legacy-archive').createSignedUrl(object,60)).error);
 });
 await check('Password update replaces ID password; short new passwords remain denied',async()=>{
  assert.ok((await ownerClient.auth.updateUser({password:label})).error);
  const next=crypto.randomBytes(24).toString('base64url')+'!aA1';
  assert.equal((await ownerClient.auth.updateUser({password:next})).error,null);
  assert.equal((await client().auth.signInWithPassword({email:owner.user.email,password:next})).error,null);
  assert.ok((await client().auth.signInWithPassword({email:owner.user.email,password:label})).error);
 });
 report.passed=true;
} catch {console.error('FAIL legacy staging acceptance (raw errors and credentials omitted)');process.exitCode=1;}
finally {
 try {
  if(uploaded)assert.equal((await privileged.storage.from('legacy-archive').remove([object])).error,null);
  await db.query('begin');await db.query('delete from public.artifacts where id=$1',[artifact]);
  await db.query('delete from private.administrators where auth_user_id=any($1::uuid[])',[users]);
  await db.query('delete from public.participants where auth_user_id=any($1::uuid[])',[users]);
  await db.query('delete from public.profiles where auth_user_id=any($1::uuid[])',[users]);
  await db.query('delete from private.account_identifiers where normalized_username=any($1::text[])',[names]);
  await db.query('commit');
  for(const user of users)assert.equal((await privileged.auth.admin.deleteUser(user)).error,null);
  console.log('PASS synthetic fixture cleanup');
 } catch {await db.query('rollback').catch(()=>{});report.passed=false;report.cleanup_failed=true;console.error('FAIL synthetic fixture cleanup');process.exitCode=1;}
 await db.end().catch(()=>{});
 fs.writeFileSync('test/results/admin-legacy-staging.json',JSON.stringify(report,null,2)+'\n');
}
