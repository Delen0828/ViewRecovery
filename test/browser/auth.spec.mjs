import {test,expect} from '@playwright/test';
import {readLocalEnv} from '../../scripts/lib/local-env.mjs';
const env=readLocalEnv(),project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const user={id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',email_confirmed_at:'2026-10-04T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{username:'Fixture'},identities:[],created_at:'2026-10-04T00:00:00Z'};
const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})).toString('base64url');
const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
async function mockAccount(page) {
 await page.addInitScript(({key,session})=>{if(!sessionStorage.getItem('fixture-account-initialized')){localStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem('fixture-account-initialized','1');}},{key:`sb-${project}-auth-token`,session});
 await page.route(`${env.SUPABASE_URL}/auth/v1/**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)}));
 await page.route(`${env.SUPABASE_URL}/rest/v1/**`,route=>{
  const url=new URL(route.request().url());
  const resource=url.pathname.split('/').at(-1);
  const data=resource==='profiles'?{display_username:'Fixture',preferences:{}}:resource==='participants'?{id:'participant-fixture',provenance:'registration'}:[];
  return route.fulfill({status:200,contentType:'application/json',headers:{'Content-Range':'*/0'},body:JSON.stringify(data)});
 });
}
test('signed-out direct experiment and portal routes require sign-in and preserve return route',async({page})=>{
 for(const route of ['/Motion','/data-portal/','/data-portal/users.html','/data-portal/preview.html']) {
  await page.goto(route);await expect(page).toHaveURL(/\/auth\/login\?/);
  await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(route);
 }
});
test('unknown username opens registration with a prefilled label',async({page})=>{
 await page.route('**/api/auth',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'USERNAME_NOT_REGISTERED',message:'Username not registered. Create an account.'})}));
 await page.goto('/auth/login?returnTo=%2FMotion');await page.getByLabel('Username').fill('New_User');await page.getByLabel('Password',{exact:true}).fill('WrongPassword!123');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Create an account',exact:true})).toBeVisible();await expect(page.getByLabel('Username')).toHaveValue('New_User');expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/Motion');
});
test('registration checks confirmation and reports verification without starting a task',async({page})=>{
 let calls=0;
 await page.route('**/api/auth',route=>{calls++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({message:'Check your email to verify your account, then sign in.'})});});
 await page.goto('/auth/register?username=Fixture');await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('Password',{exact:true}).fill('LongPassword!123');await page.getByLabel('Confirm password').fill('DifferentPassword!123');await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Passwords do not match.');expect(calls).toBe(0);
 await page.getByLabel('Confirm password').fill('LongPassword!123');await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('Check your email');expect(calls).toBe(1);await expect(page).toHaveURL(/\/auth\/register/);
});
test('verified account dashboard and portal share session; logout protects direct routes again',async({page})=>{
 await mockAccount(page);await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible();await expect(page.getByText('Your account is ready. Study staff must enroll you before task setup.')).toBeVisible();
 await page.getByRole('link',{name:'Study results',exact:true}).click();await expect(page.getByRole('heading',{name:'Study results',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 // Remove the fixture initializer so navigation does not seed a new session after logout.
 expect(await page.evaluate(key=>localStorage.getItem(key),`sb-${project}-auth-token`)).toBeNull();
});
test('typing in auth fields does not trigger experiment keyboard shortcuts; offsite returns are rejected',async({page})=>{
 await page.goto('/auth/login?returnTo=https%3A%2F%2Fevil.test');await page.getByLabel('Username').fill('br');await expect(page.getByLabel('Username')).toHaveValue('br');
 await expect(page.getByRole('link',{name:'Create an account'})).toHaveAttribute('href',/returnTo=%2Fdashboard/);
 await expect(page.locator('#jspsych-content')).toHaveCount(0);
});

test('logout remains available while historical files are loading',async({page})=>{
 await mockAccount(page);
 await page.route(`${env.SUPABASE_URL}/rest/v1/artifacts?**`,async route=>{
  await new Promise(resolve=>setTimeout(resolve,1500));
  await route.fulfill({status:200,contentType:'application/json',headers:{'Content-Range':'*/0'},body:'[]'}).catch(()=>{});
 });
 await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible();
 await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
});

test('legacy short user IDs can sign in and participants cannot open the admin directory',async({page})=>{
 await page.goto('/auth/login');await page.getByLabel('Username').fill('X');
 expect(await page.getByLabel('Username').evaluate(input=>input.checkValidity())).toBe(true);
 await mockAccount(page);await page.goto('/admin');await expect(page.getByRole('heading',{name:'Administrator access required'})).toBeVisible();
});
test('signed-in password change checks confirmation and reauthenticates before updating',async({page})=>{
 await mockAccount(page);let logins=0,updates=0;
 await page.route('**/api/auth',route=>{logins++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session})});});
 await page.route(`${env.SUPABASE_URL}/auth/v1/user`,route=>{
  if(route.request().method()==='PUT')updates++;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});
 });
 await page.goto('/auth/change');await expect(page.getByRole('heading',{name:'Change your password'})).toBeVisible();
 await page.getByLabel('Current password').fill('Fixture');await page.getByLabel('New password',{exact:true}).fill('ChangedPassword!123');await page.getByLabel('Confirm password').fill('DifferentPassword!123');await page.getByRole('button',{name:'Save password'}).click();
 await expect(page.getByRole('status')).toHaveText('Passwords do not match.');expect(logins).toBe(0);expect(updates).toBe(0);
 await page.getByLabel('Confirm password').fill('ChangedPassword!123');await page.getByRole('button',{name:'Save password'}).click();
 await expect(page.getByRole('status')).toContainText('Password saved.');expect(logins).toBe(1);expect(updates).toBe(1);
});
test('admin can browse all users and safely preview multiline historical CSV',async({page})=>{
 await mockAccount(page);
 const csv='user_id,stimulus,correct\nFixture,"<script>alert(1)</script>\n<p>preserved</p>",true\n';
 const digest=(await import('node:crypto')).createHash('sha256').update(csv).digest('hex');
 const file={id:'file-fixture',participant_id:'20000000-0000-0000-0000-000000000001',bucket:'legacy-archive',object_key:'fixture.csv',original_path:'user_Fixture_Motion_final.csv',kind:'.csv',row_count:1,task:'Motion',identity_status:'matched'};
 await page.route(`${env.SUPABASE_URL}/rest/v1/**`,route=>{
  const url=new URL(route.request().url()),resource=url.pathname.split('/').at(-1);
  let data=[];
  if(resource==='account_access')data='admin';
  else if(resource==='admin_user_status')data=[{username:'Fixture',participant_id:file.participant_id,provenance:'legacy',file_count:1,source_rows:1,run_count:0,total_users:1}];
  else if(resource==='profiles')data={display_username:'Fixture',preferences:{}};
  else if(resource==='participants')data={id:file.participant_id,auth_user_id:user.id,provenance:'legacy'};
  else if(resource==='artifacts')data=url.searchParams.get('select')==='sha256'?{sha256:digest}:[file];
  return route.fulfill({status:200,contentType:'application/json',headers:{'Content-Range':'0-0/1'},body:JSON.stringify(data)});
 });
 await page.route(`${env.SUPABASE_URL}/storage/v1/object/sign/**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signedURL:'/object/sign/legacy-archive/fixture.csv?token=fixture'})}));
 await page.route(`${env.SUPABASE_URL}/storage/v1/object/sign/legacy-archive/fixture.csv?token=fixture`,route=>route.fulfill({status:200,contentType:'text/csv',body:csv}));
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'Admin — all user data'})).toBeVisible();
 await page.getByRole('link',{name:'Fixture',exact:true}).click();await expect(page.getByRole('heading',{name:'Fixture',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View rows'}).click();await expect(page.getByText('Original file checksum verified.')).toBeVisible();
 await expect(page.locator('.raw-cell').filter({hasText:'<script>alert(1)</script>'})).toBeVisible();
 await expect(page.locator('#file-preview script')).toHaveCount(0);
});
