import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import {DEFAULT_STUDY_SETUP} from '../src/study-setup.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({root, server: {host: '127.0.0.1', port: 0}});
let browser;
const errors = [];
const radians = Math.PI / 180;
const pixels = (degrees, setup, axis) => Math.tan(degrees * radians) * setup.distance
  * setup.resolution[axis] / setup.physical[axis];

async function openEditor(task, setup, viewport = {width: 1280, height: 1000}) {
  const context = await browser.newContext({viewport, hasTouch: true});
  const rows = [];
  // Keep QA offline and acknowledge experiment data without writing participant records.
  await context.route('https://d3js.org/**', route => route.fulfill({
    path: root + 'node_modules/d3/dist/d3.min.js', contentType: 'text/javascript'
  }));
  await context.route('**/api/experiment/ingest', async route => {
    const body = route.request().postDataJSON();
    rows.push(...body.events.map(event => event.payload));
    await route.fulfill({json: {success: true, batch_id: body.batch_id, accepted: body.events.length}});
  });
  await context.route('**/api/experiment/participant?*', route => route.fulfill({
    json: {user_id: 'PositionQA', setup: DEFAULT_STUDY_SETUP, setup_saved: false}
  }));
  // Fullscreen is a browser capability outside the position editor; emulate it for headless QA.
  await context.addInitScript(() => {
    let fullscreen = false;
    Object.defineProperty(document, 'fullscreenElement', {get: () => fullscreen ? document.documentElement : null});
    Element.prototype.requestFullscreen = async function() {
      fullscreen = true;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0] + task);
  await page.getByRole('button', {name: 'Enter Fullscreen & Continue'}).click();
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await page.locator('#user-id-input').fill('PositionQA');
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect(page.locator('#stimulus-position-preview')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Continue', exact: true})).toHaveCount(1);
  await expect(page.locator('.setup-parameters input')).toHaveCount(7);
  await expect(page.locator('#setup-actions #continue-position-btn')).toBeVisible();
  await fillCalibration(page, setup);
  return {page, context, rows};
}

async function fillCalibration(page, setup) {
  for (const [id, value] of Object.entries({
    'resolution-width': setup.resolution[0], 'resolution-height': setup.resolution[1],
    'screen-width': setup.physical[0], 'screen-height': setup.physical[1],
    'viewing-distance': setup.distance
  })) await page.locator('#' + id).fill(String(value));
}

async function verifyMonitor(page, setup) {
  const svg = page.locator('#stimulus-position-preview');
  await expect(svg).toHaveAttribute('viewBox', `0 0 ${setup.resolution.join(' ')}`);
  await expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
  const bounds = await svg.boundingBox();
  assert.ok(Math.abs(bounds.width / bounds.height - setup.physical[0] / setup.physical[1]) < 0.002);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(page.locator('#monitor-width-readout')).toHaveText(`${setup.physical[0]} cm · ${setup.resolution[0]} px`);
  await expect(page.locator('#monitor-height-readout')).toHaveText(`${setup.physical[1]} cm · ${setup.resolution[1]} px`);
  await expect(page.locator('#monitor-distance-readout')).toHaveText(`Viewing distance · ${setup.distance} cm`);
  const parameters = await page.locator('.setup-parameters').boundingBox();
  const preview = await page.locator('.setup-preview').boundingBox();
  if (page.viewportSize().width > 640) {
    assert.ok(parameters.x + parameters.width < preview.x, 'Parameters sit to the left of the monitor');
  } else {
    assert.ok(parameters.y + parameters.height < preview.y, 'The compact layout stacks on mobile');
  }
  const background = await svg.locator('rect').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {width: rect.width, height: rect.height};
  });
  assert.ok(Math.abs(background.width - bounds.width) < 0.01);
  assert.ok(Math.abs(background.height - bounds.height) < 0.01);
  await expect(page.locator('.position-quadrant')).toHaveCount(4);
  assert.ok(await page.locator('.position-quadrant').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 18));
  for (const [axis, dimension] of ['x', 'y'].entries()) {
    for (const degree of [-5, -1, 1, 5]) {
      const line = svg.locator(`.position-grid-line[data-axis="${dimension}"][data-degree="${degree}"]`);
      const coordinate = Number(await line.getAttribute(dimension + '1'));
      assert.ok(Math.abs(coordinate - (setup.resolution[axis] / 2 + pixels(degree, setup, axis))) < 0.001);
    }
  }
  const input = await page.locator('#stimulus-x-offset').boundingBox();
  const field = await page.locator('.position-field').first().boundingBox();
  assert.ok(input.height < 48 && input.width < 170 && field.height < 76);
}

