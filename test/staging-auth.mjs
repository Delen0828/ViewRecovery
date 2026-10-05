// Real Auth/Data API/Storage integration. Synthetic accounts only; no emails are sent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv,validateStagingEnv} from '../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../scripts/lib/staging-db.mjs';
const env=readLocalEnv();
assert.equal(validateStagingEnv(env).length,0,'Staging config must pass before integration');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,options);
const publicClient=()=>createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options);
const anonymous=publicClient(),owner=publicClient(),other=publicClient();
const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-auth-acceptance'));
const report={checks:[],passed:false};
const users=[],names=[],artifactId=crypto.randomUUID();
const object=`acceptance/${crypto.randomUUID()}.txt`;
const password=crypto.randomBytes(24).toString('base64url')+'!aA1';
let uploaded=false,session,account,second;
async function check(name,fn) {
 try {await fn();report.checks.push({name,passed:true});console.log(`PASS ${name}`);}
 catch {report.checks.push({name,passed:false});console.error(`FAIL ${name} (details omitted; synthetic values and secrets are not logged)`);throw new Error('CHECK_FAILED');}
}
async function invoke(body) {
 const {data,error}=await anonymous.functions.invoke('username-auth',{body});
 if(error) {
  let payload={};try {payload=await error.context?.json();} catch{}
  return {status:error.context?.status||0,body:payload};
 }
 return {status:200,body:data};
}
async function fixture() {
 const username=`accept_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
 names.push(username);
 const {data:token,error:reservationError}=await admin.rpc('reserve_username',{username});assert.equal(reservationError,null);
 const {data,error}=await admin.auth.admin.createUser({email:`${username}@example.invalid`,password,email_confirm:true,user_metadata:{username,username_reservation:token,role:'admin'}});
 assert.equal(error,null);assert.ok(data.user?.id);users.push(data.user.id);
 const participant=await admin.from('participants').select('id,provenance').eq('auth_user_id',data.user.id).single();assert.equal(participant.error,null);assert.equal(participant.data.provenance,'registration');
 return {username,userId:data.user.id,participantId:participant.data.id};
}
try {
 await db.connect();
 await check('Anonymous Data API and identity lookup are denied',async()=>{
  assert.ok((await anonymous.from('profiles').select('*')).error);
  assert.ok((await anonymous.rpc('username_auth_email',{username:'no_directory'})).error);
 });
 await check('Concurrent username reservation has exactly one winner',async()=>{
  const name=`race_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;names.push(name);
  const responses=await Promise.all([admin.rpc('reserve_username',{username:name}),admin.rpc('reserve_username',{username:name.toUpperCase()})]);
  assert.equal(responses.filter(r=>!r.error).length,1);assert.equal(responses.filter(r=>r.error?.code==='23505').length,1);
 });
 await check('Controlled Auth identity creation assigns no admin or enrollment rights',async()=>{
  account=await fixture();second=await fixture();
  const rights=await db.query('select exists(select 1 from private.administrators where auth_user_id=$1) admin,exists(select 1 from public.enrollments e join public.participants p on p.id=e.participant_id where p.auth_user_id=$1) enrolled',[account.userId]);
  assert.equal(rights.rows[0].admin,false);assert.equal(rights.rows[0].enrolled,false);
 });
 await check('Deployed username endpoint returns registration prompt and generic password errors',async()=>{
  let result=await invoke({action:'login',username:`absent_${crypto.randomUUID().slice(0,12)}`,password:'wrong'});
  assert.equal(result.status,404);assert.equal(result.body.code,'USERNAME_NOT_REGISTERED');assert.ok(!result.body.email);
  result=await invoke({action:'login',username:account.username,password:'wrong'});assert.equal(result.status,401);assert.equal(result.body.code,'INVALID_CREDENTIALS');assert.ok(!result.body.email);
 });
 await check('Username login establishes a real verified Supabase session',async()=>{
  const result=await invoke({action:'login',username:account.username.toUpperCase(),password});
  assert.equal(result.status,200);session=result.body.session;assert.equal(session.user.id,account.userId);
  assert.equal((await owner.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token})).error,null);
  const identity=await owner.auth.getUser();assert.equal(identity.error,null);assert.equal(identity.data.user.id,account.userId);assert.ok(identity.data.user.email_confirmed_at);
  const signIn=await other.auth.signInWithPassword({email:`${second.username}@example.invalid`,password});assert.equal(signIn.error,null);
 });
 await check('Data API isolates participant profiles and denies role changes',async()=>{
  const profiles=await owner.from('profiles').select('auth_user_id');assert.equal(profiles.error,null);assert.deepEqual(profiles.data.map(p=>p.auth_user_id),[account.userId]);
  const cross=await other.from('profiles').select('*').eq('auth_user_id',account.userId);assert.equal(cross.error,null);assert.equal(cross.data.length,0);
  assert.ok((await owner.from('participants').update({auth_user_id:second.userId}).eq('id',account.participantId)).error);
  assert.ok((await owner.rpc('reserve_username',{username:'cannot_self_manage'})).error);
 });
 await check('Private Storage downloads require an authorized artifact record',async()=>{
  const upload=await admin.storage.from('legacy-archive').upload(object,new Blob(['Synthetic staging acceptance fixture'],{type:'text/plain'}));assert.equal(upload.error,null);uploaded=true;
  const insert=await admin.from('artifacts').insert({id:artifactId,participant_id:account.participantId,bucket:'legacy-archive',object_key:object,sha256:crypto.createHash('sha256').update('Synthetic staging acceptance fixture').digest('hex'),original_path:'synthetic-fixture.txt'});assert.equal(insert.error,null);
  assert.equal((await owner.storage.from('legacy-archive').download(object)).error,null);
  assert.ok((await other.storage.from('legacy-archive').download(object)).error);
  assert.ok((await anonymous.storage.from('legacy-archive').download(object)).error);
 });
 await check('Real session refresh preserves owner identity',async()=>{
  const refreshed=await owner.auth.refreshSession();assert.equal(refreshed.error,null);assert.equal(refreshed.data.user.id,account.userId);
 });
 await check('Recovery link generation, verification and password update work without sending email',async()=>{
  const link=await admin.auth.admin.generateLink({type:'recovery',email:`${account.username}@example.invalid`,options:{redirectTo:env.AUTH_REDIRECT_URL}});assert.equal(link.error,null);assert.equal(link.data.properties.redirect_to,env.AUTH_REDIRECT_URL);
  const recover=publicClient();const verified=await recover.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'recovery'});assert.equal(verified.error,null);assert.equal(verified.data.user.id,account.userId);
  const nextPassword=crypto.randomBytes(24).toString('base64url')+'!bB2';assert.equal((await recover.auth.updateUser({password:nextPassword})).error,null);
  assert.equal((await publicClient().auth.signInWithPassword({email:`${account.username}@example.invalid`,password:nextPassword})).error,null);
  await recover.auth.signOut({scope:'local'});
 });
 await check('Logout clears the local session and protected reads fail',async()=>{
  assert.equal((await owner.auth.signOut({scope:'local'})).error,null);
  assert.equal((await owner.auth.getSession()).data.session,null);
  assert.ok((await owner.from('profiles').select('*')).error);
 });
 report.passed=true;
} catch {process.exitCode=1;} finally {
 try {
  if(uploaded) assert.equal((await admin.storage.from('legacy-archive').remove([object])).error,null);
  await db.query('begin');
  await db.query('delete from public.artifacts where id=$1',[artifactId]);
  for(const user of users) {
   await db.query('delete from public.participants where auth_user_id=$1',[user]);
   await db.query('delete from public.profiles where auth_user_id=$1',[user]);
  }
  await db.query('delete from private.account_identifiers where normalized_username=any($1::text[])',[names]);
  await db.query('commit');
  for(const user of users) assert.equal((await admin.auth.admin.deleteUser(user)).error,null);
  report.checks.push({name:'Synthetic fixture cleanup',passed:true});console.log('PASS synthetic fixture cleanup');
 } catch {await db.query('rollback').catch(()=>{});report.passed=false;report.checks.push({name:'Synthetic fixture cleanup',passed:false});console.error('FAIL synthetic fixture cleanup; review fixture records locally');process.exitCode=1;}
 await db.end().catch(()=>{});
 fs.writeFileSync('test/results/step-03-staging-auth.json',JSON.stringify(report,null,2)+'\n');
}
