import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {mock} from './fixtures/portal.mjs';
async function shot(page,name) {fs.mkdirSync('test/results/navigation-screenshots',{recursive:true});await page.screenshot({path:`test/results/navigation-screenshots/${name}.png`,fullPage:!name.includes('experiment')});}
test('file overview restores summaries, catch pass rates, filters, pagination and safe standalone previews',async({page})=>{
 await mock(page,{count:28,role:'admin'});await page.setViewportSize({width:1440,height:1000});await page.goto('/data-portal/');
 await expect(page.locator('#file-rows tr')).toHaveCount(25);await expect(page.locator('[data-pass="0"]')).toHaveText('100.0% (1/1)');
 await shot(page,'file-overview');await page.getByRole('button',{name:'Next files'}).click();await expect(page.locator('#file-rows tr')).toHaveCount(3);
 await page.getByLabel('Filename search').fill('Centrality');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#file-rows tr')).toHaveCount(14);
 await page.getByLabel('Created from').fill('2026-10-20');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#file-rows tr')).toHaveCount(5);
 await page.goto('/data-portal/preview.html?file=file-0');await expect(page.getByText('Original file checksum verified.')).toBeVisible();
 await expect(page.getByRole('img',{name:'Accuracy by difficulty'})).toBeVisible();await page.getByRole('button',{name:'Next rows'}).click();
 await expect(page.locator('.raw-cell').filter({hasText:'<script>alert(1)</script>'})).toBeVisible();await expect(page.locator('#file-preview script')).toHaveCount(0);await shot(page,'file-preview');
});
test('user overview renders all legacy chart types and interactive task/session selections',async({page})=>{
 await mock(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/data-portal/users.html');
 await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');await expect(page.locator('#trend-charts svg')).toHaveCount(5);
 const cards=page.locator('#trend-charts .chart-card'),first=await cards.nth(0).boundingBox(),second=await cards.nth(1).boundingBox();
 expect(first.y).toBe(second.y);expect(second.x).toBeGreaterThan(first.x+first.width);
 const duration=page.getByRole('img',{name:'Training time across sessions'});
 await expect(duration).toBeVisible();await expect(duration).not.toContainText(/resting/i);
 // Fixture sessions contain 61 seconds of training and 60 seconds of rest.
 await expect(duration.locator('[data-series="Motion"] circle title').first()).toContainText('1.0');
 for(const index of [0,1,2]) {
  expect(await cards.nth(index).locator('circle').evaluateAll(points=>points.every(p=>p.getAttribute('fill-opacity')==='1'))).toBe(true);
  expect(await cards.nth(index).locator('[data-series]>g').evaluateAll(groups=>groups.every(g=>g.getAttribute('opacity')==='1'))).toBe(true);
  expect(await cards.nth(index).locator('[data-series] line').evaluateAll(lines=>lines.every(line=>line.getAttribute('stroke-opacity')==='1'))).toBe(true);
 }
 const taskLegend=cards.nth(0).getByRole('button',{name:'Motion',exact:true});await taskLegend.click();
 await expect(cards.nth(0).locator('[data-series="Motion"]')).toBeVisible();
 await expect(cards.nth(0).locator('[data-series="Centrality"]')).toBeHidden();
 await expect(cards.nth(0).locator('[data-series]:not([hidden])')).toHaveCount(1);
 await expect(cards.nth(0).getByRole('button',{name:'Centrality',exact:true})).toBeVisible();
 await expect(cards.nth(0).getByRole('button',{name:'Centrality',exact:true}).locator('span')).toHaveCSS('background-color','rgb(217, 119, 6)');
 await taskLegend.click();await expect(cards.nth(0).locator('[data-series="Centrality"]')).toBeVisible();
 await expect(page.locator('#overview-table')).toContainText('240');await page.getByLabel('Difficulty task').selectOption('Centrality');
 await expect(page.getByRole('heading',{name:'Centrality: time by difficulty across sessions'})).toBeVisible();
 for(const index of [3,4]) {
  const series=cards.nth(index).locator('[data-series]');
  expect(await series.evaluateAll(groups=>groups.map(g=>getComputedStyle(g).color))).toEqual(['rgb(217, 119, 6)','rgb(217, 119, 6)']);
  await expect(series.first().locator('g')).toHaveAttribute('opacity','0.35');await expect(series.last().locator('g')).toHaveAttribute('opacity','1');
 }
 const legendAppearance=()=>cards.nth(3).locator('[data-highlight]').evaluateAll(buttons=>buttons.map(b=>{
  const box=getComputedStyle(b),swatch=getComputedStyle(b.querySelector('span'));
  return {color:box.color,background:box.backgroundColor,opacity:box.opacity,filter:box.filter,swatchColor:swatch.backgroundColor,swatchOpacity:swatch.opacity};
 }));
 const appearance=await legendAppearance();
 const legend=cards.nth(3).getByRole('button').first();await legend.click();await expect(legend).toHaveAttribute('aria-pressed','true');
 const old=cards.nth(3).locator('[data-series^="Session 2 "]'),recent=cards.nth(3).locator('[data-series^="Session 4 "]'),recentLegend=cards.nth(3).getByRole('button').last();
 await expect(old).toBeVisible();await expect(old.locator('g')).toHaveAttribute('opacity','0.35');
 await expect(recent).toBeHidden();await expect(recent.locator('g')).toHaveAttribute('opacity','1');
 await expect(cards.nth(3).locator('[data-series]:not([hidden])')).toHaveCount(1);
 expect(await legendAppearance()).toEqual(appearance);
 await shot(page,'user-trends-selected');await recentLegend.click();
 await expect(old).toBeHidden();await expect(old.locator('g')).toHaveAttribute('opacity','0.35');
 await expect(recent).toBeVisible();await expect(recentLegend).toHaveAttribute('aria-pressed','true');
 await expect(legend).toHaveAttribute('aria-pressed','false');expect(await legendAppearance()).toEqual(appearance);
 await recentLegend.click();await expect(old).toBeVisible();await expect(recent).toBeVisible();
 await expect(recentLegend).toHaveAttribute('aria-pressed','false');expect(await legendAppearance()).toEqual(appearance);
 await expect(old.locator('g')).toHaveAttribute('opacity','0.35');
 await shot(page,'user-trends');await page.getByLabel('Motion',{exact:true}).uncheck();await expect(page.locator('#trend-summary')).toContainText('120');
});
test('overview and file metrics use SQL values without requesting Storage or raw events',async({page})=>{
 const saved=await mock(page,{role:'admin'});
 // SQL values intentionally differ from the CSV, proving charts use the SQL result.
 saved.manifest[0].metrics.meanDifficulty=7;saved.manifest[0].metrics.correct=0;
 saved.manifest[0].metrics.levels.forEach(level=>level.accuracy=0);
 await page.route('**/storage/v1/**',route=>route.abort());
 await page.route('**/rest/v1/experiment_events?**',route=>route.abort());
 await page.goto('/dashboard');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');
 await expect(page.getByRole('img',{name:'Motion: difficulty across sessions'}).locator('circle title').first()).toContainText('7');
 expect(saved.requests.filter(r=>r.resource==='portal_sessions')).toHaveLength(1);
 expect(saved.requests.filter(r=>['storage','portal_artifacts','experiment_events'].includes(r.resource))).toHaveLength(0);
 await page.goto('/data-portal/');await expect(page.locator('[data-pass="0"]')).toHaveText('100.0% (1/1)');
 expect(saved.requests.filter(r=>r.resource==='storage')).toHaveLength(0);
 expect(saved.requests.filter(r=>r.resource==='portal_artifacts')).toHaveLength(1);
});
test('missing SQL summaries report incomplete results without falling back to CSVs',async({page})=>{
 const saved=await mock(page,{count:6});saved.manifest[0].metrics=null;
 await page.route('**/storage/v1/**',route=>route.abort());
 await page.goto('/data-portal/users.html');
 await expect(page.locator('#trend-status')).toHaveText('1 session summaries are unavailable. Charts show 5 sessions; results are incomplete.');
 await expect(page.locator('#trend-progress')).toHaveAttribute('value','6');
 await expect(page.locator('#trend-loading')).toBeHidden();
 expect(saved.requests.filter(r=>r.resource==='storage')).toHaveLength(0);
});
test('SQL summary pagination reports progress and retains all sessions',async({page})=>{
 const saved=await mock(page,{count:501});let release;
 await page.route('**/rest/v1/portal_sessions?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('offset')!=='500')return route.fallback();
  await new Promise(resolve=>release=resolve);await route.fallback();
 });
 await page.goto('/data-portal/users.html');
 const progress=page.locator('#trend-progress');
 await expect(progress).toBeVisible();await expect(progress).toHaveAttribute('value','500');await expect(progress).toHaveAttribute('max','501');
 await expect(page.locator('#trend-progress-detail')).toHaveText('500 / 501 sessions · 99%');
 release();await expect(page.locator('#trend-status')).toHaveText('501 sessions loaded.');
 await expect(page.locator('#trend-loading')).toBeHidden();expect(saved.requests.filter(r=>r.resource==='portal_sessions')).toHaveLength(2);
});
test('source changes cancel obsolete SQL loads and failed reads clear progress',async({page})=>{
 const saved=await mock(page);
 saved.runs.push(...Array.from({length:3},(_,i)=>({id:`recorded-${i}`,participant_id:'20000000-0000-0000-0000-000000000001',task:'Motion',status:'complete',started_at:`2026-10-0${i+1}T14:30:00Z`,parameter_snapshot:{}})));
 const pending=[];
 await page.route('**/rest/v1/portal_sessions?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('source')!=='eq.recorded')return route.fallback();
  const fail=await new Promise(resolve=>pending.push(resolve));
  if(fail)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Fixture summary read failed'})}).catch(()=>{});
  await route.fallback().catch(()=>{});
 });
 await page.goto('/data-portal/users.html');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');
 await page.getByLabel('Results source').selectOption('recorded');await expect(page.locator('#trend-progress')).toHaveAttribute('value','0');
 await expect.poll(()=>pending.length).toBe(1);pending.shift()(false);
 await expect(page.locator('#trend-status')).toHaveText('3 sessions loaded.');
 await page.getByLabel('Results source').selectOption('historical');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');
 await page.getByLabel('Results source').selectOption('recorded');await expect.poll(()=>pending.length).toBe(1);
 await page.getByLabel('Results source').selectOption('historical');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');pending.shift()(false);
 await page.getByLabel('Difficulty task').selectOption('Centrality');await expect(page.locator('#overview-table')).toContainText('240');
 await page.getByLabel('Results source').selectOption('recorded');await expect.poll(()=>pending.length).toBe(1);pending.shift()(true);
 await expect(page.locator('#trend-status')).toHaveText('Could not load session summaries.');await expect(page.locator('#trend-loading')).toBeHidden();
});
test('personal configuration saves to Supabase, reloads, validates geometry and starts the legacy task using its snapshot',async({page})=>{
 const saved=await mock(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/Motion');
 await page.getByLabel('Visible screen width (cm)').fill('47.6');await page.getByLabel('Visible screen height (cm)').fill('26.8');await page.getByLabel('Viewing distance (cm)').fill('50');
 await page.getByLabel('X offset (degrees)').fill('4');await page.getByLabel('Y offset (degrees)').fill('4');
 await page.getByLabel('I measured this display', {exact:false}).check();await shot(page,'training-configuration');await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Save configuration',exact:true}).click();
 await expect(page.locator('#training-status')).toContainText('Configuration saved');expect(saved.calls[0].display.fullscreen).toBe(true);
 await page.reload();await expect(page.getByLabel('Visible screen width (cm)')).toHaveValue('47.6');await expect(page.getByLabel('X offset (degrees)')).toHaveValue('4');
 await page.getByLabel('X offset (degrees)').fill('79');await expect(page.locator('#geometry-readout')).toContainText('offscreen');await page.getByLabel('I measured this display',{exact:false}).check();
 await page.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(page.locator('#training-status')).toContainText('offscreen');expect(saved.calls).toHaveLength(1);
 await page.getByLabel('X offset (degrees)').fill('4');await page.getByLabel('I measured this display',{exact:false}).check();await page.getByRole('button',{name:'Confirm and start training'}).click();
 await expect(page.locator('#jspsych-content')).toContainText('Please click');await shot(page,'experiment-start');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 // Advance instructions to the first real stimulus, keeping renderer/timing intact.
 for(let i=0;i<10;i++) {
  const ready=page.locator('.ready-title');if(await ready.count())break;
  const button=page.locator('#jspsych-content button').first();if(await button.count())await button.click();else await page.keyboard.press('Space');
  await page.waitForTimeout(150);
 }
 await expect(page.locator('.ready-title')).toHaveText('Ready?');await page.keyboard.press('Space');
 await expect(page.locator('#stimulus')).toBeVisible();await page.waitForTimeout(1050);await shot(page,'experiment-stimulus');
 await page.waitForTimeout(850);await page.keyboard.press('ArrowUp');await page.waitForTimeout(1400);
 await expect.poll(()=>saved.uploads.flatMap(b=>b.events).some(event=>typeof event.payload.correct==='boolean')).toBe(true);
 expect(saved.runs[0].parameter_snapshot.training.x_deg).toBe(4);expect(errors).toEqual([]);
});
test('portal and configuration fit mobile viewports',async({page})=>{
 await mock(page);await page.setViewportSize({width:390,height:844});await page.goto('/Motion');
 await expect(page.getByRole('heading',{name:'Personalized training configuration'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,'mobile-training');
 await page.goto('/data-portal/users.html');await expect(page.locator('#trend-status')).toHaveText('4 sessions loaded.');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,'mobile-trends');
 const cards=page.locator('#trend-charts .chart-card'),first=await cards.nth(0).boundingBox(),second=await cards.nth(1).boundingBox();
 expect(second.x).toBe(first.x);expect(second.y).toBeGreaterThan(first.y+first.height);
});
