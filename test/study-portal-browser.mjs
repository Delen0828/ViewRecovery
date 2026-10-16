import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium, expect} from '@playwright/test';
import {openDatabase, projectRoot} from '../scripts/lib/postgres.mjs';
import {createServer} from '../server/index.mjs';
import {portalClient} from './portal-auth-client.mjs';
import {DEFAULT_STUDY_SETUP, STUDY_TASKS, studyCalibration} from '../src/study-setup.js';

const pool = await openDatabase();
const suffix = randomUUID().replaceAll('-', '');
const participant = 'S' + suffix.slice(0, 31), other = 'T' + suffix.slice(0, 8);
const adminId = 'study-browser-admin-' + suffix;
const setup = {...DEFAULT_STUDY_SETUP, task: 'Orientation', resWidth: 2560, resHeight: 1440,
  screenWidth: 60, screenHeight: 34, viewingDistance: 65, xOffsetDeg: 7.2, yOffsetDeg: -2.3};
const rows = [], errors = [];
let server, browser;

async function openId(page, url) {
  await page.goto(url);
  await page.getByRole('button', {name: 'Enter Fullscreen & Continue'}).click();
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect(page.locator('#user-id-input')).toBeVisible();
}

async function verifySetup(page, value) {
  for (const [id, key] of Object.entries({
    'resolution-width': 'resWidth', 'resolution-height': 'resHeight',
    'screen-width': 'screenWidth', 'screen-height': 'screenHeight',
    'viewing-distance': 'viewingDistance', 'stimulus-x-offset': 'xOffsetDeg', 'stimulus-y-offset': 'yOffsetDeg'
  })) await expect(page.locator('#' + id)).toHaveValue(String(value[key]));
  const calibration = studyCalibration(value);
  await expect(page.locator('#stimulus-position-readout')).toHaveText(
    `x ${calibration.xOffsetPx.toFixed(1)} px, y ${calibration.yOffsetPx.toFixed(1)} px`);
}

