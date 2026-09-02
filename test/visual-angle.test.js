import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DISPLAY_INPUTS,
  calculateDisplayCalibration,
  degreesToPixels,
} from '../src/visual-angle.js';

test('display calibration matches the main-study pixels-per-degree formula', () => {
  const calibration = calculateDisplayCalibration(DEFAULT_DISPLAY_INPUTS);
  const expectedPixelsPerCmX = 1920 / 47.6;
  const expectedPixelsPerCmY = 1080 / 26.8;
  const expectedCmPerDegree = Math.tan(Math.PI / 180) * 50;
  const expectedPixelsPerDegree =
    ((expectedPixelsPerCmX + expectedPixelsPerCmY) / 2) * expectedCmPerDegree;

  assert.equal(calibration.pixelsPerCmX, expectedPixelsPerCmX);
  assert.equal(calibration.pixelsPerCmY, expectedPixelsPerCmY);
  assert.equal(calibration.pixelsPerDegree, expectedPixelsPerDegree);
});

test('the default 5-degree threshold converts using calibrated pixels per degree', () => {
  const calibration = calculateDisplayCalibration(DEFAULT_DISPLAY_INPUTS);
  assert.equal(degreesToPixels(5, calibration.pixelsPerDegree), calibration.pixelsPerDegree * 5);
});

test('display calibration rejects missing or non-positive measurements', () => {
  assert.throws(
    () => calculateDisplayCalibration({ ...DEFAULT_DISPLAY_INPUTS, screenWidthCm: 0 }),
    /positive number/,
  );
  assert.throws(() => degreesToPixels(-1, 40), /positive number/);
});
