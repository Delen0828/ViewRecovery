import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium,expect} from '@playwright/test';
import {openDatabase,projectRoot} from '../scripts/lib/postgres.mjs';
import {createServer} from '../server/index.mjs';
import {ingest,hash} from '../server/store.mjs';
import {today,startOfWeek} from '@internationalized/date';
import {DEFAULT_STUDY_SETUP} from '../src/study-setup.js';

const pool=await openDatabase();
const participant='P'+randomUUID().replaceAll('-','').slice(0,8),other='P'+randomUUID().replaceAll('-','').slice(0,8);
const participantName='Avery Lane';
const run={id:randomUUID(),user_id:participant,task:'Motion',run_timestamp:'2026-10-13T14-00-00'};
const requests=[],errors=[];
const adminUsername='portal-browser-admin-'+participant,signupUser='New'+participant;
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
  server=createServer(pool,{portalAuth:{adminUsername,adminPasswordHash:bcrypt.hashSync('browser-test-password',4),participantPasswordHash:'',maxAttempts:100}});
  await server.portalAuthReady;
  await pool.query('UPDATE portal_auth."user" SET name=$1 WHERE username=$2',[participantName,participant]);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1360,height:950}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  const tab=label=>page.getByRole('tab',{name:label,exact:true});
  const ganttRow=id=>page.locator(`.gantt-user-row[data-user-id="${id}"]`);
  const choose=async(label,value)=>{await page.getByRole('button',{name:new RegExp(label)}).click();await page.getByRole('option',{name:value,exact:true}).click();};
  await page.goto(base+'/data-portal/');
  await expect(page.getByRole('heading',{name:'Data Portal',exact:true})).toBeVisible();
  const copyright=await page.locator('.login-page > footer').innerText();
  await page.locator('#username').fill(participant);await page.locator('#password').fill(participant);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toHaveCount(1);
  await expect(page.locator('.portal-topbar').getByRole('button',{name:'Refresh',exact:true})).toBeVisible();
  await expect(page.locator('.portal-footer')).toHaveText(copyright);
  await expect(page.locator('.selected-user-chip')).toHaveCount(0);
  await expect(page.locator('.chart-wrap svg')).toHaveCount(2);
  await expect(page.locator('.stat')).toHaveCount(3);
  await expect(page.locator('.stat-label')).toHaveText(['Sessions completed','Trials completed','Avg. study time']);
  await expect(page.locator('[data-stat=trials] .stat-value')).toHaveText('2');
  await page.locator('.stats-settings summary').click();
  await page.getByRole('checkbox',{name:'Avg. study time',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Avg. accuracy',exact:true}).check();
  await page.getByRole('checkbox',{name:'Cumulated study time',exact:true}).check();
  await page.getByRole('button',{name:'Save cards',exact:true}).click();
  await expect(page.locator('.stat')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('.stat-label')).toHaveText(['Sessions completed','Trials completed','Avg. accuracy','Cumulated study time']);
  await page.locator('.stats-settings summary').click();
  await page.getByRole('checkbox',{name:'Avg. accuracy',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Cumulated study time',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Avg. study time',exact:true}).check();
  await page.getByRole('button',{name:'Save cards',exact:true}).click();
  await expect(page.locator('.stat')).toHaveCount(3);
  await expect(tab('Study Setup')).toBeVisible();await expect(tab('My Progress')).toBeVisible();
  assert.ok(!requests.some(url=>url.includes('/download')));
  mkdirSync(join(projectRoot,'test/results'),{recursive:true});
  await page.screenshot({path:join(projectRoot,'test/results/portal-dashboard-desktop.png'),fullPage:true});
  await tab('Study Setup').click();
  await expect(page.getByRole('heading',{name:'Screen & stimulus',exact:true})).toBeVisible();
  await page.locator('#resWidth').fill('2560');await page.locator('#xOffsetDeg').fill('7');
  await page.getByRole('button',{name:'Save setup',exact:true}).click();
  await expect(page.locator('.notice.success')).toHaveText('Study setup saved.');
  await page.reload();await expect(page.locator('#resWidth')).toHaveValue('2560');
  await expect(page.locator('#xOffsetDeg')).toHaveValue('7');
  const marker=page.locator('[data-position-marker="0"]');
  const before=await marker.getAttribute('cx');const bounds=await marker.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+30,bounds.y+bounds.height/2+15);await page.mouse.up();
  assert.notEqual(await marker.getAttribute('cx'),before);
  await page.screenshot({path:join(projectRoot,'test/results/portal-setup-desktop.png'),fullPage:true});
  await tab('My Progress').click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(page.locator('.chart-wrap svg')).toHaveCount(2);
  await page.getByRole('button',{name:'Unpin Duration across sessions'}).click();
  await tab('Dashboard').click();await expect(page.locator('.chart-wrap svg')).toHaveCount(1);
  await tab('My Progress').click();await page.locator('.chart-panel-accuracy').getByLabel('Motion',{exact:true}).uncheck();
  await expect(page.locator('.trend-point-Motion')).toHaveCount(0);
  await expect(page.locator('.duration-trend-point-Motion')).toHaveCount(2);
  await page.locator('.chart-panel-accuracy').getByLabel('Motion',{exact:true}).check();
  await expect(page.locator('.trend-point-Motion')).toHaveCount(2);
  const newPayload={...payload,trial_index:2,overall_trial_number:2,correct:false,time_elapsed:400};
  assert.equal((await context.request.post(base+'/api/experiment/ingest',{data:{batch_id:randomUUID(),run,events:[{event_sequence:2,included:true,payload:newPayload}]}})).status(),200);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('[data-stat=trials] .stat-value')).toHaveText('3');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await expect(page.locator('.account-avatar')).toBeVisible();
  await page.screenshot({path:join(projectRoot,'test/results/portal-progress-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Log Out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Data Portal',exact:true})).toBeVisible();
  await choose('Login mode','Admin');
  await page.locator('#username').fill(adminUsername);await page.locator('#password').fill('browser-test-password');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Schedule',exact:true})).toBeVisible();
  await expect(page.locator('.gantt-user-row')).toHaveCount(0);
  await expect(page.getByText('No schedules in this date range.',{exact:true})).toBeVisible();
  assert.ok(await page.locator('.gantt-body').evaluate(node=>node.getBoundingClientRect().height>=84));
  const todayDate=today('America/New_York');
  const firstDay=startOfWeek(todayDate,'en-US','sun').subtract({weeks:1});
  assert.deepEqual(await page.locator('.gantt-day').evaluateAll(nodes=>nodes.map(node=>node.dataset.date)),
    Array.from({length:35},(_,index)=>firstDay.add({days:index}).toString()));
  await expect(page.locator('.gantt-week')).toHaveCount(5);
  for (const week of await page.locator('.gantt-week').allTextContents()) assert.match(week.trim(),/^Week \d{1,2}$/);
  assert.ok(await page.locator('.gantt-day').first().evaluate(node=>node.getBoundingClientRect().width<=48));
  const otherSchedule=await context.request.put(base+'/data-portal/api/schedule',{
    headers:{Origin:base}, data:{user_id:other,version:0,sessions:[{
      session_id:randomUUID(),start_date:todayDate.subtract({days:3}).toString(),end_date:todayDate.add({days:3}).toString(),
      scheduled_time:'14:00',duration_minutes:20,session_type:'break',task_type:'Orientation',
    }]},
  });
  assert.equal(otherSchedule.status(),200);
  await page.reload();
  await expect(page.locator('.gantt-user-row')).toHaveCount(1);
  await expect(ganttRow(other).locator('.gantt-bar')).toHaveCount(1);
  await expect(ganttRow(participant)).toHaveCount(0);
  await page.locator('.user-button').filter({hasText:participant}).click();
  await page.getByRole('button',{name:'Add session',exact:true}).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.gantt-day')).toHaveCount(35);
  await expect(page.locator('[data-slot="gantt"]')).toBeVisible();
  await expect(page.locator('.gantt-user-label')).toHaveCount(0);
  await expect(page.locator('.gantt-user-row')).toHaveCount(2);
  await expect(ganttRow(participant).locator('.gantt-bar-name')).toHaveText(participantName);
  assert.equal(await ganttRow(participant).locator('.gantt-bar').evaluate(node=>node.getBoundingClientRect().height),16);
  await page.locator('.session-row input[type=time]').first().fill('09:45');
  await page.locator('.session-row input[type=number]').first().fill('45');
  // End-date input has date segments only; advance by a day to exercise recurrence.
  const endDay=page.locator('.session-row').getByRole('spinbutton',{name:/day, Session 1 ends/});
  await endDay.focus();await endDay.press('ArrowUp');
  await page.getByRole('button',{name:'Save schedule',exact:true}).click();
  await expect(page.locator('.notice.success')).toContainText('Schedule saved.');
  const definition=await (await context.request.get(base+'/data-portal/api/schedule?user_id='+participant)).json();
  assert.equal(definition.sessions.length,1);
  assert.equal(definition.sessions[0].scheduled_time,'09:45:00');
  assert.equal(definition.sessions[0].duration_minutes,45);
  assert.equal(definition.sessions[0].end_date,todayDate.add({days:1}).toString());
  await expect(ganttRow(participant).locator('.gantt-bar')).toHaveAttribute('aria-label',/9:45 AM ET · 45 min daily/);
  // Bars select the owning user and focus the exact session, including unsaved sessions.
  const participantSession=page.locator(`.session-row[data-session-id="${definition.sessions[0].session_id}"]`);
  await ganttRow(other).getByRole('button').click();
  await expect(page.locator('.user-button[aria-pressed="true"]')).toContainText(other);
  await expect(page.locator('.session-row input[type=time]')).toHaveValue('14:00:00');
  await expect(page.locator('.session-row.is-selected')).toBeFocused();
  await expect(page.locator('.session-row.is-selected')).toBeInViewport();
  await ganttRow(participant).getByRole('button').press('Enter');
  await expect(participantSession).toBeFocused();
  await participantSession.locator('input[type=time]').fill('10:00');
  await ganttRow(participant).getByRole('button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(participantSession).toBeFocused();
  await expect(participantSession.locator('input[type=time]')).toHaveValue('10:00');
  await ganttRow(other).getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.locator('.user-button[aria-pressed="true"]')).toContainText(participant);
  await expect(participantSession.locator('input[type=time]')).toHaveValue('10:00');
  await ganttRow(other).getByRole('button').click();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(page.locator('.user-button[aria-pressed="true"]')).toContainText(other);
  await expect(page.locator('.session-row.is-selected')).toBeFocused();
  await ganttRow(participant).getByRole('button').press('Space');
  await expect(participantSession).toBeFocused();
  await expect(participantSession.locator('input[type=time]')).toHaveValue('09:45:00');
  assert.equal(await page.locator('.session-row').getByRole('spinbutton',{name:/hour|minute|AM\/PM/}).count(),0);
  const layout=await page.evaluate(()=>{
    const preview=document.querySelector('.schedule-preview').getBoundingClientRect();
    const users=document.querySelector('.schedule-layout .user-sidebar').getBoundingClientRect();
    const sessions=document.querySelector('.schedule-sessions').getBoundingClientRect();
    return {preview:preview.toJSON(),users:users.toJSON(),sessions:sessions.toJSON()};
  });
  assert.ok(Math.abs(layout.users.height-layout.sessions.height)<2);
  assert.ok(Math.abs(layout.users.top-layout.sessions.top)<2);
  assert.ok(Math.abs(layout.preview.left-layout.users.left)<2);
  assert.ok(Math.abs(layout.preview.right-layout.sessions.right)<2);
  assert.ok(layout.preview.bottom<layout.users.top);
  assert.ok(await page.locator('.gantt-scroll').evaluate(node=>node.scrollWidth>node.clientWidth));
  await page.locator('.gantt-scroll').evaluate(node=>node.scrollLeft=node.scrollWidth);
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect.poll(()=>page.locator('.gantt-scroll').evaluate(node=>{const today=node.querySelector('.is-today').getBoundingClientRect(),bounds=node.getBoundingClientRect();return today.left>=bounds.left&&today.right<=bounds.right;})).toBe(true);
  await expect(ganttRow(other).locator('.gantt-bar-name')).toBeInViewport();
  await expect.poll(()=>page.locator('.user-list').evaluate(node=>{const item=node.querySelector('[aria-pressed=true]').getBoundingClientRect(),bounds=node.getBoundingClientRect();return item.top>=bounds.top&&item.bottom<=bounds.bottom;})).toBe(true);
  await page.getByRole('button',{name:'Next five weeks',exact:true}).click();
  await expect(page.locator('.gantt-day').first()).toHaveAttribute('data-date',firstDay.add({weeks:5}).toString());
  await expect(page.locator('.gantt-user-row')).toHaveCount(0);
  await expect(page.getByText('No schedules in this date range.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Previous five weeks',exact:true}).click();
  await expect(page.locator('.gantt-day').first()).toHaveAttribute('data-date',firstDay.toString());
  await page.getByRole('button',{name:'Previous five weeks',exact:true}).click();
  await expect(page.locator('.gantt-day').first()).toHaveAttribute('data-date',firstDay.subtract({weeks:5}).toString());
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(ganttRow(participant).locator('.gantt-bar')).toHaveCount(1);
  await page.screenshot({path:join(projectRoot,'test/results/portal-schedule-desktop.png'),fullPage:true});
  await page.reload();
  await page.locator('.user-button').filter({hasText:participant}).click();
  await expect(page.locator('.session-row input[type=time]').first()).toHaveValue('09:45:00');
  await expect(page.locator('.session-row input[type=number]').first()).toHaveValue('45');
  await page.locator('.user-button').filter({hasText:other}).click();
  await expect(page.locator('.session-row input[type=time]').first()).toHaveValue('14:00:00');
  await expect(page.locator('.gantt-user-row')).toHaveCount(2);
  await page.locator('.user-button').filter({hasText:participant}).click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await expect.poll(()=>page.locator('.gantt-scroll').evaluate(node=>{const today=node.querySelector('.is-today').getBoundingClientRect(),bounds=node.getBoundingClientRect();return today.left>=bounds.left&&today.right<=bounds.right;})).toBe(true);
  await page.screenshot({path:join(projectRoot,'test/results/portal-schedule-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await tab('Data Analytics').click();await expect(page.locator('.chart-wrap svg')).toHaveCount(4);
  await expect(page.getByRole('switch',{name:'Advanced charts'})).toHaveCount(0);
  await expect(page.locator('.chart-difficulty-duration svg')).toBeVisible();
  // Interleaved, unordered absolute indices must align by rank within each task.
  const trendsRoute=base+'/data-portal/api/user-trends';
  await page.route(trendsRoute,async route=>{
    const response=await route.fetch(),data=await response.json();
    for (const field of ['accuracy_series','duration_series','difficulty_series']) {
      const points=data[field].filter(point=>point.userId===participant);
      const names=[...new Set(points.map(point=>point.fileName))];
      data[field]=data[field].filter(point=>point.userId!==participant).concat(
        points.map(point=>({...point,sessionIndex:names.indexOf(point.fileName)===0?7:2})),
        points.map(point=>({...point,task:'Centrality',fileName:'centrality-'+point.fileName,
          sessionIndex:names.indexOf(point.fileName)===0?6:1})),
      );
    }
    await route.fulfill({response,json:data});
  });
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.trend-point-Centrality')).toHaveCount(2);
  for (const chart of ['accuracy','duration']) {
    const root=page.locator(`.chart-${chart}`);
    await expect(root.locator('.session-tick-label')).toHaveText(['1st session','2nd session']);
    const positions=await root.locator('circle').evaluateAll(nodes=>nodes.map(node=>({task:node.parentNode.getAttribute('class'),x:node.getAttribute('cx'),index:node.parentNode.__data__.sessionIndex})));
    const motion=positions.filter(point=>point.task.includes('Motion'));
    const centrality=positions.filter(point=>point.task.includes('Centrality'));
    assert.deepEqual(motion.map(point=>point.index),[2,7]);
    assert.deepEqual(centrality.map(point=>point.index),[1,6]);
    assert.deepEqual(motion.map(point=>point.x),centrality.map(point=>point.x));
  }
  await expect(page.locator('.chart-duration .axis').last().locator('.tick text')).toHaveText(['0s','5m','10m','15m','20m','25m','30m']);
  await expect(page.locator('.chart-difficulty-duration .axis').last().locator('.tick text')).toHaveText(['0s','2s','4s','6s','8s','10s']);
  const accuracyDifficulty=page.locator('.chart-difficulty');
  const durationDifficulty=page.locator('.chart-difficulty-duration');
  await accuracyDifficulty.locator('.date-legend-item').first().hover();
  await expect(accuracyDifficulty.locator('.difficulty-date-series[display=none]')).toHaveCount(0);
  await accuracyDifficulty.getByRole('checkbox').first().uncheck();
  await expect(accuracyDifficulty.locator('.difficulty-date-series[display=none]')).toHaveCount(1);
  await expect(durationDifficulty.locator('.duration-date-series[display=none]')).toHaveCount(0);
  await page.setViewportSize({width:1380,height:1000});
  await expect(accuracyDifficulty.getByRole('checkbox').first()).not.toBeChecked();
  await expect(accuracyDifficulty.locator('.difficulty-date-series[display=none]')).toHaveCount(1);
  await durationDifficulty.getByRole('checkbox').last().focus();
  await page.keyboard.press('Space');
  await expect(durationDifficulty.locator('.duration-date-series[display=none]')).toHaveCount(1);
  await expect(durationDifficulty.getByRole('checkbox').last()).toBeFocused();
  await choose('Accuracy by difficulty task','Centrality');
  await expect(accuracyDifficulty.locator('svg')).toHaveAttribute('aria-label','Centrality accuracy by difficulty level across sessions');
  await expect(durationDifficulty.locator('svg')).toHaveAttribute('aria-label','Motion average duration by difficulty level across sessions');
  await choose('Accuracy by difficulty task','Motion');
  await expect(accuracyDifficulty.getByRole('checkbox').first()).not.toBeChecked();
  await page.locator('.chart-panel-accuracy').getByLabel('Centrality',{exact:true}).uncheck();
  await expect(page.locator('.trend-point-Centrality')).toHaveCount(0);
  await expect(page.locator('.duration-trend-point-Centrality')).toHaveCount(2);
  await page.locator('.chart-panel-accuracy').getByLabel('Centrality',{exact:true}).check();
  await page.screenshot({path:join(projectRoot,'test/results/portal-analytics-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:join(projectRoot,'test/results/portal-analytics-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.unroute(trendsRoute);
  await tab('File Download').click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('columnheader',{name:'Session ID',exact:true})).toHaveCount(0);
  await expect(page.getByRole('columnheader',{name:'Rows',exact:true})).toHaveCount(0);
  await expect(page.getByRole('columnheader',{name:'Sanity check accuracy',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toHaveCount(1);
  await expect(page.locator('.file-duration-track')).toHaveCount(1);
  await expect(page.locator('.table-actions a').first()).toHaveText('Download');
  assert.ok(!(await page.locator('table').innerText()).includes('.csv'));
  await page.getByLabel('Include session files').check();await expect(page.locator('tbody tr')).toHaveCount(2);
  const active=page.locator('tbody tr').filter({has:page.getByLabel(`Preview session ${run.id}`,{exact:true})});
  const sanityEvent={...payload,overall_trial_number:3,trial_category:'fixation_catch_response',time_elapsed:500};
  const breakEvent={user_id:participant,task_type:'Motion',trial_category:'scheduled_break',time_elapsed:600};
  assert.equal((await context.request.post(base+'/api/experiment/ingest',{data:{batch_id:randomUUID(),run,events:[
    {event_sequence:3,included:true,payload:sanityEvent},
    {event_sequence:4,included:true,payload:breakEvent},
  ]}})).status(),200);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByLabel('Include session files')).toBeChecked();
  await expect(active.getByLabel('Sanity check accuracy: 100%, 1 of 1 passed')).toBeVisible();
  assert.ok(await active.locator('.file-duration-training').evaluate(node=>node.getBoundingClientRect().width>0));
  assert.ok(await active.locator('.file-duration-break').evaluate(node=>node.getBoundingClientRect().width>0));
  assert.equal(await active.locator('button.file-action').evaluate(node=>getComputedStyle(node).backgroundColor),
    await active.locator('a.file-action').evaluate(node=>getComputedStyle(node).backgroundColor));
  await active.getByRole('button',{name:/Preview session/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.preview-metrics')).toContainText('50%');
  await expect(page.getByRole('dialog').locator('.chart-wrap svg')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).last().click();
  await page.locator('[data-slot="wrapper"]:has(.preview-metrics)').waitFor({state:'detached'});
  assert.ok(!requests.some(url=>url.includes('/download')));
  const archived=page.locator('tbody tr').filter({has:page.getByLabel(/^Preview session source:/)});
  const download=await context.request.get(base+await archived.getByLabel(/Download session/).getAttribute('href'));
  assert.equal(download.status(),200);assert.deepEqual(await download.body(),bytes);
  await page.screenshot({path:join(projectRoot,'test/results/portal-files-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:join(projectRoot,'test/results/portal-files-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await tab('Manage Users').click();
  await page.locator('.user-button').filter({hasText:participant}).click();
  const studyParameters=page.getByRole('region',{name:'Study parameters',exact:true});
  const setupField=key=>key==='viewingDistance'
    ? studyParameters.getByLabel('Viewing distance',{exact:true}) : studyParameters.locator('#'+key);
  await expect(studyParameters.getByRole('heading',{name:'Screen & stimulus',exact:true})).toBeVisible();
  await expect(page.locator('#resWidth')).toHaveValue('2560');
  await expect(page.locator('#xOffsetDeg')).toHaveValue('7');
  const adminSetup={...DEFAULT_STUDY_SETUP,task:'Bar',resWidth:2560,resHeight:1440,
    screenWidth:60,screenHeight:34,viewingDistance:65,xOffsetDeg:6.5,yOffsetDeg:-3.5};
  await choose('Task','Bar');
  for (const [key,value] of Object.entries(adminSetup))
    if (key!=='task') await setupField(key).fill(String(value));
  await expect(studyParameters.locator('[data-position-marker]')).toHaveCount(2);
  await page.locator('#screenWidth').fill('0');
  await expect(studyParameters.getByRole('button',{name:'Save setup',exact:true})).toBeDisabled();
  await page.locator('#screenWidth').fill(String(adminSetup.screenWidth));
  await page.locator('.account-form').getByLabel('User ID',{exact:true}).fill('Renamed'+participant);
  await page.getByRole('button',{name:'Save account'}).click();
  await expect(page.locator('.account-form .notice.error')).toHaveText('Save study parameters before changing the User ID.');
  await page.locator('.account-form').getByLabel('User ID',{exact:true}).fill(participant);
  await page.getByLabel('New password',{exact:true}).fill('changed-password');await page.getByRole('button',{name:'Save account'}).click();
  await expect(page.locator('.account-form .notice.success')).toHaveText('Account updated.');
  // Saving account access must preserve unsaved study parameters and their guard.
  await page.locator('.user-button').filter({hasText:other}).click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(setupField('viewingDistance')).toHaveValue('65');
  await page.getByLabel('New password',{exact:true}).fill('draft-password');
  await studyParameters.getByRole('button',{name:'Save setup',exact:true}).click();
  await expect(studyParameters.locator('.notice.success')).toHaveText('Study setup saved.');
  const savedPreferences=await (await context.request.get(base+'/data-portal/api/preferences?user_id='+participant)).json();
  assert.equal(savedPreferences.user_id,participant);
  assert.equal(savedPreferences.setup_saved,true);
  assert.deepEqual(savedPreferences.setup,adminSetup);
  // Saving parameters must still guard unsaved account edits.
  await page.locator('.user-button').filter({hasText:other}).click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('New password',{exact:true}).fill('');
  await expect(page.getByLabel('New password',{exact:true})).toHaveValue('');
  await expect(page.getByRole('button',{name:'Save account'})).toBeDisabled();
  await page.locator('.user-button').filter({hasText:other}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#resWidth')).toHaveValue(String(DEFAULT_STUDY_SETUP.resWidth));
  assert.deepEqual((await (await context.request.get(base+'/data-portal/api/preferences?user_id='+other)).json()).setup,DEFAULT_STUDY_SETUP);
  await page.locator('#resWidth').fill('2000');
  await studyParameters.getByRole('button',{name:'Reset setup to defaults',exact:true}).click();
  await expect(page.locator('#resWidth')).toHaveValue(String(DEFAULT_STUDY_SETUP.resWidth));
  await page.locator('.user-button').filter({hasText:participant}).click();
  await expect(setupField('viewingDistance')).toHaveValue('65');
  await page.reload();
  await page.locator('.user-button').filter({hasText:participant}).click();
  for (const [key,value] of Object.entries(adminSetup))
    if (key!=='task') await expect(setupField(key)).toHaveValue(String(value));
  await expect(studyParameters.locator('[data-position-marker]')).toHaveCount(2);
  await page.screenshot({path:join(projectRoot,'test/results/portal-admin-study-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:join(projectRoot,'test/results/portal-admin-study-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Add user',exact:true}).click();
  await page.getByRole('dialog').getByLabel('User ID',{exact:true}).fill(signupUser);
  await page.getByRole('dialog').getByLabel('Password',{exact:true}).fill('signup-password');
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.account-form').getByLabel('User ID',{exact:true})).toHaveValue(signupUser);
  await page.getByRole('button',{name:'Delete user',exact:true}).click();await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.user-button').filter({hasText:signupUser})).toHaveCount(0);
  await page.locator('.user-button').filter({hasText:other}).click();
  await page.getByRole('button',{name:'Delete user',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Also delete recorded experiment data'})).not.toBeChecked();
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.user-button').filter({hasText:other}).click();
  await expect(page.getByRole('heading',{name:'Recorded data',exact:true})).toBeVisible();
  await expect(studyParameters).toHaveCount(0);
  await page.getByRole('button',{name:'Delete user',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Also delete recorded experiment data'})).toHaveCount(0);
  await page.getByRole('button',{name:'Delete user and data',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.user-button').filter({hasText:other})).toHaveCount(0);
  await expect(page.locator('.account-form').getByLabel('User ID',{exact:true})).not.toHaveValue(other);
  await expect(page.locator('.user-button[aria-pressed="true"]')).toHaveCount(1);
  const palette=[['Motion','rgb(37, 99, 235)'],['Orientation','rgb(5, 150, 105)'],
    ['Centrality','rgb(217, 119, 6)'],['Bar','rgb(124, 58, 237)'],['Break','rgb(124, 135, 153)']];
  const colorSchedule=await context.request.put(base+'/data-portal/api/schedule',{
    headers:{Origin:base},data:{user_id:participant,version:definition.version,sessions:[...definition.sessions,
      ...['Orientation','Centrality','Bar','Break'].map((task,index)=>({
        session_id:randomUUID(),start_date:todayDate.toString(),end_date:todayDate.toString(),
        scheduled_time:`${11+index}:00`,duration_minutes:20,
        session_type:task==='Break'?'break':'study',task_type:task==='Break'?'Motion':task,
      })),
    ]},
  });
  assert.equal(colorSchedule.status(),200);
  const colorDefinition=await colorSchedule.json();
  await tab('Schedule').click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(ganttRow(participant).locator('.gantt-bar')).toHaveCount(5);
  for (const [task,color] of palette) {
    const bar=task==='Break'?ganttRow(participant).locator('.gantt-bar.break'):
      ganttRow(participant).locator(`.gantt-bar[aria-label*="${task} Study"]`);
    await expect(bar).toHaveCSS('color',color);
  }
  const barSession=colorDefinition.sessions.find(row=>row.task_type==='Bar');
  await ganttRow(participant).getByRole('button',{name:/Bar Study/}).press('Enter');
  await expect(page.locator(`.session-row[data-session-id="${barSession.session_id}"]`)).toBeFocused();
  await expect(page.locator('.session-row.is-selected')).toHaveCount(1);
  await page.screenshot({path:join(projectRoot,'test/results/portal-schedule-task-colors.png'),fullPage:true});
  await page.getByRole('button',{name:'Log Out',exact:true}).click();
  // Recheck participant synchronization and new password after admin edits.
  await page.locator('#username').fill(participant);await page.locator('#password').fill('changed-password');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.locator('.agenda-item')).toHaveCount(5);
  const participantPreferences=await (await context.request.get(base+'/data-portal/api/preferences')).json();
  assert.deepEqual(participantPreferences.setup,adminSetup);
  await tab('Study Setup').click();
  await expect(page.getByLabel('Viewing distance',{exact:true})).toHaveValue('65');
  await expect(page.locator('#xOffsetDeg')).toHaveValue('6.5');
  await tab('Dashboard').click();
  const dots=page.locator('.agenda-item .session-dot');
  for (const [index,[,color]] of palette.entries()) await expect(dots.nth(index)).toHaveCSS('background-color',color);
  const selectedDay=page.locator('.portal-calendar-day[data-selected="true"]');
  const calendarMarker=await selectedDay.evaluate(node=>{
    const style=getComputedStyle(node,'::after');
    return {colors:style.backgroundImage,width:style.width};
  });
  for (const [,color] of palette) assert.ok(calendarMarker.colors.includes(color),`Calendar marker missing ${color}`);
  assert.equal(calendarMarker.width,'24px');
  await page.screenshot({path:join(projectRoot,'test/results/portal-calendar-task-colors.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Log Out',exact:true}).click();
  await page.getByRole('button',{name:'Create User Account',exact:true}).click();
  await page.getByLabel('User ID',{exact:true}).fill(signupUser);await page.getByLabel('Email',{exact:true}).fill(signupUser+'@example.com');
  await page.getByLabel('Password',{exact:true}).fill('signup-password');await page.getByLabel('Invitation code',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Create Account',exact:true}).click();await expect(page.locator('.notice.error')).toHaveText('Invalid invitation code.');
  await page.getByLabel('Invitation code',{exact:true}).fill('bright');await page.getByRole('button',{name:'Create Account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.locator('.dashboard-calendar')).toBeVisible();
  assert.equal((await pool.query('SELECT role,"emailVerified" FROM portal_auth."user" WHERE username=$1',[signupUser])).rows[0].emailVerified,false);
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(base)));
  console.log('Portal browser passed: role panels, banner refresh, saved setup and drag preview, chart filters/pins, live SQL progress, daily scheduling sync and ReUI Gantt user/session navigation with keyboard and unsaved-change guards, all analytics charts, duration/break bars, sanity check accuracy, preview/download, account and data-only deletion, invitation signup, desktop/mobile layout.');
} catch(error) {
  const failedPage=context?.pages()[0];
  if(failedPage) {
    await failedPage.screenshot({path:join(projectRoot,'test/results/portal-failure.png'),fullPage:true});
    writeFileSync(join(projectRoot,'test/results/portal-failure.html'),await failedPage.content());
  }
  throw error;
} finally {
  await browser?.close();
  if (server) {server.close();await once(server,'close');}
  for (const table of ['ingest_batches','events']) await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`,[run.id]);
  await pool.query('DELETE FROM experiment_data.runs WHERE id=$1',[run.id]);
  if (jobId) {
    await pool.query('DELETE FROM experiment_data.source_rows WHERE source_file_id IN (SELECT id FROM experiment_data.source_files WHERE import_job_id=$1)',[jobId]);
    await pool.query('DELETE FROM experiment_data.source_files WHERE import_job_id=$1',[jobId]);
    await pool.query('DELETE FROM experiment_data.import_jobs WHERE id=$1',[jobId]);
  }
  await pool.query('DELETE FROM portal_auth."user" WHERE username=ANY($1)',[[participant,other,signupUser,adminUsername]]);
  await pool.query('DELETE FROM experiment_data.portal_retired_users WHERE user_id=ANY($1)',[[participant,other,signupUser]]);
  await pool.end();
}