try {
  server = createServer(pool, {portalAuth: {adminUsername: adminId,
    adminPasswordHash: bcrypt.hashSync('study-admin-password', 4), maxAttempts: 100}});
  await server.portalAuthReady;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = portalClient(base), user = portalClient(base);
  assert.equal((await admin.login(adminId, 'study-admin-password', 'admin')).response.status, 200);
  const mutate = async (client, path, method, data) => {
    const response = await client.api(path, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  for (const user_id of [participant, other])
    await mutate(admin, '/data-portal/api/users', 'POST', {user_id, password: 'study-user-password'});
  assert.equal((await user.login(participant, 'study-user-password')).response.status, 200);
  await mutate(user, '/data-portal/api/preferences', 'PUT', {setup});

  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1360, height: 1000}});
  await context.route('https://d3js.org/**', route => route.fulfill({contentType: 'text/javascript',
    body: readFileSync(join(projectRoot, 'node_modules/d3/dist/d3.min.js'))}));
  await context.route('**/api/experiment/ingest', async route => {
    const body = route.request().postDataJSON();
    rows.push(...body.events.map(event => event.payload));
    await route.fulfill({json: {success: true, batch_id: body.batch_id, accepted: body.events.length}});
  });
  await context.addInitScript(() => {
    let fullscreen = false;
    Object.defineProperty(document, 'fullscreenElement', {get: () => fullscreen ? document.documentElement : null});
    Element.prototype.requestFullscreen = async function() {
      fullscreen = true;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const study = await context.newPage();
  await openId(study, base + '/Motion');
  await expect(study.locator('#continue-btn')).toBeEnabled();
  await study.locator('#user-id-input').fill('invalid ID');
  await expect(study.locator('#error-message')).toBeHidden();
  await expect(study.locator('#user-id-status')).toBeEmpty();
  await expect(study.locator('#continue-btn')).toBeEnabled();
  await study.locator('#continue-btn').click();
  await expect(study.locator('#error-message')).toContainText('User ID not found');
  await expect(study.getByRole('link', {name: 'Register in the data portal'})).toBeVisible();
  await expect(study.locator('#continue-btn')).toHaveText('Continue');
  await expect(study.locator('#continue-btn')).toBeEnabled();
  const missing = 'Missing' + suffix.slice(0, 8);
  await study.locator('#user-id-input').fill(missing);
  await expect(study.locator('#error-message')).toBeHidden();
  await study.locator('#continue-btn').click();
  await expect(study.locator('#error-message')).toContainText('Please register in the data portal');
  await expect(study.locator('#continue-btn')).toBeEnabled();
  const registerLink = study.getByRole('link', {name: 'Register in the data portal'});
  const registration = await context.newPage();
  await registration.goto(base + await registerLink.getAttribute('href'));
  await expect(registration.getByRole('heading', {name: 'Create user account', exact: true})).toBeVisible();
  await expect(registration.getByLabel('User ID', {exact: true})).toHaveValue(missing);
  await registration.close();

  // A failed lookup must keep the participant on the ID screen, then allow retry.
  const lookupPattern = '**/api/experiment/participant?*';
  await study.route(lookupPattern, route => route.fulfill({status: 503, json: {error: 'Unavailable'}}));
  await study.locator('#user-id-input').fill(participant);
  await study.locator('#continue-btn').click();
  await expect(study.locator('#error-message')).toContainText('Unable to check your User ID');
  await expect(study.locator('#continue-btn')).toHaveText('Continue');
  await expect(study.locator('#continue-btn')).toBeEnabled();
  await expect(study.locator('#user-id-retry')).toHaveCount(0);
  await study.unroute(lookupPattern);
  await study.locator('#continue-btn').click();
  await verifySetup(study, setup);
  // Imported values remain editable and the actual run records those edits.
  await study.locator('#viewing-distance').fill('70');
  await study.locator('#continue-position-btn').click();
  await expect(study.locator('.instruction-wrapper')).toBeVisible();
  await expect.poll(() => rows.find(row => row.trial_category === 'stimulus_position_editor')).toBeTruthy();
  const imported = rows.find(row => row.trial_category === 'stimulus_position_editor');
  assert.equal(imported.user_id, participant);
  assert.equal(imported.task_type, 'Motion');
  assert.deepEqual(imported.calculator_data.resolution, [2560, 1440]);
  assert.deepEqual(imported.calculator_data.screenSizeCm, [60, 34]);
  assert.equal(imported.calculator_data.viewingDistanceCm, 70);
  assert.equal(imported.stimulus_position_data.xOffsetDeg, 7.2);
  assert.equal(imported.stimulus_position_data.yOffsetDeg, -2.3);
  assert.deepEqual((await (await user.api('/data-portal/api/preferences')).json()).setup, setup);

  // A response for a previous ID cannot enable entry or import the previous setup.
  await openId(study, base + '/Motion');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await study.route(lookupPattern, async route => {
    if (new URL(route.request().url()).searchParams.get('user_id') !== participant) return route.continue();
    await held;
    await route.fulfill({json: {user_id: participant, setup, setup_saved: true}});
  });
  const requested = study.waitForRequest(url => url.url().includes('user_id=' + participant));
  await study.locator('#user-id-input').fill(participant);
  await study.locator('#continue-btn').click();
  await requested;
  await expect(study.locator('#continue-btn')).toBeDisabled();
  await study.locator('#user-id-input').fill(other);
  await expect(study.locator('#continue-btn')).toBeEnabled();
  release();
  await study.locator('#continue-btn').click();
  await verifySetup(study, DEFAULT_STUDY_SETUP);
  await study.unroute(lookupPattern);

  const portal = await context.newPage();
  await portal.goto(base + '/data-portal/');
  await portal.locator('#username').fill(participant);
  await portal.locator('#password').fill('study-user-password');
  await portal.getByRole('button', {name: 'Sign In', exact: true}).click();
  await expect(portal.getByRole('heading', {name: 'Dashboard', exact: true})).toBeVisible();
  const startTraining = portal.locator('.next-session-actions a').filter({hasText: 'Start Training'});
  await expect(startTraining).toHaveAttribute('aria-disabled', 'true');
  let version = 0;
  for (const task of STUDY_TASKS) {
    const schedule = await mutate(admin, '/data-portal/api/schedule', 'PUT', {
      user_id: participant, version, sessions: [{session_id: randomUUID(),
        starts_at: new Date(Date.now() + 600000).toISOString(), ends_at: new Date(Date.now() + 1800000).toISOString(),
        session_type: 'study', task_type: task}]
    });
    version = schedule.version;
    await portal.reload();
    await expect(startTraining).toHaveAttribute('href', `/${task}?user_id=${participant}`);
    await startTraining.click();
    await expect(portal).toHaveURL(`${base}/${task}?user_id=${participant}`);
    await portal.getByRole('button', {name: 'Enter Fullscreen & Continue'}).click();
    await portal.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect(portal.locator('#user-id-input')).toHaveValue(participant);
    await expect(portal.locator('#continue-btn')).toBeEnabled();
    await portal.locator('#continue-btn').click();
    await verifySetup(portal, setup);
    await expect(portal.locator('.position-subtitle')).toContainText(task === 'Bar' ? 'Bar Comparison' : task);
    await portal.goto(base + '/data-portal/');
    await expect(portal.getByRole('heading', {name: 'Dashboard', exact: true})).toBeVisible();
  }
  // Breaks retain their calendar information without launching a training task.
  await mutate(admin, '/data-portal/api/schedule', 'PUT', {user_id: participant, version,
    sessions: [{session_id: randomUUID(), starts_at: new Date(Date.now() - 60000).toISOString(),
      ends_at: new Date(Date.now() + 600000).toISOString(), session_type: 'break', task_type: 'Motion'}]});
  await portal.reload();
  await expect(portal.locator('.next-session h2')).toHaveText('Motion break');
  await expect(startTraining).toHaveAttribute('aria-disabled', 'true');
  assert.deepEqual(errors, []);
  console.log('Study/portal browser passed: registered IDs, registration link, retry, stale lookup rejection, all saved calibration fields, editable run settings, shared defaults, and Start Training routes for all four tasks.');
} finally {
  await browser?.close();
  await pool.query('DELETE FROM portal_auth."user" WHERE username=ANY($1)', [[participant, other, adminId]]);
  if (server?.listening) { server.close(); await once(server, 'close'); }
  await pool.end();
}
