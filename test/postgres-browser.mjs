import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {openDatabase,projectRoot} from '../scripts/lib/postgres.mjs';
import {createServer} from '../server/index.mjs';
import {portalClient} from './portal-auth-client.mjs';

const pool=await openDatabase();
const server=createServer(pool,{portalAuth:{maxAttempts:100}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const participant='B'+randomUUID().replaceAll('-','').slice(0,8);
let browser;
const errors=[];const writes=[];
try {
  await server.portalAuthReady;
  const signup=await portalClient(base).post('/data-portal/auth/sign-up/email',{
    username:participant,name:`User ${participant}`,email:participant+'@example.com',
    password:'browser-study-password',invitationCode:'bright'
  });
  assert.equal(signup.status,200);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('https://d3js.org/d3.v7.min.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(join(projectRoot,'node_modules/d3/dist/d3.min.js'))}));
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/api/experiment/ingest'))writes.push(JSON.parse(request.postData()));});
  await page.goto(base+'/Motion');
  await page.getByRole('button',{name:'Enter Fullscreen & Continue'}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#user-id-input').fill(participant);
  await page.locator('#continue-btn').click();
  await expect(page.locator('#resolution-width')).toBeVisible();
  await expect(page.locator('#stimulus-x-offset')).toBeVisible();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  // Accelerate only test time; the production study configuration is unchanged.
  await page.clock.install();
  await page.clock.runFor(150);
  for (let i=0;i<2;i++) {await expect(page.locator('.instruction-wrapper')).toBeVisible();await page.keyboard.press('Space');}
  await expect(page.locator('.ready-title')).toHaveText('Ready?');await page.keyboard.press('Space');
  let paused=false,responses=0,breaks=0;
  for (let step=0;step<2000;step++) {
    if (await page.locator('.results-page').count()) break;
    if (await page.locator('.question-text').count()) {
      if (!paused && responses===1) {
        await page.keyboard.press('b');
        await expect(page.locator('.ready-title')).toHaveText('Paused');
        await expect(page.locator('#break-auto-save-status')).toHaveText('Your progress has been auto saved.',{timeout:30000});
        await page.keyboard.press('Space');paused=true;
      } else {await page.keyboard.press('ArrowUp');responses++;}
    } else if (await page.locator('#break-auto-save-status').count()) {
      await expect(page.locator('#break-auto-save-status')).toHaveText('Your progress has been auto saved.',{timeout:30000});
      await page.keyboard.press('Space');breaks++;
    } else {
      await page.clock.fastForward(1000);
    }
  }
  await expect(page.locator('.results-page')).toBeVisible();
  await expect(page.locator('#save-status-icon')).toHaveText('Saved',{timeout:30000});
  assert.equal(responses,256);assert.equal(breaks,7);assert.ok(paused);
  const run=await pool.query('SELECT id,status FROM experiment_data.runs WHERE user_id=$1',[participant]);
  assert.equal(run.rowCount,1);assert.equal(run.rows[0].status,'complete');
  const runId=run.rows[0].id;
  const responseRows=await pool.query(`SELECT payload FROM experiment_data.recorded_rows WHERE run_id=$1 AND payload ? 'correct' ORDER BY event_sequence`,[runId]);
  assert.equal(responseRows.rowCount,256);
  assert.equal(new Set(responseRows.rows.map(row=>row.payload.overall_trial_number)).size,256);
  const excluded=await pool.query('SELECT count(*)::integer AS count FROM experiment_data.events WHERE run_id=$1 AND NOT included',[runId]);
  assert.ok(excluded.rows[0].count>0);
  const saves=await pool.query('SELECT prefix,count(*)::integer AS count FROM experiment_data.saves WHERE run_id=$1 GROUP BY prefix',[runId]);
  assert.deepEqual(Object.fromEntries(saves.rows.map(row=>[row.prefix,row.count])),{final_complete:1,pause_checkpoint:1,session_chunk_complete:8});
  assert.ok(writes.length>0);assert.ok(writes.every(body=>!('filedata' in body) && Array.isArray(body.events)));
  await page.getByRole('button',{name:'Finish',exact:true}).click();
  await page.clock.fastForward(500);
  const viewer=await context.newPage();await viewer.goto(base+'/database');
  await expect(viewer.locator('#status')).toContainText('Connected to PostgreSQL');
  await viewer.locator('#participant').fill(participant);await viewer.getByRole('button',{name:'Filter',exact:true}).click();
  await expect(viewer.locator('#sources tr')).toHaveCount(11);
  await viewer.locator('#sources tr').filter({hasText:'run'}).first().click();
  await expect(viewer.locator('#rows tr')).toHaveCount(50);
  await expect(viewer.locator('#row-head')).toContainText('user_id');
  await viewer.setViewportSize({width:390,height:844});
  assert.ok(await viewer.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.deepEqual(errors,[]);
  mkdirSync(join(projectRoot,'test/results'),{recursive:true});
  await viewer.screenshot({path:join(projectRoot,'test/results/database-viewer.png'),fullPage:true});
  console.log('Browser passed: unchanged 256-trial Motion study, manual pause/replay, 8 session saves, final save, JSON transport, SQL viewer and mobile layout.');
} finally {
  await browser?.close();
  const ids=(await pool.query('SELECT id FROM experiment_data.runs WHERE user_id=$1',[participant])).rows.map(row=>row.id);
  for (const id of ids) {
    await pool.query('DELETE FROM experiment_data.save_rows WHERE save_id IN (SELECT id FROM experiment_data.saves WHERE run_id=$1)',[id]);
    for (const table of ['saves','ingest_batches','events']) await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`,[id]);
    await pool.query('DELETE FROM experiment_data.runs WHERE id=$1',[id]);
  }
  // Login's initial rows can reach SQL before the participant ID is known.
  // Their run gets the ID on the next write; no broad cleanup of unrelated runs occurs.
  await pool.query('DELETE FROM portal_auth."user" WHERE username=$1',[participant]);
  server.close();await once(server,'close');await pool.end();
}
