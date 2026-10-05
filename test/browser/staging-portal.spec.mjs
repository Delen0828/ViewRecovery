import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {readLocalEnv} from '../../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../../scripts/lib/staging-db.mjs';
import {storeArtifactMetrics} from '../../scripts/lib/portal-metrics.mjs';
test.use({screenshot:'off'});
let cleanupFixture=null;
test.afterEach(async()=>{test.setTimeout(30000);if(cleanupFixture){await cleanupFixture();cleanupFixture=null;}});
test('real Supabase file charts, configuration persistence, run snapshot, event ingestion and access isolation',async({page})=>{
 test.skip(process.env.VIEWRECOVERY_LIVE_BROWSER!=='1','Set VIEWRECOVERY_LIVE_BROWSER=1 for real staging verification.');
 test.setTimeout(180000);
 const env=readLocalEnv(),username=`portal_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`,password=crypto.randomBytes(24).toString('base64url')+'!aA1';
 const opts={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,opts),owner=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,opts),anonymous=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,opts);
 const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-portal-browser'));
 let userId,participantId;const studyId=crypto.randomUUID(),artifactIds=[],objects=[];const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 cleanupFixture=async()=>{
  if(objects.length)expect((await admin.storage.from('legacy-archive').remove(objects)).error).toBeNull();
  await db.query('begin');
  if(userId) {
   await db.query('delete from public.ingest_batches where run_id in (select id from public.experiment_runs where participant_id=$1)',[participantId]);
   await db.query('delete from public.experiment_events where run_id in (select id from public.experiment_runs where participant_id=$1)',[participantId]);
   await db.query('delete from public.trial_attempts where run_id in (select id from public.experiment_runs where participant_id=$1)',[participantId]);
   await db.query('delete from public.experiment_runs where participant_id=$1',[participantId]);
   await db.query('delete from public.training_settings where participant_id=$1',[participantId]);
   await db.query('delete from public.display_profiles where auth_user_id=$1',[userId]);
   await db.query('delete from public.artifacts where id=any($1::uuid[])',[artifactIds]);
   await db.query('delete from public.enrollments where study_id=$1',[studyId]);
   await db.query('delete from public.studies where id=$1',[studyId]);
   await db.query('delete from public.participants where auth_user_id=$1',[userId]);
   await db.query('delete from public.profiles where auth_user_id=$1',[userId]);
   await db.query('delete from private.account_identifiers where auth_user_id=$1',[userId]);
  }else await db.query('delete from private.account_identifiers where normalized_username=$1 and auth_user_id is null',[username]);
  await db.query('commit');if(userId)expect((await admin.auth.admin.deleteUser(userId)).error).toBeNull();await db.end();
 };
 await db.connect();
 async function screenshot(name) {fs.mkdirSync('test/results/portal-screenshots',{recursive:true});await page.screenshot({path:`test/results/portal-screenshots/staging-${name}.png`,fullPage:!name.includes('experiment')});}
  const reservation=await admin.rpc('reserve_username',{username});expect(reservation.error).toBeNull();
  const account=await admin.auth.admin.createUser({email:`${username}@example.invalid`,password,email_confirm:true,user_metadata:{username,username_reservation:reservation.data}});expect(account.error).toBeNull();userId=account.data.user.id;
  const participant=await admin.from('participants').select('id').eq('auth_user_id',userId).single();expect(participant.error).toBeNull();participantId=participant.data.id;
  expect((await admin.from('studies').insert({id:studyId,name:'Browser verification study',protocol_version:'legacy-2026-10-04',consent_version:'v1',active:true})).error).toBeNull();
  expect((await admin.from('enrollments').insert({study_id:studyId,participant_id:participantId,active:true,consent_version:'v1',consented_at:new Date().toISOString()})).error).toBeNull();
  for(let i=0;i<4;i++) {
   const task=i%2?'Centrality':'Motion';
   const rows=['user_id,task_type,trial_category,overall_trial_number,time_elapsed,correct,difficulty_level,rt'];
   rows.push(`Fixture,${task},instructions,,0,,,`);
   for(let n=1;n<=60;n++)rows.push(`Fixture,${task},,${n},${n*1000},${(n+i)%4!==0},${n%5},250`);
   rows.push(`Fixture,${task},scheduled_break,,90000,,,`);rows.push(`Fixture,${task},fixation_catch_response,61,91000,true,,200`);
   const csv=rows.join('\n')+'\n',id=crypto.randomUUID(),object=`browser-verification/${username}/${i}.csv`;
   expect((await admin.storage.from('legacy-archive').upload(object,new Blob([csv],{type:'text/csv'}))).error).toBeNull();objects.push(object);
   expect((await admin.from('artifacts').insert({id,participant_id:participantId,study_id:studyId,bucket:'legacy-archive',object_key:object,sha256:crypto.createHash('sha256').update(csv).digest('hex'),original_path:`final_complete_user_Fixture_${task}_2026-10-0${i+1}T14-30-00.csv`,kind:'.csv',bytes:Buffer.byteLength(csv),row_count:63,legacy_user_id:'Fixture',task,identity_status:'matched'})).error).toBeNull();artifactIds.push(id);
   expect((await storeArtifactMetrics(db,{id,task,sha256:crypto.createHash('sha256').update(csv).digest('hex')},Buffer.from(csv))).valid).toBe(true);
  }
  const signed=await owner.auth.signInWithPassword({email:`${username}@example.invalid`,password});expect(signed.error).toBeNull();
  expect((await anonymous.storage.from('legacy-archive').download(objects[0])).error).not.toBeNull();
  expect((await owner.from('artifacts').select('id')).data.map(f=>f.id).sort()).toEqual([...artifactIds].sort());
  await page.addInitScript(({key,session})=>{if(!sessionStorage.getItem('live-fixture')){localStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem('live-fixture','1');}},{key:`sb-${new URL(env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`,session:signed.data.session});
  await page.setViewportSize({width:1440,height:1000});await page.goto('/dashboard');
  await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.',{timeout:15000});await screenshot('progress-overview');
  await page.goto(`/data-portal/preview.html?file=${artifactIds[0]}`);await expect(page.getByText('Original file checksum verified.')).toBeVisible({timeout:15000});await screenshot('file-preview');
  await page.goto('/data-portal/users.html');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.',{timeout:15000});await expect(page.locator('#trend-charts svg')).toHaveCount(5);await screenshot('user-trends');
  await page.clock.install();
  await page.goto('/Motion');await page.getByLabel('Visible screen width (cm)').fill('47.6');await page.getByLabel('Visible screen height (cm)').fill('26.8');await page.getByLabel('Viewing distance (cm)').fill('50');await page.getByLabel('X offset (degrees)').fill('4');await page.getByLabel('Y offset (degrees)').fill('4');
  await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(page.locator('#training-status')).toContainText('Configuration saved',{timeout:15000});
  await page.reload();await expect(page.getByLabel('Visible screen width (cm)')).toHaveValue('47.6');await expect(page.getByLabel('X offset (degrees)')).toHaveValue('4');await screenshot('training-configuration');
  await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Confirm and start training'}).click();await expect(page.locator('#jspsych-content')).toContainText('Please click',{timeout:15000});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  for(let i=0;i<12;i++) {if(await page.locator('.ready-title').count())break;const button=page.locator('#jspsych-content button').first();if(await button.count())await button.click();else await page.keyboard.press('Space');await page.waitForTimeout(150);}
  await expect(page.locator('.ready-title')).toHaveText('Ready?');await page.keyboard.press('Space');await expect(page.locator('#stimulus')).toBeVisible();await page.waitForTimeout(1050);const bounds=await page.locator('#stimulus').boundingBox();expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(1440);await screenshot('experiment-stimulus');
  await page.waitForTimeout(850);await page.keyboard.press('ArrowUp');await page.waitForTimeout(1400);
  const responseCount=async()=>{const r=await db.query('select count(*)::int n from public.trial_attempts t join public.experiment_runs r on r.id=t.run_id where r.participant_id=$1 and t.state=\'completed\'',[participantId]);return r.rows[0].n;};
  await expect.poll(responseCount,{timeout:15000}).toBeGreaterThan(0);
  // Interrupt the second attempt and verify that its response cannot count.
  await page.keyboard.press('b');await expect(page.locator('#jspsych-content')).toContainText('Manual break requested');
  await expect.poll(async()=>{const r=await db.query('select count(*)::int n from public.trial_attempts t join public.experiment_runs r on r.id=t.run_id where r.participant_id=$1 and t.state=\'interrupted\'',[participantId]);return r.rows[0].n;},{timeout:15000}).toBeGreaterThan(0);
  // Complete the actual 256-trial renderer with a controlled browser clock.
  // This exercises real catch slots, all chunk boundaries and completion RPCs.
  for(let i=0;i<2000;i++) {
   if(await page.locator('.server-save-section').count())break;
   if(await page.locator('.ready-title').count())await page.keyboard.press('Space');
   else if(await page.locator('.question-text').count())await page.keyboard.press('ArrowUp');
   await page.clock.fastForward(1100);
   if(i%128===0)console.log(`Full-session verification: ${i} clock steps processed.`);
  }
  await expect(page.locator('.server-save-section')).toBeVisible();
  await expect(page.locator('.server-save-section')).toContainText('All trial events synchronized. Run completed in Supabase.',{timeout:60000});
  expect(await responseCount()).toBe(256);
  const caught=await db.query('select count(*)::int n from public.trial_attempts t join public.experiment_runs r on r.id=t.run_id where r.participant_id=$1 and t.state=\'completed\' and t.is_catch',[participantId]);expect(caught.rows[0].n).toBe(13);
  await screenshot('completed-training');
  const runs=await owner.from('experiment_runs').select('id,parameter_snapshot').eq('participant_id',participantId);expect(runs.error).toBeNull();expect(runs.data).toHaveLength(1);expect(runs.data[0].parameter_snapshot.training.x_deg).toBe(4);expect(runs.data[0].parameter_snapshot.display.width_cm).toBe(47.6);
  await page.goto(`/data-portal/preview.html?run=${runs.data[0].id}`);await expect(page.getByRole('heading',{name:'Recorded run preview'})).toBeVisible();await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible({timeout:15000});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();expect((await download).suggestedFilename()).toContain('run_Motion_');await screenshot('recorded-run-preview');
  await page.goto('/data-portal/users.html');await page.getByLabel('Results source').selectOption('recorded');await expect(page.locator('#trend-status')).toHaveText('1 sessions loaded.',{timeout:15000});await expect(page.locator('#trend-summary')).toContainText('Responses');await screenshot('recorded-run-trends');
  expect(errors).toEqual([]);

});
