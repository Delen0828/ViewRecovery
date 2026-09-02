import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GAZE_SAMPLE_RATE_HZ,
  DEFAULT_GAZE_TIME_WINDOW_MS,
  MAX_GAZE_SAMPLE_RATE_HZ,
  MIN_GAZE_SAMPLE_RATE_HZ,
  advanceGazeSamplingClock,
  calculateGazeSamplingSettings,
  shouldAcceptGazeSample,
  trimGazeSamplesToWindow,
} from '../src/gaze-sampling.js';

test('default gaze sampling settings use a 50 ms window at 30 Hz', () => {
  const settings = calculateGazeSamplingSettings({
    timeWindowMs: DEFAULT_GAZE_TIME_WINDOW_MS,
    sampleRateHz: DEFAULT_GAZE_SAMPLE_RATE_HZ,
  });

  assert.equal(settings.timeWindowMs, 50);
  assert.equal(settings.sampleRateHz, 30);
  assert.equal(settings.sampleIntervalMs, 1000 / 30);
  assert.equal(settings.estimatedSamplesPerWindow, 1.5);
});

test('sample rate accepts the inclusive 20–1000 Hz range', () => {
  assert.doesNotThrow(() =>
    calculateGazeSamplingSettings({ timeWindowMs: 50, sampleRateHz: MIN_GAZE_SAMPLE_RATE_HZ }),
  );
  assert.doesNotThrow(() =>
    calculateGazeSamplingSettings({ timeWindowMs: 50, sampleRateHz: MAX_GAZE_SAMPLE_RATE_HZ }),
  );
  assert.throws(
    () => calculateGazeSamplingSettings({ timeWindowMs: 50, sampleRateHz: 19 }),
    /Sample rate/,
  );
  assert.throws(
    () => calculateGazeSamplingSettings({ timeWindowMs: 50, sampleRateHz: 1001 }),
    /Sample rate/,
  );
});

test('sampling cadence rejects predictions that arrive before the selected interval', () => {
  assert.equal(shouldAcceptGazeSample(null, 100, 20), true);
  assert.equal(shouldAcceptGazeSample(100, 149.9, 20), false);
  assert.equal(shouldAcceptGazeSample(100, 150, 20), true);
  assert.equal(shouldAcceptGazeSample(100, 100.9, 1000), false);
  assert.equal(shouldAcceptGazeSample(100, 101, 1000), true);
});

test('sampling clock stays near the requested average rate when predictions arrive off cadence', () => {
  const predictionTimes = [0, 33.34, 66.68, 100.02, 133.36, 166.7, 200.04];
  let samplingClock = null;
  let acceptedSamples = 0;

  predictionTimes.forEach((predictionTime) => {
    if (shouldAcceptGazeSample(samplingClock, predictionTime, 20)) {
      samplingClock = advanceGazeSamplingClock(samplingClock, predictionTime, 20);
      acceptedSamples += 1;
    }
  });

  assert.equal(acceptedSamples, 5);
  assert.equal(samplingClock, 200);
});

test('rolling windows retain their shared samples when consecutive windows overlap', () => {
  const samples = [
    { time: 0, x: 0, y: 0 },
    { time: 25, x: 1, y: 1 },
    { time: 50, x: 2, y: 2 },
  ];

  assert.equal(trimGazeSamplesToWindow(samples, 50, 50), samples);
  assert.deepEqual(samples.map((sample) => sample.time), [0, 25, 50]);

  samples.push({ time: 75, x: 3, y: 3 });
  trimGazeSamplesToWindow(samples, 75, 50);
  assert.deepEqual(samples.map((sample) => sample.time), [25, 50, 75]);
});

test('time windows must be positive', () => {
  assert.throws(
    () => calculateGazeSamplingSettings({ timeWindowMs: 0, sampleRateHz: 30 }),
    /Time window/,
  );
  assert.doesNotThrow(() =>
    calculateGazeSamplingSettings({ timeWindowMs: 60001, sampleRateHz: 30 }),
  );
});