async function drag(page, setup, xDegrees, yDegrees, index = 0, touch = false, expected = [xDegrees, yDegrees]) {
  await page.locator('#stimulus-position-preview').scrollIntoViewIfNeeded();
  const svg = await page.locator('#stimulus-position-preview').boundingBox();
  const marker = await page.locator('.position-marker').nth(index).locator('circle').last().boundingBox();
  const start = {x: marker.x + marker.width / 2, y: marker.y + marker.height / 2};
  const xDirection = index === 1 ? 1 : -1;
  const target = {
    x: svg.x + svg.width * (0.5 + xDirection * pixels(xDegrees, setup, 0) / setup.resolution[0]),
    y: svg.y + svg.height * (0.5 - pixels(yDegrees, setup, 1) / setup.resolution[1])
  };
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [target]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, {steps: 12});
    await page.mouse.up();
  }
  await expect(page.locator('#stimulus-x-offset')).toHaveValue(String(expected[0]));
  await expect(page.locator('#stimulus-y-offset')).toHaveValue(String(expected[1]));
  await expect(page.locator('#stimulus-position-preview')).not.toHaveClass(/is-dragging/);
  await expect(page.locator('#stimulus-position-readout')).toHaveText(
    `x ${pixels(expected[0], setup, 0).toFixed(1)} px, y ${pixels(expected[1], setup, 1).toFixed(1)} px`
  );
  const point = page.locator('.position-marker').nth(index).locator('circle').last();
  assert.ok(Math.abs(Number(await point.getAttribute('cx')) - (setup.resolution[0] / 2 + xDirection * pixels(expected[0], setup, 0))) < 0.001);
  assert.ok(Math.abs(Number(await point.getAttribute('cy')) - (setup.resolution[1] / 2 - pixels(expected[1], setup, 1))) < 0.001);
}

