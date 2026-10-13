import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {openDatabase} from '../scripts/lib/postgres.mjs';
import {createServer} from '../server/index.mjs';
import {ingest,hash} from '../server/store.mjs';
import {portalClient} from './portal-auth-client.mjs';
import {migratePortalAccounts} from '../server/portal-accounts.mjs';
import {verifyPassword} from 'better-auth/crypto';

test('Better Auth portal preserves accounts and SQL account scopes',async t=>{
  const pool=await openDatabase();let server;
  const user='P'+randomUUID().replaceAll('-','').slice(0,9),other='P'+randomUUID().replaceAll('-','').slice(0,9);
  const runId=randomUUID(),checksum=hash(randomUUID());
  const adminUsername='portal-test-admin-'+user,signupUser='New'+user;
  const authOptions={adminUsername,adminPasswordHash:bcrypt.hashSync('test-password',4).replace(/^\$2b\$/, '$2y$'),participantPasswordHash:'',maxAttempts:100};
  let jobId;
  const historicRows=[
    {task_type:'Motion',overall_trial_number:1,time_elapsed:'100',rt:'100'},
    {task_type:'Motion',overall_trial_number:1,time_elapsed:'150',rt:'5',correct:'true',difficulty_level:'1'},
    {task_type:'Motion',overall_trial_number:2,time_elapsed:'250'},
    {task_type:'Motion',overall_trial_number:2,time_elapsed:'300',correct:'false',difficulty_level:'2'},
    {task_type:'Motion',overall_trial_number:3,time_elapsed:'400',correct:'true',trial_category:'fixation_catch_response'},
    {task_type:'Motion',time_elapsed:'500',trial_category:'scheduled_break'}
  ];
  async function source(name,owner,kind='csv',rows=historicRows) {
    const bytes=Buffer.from('preserved archive bytes for '+name);
    const file=await pool.query(`INSERT INTO experiment_data.source_files(import_job_id,original_path,sha256,kind,user_id,task,run_timestamp,header,row_count,bytes)
      VALUES($1,$2,$3,$4,$5,'Motion','2026-10-13T12-00-00','[]',$6,$7) RETURNING id`,[jobId,name,hash(bytes),kind,owner,rows.length,bytes]);
    await pool.query(`INSERT INTO experiment_data.source_rows(source_file_id,ordinal,payload) SELECT $1,ordinal,payload
      FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS r(payload,ordinal)`,[file.rows[0].id,JSON.stringify(rows)]);
    return {reference:'source:'+file.rows[0].id,bytes,name};
  }
  try {
    jobId=(await pool.query('INSERT INTO experiment_data.import_jobs(archive_sha256,archive_name) VALUES($1,$2) RETURNING id',[checksum,'portal-test.zip'])).rows[0].id;
    const final=await source(`data/final_complete_user_${user}_Motion_2026-10-13T12-00-00.csv`,user);
    await source(`data/session_chunk_complete_user_${user}_Motion_session01_2026-10-13T12-00-00.csv`,user);
    await source(`data/final_complete_user_${user}_Motion_2026-10-13T12-00-00.csv.old.bak`,user,'backup');
    const foreign=await source(`data/final_complete_user_${other}_Motion_2026-10-13T12-00-00.csv`,other);
    const legacy=await source(`data/user_${other}_2026-10-13T12-00-00.csv`,null);
    await pool.query('UPDATE experiment_data.source_files SET run_timestamp=NULL,task=NULL WHERE id=$1',[legacy.reference.split(':')[1]]);
    const run={id:runId,user_id:user,task:'Motion',run_timestamp:'2026-10-13T14-00-00'};
    const payload={user_id:user,task_type:'Motion',trial_index:1,overall_trial_number:1,correct:true,difficulty_level:1,rt:100,time_elapsed:100,calculator_data:{x:5}};
    const first=await ingest(pool,{batch_id:randomUUID(),run,events:[{event_sequence:1,included:true,payload},
      {event_sequence:2,included:false,payload:{...payload,correct:false,manual_pause_interrupted:true}}],
      save:{save_key:`final_complete_user_${user}_Motion_2026-10-13T14-00-00.json`,prefix:'final_complete',overwrite:false,rows:[payload]}});
    server=createServer(pool,{portalAuth:authOptions});
    await server.portalAuthReady;
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const anonymous=portalClient(base),participant=portalClient(base),admin=portalClient(base);
    await t.test('portal assets are available locally and data requires login',async()=>{
      const page=await fetch(base+'/data-portal/');assert.equal(page.status,200);assert.ok(page.url.endsWith('/data-portal/index.html'));
      assert.ok((await page.text()).includes('./d3.min.js'));
      assert.equal((await fetch(base+'/data-portal/d3.min.js')).status,200);
      for (const path of ['/data-portal/api/files','/data-portal/api/user-trends','/data-portal/api/preview?file='+final.reference,'/data-portal/download?file='+final.reference]) assert.equal((await anonymous.api(path)).status,401);
      assert.equal((await fetch(base+'/data-portal/../server/portal-auth.mjs')).status,404);
    });
    await t.test('origin checks, stored passwords and login modes protect access',async()=>{
      assert.equal((await admin.post('/data-portal/auth/sign-in/username',{username:adminUsername,password:'test-password',mode:'admin'},{Origin:'https://untrusted.example'})).status,403);
      assert.equal((await admin.login(adminUsername,'wrong','admin')).response.status,401);
      assert.equal((await admin.login(adminUsername,'test-password','user')).response.status,401);
      assert.equal((await participant.login(user,user,'admin')).response.status,401);
      assert.equal((await participant.login(user,'')).response.status,401);
      assert.equal((await participant.login('Unknown'+user)).response.status,401);
      assert.equal((await admin.post('/data-portal/auth/sign-in/username',{username:adminUsername,password:'test-password'})).status,400);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM portal_auth.session s JOIN portal_auth."user" u ON s."userId"=u.id WHERE u.username=ANY($1)',[[user,adminUsername]])).rows[0].count,0);
      const logged=await admin.login(adminUsername,'test-password','admin');assert.equal(logged.response.status,200);assert.equal(logged.body.user.role,'admin');
      assert.ok(logged.response.headers.get('set-cookie').includes('HttpOnly'));
      assert.equal((await anonymous.api('/data-portal/api/files',{headers:{Cookie:'viewrecovery.session_token=forged'}})).status,401);
      const files=await (await admin.api('/data-portal/api/files')).json();assert.ok(files.files.some(file=>file.reference===foreign.reference));
    });
    await t.test('migration keeps password hashes and remains idempotent',async()=>{
      const accounts=(await pool.query('SELECT u.username,a.password FROM portal_auth."user" u JOIN portal_auth.account a ON a."userId"=u.id WHERE u.username=ANY($1)',[[user,adminUsername]])).rows;
      assert.equal(accounts.find(account=>account.username===adminUsername).password,authOptions.adminPasswordHash);
      assert.equal(await verifyPassword({hash:accounts.find(account=>account.username===user).password,password:user}),true);
      assert.deepEqual(await migratePortalAccounts(pool,authOptions),{users_created:0,admins_created:0,passwords_created:0});
    });
    await t.test('invitation is enforced on direct signup and accounts never self-promote',async()=>{
      const newClient=portalClient(base),body={name:'New user',username:signupUser,email:signupUser+'@example.com',password:'new-password'};
      for (const invitationCode of [undefined,'wrong','BRIGHT']) assert.equal((await newClient.post('/data-portal/auth/sign-up/email',{...body,invitationCode})).status,403);
      assert.equal((await newClient.post('/data-portal/auth/sign-up/email',{...body,invitationCode:'bright',role:'admin'})).status,403);
      assert.equal((await newClient.post('/data-portal/auth/sign-up/email',{...body,invitationCode:'bright',mode:'admin'})).status,403);
      assert.equal((await newClient.post('/data-portal/auth/sign-up/email',{...body,username:user,invitationCode:'bright'})).status,400);
      assert.equal((await pool.query('SELECT id FROM portal_auth."user" WHERE username=$1',[signupUser])).rowCount,0);
      const created=await newClient.post('/data-portal/auth/sign-up/email',{...body,invitationCode:'bright'});
      assert.equal(created.status,200);const registered=await created.json();assert.equal(registered.user.role,'user');assert.equal(registered.user.emailVerified,false);
      const state=await (await newClient.api('/data-portal/api/session')).json();assert.equal(state.authenticated,true);assert.equal(state.user_id,signupUser);
      assert.equal((await newClient.api('/data-portal/download?file='+foreign.reference)).status,404);
      assert.equal((await newClient.post('/data-portal/auth/update-user',{role:'admin',participantId:other})).status,400);
      assert.equal((await newClient.post('/data-portal/auth/sign-in/email',{email:body.email,password:body.password})).status,404);
      assert.equal((await newClient.post('/data-portal/auth/sign-in/social',{provider:'google'})).status,404);
      assert.equal((await newClient.post('/data-portal/auth/change-password',{currentPassword:body.password,newPassword:'changed-password',revokeOtherSessions:true})).status,200);
      await newClient.post('/data-portal/auth/sign-out',{});
      await migratePortalAccounts(pool,authOptions);
      assert.equal((await newClient.login(signupUser,body.password)).response.status,401);
      assert.equal((await newClient.login(signupUser,'changed-password')).response.status,200);
    });
    await t.test('participants see only their sources, previews, downloads and trends',async()=>{
      const login=await participant.login(user);assert.equal(login.body.user.role,'user');
      const files=await (await participant.api('/data-portal/api/files?metric_types=final,session,pause')).json();
      assert.ok(files.files.some(file=>file.reference===final.reference));assert.ok(files.files.some(file=>file.reference==='run:'+runId));
      assert.ok(!files.files.some(file=>file.reference===foreign.reference));
      assert.equal((await participant.api('/data-portal/api/preview?file='+foreign.reference)).status,404);
      assert.equal((await participant.api('/data-portal/download?file='+foreign.reference)).status,404);
      assert.equal((await participant.api('/data-portal/api/preview?file='+encodeURIComponent(final.name.split('/').at(-1)))).status,200);
      assert.equal((await participant.api('/data-portal/api/files?date_from=2099-01-01')).status,200);
      assert.equal((await participant.api('/data-portal/api/files?date_from=2026-02-30')).status,400);
      const legacyOwner=portalClient(base);await legacyOwner.login(other);
      const legacyFiles=await (await legacyOwner.api('/data-portal/api/files')).json();
      const legacyFile=legacyFiles.files.find(file=>file.reference===legacy.reference);assert.ok(legacyFile);
      assert.equal(new Date(legacyFile.created_at*1000).toISOString(),'2026-10-13T12:00:00.000Z');
      assert.equal((await participant.api('/data-portal/api/preview?file='+legacy.reference)).status,404);
    });
    await t.test('SQL charts exclude overlapping chunks, backups, duplicate final snapshots and interrupted rows',async()=>{
      const trends=await (await participant.api('/data-portal/api/user-trends')).json();
      assert.equal(trends.loaded_file_count,2);assert.equal(trends.records.length,0);
      assert.equal(trends.user_summaries.length,1);assert.equal(trends.user_summaries[0].id,user);assert.equal(trends.user_summaries[0].trials,3);
      assert.equal(trends.accuracy_series.find(point=>point.reference===final.reference).accuracy,50);
      assert.equal(trends.accuracy_series.find(point=>point.reference==='run:'+runId).accuracy,100);
      const preview=await (await participant.api('/data-portal/api/preview?file='+final.reference)).json();
      assert.equal(preview.metrics.total,2);assert.equal(preview.metrics.trainingMs,400);assert.equal(preview.metrics.restingMs,100);
      assert.equal(preview.metrics.catchTotal,1);assert.equal(preview.metrics.catchCorrect,1);
      assert.deepEqual(preview.metrics.levels.map(level=>level.durationMs),[150,150]);
      const stale=await pool.query('SELECT version FROM experiment_data.portal_metrics WHERE reference=$1',['run:'+runId]);
      await ingest(pool,{batch_id:randomUUID(),run,events:[{event_sequence:3,included:true,payload:{...payload,trial_index:3,overall_trial_number:2,correct:false,difficulty_level:2,time_elapsed:300}}]});
      const refreshed=await (await participant.api('/data-portal/api/preview?file=run:'+runId)).json();
      assert.equal(refreshed.metrics.total,2);assert.equal(refreshed.metrics.correct,1);
      assert.notEqual((await pool.query('SELECT version FROM experiment_data.portal_metrics WHERE reference=$1',['run:'+runId])).rows[0].version,stale.rows[0].version);
    });
    await t.test('downloads preserve archive bytes and new SQL save payload types',async()=>{
      const original=await participant.api('/data-portal/download?file='+final.reference);assert.deepEqual(Buffer.from(await original.arrayBuffer()),final.bytes);
      const saved=await participant.api('/data-portal/download?file=save:'+first.save_id);assert.ok(saved.headers.get('content-type').startsWith('application/json'));assert.deepEqual(await saved.json(),[payload]);
    });
    await t.test('logout requires a trusted origin and revokes the stored session',async()=>{
      assert.equal((await participant.post('/data-portal/auth/sign-out',{}, {Origin:'https://untrusted.example'})).status,403);
      assert.equal((await participant.post('/data-portal/auth/sign-out',{}, {Origin:''})).status,403);
      const raw=await participant.api('/data-portal/auth/get-session');const stored=await raw.json();
      await participant.post('/data-portal/auth/sign-out',{});
      assert.equal((await pool.query('SELECT id FROM portal_auth.session WHERE id=$1',[stored.session.id])).rowCount,0);
      assert.equal((await participant.api('/data-portal/api/files')).status,401);
    });
    await t.test('expired sessions and repeated requests are denied',async()=>{
      await participant.login(user);
      const stored=await (await participant.api('/data-portal/auth/get-session')).json();
      await pool.query('UPDATE portal_auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',[stored.session.id]);
      assert.equal((await participant.api('/data-portal/api/files')).status,401);
      const limited=createServer(pool,{portalAuth:{...authOptions,maxAttempts:1}});
      try {
        await limited.portalAuthReady;limited.listen(0,'127.0.0.1');await once(limited,'listening');
        const throttled=portalClient(`http://127.0.0.1:${limited.address().port}`);
        const response=(await throttled.login(user,user)).response;
        assert.equal(response.status,429);assert.ok(response.headers.get('x-retry-after'));
        assert.equal((await throttled.post('/data-portal/auth/sign-in/username',{username:user,password:user,mode:'user'},{'x-portal-client-ip':'203.0.113.18'})).status,429);
        const proxyHeaders={'cf-connecting-ip':'203.0.113.17'};
        await pool.query('DELETE FROM portal_auth."rateLimit" WHERE key=$1',['203.0.113.17|/sign-in/username']);
        assert.equal((await throttled.post('/data-portal/auth/sign-in/username',{username:user,password:user,mode:'user'},proxyHeaders)).status,200);
        assert.equal((await throttled.post('/data-portal/auth/sign-in/username',{username:user,password:user,mode:'user'},proxyHeaders)).status,429);
      } finally {limited.close();await once(limited,'close');}
    });
    await t.test('hosted auth uses the configured public origin and secure cookies',async()=>{
      const hosted=createServer(pool,{portalAuth:{...authOptions,baseURL:'https://study.example.org'}});
      try {
        await hosted.portalAuthReady;hosted.listen(0,'127.0.0.1');await once(hosted,'listening');
        const client=portalClient(`http://127.0.0.1:${hosted.address().port}`);
        const body={username:user,password:user,mode:'user'};
        assert.equal((await client.post('/data-portal/auth/sign-in/username',body)).status,403);
        const response=await client.post('/data-portal/auth/sign-in/username',body,{Origin:'https://study.example.org'});
        assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie').includes('; Secure;'));
        assert.equal((await (await client.api('/data-portal/api/session')).json()).user_id,user);
      } finally {hosted.close();await once(hosted,'close');}
    });
  } finally {
    if (server) {server.close();await once(server,'close');}
    await pool.query('DELETE FROM experiment_data.save_rows WHERE save_id IN (SELECT id FROM experiment_data.saves WHERE run_id=$1)',[runId]);
    for (const table of ['saves','ingest_batches','events']) await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`,[runId]);
    await pool.query('DELETE FROM experiment_data.runs WHERE id=$1',[runId]);
    if (jobId) {
      await pool.query('DELETE FROM experiment_data.source_rows WHERE source_file_id IN (SELECT id FROM experiment_data.source_files WHERE import_job_id=$1)',[jobId]);
      await pool.query('DELETE FROM experiment_data.source_files WHERE import_job_id=$1',[jobId]);
      await pool.query('DELETE FROM experiment_data.import_jobs WHERE id=$1',[jobId]);
    }
    await pool.query('DELETE FROM portal_auth."user" WHERE username=ANY($1)',[[user,other,signupUser,adminUsername]]);
    await pool.query('DELETE FROM portal_auth."rateLimit" WHERE key=$1',['203.0.113.17|/sign-in/username']);
    await pool.end();
  }
});
