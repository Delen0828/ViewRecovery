import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {readLocalEnv} from '../../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../../scripts/lib/staging-db.mjs';
import {storeArtifactMetrics} from '../../scripts/lib/portal-metrics.mjs';
test.use({screenshot:'off'});
let cleanupFixture;
test.afterEach(async()=>{test.setTimeout(30000);if(cleanupFixture){await cleanupFixture();cleanupFixture=null;}});
test('real participant and administrator menus, scoped user search, saved settings, downloads and own password change',async({page,browser})=>{
 test.skip(process.env.VIEWRECOVERY_LIVE_BROWSER!=='1','Enable real staging verification with VIEWRECOVERY_LIVE_BROWSER=1.');test.setTimeout(90000);
 const env=readLocalEnv(),suffix=crypto.randomUUID().replaceAll('-','').slice(0,16),options={auth:{persistSession:false,autoRefreshToken:false}};
 const privileged=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,options),participantClient=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options),adminClient=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options);
 const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-navigation-browser')),accounts=[],objects=[],artifactIds=[],studyId=crypto.randomUUID();let adminContext;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await db.connect();
 cleanupFixture=async()=>{
  if(adminContext)await adminContext.close();
  if(objects.length)expect((await privileged.storage.from('legacy-archive').remove(objects)).error).toBeNull();
  await db.query('begin');
  await db.query('delete from public.artifacts where id=any($1::uuid[])',[artifactIds]);
  for(const account of accounts)if(account.id){
   await db.query('delete from private.administrators where auth_user_id=$1',[account.id]);
   await db.query('delete from public.training_settings where participant_id=$1',[account.participantId]);
   await db.query('delete from public.display_profiles where auth_user_id=$1',[account.id]);
   await db.query('delete from public.enrollments where participant_id=$1 and study_id=$2',[account.participantId,studyId]);
   await db.query('delete from public.participants where auth_user_id=$1',[account.id]);
   await db.query('delete from public.profiles where auth_user_id=$1',[account.id]);
   await db.query('delete from private.account_identifiers where auth_user_id=$1',[account.id]);
  }else await db.query('delete from private.account_identifiers where normalized_username=$1 and auth_user_id is null',[account.username]);
  await db.query('delete from public.studies where id=$1',[studyId]);await db.query('commit');
  for(const account of accounts)if(account.id)expect((await privileged.auth.admin.deleteUser(account.id)).error).toBeNull();
  const remaining=await db.query('select count(*)::int n from public.profiles where auth_user_id=any($1::uuid[])',[accounts.filter(a=>a.id).map(a=>a.id)]);expect(remaining.rows[0].n).toBe(0);
  await db.end();
 };
 async function account(role,client) {
  const fixture={username:`nav_${role}_${suffix}`,password:crypto.randomBytes(24).toString('base64url')+'!aA1'};accounts.push(fixture);
  const reserved=await privileged.rpc('reserve_username',{username:fixture.username});expect(reserved.error).toBeNull();
  const created=await privileged.auth.admin.createUser({email:`${fixture.username}@example.invalid`,password:fixture.password,email_confirm:true,user_metadata:{username:fixture.username,username_reservation:reserved.data}});expect(created.error).toBeNull();fixture.id=created.data.user.id;
  const participant=await privileged.from('participants').select('id').eq('auth_user_id',fixture.id).single();expect(participant.error).toBeNull();fixture.participantId=participant.data.id;
  const signed=await client.auth.signInWithPassword({email:`${fixture.username}@example.invalid`,password:fixture.password});expect(signed.error).toBeNull();fixture.session=signed.data.session;return fixture;
 }
 const owner=await account('user',participantClient),administrator=await account('admin',adminClient);
 await db.query('insert into private.administrators(auth_user_id) values($1)',[administrator.id]);
 expect((await privileged.from('studies').insert({id:studyId,name:'Navigation verification study',protocol_version:'legacy-2026-10-04',consent_version:'v1',active:true})).error).toBeNull();
 expect((await privileged.from('enrollments').insert({study_id:studyId,participant_id:owner.participantId,active:true,consent_version:'v1',consented_at:new Date().toISOString()})).error).toBeNull();
 for(const [i,task] of ['Motion','Orientation','Centrality','Bar'].entries()) {
  const rows=['user_id,task_type,trial_category,overall_trial_number,time_elapsed,correct,difficulty_level,rt',`SyntheticUser,${task},instructions,,0,,,`];
  for(let n=1;n<=30;n++)rows.push(`SyntheticUser,${task},,${n},${n*1000},${n%3!==0},${n%5},250`);
  rows.push(`SyntheticUser,${task},fixation_catch_response,31,31000,true,,200`);
  const csv=rows.join('\n')+'\n',object=`browser-verification/nav_${suffix}/${task}.csv`,id=crypto.randomUUID();
  expect((await privileged.storage.from('legacy-archive').upload(object,new Blob([csv],{type:'text/csv'}))).error).toBeNull();objects.push(object);
  expect((await privileged.from('artifacts').insert({id,participant_id:owner.participantId,study_id:studyId,bucket:'legacy-archive',object_key:object,sha256:crypto.createHash('sha256').update(csv).digest('hex'),original_path:`final_complete_user_SyntheticUser_${task}_2026-10-0${i+1}T14-30-00.csv`,kind:'.csv',row_count:33,bytes:Buffer.byteLength(csv),legacy_user_id:'SyntheticUser',task,identity_status:'matched'})).error).toBeNull();artifactIds.push(id);
  expect((await storeArtifactMetrics(db,{id,task,sha256:crypto.createHash('sha256').update(csv).digest('hex')},Buffer.from(csv))).valid).toBe(true);
 }
 async function seed(target,fixture) {
  await target.addInitScript(({key,session})=>{if(!sessionStorage.getItem('nav-fixture')){localStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem('nav-fixture','1');}},{key:`sb-${new URL(env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`,session:fixture.session});
 }
 async function shot(target,name) {fs.mkdirSync('test/results/navigation-screenshots',{recursive:true});await target.screenshot({path:`test/results/navigation-screenshots/staging-${name}.png`,fullPage:true});}
 const menu=target=>target.getByRole('navigation',{name:'Main menu'});
 await page.setViewportSize({width:1440,height:1000});await seed(page,owner);await page.goto('/dashboard');await expect(menu(page).getByRole('link')).toHaveText(['My progress','Training settings','Account']);await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.',{timeout:15000});await expect(page.locator('#trend-charts svg')).toHaveCount(5);await shot(page,'participant-progress');
 await menu(page).getByRole('link',{name:'Training settings'}).click();await page.getByLabel('Visible screen width (cm)').fill('47.6');await page.getByLabel('Visible screen height (cm)').fill('26.8');await page.getByLabel('Viewing distance (cm)').fill('50');await page.getByLabel('X offset (degrees)').fill('4');await page.getByLabel('Y offset (degrees)').fill('4');
 await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(page.locator('#training-status')).toContainText('Configuration saved',{timeout:15000});await page.reload();await expect(page.getByLabel('X offset (degrees)')).toHaveValue('4');await shot(page,'participant-training');
 const unauthorized=await participantClient.rpc('admin_user_status',{search:administrator.username,page_offset:0});expect(unauthorized.error).not.toBeNull();
 adminContext=await browser.newContext({viewport:{width:1440,height:1000}});const adminPage=await adminContext.newPage();adminPage.on('pageerror',error=>errors.push(error.message));await seed(adminPage,administrator);await adminPage.goto('http://localhost:5173/admin');await expect(menu(adminPage).getByRole('link')).toHaveText(['User progress','Training settings','Account','File download']);
 const picker=adminPage.getByRole('combobox',{name:'User ID'});await picker.fill(owner.username);await expect(adminPage.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(1,{timeout:15000});await shot(adminPage,'admin-user-search');await picker.press('ArrowDown');await picker.press('Enter');await expect(adminPage.locator('#trend-status')).toHaveText('4 sessions loaded.',{timeout:15000});await expect(adminPage.locator('#overview-table')).toContainText(owner.username);await shot(adminPage,'admin-user-progress');
 await menu(adminPage).getByRole('link',{name:'Training settings'}).click();await expect(picker).toHaveValue(owner.username);await expect(adminPage.getByLabel('X offset (degrees)')).toHaveValue('4');await expect(adminPage.getByLabel('Visible screen width (cm)')).toHaveValue('47.6');await expect(adminPage.getByLabel('X offset (degrees)')).not.toBeEditable();await expect(adminPage.getByRole('img',{name:'Saved stimulus position preview'})).toBeVisible();await shot(adminPage,'admin-user-training');
 await menu(adminPage).getByRole('link',{name:'File download'}).click();await expect(adminPage.locator('#file-rows tr')).toHaveCount(4);await expect(adminPage.locator('[data-pass="0"]')).toHaveText('100.0% (1/1)',{timeout:15000});await shot(adminPage,'admin-file-download');
 await adminPage.getByRole('button',{name:'View rows'}).first().click();await expect(adminPage.getByText('Original file checksum verified.')).toBeVisible({timeout:15000});
 const download=adminPage.waitForEvent('download');await adminPage.getByRole('button',{name:'Download',exact:true}).first().click();const downloaded=await download;expect(downloaded.suggestedFilename()).toContain('final_complete_user_SyntheticUser_');expect(fs.readFileSync(await downloaded.path(),'utf8')).toContain('SyntheticUser');await downloaded.delete();
 await menu(adminPage).getByRole('link',{name:'Account',exact:true}).click();await expect(adminPage.locator('header strong')).toContainText(administrator.username);await expect(picker).toHaveCount(0);await shot(adminPage,'admin-account');
 await menu(page).getByRole('link',{name:'Account',exact:true}).click();await shot(page,'participant-account');const changed=crypto.randomBytes(24).toString('base64url')+'!bB2';
 await page.getByLabel('Current password').fill(owner.password);await page.getByLabel('New password',{exact:true}).fill(changed);await page.getByLabel('Confirm password').fill(changed);await page.getByRole('button',{name:'Save password'}).click();await expect(page.locator('#auth-status')).toContainText('Password saved.',{timeout:15000});
 const check=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options);expect((await check.auth.signInWithPassword({email:`${owner.username}@example.invalid`,password:owner.password})).error).not.toBeNull();expect((await check.auth.signInWithPassword({email:`${owner.username}@example.invalid`,password:changed})).error).toBeNull();await check.auth.signOut({scope:'local'});
 await menu(adminPage).getByRole('link',{name:'User progress'}).click();await picker.fill(owner.username);await expect(adminPage.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(1);await picker.press('Enter');await expect(adminPage.locator('#trend-status')).toHaveText('4 sessions loaded.',{timeout:15000});await adminPage.setViewportSize({width:390,height:844});expect(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(adminPage,'admin-mobile-progress');expect(errors).toEqual([]);
});
