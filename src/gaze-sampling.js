export const DEFAULT_GAZE_TIME_WINDOW_MS = 50;
export const MIN_GAZE_TIME_WINDOW_MS = 1;
export const DEFAULT_GAZE_SAMPLE_RATE_HZ = 30;
export const MIN_GAZE_SAMPLE_RATE_HZ = 20;
export const MAX_GAZE_SAMPLE_RATE_HZ = 1000;

function requireNumberInRange(value, minimum, maximum, name) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
}

export function calculateGazeSamplingSettings({ timeWindowMs, sampleRateHz }) {
  if (!Number.isFinite(timeWindowMs) || timeWindowMs < MIN_GAZE_TIME_WINDOW_MS) {
    throw new RangeError(`Time window must be at least ${MIN_GAZE_TIME_WINDOW_MS}.`);
  }
  requireNumberInRange(
    sampleRateHz,
    MIN_GAZE_SAMPLE_RATE_HZ,
    MAX_GAZE_SAMPLE_RATE_HZ,
    'Sample rate',
  );

  return {
    timeWindowMs,
    sampleRateHz,
    sampleIntervalMs: 1000 / sampleRateHz,
    estimatedSamplesPerWindow: Math.max(1, (timeWindowMs * sampleRateHz) / 1000),
  };
}

export function shouldAcceptGazeSample(lastAcceptedTime, currentTime, sampleRateHz) {
  requireNumberInRange(
    sampleRateHz,
    MIN_GAZE_SAMPLE_RATE_HZ,
    MAX_GAZE_SAMPLE_RATE_HZ,
    'Sample rate',
  );
  if (!Number.isFinite(currentTime)) {
    throw new TypeError('The current sample time must be finite.');
  }
  if (lastAcceptedTime === null) {
    return true;
  }
  if (!Number.isFinite(lastAcceptedTime)) {
    throw new TypeError('The previous sample time must be finite or null.');
  }

  // If the monotonic clock is reset, accept immediately and start a new cadence.
  if (currentTime < lastAcceptedTime) {
    return true;
  }

  return currentTime - lastAcceptedTime + 1e-9 >= 1000 / sampleRateHz;
}

export function advanceGazeSamplingClock(lastSamplingTime, currentTime, sampleRateHz) {
  if (!shouldAcceptGazeSample(lastSamplingTime, currentTime, sampleRateHz)) {
    return lastSamplingTime;
  }
  if (lastSamplingTime === null || currentTime < lastSamplingTime) {
    return currentTime;
  }

  const sampleIntervalMs = 1000 / sampleRateHz;
  const elapsedIntervals = Math.max(
    1,
    Math.floor((currentTime - lastSamplingTime + 1e-9) / sampleIntervalMs),
  );
  return lastSamplingTime + elapsedIntervals * sampleIntervalMs;
}

export function trimGazeSamplesToWindow(samples, currentTime, timeWindowMs) {
  if (!Array.isArray(samples)) {
    throw new TypeError('Gaze samples must be an array.');
  }
  if (!Number.isFinite(timeWindowMs) || timeWindowMs < MIN_GAZE_TIME_WINDOW_MS) {
    throw new RangeError(`Time window must be at least ${MIN_GAZE_TIME_WINDOW_MS}.`);
  }
  if (!Number.isFinite(currentTime)) {
    throw new TypeError('The current sample time must be finite.');
  }

  const windowStart = currentTime - timeWindowMs;
  let expiredSampleCount = 0;
  while (
    expiredSampleCount < samples.length &&
    samples[expiredSampleCount].time < windowStart
  ) {
    expiredSampleCount += 1;
  }

  if (expiredSampleCount > 0) {
    samples.splice(0, expiredSampleCount);
  }

  return samples;
}
