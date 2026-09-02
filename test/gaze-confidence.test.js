import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHI_SQUARE_95_DF2,
  MAX_SHADE_OPACITY,
  MIN_SHADE_OPACITY,
  calculateGazeConfidenceEllipse,
  confidenceShadeOpacity,
} from '../src/gaze-confidence.js';

test('confidence ellipse is centered on the average gaze position', () => {
  const ellipse = calculateGazeConfidenceEllipse([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]);

  assert.deepEqual(ellipse.mean, { x: 1, y: 0 });
  assert.equal(ellipse.sampleCount, 2);
  assert.ok(Math.abs(ellipse.semiMajorRadius - Math.sqrt(CHI_SQUARE_95_DF2)) < 1e-12);
  assert.equal(ellipse.semiMinorRadius, 0);
  assert.equal(ellipse.angleRadians, 0);
});

test('confidence ellipse follows correlated diagonal gaze variation', () => {
  const ellipse = calculateGazeConfidenceEllipse([
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ]);

  assert.deepEqual(ellipse.mean, { x: 1, y: 1 });
  assert.ok(ellipse.semiMajorRadius > 0);
  assert.ok(ellipse.semiMinorRadius < 1e-7);
  assert.ok(Math.abs(ellipse.angleRadians - Math.PI / 4) < 1e-12);
});

test('one sample has a mean but not enough data for a confidence bound', () => {
  const ellipse = calculateGazeConfidenceEllipse([{ x: 12, y: 34 }]);

  assert.deepEqual(ellipse.mean, { x: 12, y: 34 });
  assert.equal(ellipse.semiMajorRadius, 0);
  assert.equal(ellipse.semiMinorRadius, 0);
});

test('larger confidence bounds receive a lighter shade', () => {
  const compactOpacity = confidenceShadeOpacity(10, 100);
  const broadOpacity = confidenceShadeOpacity(80, 100);

  assert.ok(compactOpacity > broadOpacity);
  assert.equal(confidenceShadeOpacity(0, 100), MAX_SHADE_OPACITY);
  assert.equal(confidenceShadeOpacity(100, 100), MIN_SHADE_OPACITY);
  assert.equal(confidenceShadeOpacity(1000, 100), MIN_SHADE_OPACITY);
});

test('invalid samples are rejected', () => {
  assert.throws(() => calculateGazeConfidenceEllipse([]), /At least one/);
  assert.throws(
    () => calculateGazeConfidenceEllipse([{ x: Number.NaN, y: 0 }]),
    /finite x and y/,
  );
});
