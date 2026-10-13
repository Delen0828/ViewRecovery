import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium,expect} from '@playwright/test';
import {openDatabase,projectRoot} from '../scripts/lib/postgres.mjs';
import {createServer} from '../server/index.mjs';
import {ingest,hash} from '../server/store.mjs';

const pool=await openDatabase();
const participant='P'+randomUUID().replaceAll('-','').slice(0,8),other='P'+randomUUID().replaceAll('-','').slice(0,8);
const run={id:randomUUID(),user_id:participant,task:'Motion',run_timestamp:'2026-10-13T14-00-00'};
const requests=[],errors=[],sessionIds=[];
let server,browser,context,jobId;
try {
  jobId=(await pool.query('INSERT INTO experiment_data.import_jobs(archive_sha256,archive_name) VALUES($1,$2) RETURNING id',[hash(randomUUID()),'portal-browser-test.zip'])).rows[0].id;
  const historical={user_id:participant,task_type:'Motion',overall_trial_number:'1',correct:'true',difficulty_level:'1',rt:'100',time_elapsed:'100'};
  const name=`data/final_complete_user_${participant}_Motion_2026-10-13T12-00-00.csv`;
  const bytes=Buffer.from('user_id,task_type,correct,difficulty_level\n'+participant+',Motion,true,1\n');
  for (const owner of [participant,other]) {
    const file=(await pool.query(`INSERT INTO experiment_data.source_files(import_job_id,original_path,sha256,kind,user_id,task,run_timestamp,header,row_count,bytes)
      VALUES($1,$2,$3,'csv',$4,'Motion','2026-10-13T12-00-00','[]',1,$5) RETURNING id`,[jobId,name.replace(participant,owner),hash(bytes),owner,bytes])).rows[0];
    await pool.query('INSERT INTO experiment_data.source_rows(source_file_id,ordinal,payload) VALUES($1,1,$2)',[file.id,{...historical,user_id:owner}]);
  }
  const payload={user_id:participant,task_type:'Motion',trial_index:1,overall_trial_number:1,correct:true,difficulty_level:2,rt:200,time_elapsed:200};
  await ingest(pool,{batch_id:randomUUID(),run,events:[{event_sequence:1,included:true,payload}]});
  server=createServer(pool,{portalAuth:{adminUsername:'portal-browser-admin',adminPasswordHash:bcrypt.hashSync('browser-test-password',4),participantPasswordHash:''}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1360,height:950}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  await page.goto(base+'/data-portal/');
  await expect(page.getByRole('heading',{name:'Data Portal Login'})).toBeVisible();
  await page.locator('#username').fill(participant);
  await page.getByRole('button',{name:'Sign In'}).click();
  await expect(page.getByRole('heading',{name:'User Trends',exact:true})).toBeVisible();
  await expect(page.locator('.user-button')).toHaveCount(1);
  await expect(page.locator('.user-encouragement')).toContainText('2 trials');
  await expect(page.locator('.chart-wrap svg')).toHaveCount(2);
  assert.ok(!requests.some(url=>url.includes('/download')));
  const newPayload={...payload,trial_index:2,overall_trial_number:2,correct:false,time_elapsed:400};
  const write=await context.request.post(base+'/api/experiment/ingest',{data:{batch_id:randomUUID(),run,events:[{event_sequence:2,included:true,payload:newPayload}]}});
  assert.equal(write.status(),200);
  await page.reload();
  await expect(page.locator('.user-encouragement')).toContainText('3 trials');
  await page.getByRole('link',{name:'Data Files',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Data Files',exact:true})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel(/Session files/).check();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const active=page.locator('tbody tr').filter({hasText:'session_active_user_'});
  await active.getByRole('link',{name:'Preview',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Data Preview',exact:true})).toBeVisible();
  await expect(page.locator('.metric-value').filter({hasText:/^50%$/})).toHaveCount(1);
  await expect(page.locator('.chart-wrap svg')).toHaveCount(1);
  assert.ok(!requests.some(url=>url.includes('/download')));
  await page.getByRole('link',{name:'Data Files',exact:true}).click();
  const archived=page.locator('tbody tr').filter({hasText:name});
  const download=await context.request.get(base+await archived.getByRole('link',{name:'Download',exact:true}).getAttribute('href'));
  assert.equal(download.status(),200);assert.deepEqual(await download.body(),bytes);
  await page.getByRole('button',{name:'Log Out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Data Portal Login'})).toBeVisible();
  await page.locator('#username').fill('portal-browser-admin');await page.locator('#password').fill('browser-test-password');
  await page.getByRole('button',{name:'Sign In'}).click();
  await page.getByRole('link',{name:'User Trends',exact:true}).click();
  await page.locator('.user-button').filter({hasText:'User '+participant}).click();
  await expect(page.locator('.chart-wrap svg')).toHaveCount(3);
  await expect(page.locator('.user-encouragement')).toContainText('3 trials');
  mkdirSync(join(projectRoot,'test/results'),{recursive:true});
  await page.screenshot({path:join(projectRoot,'test/results/sql-portal-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:join(projectRoot,'test/results/sql-portal-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>url.startsWith(base)));
  console.log('Portal browser passed: original layout, participant/admin login, historical and live SQL charts, live update, preview, download, local assets and mobile layout.');
} finally {
  if (context) for (const cookie of await context.cookies()) if (cookie.name==='viewrecovery_portal_session') sessionIds.push(hash(cookie.value));
  await browser?.close();
  if (server) {server.close();await once(server,'close');}
  for (const table of ['ingest_batches','events']) await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`,[run.id]);
  await pool.query('DELETE FROM experiment_data.runs WHERE id=$1',[run.id]);
  if (jobId) {
    await pool.query('DELETE FROM experiment_data.source_rows WHERE source_file_id IN (SELECT id FROM experiment_data.source_files WHERE import_job_id=$1)',[jobId]);
    await pool.query('DELETE FROM experiment_data.source_files WHERE import_job_id=$1',[jobId]);
    await pool.query('DELETE FROM experiment_data.import_jobs WHERE id=$1',[jobId]);
  }
  await pool.query('DELETE FROM experiment_data.portal_sessions WHERE id_hash=ANY($1::text[])',[sessionIds]);
  await pool.end();
}
