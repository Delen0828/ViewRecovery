// Protected staging-only provisioning. Never log identifiers, hashes or passwords.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
import {stagingDatabaseConfig} from './lib/staging-db.mjs';

const env=readLocalEnv();
if(validateStagingEnv(env).length) throw new Error('INVALID_STAGING_CONFIG');
const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-legacy-access'));
const archivePath=path.resolve(process.argv[2]||'server-data.zip');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'viewrecovery-legacy-'));
fs.chmodSync(temporary,0o700);
const report={passed:false,created_accounts:0,existing_accounts:0,uploaded_files:0,existing_files:0,verified_files:0};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function error(code) {throw Object.assign(new Error(code),{safeCode:code});}
async function account(label,passwordHash,namespace,isAdmin=false) {
 const existing=await db.query(`select i.auth_user_id,u.raw_app_meta_data,p.id participant_id,
 exists(select 1 from private.administrators a where a.auth_user_id=i.auth_user_id) is_admin
 from private.account_identifiers i join auth.users u on u.id=i.auth_user_id join public.participants p on p.auth_user_id=i.auth_user_id
 where i.normalized_username=lower($1)`,[label]);
 if(existing.rowCount) {
  const row=existing.rows[0];
  if(row.raw_app_meta_data?.legacy_access_namespace!==namespace || (isAdmin && !row.is_admin)) error('EXISTING_ACCOUNT_CONFLICT');
  report.existing_accounts++;return row;
 }
 const token=crypto.randomUUID();
 await db.query(`insert into private.account_identifiers(normalized_username,reservation_id,expires_at) values(lower($1),$2,now()+interval '15 minutes')
 on conflict(normalized_username) do update set reservation_id=excluded.reservation_id,expires_at=excluded.expires_at
 where private.account_identifiers.auth_user_id is null and private.account_identifiers.expires_at<now()`,[label,token]);
 const {data,error:createError}=await admin.auth.admin.createUser({
  email:`legacy-${hash(namespace+':'+label.toLowerCase()).slice(0,32)}@accounts.invalid`,
  password_hash:passwordHash,email_confirm:true,
  user_metadata:{username:label,username_reservation:token},
  app_metadata:{legacy_access_namespace:namespace}
 });
 if(createError)error('AUTH_ACCOUNT_CREATE_FAILED');
 const user=data.user;
 try {
  await db.query('begin');
  if(isAdmin)await db.query('insert into private.administrators(auth_user_id) values($1)',[user.id]);
  else await db.query("update public.participants set provenance='legacy' where auth_user_id=$1",[user.id]);
  const participant=(await db.query('select id from public.participants where auth_user_id=$1',[user.id])).rows[0];
  await db.query('commit');report.created_accounts++;
  return {auth_user_id:user.id,participant_id:participant.id};
 } catch(e) {await db.query('rollback');error('ACCOUNT_ROLE_PROVISION_FAILED');}
}
async function preserveFile({objectKey,bytes,sha256,originalPath,participantId=null,kind=null,rowCount=null,userId=null,task=null,identityStatus='unassigned'}) {
 const existing=(await db.query("select sha256 from public.artifacts where bucket='legacy-archive' and object_key=$1",[objectKey])).rows[0];
 if(existing && existing.sha256!==sha256)error('EXISTING_ARTIFACT_HASH_CONFLICT');
 if(!existing) {
  // Opaque keys prevent the filesystem identity from being used as authorization.
  const {error:uploadError}=await admin.storage.from('legacy-archive').upload(objectKey,bytes,{upsert:false,contentType:'application/octet-stream'});
  if(uploadError) {
   // Resume after a successful upload and interrupted metadata transaction only
   // when its bytes match. Never overwrite an existing object.
   const {data,error:readError}=await admin.storage.from('legacy-archive').download(objectKey);
   if(readError || hash(Buffer.from(await data.arrayBuffer()))!==sha256)error('ARCHIVE_UPLOAD_FAILED');
  }
  await db.query(`insert into public.artifacts(participant_id,bucket,object_key,sha256,original_path,kind,bytes,row_count,legacy_user_id,task,identity_status)
  values($1,'legacy-archive',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[participantId,objectKey,sha256,originalPath,kind,bytes.length,rowCount,userId,task,identityStatus]);
  report.uploaded_files++;
 } else report.existing_files++;
 // Verify the actual stored bytes on both first import and rerun.
 const {data,error:readError}=await admin.storage.from('legacy-archive').download(objectKey);
 if(readError || hash(Buffer.from(await data.arrayBuffer()))!==sha256)error('ARCHIVE_VERIFICATION_FAILED');
 report.verified_files++;
}
try {
 const prepared=spawnSync('python3',['scripts/prepare_legacy_access.py',archivePath,'--output',temporary],{encoding:'utf8'});
 if(prepared.status!==0)error('ARCHIVE_PREPARATION_FAILED');
 const manifest=JSON.parse(fs.readFileSync(path.join(temporary,'manifest.json'),'utf8'));
 report.source_files=manifest.file_count;report.primary_rows=manifest.primary_rows;report.backup_rows=manifest.backup_rows;
 report.legacy_users=manifest.users.length;report.identity_conflicts=manifest.entries.filter(e=>e.identity_status==='conflict').length;
 await db.connect();await db.query("select pg_advisory_lock(hashtext('viewrecovery-legacy-access'))");
 const php=fs.readFileSync('data_portal.php','utf8');
 const adminLabel=env.DATA_PORTAL_USER||'admin';
 const adminHash=env.DATA_PORTAL_PASS_HASH||php.match(/\$defaultPasswordHash\s*=\s*'([^']+)'/)[1];
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(adminLabel) || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(adminHash))error('INVALID_LEGACY_ADMIN_CONFIGURATION');
 const namespace='legacy-access-v1';
 // Fail before creating any account if a legacy identity is already registered
 // by a different process, or if it would collide with the administrator.
 if(manifest.users.some(label=>label.toLowerCase()===adminLabel.toLowerCase()))error('LEGACY_ADMIN_USERNAME_COLLISION');
 const labels=[adminLabel,...manifest.users];
 const collisions=await db.query(`select count(*)::int n from private.account_identifiers i join auth.users u on u.id=i.auth_user_id
 where i.normalized_username=any($1::text[]) and coalesce(u.raw_app_meta_data->>'legacy_access_namespace','')<>$2`,[labels.map(l=>l.toLowerCase()),namespace]);
 if(collisions.rows[0].n)error('EXISTING_ACCOUNT_CONFLICT');
 const owner=await account(adminLabel,adminHash.replace(/^\$2y\$/,'$2b$'),namespace,true);
 const participants=new Map();
 for(const label of manifest.users) {
  const user=await account(label,await bcrypt.hash(label,12),namespace);
  participants.set(label,user.participant_id);
  await db.query(`insert into private.legacy_identity_links(namespace,original_participant_id,participant_id,verified_by,verified_at,evidence_reference)
  values($1,$2,$3,$4,now(),'Operator-authorized ID-password migration, 2026-10-04') on conflict(namespace,original_participant_id) do nothing`,[namespace,label,user.participant_id,owner.auth_user_id]);
 }
 report.accounts_verified=(await db.query("select count(*)::int n from auth.users where raw_app_meta_data->>'legacy_access_namespace'=$1",[namespace])).rows[0].n;
 const prefix=`legacy-access/${manifest.archive_sha256}`;
 await preserveFile({objectKey:`${prefix}/archive.zip`,bytes:fs.readFileSync(archivePath),sha256:manifest.archive_sha256,originalPath:path.basename(archivePath),kind:'.zip'});
 const manifestBytes=fs.readFileSync(path.join(temporary,'manifest.json'));
 await preserveFile({objectKey:`${prefix}/manifest.json`,bytes:manifestBytes,sha256:hash(manifestBytes),originalPath:'legacy-access-manifest.json',kind:'.json'});
 for(const [index,entry] of manifest.entries.entries()) {
  await preserveFile({objectKey:`${prefix}/files/${String(index).padStart(4,'0')}`,bytes:fs.readFileSync(path.join(temporary,entry.local_file)),sha256:entry.sha256,originalPath:entry.path,participantId:entry.user_id?participants.get(entry.user_id):null,kind:entry.kind,rowCount:entry.rows??null,userId:entry.user_id,task:entry.task,identityStatus:entry.identity_status});
  if((index+1)%50===0)console.log(`Verified ${index+1}/${manifest.file_count} archive entries`);
 }
 report.passed=true;console.log('PASS legacy accounts, administrator access and private archive preservation');
} catch(e) {
 report.error_code=e.safeCode||'PROVISIONING_UNAVAILABLE';console.error(`FAIL ${report.error_code}; raw errors and credentials omitted`);process.exitCode=1;
} finally {
 await db.query("select pg_advisory_unlock(hashtext('viewrecovery-legacy-access'))").catch(()=>{});
 await db.end().catch(()=>{});
 fs.rmSync(temporary,{recursive:true,force:true});
 fs.writeFileSync('test/results/admin-legacy-provisioning.json',JSON.stringify(report,null,2)+'\n');
}
