import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {readLocalEnv} from '../../scripts/lib/local-env.mjs';
import {mock} from './fixtures/portal.mjs';
import {parseCsv} from '../../src/portal-csv.js';
import {analyzeRows,csvObjects,fileDate} from '../../src/portal-metrics.js';
import {summaryMetrics} from '../../scripts/lib/portal-metrics.mjs';
const env=readLocalEnv(),project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const id=(prefix,n)=>`${prefix}000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=Array.from({length:56},(_,i)=>({auth_user_id:id('10',i+1),participant_id:id('20',i+1),username:i===0?'Administrator':`User_${String(i).padStart(3,'0')}`,total_users:56}));
const tasks=['Motion','Centrality','Orientation','Bar'];
const display={viewport_width:1440,viewport_height:1000,screen_width:1920,screen_height:1080,width_cm:47.6,height_cm:26.8,distance_cm:50,dpr:1,fullscreen:true};
const study='30000000-0000-0000-0000-000000000001';
function fixtureCsv(user,task) {
 return `user_id,task_type,trial_category,overall_trial_number,time_elapsed,correct,difficulty_level,rt\n${user},${task},instructions,,0,,,\n${user},${task},,1,1000,true,1,250\n${user},${task},,2,2000,false,2,300\n${user},${task},fixation_catch_response,3,3000,true,,200\n`;
}
async function mockAdmin(page) {
 const authUser={id:directory[0].auth_user_id,aud:'authenticated',role:'authenticated',email:'admin@example.invalid',email_confirmed_at:'2026-10-04T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:'2026-10-04T00:00:00Z'};
 const payload=Buffer.from(JSON.stringify({sub:authUser.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})).toString('base64url');
 const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:authUser};
 const requests=[];
 const manifest=[directory[42],directory[43]].flatMap(user=>tasks.map((task,i)=>({id:`${user.username}-${task}`,participant_id:user.participant_id,bucket:'legacy-archive',object_key:`${user.username}/${task}.csv`,original_path:`final_complete_user_${user.username}_${task}_2026-10-0${i+1}T14-30-00.csv`,kind:'.csv',row_count:5,task,identity_status:'matched',bytes:400,legacy_user_id:user.username,sha256:createHash('sha256').update(fixtureCsv(user.username,task)).digest('hex'),metrics:summaryMetrics(analyzeRows(csvObjects(parseCsv(fixtureCsv(user.username,task))),task),task)})));
 await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${project}-auth-token`,session});
 await page.route(`${env.SUPABASE_URL}/auth/v1/**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(authUser)}));
 await page.route(`${env.SUPABASE_URL}/rest/v1/**`,route=>{
  const url=new URL(route.request().url()),resource=url.pathname.split('/').at(-1),args=route.request().postDataJSON();requests.push({resource,params:Object.fromEntries(url.searchParams),args});
  const participantFilter=url.searchParams.get('participant_id')?.slice(3),authFilter=url.searchParams.get('auth_user_id')?.slice(3),selected=directory.find(u=>u.auth_user_id===authFilter||u.auth_user_id===args?.account_user||u.participant_id===args?.selected_participant||u.participant_id===participantFilter||'eq.'+u.participant_id===url.searchParams.get('id'))||directory[0];
  let data=[],total=0;
  if(resource==='portal_dashboard')data={access:'admin',profile:{display_username:selected.username,preferences:{}},participant:{id:selected.participant_id,auth_user_id:selected.auth_user_id,provenance:'registration'},studies:[{id:study,name:'Visual recovery study',active:true,tasks,protocol_version:'legacy-2026-10-04',consent_version:'v1'}],enrollments:[{participant_id:selected.participant_id,study_id:study,active:true,consent_version:'v1',consented_at:'2026-10-04T00:00:00Z'}],runs:[],totalRuns:0};
  else if(resource==='account_access')data='admin';
  else if(resource==='admin_user_status') {
   const found=directory.filter(u=>u.username.toLowerCase().includes(args.search.toLowerCase()));data=found.slice(args.page_offset,args.page_offset+50).map(u=>({...u,total_users:found.length}));
  }else if(resource==='profiles')data={display_username:selected.username,preferences:{}};
  else if(resource==='participants')data={id:selected.participant_id,auth_user_id:selected.auth_user_id,provenance:'registration'};
  else if(resource==='studies')data=[{id:study,name:'Visual recovery study',active:true,tasks,protocol_version:'legacy-2026-10-04',consent_version:'v1'}];
  else if(resource==='enrollments')data=[{participant_id:selected.participant_id,study_id:study,active:true,consent_version:'v1',consented_at:'2026-10-04T00:00:00Z'}];
  else if(resource==='display_profiles')data=[{id:id('40',Number(selected.auth_user_id.slice(-12))),auth_user_id:selected.auth_user_id,name:'Primary display',settings:display,version:2}];
  else if(resource==='training_settings')data=tasks.map(task=>({id:`setting-${task}`,participant_id:selected.participant_id,study_id:study,task,display_profile_id:id('40',Number(selected.auth_user_id.slice(-12))),settings:{x_deg:selected.username==='User_043'?3:4,y_deg:4,positions:[task==='Bar'?'upper':'left_upper']},version:3}));
  else if(resource==='portal_sessions'){data=manifest.filter(f=>!participantFilter||f.participant_id===participantFilter).map(f=>({id:f.id,participant_id:f.participant_id,task:f.task,session_date:fileDate(f),label:f.original_path,username:f.legacy_user_id,metrics:f.metrics}));total=data.length;}
  else if(resource==='artifacts'||resource==='portal_artifacts') {
   if(url.searchParams.get('select')==='sha256') {
    const file=manifest.find(f=>'eq.'+f.id===url.searchParams.get('id'));data={sha256:createHash('sha256').update(fixtureCsv(file.legacy_user_id,file.task)).digest('hex')};
   }else {
    const files=url.searchParams.get('participant_id')==='is.null'?[]:manifest.filter(f=>!participantFilter||f.participant_id===participantFilter);total=files.length;
    const offset=Number(url.searchParams.get('offset')||0);data=files.slice(offset,offset+Number(url.searchParams.get('limit')||25));
   }
  }
  return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':`0-${Math.max(0,total-1)}/${total}`},body:JSON.stringify(data)});
 });
 await page.route(`${env.SUPABASE_URL}/storage/v1/object/sign/**`,route=>{
  const path=new URL(route.request().url()).pathname.replace('/storage/v1','');
  if(route.request().method()==='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signedURL:path+'?token=fixture'})});
  const file=manifest.find(f=>path.endsWith('/'+f.object_key));return route.fulfill({status:200,contentType:'text/csv',body:fixtureCsv(file.legacy_user_id,file.task)});
 });
 return requests;
}
async function shot(page,name) {fs.mkdirSync('test/results/navigation-screenshots',{recursive:true});await page.screenshot({path:`test/results/navigation-screenshots/${name}.png`,fullPage:true});}
const menu=page=>page.getByRole('navigation',{name:'Main menu'});
test('participant menu separates all charts, editable settings and own password change',async({page})=>{
 const saved=await mock(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/dashboard');
 await expect(menu(page).getByRole('link')).toHaveText(['My progress','Training settings','Account']);await expect(page.locator('#trend-charts svg')).toHaveCount(5);
 await expect(page.locator('#results-user')).toBeHidden();await expect(page.locator('#task-toggles input:checked')).toHaveCount(4);await expect(page.locator('#training-form')).toHaveCount(0);await expect(page.locator('#file-filters')).toHaveCount(0);await shot(page,'participant-progress');
 await menu(page).getByRole('link',{name:'Training settings'}).click();await expect(page.getByRole('heading',{name:'Training settings',exact:true})).toBeVisible();await expect(page.getByLabel('Visible screen width (cm)')).toBeEditable();await expect(page.locator('#trend-charts')).toHaveCount(0);
 await page.getByLabel('Visible screen width (cm)').fill('47.6');await page.getByLabel('Visible screen height (cm)').fill('26.8');await page.getByLabel('Viewing distance (cm)').fill('50');await page.getByLabel('X offset (degrees)').fill('4');await page.getByLabel('Y offset (degrees)').fill('4');
 await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(page.locator('#training-status')).toContainText('Configuration saved');expect(saved.calls).toHaveLength(1);await shot(page,'participant-training');
 await menu(page).getByRole('link',{name:'Account',exact:true}).click();await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();await expect(page.getByLabel('Current password')).toBeVisible();await expect(page.locator('#trend-charts')).toHaveCount(0);await shot(page,'participant-account');
 await page.goto('/dashboard?user=20000000-0000-0000-0000-000000000099');await expect(page.locator('#overview-table')).toContainText('Fixture');await expect(page.getByRole('combobox',{name:'User ID'})).toHaveCount(0);
});
test('admin searchable paged dropdown scopes progress and settings and preserves selection across menus',async({page})=>{
 const requests=await mockAdmin(page),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1440,height:1000});await page.goto('/admin');
 await expect(menu(page).getByRole('link')).toHaveText(['User progress','Training settings','Account','File download']);
 await expect(page.locator('#user-selector')).toHaveCSS('overflow','visible');
 const picker=page.getByRole('combobox',{name:'User ID'});await picker.click();await expect(page.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(50);await page.getByRole('button',{name:'Next users'}).click();await expect(page.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(6);expect(requests.some(r=>r.resource==='admin_user_status'&&r.args.page_offset===50)).toBe(true);
 await picker.fill('User_042');await expect(page.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(1);await shot(page,'admin-user-search');await picker.press('ArrowDown');await picker.press('Enter');
 await expect(page).toHaveURL(new RegExp(directory[42].participant_id));await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');await expect(page.locator('#trend-charts svg')).toHaveCount(5);await expect(page.locator('#overview-table')).toContainText('User_042');await expect(page.locator('#overview-table')).not.toContainText('User_043');await shot(page,'admin-user-progress');
 await menu(page).getByRole('link',{name:'Training settings'}).click();await expect(picker).toHaveValue('User_042');await expect(page.getByLabel('X offset (degrees)')).toHaveValue('4');await expect(page.getByLabel('Visible screen width (cm)')).toHaveValue('47.6');await expect(page.getByLabel('X offset (degrees)')).not.toBeEditable();await expect(page.getByRole('img',{name:'Saved stimulus position preview'})).toBeVisible();await expect(page.getByRole('button',{name:'Save configuration'})).toHaveCount(0);await shot(page,'admin-user-training');
 await picker.fill('User_043');await expect(page.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(1);await page.getByRole('listbox',{name:'User IDs'}).getByRole('option').click();await expect(page.getByLabel('X offset (degrees)')).toHaveValue('3');
 await menu(page).getByRole('link',{name:'User progress'}).click();await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');await expect(page.locator('#overview-table')).toContainText('User_043');
 expect(requests.some(r=>r.resource==='portal_sessions'&&r.params.participant_id==='eq.'+directory[42].participant_id)).toBe(true);expect(requests.some(r=>r.resource==='display_profiles'&&r.params.auth_user_id==='eq.'+directory[42].auth_user_id)).toBe(true);expect(requests.some(r=>r.resource==='training_settings'&&r.params.participant_id==='eq.'+directory[42].participant_id)).toBe(true);expect(errors).toEqual([]);
});
test('admin file download retains file previews and unassigned filter; account stays their own',async({page})=>{
 const requests=await mockAdmin(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/dashboard?user='+directory[42].participant_id);await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');
 await menu(page).getByRole('link',{name:'File download'}).click();await expect(page.locator('#file-rows tr')).toHaveCount(4);await expect(page.locator('#file-rows')).not.toContainText('User_043');await expect(page.locator('[data-pass="0"]')).toHaveText('100.0% (1/1)');await shot(page,'admin-file-download');
 await page.getByRole('button',{name:'View rows'}).first().click();await expect(page.getByText('Original file checksum verified.')).toBeVisible();await expect(page.getByRole('button',{name:'Download',exact:true})).toHaveCount(4);
 await page.getByLabel('Show only unassigned files').check();await expect(page.locator('#file-rows')).toContainText('No files match');expect(requests.some(r=>r.resource==='portal_artifacts'&&r.params.participant_id==='is.null')).toBe(true);
 await menu(page).getByRole('link',{name:'Account',exact:true}).click();await expect(page.getByLabel('Current password')).toBeVisible();await expect(page.getByRole('combobox',{name:'User ID'})).toHaveCount(0);await expect(page.locator('header strong')).toContainText('Administrator');await shot(page,'admin-account');
});
test('admin selection recovers from no matches or invalid URLs and fits a phone screen',async({page})=>{
 await mockAdmin(page);await page.setViewportSize({width:390,height:844});await page.goto('/settings?user='+directory[42].participant_id);await expect(page.getByLabel('X offset (degrees)')).toHaveValue('4');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,'admin-mobile-training');
 const picker=page.getByRole('combobox',{name:'User ID'});await picker.fill('MissingUser');await expect(page.getByText('No users match this ID.')).toBeVisible();await picker.press('Escape');await expect(picker).toHaveAttribute('aria-expanded','false');
 await page.goto('/dashboard?user=invalid');await expect(page.getByRole('alert')).toHaveText('Invalid user selection.');await picker.fill('User_042');await expect(page.getByRole('listbox',{name:'User IDs'}).getByRole('option')).toHaveCount(1);await picker.press('Enter');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,'admin-mobile-progress');
});