try {
  await server.listen();
  browser = await chromium.launch({headless: true});
  mkdirSync(root + 'test/results', {recursive: true});
  const landscape = {resolution: [1920, 1080], physical: [47.6, 26.8], distance: 50};
  const motion = await openEditor('Motion', landscape);
  await verifyMonitor(motion.page, landscape);
  // Calibration edits resize the same monitor and recalculate its grid and offsets.
  const changedSetup = {resolution: [2560, 1440], physical: [60, 32], distance: 70};
  await fillCalibration(motion.page, changedSetup);
  await verifyMonitor(motion.page, changedSetup);
  await expect(motion.page.locator('#stimulus-position-readout')).toHaveText(
    `x ${pixels(5, changedSetup, 0).toFixed(1)} px, y ${pixels(5, changedSetup, 1).toFixed(1)} px`
  );
  for (const [id, value, restored] of [
    ['screen-width', '', changedSetup.physical[0]],
    ['screen-height', '0', changedSetup.physical[1]],
    ['viewing-distance', '-1', changedSetup.distance],
    ['resolution-width', '10001', changedSetup.resolution[0]],
    ['resolution-height', '1440.5', changedSetup.resolution[1]]
  ]) {
    await motion.page.locator('#' + id).fill(value);
    await expect(motion.page.locator('#continue-position-btn')).toBeDisabled();
    await expect(motion.page.locator('#' + id)).toHaveAttribute('aria-invalid', 'true');
    await expect(motion.page.locator('#stimulus-position-readout')).toHaveText('--');
    await expect(motion.page.locator('#preview-ppd')).toHaveText('--');
    await expect(motion.page.locator('.position-marker')).toHaveCount(0);
    await motion.page.locator('#' + id).fill(String(restored));
    await expect(motion.page.locator('#continue-position-btn')).toBeEnabled();
  }
  await fillCalibration(motion.page, landscape);
  await motion.page.locator('#stimulus-position-preview').evaluate(svg => {
    window.positionDragValues = [];
    svg.addEventListener('pointermove', () => {
      if (svg.classList.contains('is-dragging')) {
        window.positionDragValues.push([
          Number(document.getElementById('stimulus-x-offset').value),
          Number(document.getElementById('stimulus-y-offset').value)
        ]);
      }
    });
  });
  await drag(motion.page, landscape, 7.3, 3.2, 0, false, [7, 3]);
  await drag(motion.page, landscape, -4.2, -2.4, 0, false, [-4, -2]);
  await drag(motion.page, landscape, 5.4, 4.1, 0, true, [5, 4]);
  const dragValues = await motion.page.evaluate(() => window.positionDragValues);
  assert.ok(dragValues.length > 0);
  assert.ok(dragValues.every(values => values.every(Number.isInteger)), 'Every drag update must stay on the 1° grid');
  const svg = motion.page.locator('#stimulus-position-preview');
  // Pointer capture keeps dragging active outside the monitor and clamps to its edges.
  const bounds = await svg.boundingBox();
  const marker = await svg.locator('.position-marker circle').last().boundingBox();
  await motion.page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await motion.page.mouse.down();
  await motion.page.mouse.move(bounds.x + bounds.width + 40, bounds.y - 40, {steps: 12});
  await motion.page.mouse.up();
  await expect(motion.page.locator('#stimulus-x-offset')).toHaveValue('-25');
  await expect(motion.page.locator('#stimulus-y-offset')).toHaveValue('15');
  await expect(svg).not.toHaveClass(/is-dragging/);
  await drag(motion.page, landscape, 5.4, 4.1, 0, false, [5, 4]);
  // Resizing retains an 8px dot and its larger hit target.
  await motion.page.setViewportSize({width: 390, height: 844});
  await expect.poll(async () => (await svg.locator('.position-marker circle').last().boundingBox()).width).toBeGreaterThan(15);
  await verifyMonitor(motion.page, landscape);
  await motion.page.setViewportSize({width: 1280, height: 1000});
  await expect.poll(async () => (await svg.locator('.position-marker circle').last().boundingBox()).width).toBeLessThan(19);
  await svg.focus();
  await motion.page.keyboard.press('ArrowRight');
  await motion.page.keyboard.press('Shift+ArrowUp');
  await expect(motion.page.locator('#stimulus-x-offset')).toHaveValue('4.9');
  await expect(motion.page.locator('#stimulus-y-offset')).toHaveValue('5.0');
  await motion.page.locator('#stimulus-x-offset').fill('');
  await expect(motion.page.locator('#continue-position-btn')).toBeDisabled();
  await expect(motion.page.locator('#stimulus-position-readout')).toHaveText('--');
  await motion.page.locator('#stimulus-x-offset').fill('90');
  await expect(motion.page.locator('#continue-position-btn')).toBeDisabled();
  await motion.page.locator('#stimulus-x-offset').fill('6.2');
  await motion.page.locator('#stimulus-y-offset').fill('3.4');
  await expect(motion.page.locator('#continue-position-btn')).toBeEnabled();
  const point = svg.locator('.position-marker circle').last();
  assert.ok(Math.abs(Number(await point.getAttribute('cx')) - (960 - pixels(6.2, landscape, 0))) < 0.001);
  await motion.page.screenshot({path: root + 'test/results/stimulus-position-desktop.png', fullPage: true});
  await motion.page.locator('#continue-position-btn').click();
  await expect.poll(() => motion.rows.find(row => row.trial_category === 'stimulus_position_editor')).toBeTruthy();
  const savedRow = motion.rows.find(row => row.trial_category === 'stimulus_position_editor');
  assert.deepEqual(savedRow.calculator_data.resolution, landscape.resolution);
  assert.deepEqual(savedRow.calculator_data.screenSizeCm, landscape.physical);
  assert.equal(savedRow.calculator_data.viewingDistanceCm, landscape.distance);
  assert.equal(savedRow.calculator_data.pixelsPerCmX, landscape.resolution[0] / landscape.physical[0]);
  assert.equal(savedRow.calculator_data.pixelsPerCmY, landscape.resolution[1] / landscape.physical[1]);
  await expect(motion.page.locator('.screen-setup')).toHaveCount(0);
  await expect(motion.page.locator('.instruction-wrapper')).toBeVisible();
  const saved = savedRow.stimulus_position_data;
  assert.equal(saved.xOffsetDeg, 6.2);
  assert.equal(saved.yOffsetDeg, 3.4);
  assert.ok(Math.abs(saved.xOffsetPx - pixels(6.2, landscape, 0)) < 0.001);
  assert.ok(Math.abs(saved.yOffsetPx - pixels(3.4, landscape, 1)) < 0.001);
  await motion.context.close();

  const unusual = {resolution: [2560, 1440], physical: [54, 40], distance: 60};
  const bar = await openEditor('Bar', unusual);
  await verifyMonitor(bar.page, unusual);
  await expect(bar.page.locator('.position-marker')).toHaveCount(2);
  await drag(bar.page, unusual, 8.2, 4.3, 1, false, [8, 4]);
  await drag(bar.page, unusual, 6.7, 3.1, 0, false, [7, 3]);
  // Dragging the left bar across the center clamps horizontal separation to zero.
  await drag(bar.page, unusual, -2.2, 3.4, 0, false, [0, 3]);
  await drag(bar.page, unusual, 6.7, 3.1, 1, false, [7, 3]);
  const barCenters = await bar.page.locator('.position-marker circle:last-child').evaluateAll(markers => markers.map(marker => ({
    x: Number(marker.getAttribute('cx')), y: Number(marker.getAttribute('cy'))
  })));
  assert.ok(Math.abs(barCenters[0].x + barCenters[1].x - unusual.resolution[0]) < 0.001);
  assert.equal(barCenters[0].y, barCenters[1].y);
  await bar.page.locator('#stimulus-x-offset').fill('-1');
  await expect(bar.page.locator('#continue-position-btn')).toBeDisabled();
  await bar.page.locator('#stimulus-x-offset').fill('7');
  await bar.page.screenshot({path: root + 'test/results/stimulus-position-bar.png', fullPage: true});
  await bar.page.locator('#continue-position-btn').click();
  await expect.poll(() => bar.rows.find(row => row.trial_category === 'stimulus_position_editor')).toBeTruthy();
  const savedBar = bar.rows.find(row => row.trial_category === 'stimulus_position_editor').stimulus_position_data;
  assert.equal(savedBar.xOffsetDeg, 7);
  assert.equal(savedBar.yOffsetDeg, 3);
  assert.ok(Math.abs(savedBar.xOffsetPx - pixels(7, unusual, 0)) < 0.001);
  assert.ok(Math.abs(savedBar.yOffsetPx - pixels(3, unusual, 1)) < 0.001);
  await bar.context.close();

  const mobile = await openEditor('Orientation', landscape, {width: 390, height: 844});
  await verifyMonitor(mobile.page, landscape);
  await drag(mobile.page, landscape, 4.4, 2.3, 0, true, [4, 2]);
  await mobile.page.screenshot({path: root + 'test/results/stimulus-position-mobile.png', fullPage: true});
  await mobile.context.close();

  const portraitSetup = {resolution: [1080, 1920], physical: [30, 50], distance: 65};
  const portrait = await openEditor('Centrality', portraitSetup);
  await verifyMonitor(portrait.page, portraitSetup);
  await drag(portrait.page, portraitSetup, 4.1, 6.2, 0, false, [4, 6]);
  await portrait.context.close();
  assert.deepEqual(errors, []);
  console.log('Combined setup passed: live calibration, dimension markings, compact two-column layout, input validation, 1° mouse/touch dragging, keyboard, saved calibration and offsets, paired bars, mobile and portrait screens.');
} finally {
  await browser?.close();
  await server.close();
}
