import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';
import {readLocalEnv} from '../../scripts/lib/local-env.mjs';
import {stagingDatabaseConfig} from '../../scripts/lib/staging-db.mjs';
const enabled=process.env.VIEWRECOVERY_LIVE_BROWSER==='1';
test.use({screenshot:'off'});
test('real staging login, dashboard reads, reload, portal navigation, password recovery and logout',async({page})=>{
 test.skip(!enabled,'Set VIEWRECOVERY_LIVE_BROWSER=1 to create a temporary real staging Auth fixture.');
 const env=readLocalEnv(),username=`browser_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`,password=crypto.randomBytes(24).toString('base64url')+'!aA1';
 const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-browser-acceptance'));
 let userId;
 await db.connect();
 try {
  const {data:token,error:reservationError}=await admin.rpc('reserve_username',{username});expect(reservationError).toBeNull();
  const {data,error}=await admin.auth.admin.createUser({email:`${username}@example.invalid`,password,email_confirm:true,user_metadata:{username,username_reservation:token}});
  expect(error).toBeNull();userId=data.user.id;
  await page.goto('/auth/login');await page.getByLabel('Username').fill(username);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible({timeout:15000});
  await expect(page.getByText('Your account is ready. Study staff must enroll you before task setup.')).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible();
  await page.getByRole('link',{name:'Study results',exact:true}).click();await expect(page.getByRole('heading',{name:'Study results',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  await page.goto('/Motion');await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  const link=await admin.auth.admin.generateLink({type:'recovery',email:`${username}@example.invalid`,options:{redirectTo:env.AUTH_REDIRECT_URL}});expect(link.error).toBeNull();
  const recovery=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await recovery.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'recovery'});expect(verified.error).toBeNull();
  const storageKey=`sb-${new URL(env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(({key,session})=>{
    if(!sessionStorage.getItem('fixture-recovery-initialized')) {
      localStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem('viewrecovery-recovery','1');sessionStorage.setItem('fixture-recovery-initialized','1');
    }
  },{key:storageKey,session:verified.data.session});
  await page.goto('/auth/callback');await expect(page.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
  const newPassword=crypto.randomBytes(24).toString('base64url')+'!bB2';
  await page.getByLabel('Password',{exact:true}).fill(newPassword);await page.getByLabel('Confirm password').fill(newPassword);await page.getByRole('button',{name:'Save password'}).click();
  await expect(page.getByRole('status')).toHaveText('Password saved. Sign in with your new password.');
  await page.getByRole('link',{name:'Back to sign in'}).click();await page.getByLabel('Username').fill(username);await page.getByLabel('Password',{exact:true}).fill(newPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  await recovery.auth.signOut({scope:'local'});
 } finally {
  if(userId) {
   await db.query('begin');
   await db.query('delete from public.participants where auth_user_id=$1',[userId]);
   await db.query('delete from public.profiles where auth_user_id=$1',[userId]);
   await db.query('delete from private.account_identifiers where auth_user_id=$1',[userId]);
   await db.query('commit');
   const removed=await admin.auth.admin.deleteUser(userId);expect(removed.error).toBeNull();
  } else await db.query('delete from private.account_identifiers where normalized_username=$1 and auth_user_id is null',[username]);
  await db.end();
 }
});

test('real imported legacy user signs in with its ID and can browse private historical files',async({page})=>{
 test.skip(process.env.VIEWRECOVERY_LEGACY_PROVISIONED!=='1','Run after the protected legacy-access provisioner.');
 await page.goto('/auth/login');await page.getByLabel('Username').fill('Test1');await page.getByLabel('Password',{exact:true}).fill('Test1');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your dashboard'})).toBeVisible({timeout:15000});
 await expect(page.getByRole('link',{name:'Change password',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'View rows'}).first()).toBeVisible();
 await page.getByRole('button',{name:'View rows'}).first().click();
 await expect(page.getByText('Original file checksum verified.')).toBeVisible({timeout:15000});
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'Administrator access required'})).toBeVisible();
 await page.goto('/dashboard');await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
});

test('real administrator sees all imported users and original historical data',async({page})=>{
 test.skip(process.env.VIEWRECOVERY_LEGACY_PROVISIONED!=='1','Run after protected legacy provisioning.');
 const env=readLocalEnv(),username=`adm_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`,password=crypto.randomBytes(24).toString('base64url')+'!aA1';
 const privileged=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new pg.Client(stagingDatabaseConfig(env,'viewrecovery-admin-browser-acceptance'));let userId;
 await db.connect();
 try {
  const {data:token,error:reserveError}=await privileged.rpc('reserve_username',{username});expect(reserveError).toBeNull();
  const created=await privileged.auth.admin.createUser({email:`${username}@example.invalid`,password,email_confirm:true,user_metadata:{username,username_reservation:token}});expect(created.error).toBeNull();userId=created.data.user.id;
  await db.query('insert into private.administrators values($1)',[userId]);
  await page.goto('/admin/login');await page.getByLabel('Username').fill(username);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Admin — all user data'})).toBeVisible({timeout:15000});
  await expect(page.getByRole('link',{name:'Test1',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Test1',exact:true}).click();await expect(page.getByRole('heading',{name:'Test1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View rows'}).first().click();await expect(page.getByText('Original file checksum verified.')).toBeVisible({timeout:15000});
  await page.getByRole('link',{name:'Unassigned files'}).click();await expect(page.getByText('conflict',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 } finally {
  if(userId) {
   await db.query('begin');await db.query('delete from private.administrators where auth_user_id=$1',[userId]);
   await db.query('delete from public.participants where auth_user_id=$1',[userId]);await db.query('delete from public.profiles where auth_user_id=$1',[userId]);await db.query('delete from private.account_identifiers where auth_user_id=$1',[userId]);await db.query('commit');
   expect((await privileged.auth.admin.deleteUser(userId)).error).toBeNull();
  } else await db.query('delete from private.account_identifiers where normalized_username=$1 and auth_user_id is null',[username]);
  await db.end();
 }
});
