import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  applyCurve,
  delayUntilNextNotification,
  intervalForDistance,
  shouldPlaySoundAtDistance,
} from '../src/sound-frequency-curve.js';

const CURVES = ['linear', 'square', 'exponential', 'logarithmic'];
const MAXIMUM_DISTANCE_PX = 1000;

test('every curve keeps the same minimum and maximum frequency endpoints', () => {
  CURVES.forEach((curve) => {
    assert.equal(intervalForDistance(0, MAXIMUM_DISTANCE_PX, curve), MAX_INTERVAL_MS);
    assert.equal(intervalForDistance(200, MAXIMUM_DISTANCE_PX, curve), MAX_INTERVAL_MS);
    assert.equal(intervalForDistance(MAXIMUM_DISTANCE_PX, MAXIMUM_DISTANCE_PX, curve), MIN_INTERVAL_MS);
  });
});

test('every curve increases frequency monotonically with distance', () => {
  CURVES.forEach((curve) => {
    const intervals = [200, 400, 600, 800, 1000].map((distance) =>
      intervalForDistance(distance, MAXIMUM_DISTANCE_PX, curve),
    );

    intervals.slice(1).forEach((interval, index) => {
      assert.ok(interval <= intervals[index], `${curve} must not slow down as distance rises`);
    });
  });
});

test('curve transforms are normalized and distinct at their midpoint', () => {
  CURVES.forEach((curve) => {
    assert.equal(applyCurve(0, curve), 0);
    assert.ok(Math.abs(applyCurve(1, curve) - 1) < 1e-12);
  });

  assert.equal(applyCurve(0.5, 'linear'), 0.5);
  assert.equal(applyCurve(0.5, 'square'), 0.25);
  assert.ok(applyCurve(0.5, 'exponential') < 0.5);
  assert.ok(applyCurve(0.5, 'logarithmic') > 0.5);
});

test('unknown curves are rejected', () => {
  assert.throws(() => applyCurve(0.5, 'invalid'), /Unknown frequency curve/);
});

test('the inner-zone setting uses 500 px as an inclusive mute boundary', () => {
  assert.equal(shouldPlaySoundAtDistance(0, true), true);
  assert.equal(shouldPlaySoundAtDistance(500, true), true);
  assert.equal(shouldPlaySoundAtDistance(0, false), false);
  assert.equal(shouldPlaySoundAtDistance(500, false), false);
  assert.equal(shouldPlaySoundAtDistance(501, false), true);
});

test('the sound boundary accepts a calibrated custom threshold', () => {
  assert.equal(shouldPlaySoundAtDistance(175, false, 175), false);
  assert.equal(shouldPlaySoundAtDistance(176, false, 175), true);
});

test('the frequency curve accepts a calibrated custom center threshold', () => {
  assert.equal(intervalForDistance(175, 1000, 'linear', 175), MAX_INTERVAL_MS);
  assert.equal(intervalForDistance(1000, 1000, 'linear', 175), MIN_INTERVAL_MS);
  assert.ok(intervalForDistance(176, 1000, 'linear', 175) < MAX_INTERVAL_MS);
});

test('threshold re-entry waits for the calculated interval after the previous notification', () => {
  assert.equal(delayUntilNextNotification(null, 1100, 1200), 0);
  assert.equal(delayUntilNextNotification(1000, 1100, 1200), 1100);
  assert.equal(delayUntilNextNotification(1000, 1700, 900), 200);
  assert.equal(delayUntilNextNotification(1000, 2200, 1200), 0);
});
