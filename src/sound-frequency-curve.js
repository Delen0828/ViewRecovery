export const CENTER_THRESHOLD_PX = 200;
export const INNER_SOUND_RADIUS_PX = 500;
export const MAX_INTERVAL_MS = 1200;
export const MIN_INTERVAL_MS = 200;

export const CURVE_LABELS = {
  linear: 'linear',
  square: 'square',
  exponential: 'exponential',
  logarithmic: 'logarithmic',
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function applyCurve(progress, curve) {
  const normalizedProgress = clamp(progress, 0, 1);

  switch (curve) {
    case 'linear':
      return normalizedProgress;
    case 'square':
      return normalizedProgress ** 2;
    case 'exponential':
      return (Math.exp(normalizedProgress) - 1) / (Math.E - 1);
    case 'logarithmic':
      return Math.log1p((Math.E - 1) * normalizedProgress);
    default:
      throw new Error(`Unknown frequency curve: ${curve}`);
  }
}

export function intervalForDistance(
  distancePx,
  maximumDistancePx,
  curve,
  centerThresholdPx = CENTER_THRESHOLD_PX,
) {
  const scalableDistance = Math.max(maximumDistancePx - centerThresholdPx, 1);
  const distanceProgress = clamp(
    (distancePx - centerThresholdPx) / scalableDistance,
    0,
    1,
  );
  const curvedProgress = applyCurve(distanceProgress, curve);

  return MAX_INTERVAL_MS - (MAX_INTERVAL_MS - MIN_INTERVAL_MS) * curvedProgress;
}

export function shouldPlaySoundAtDistance(
  distancePx,
  playWithinInnerZone,
  innerRadiusPx = INNER_SOUND_RADIUS_PX,
) {
  return playWithinInnerZone || distancePx > innerRadiusPx;
}

export function delayUntilNextNotification(
  lastNotificationTime,
  currentTime,
  calculatedIntervalMs,
) {
  if (!Number.isFinite(currentTime)) {
    throw new TypeError('Current notification time must be finite.');
  }
  if (!Number.isFinite(calculatedIntervalMs) || calculatedIntervalMs < 0) {
    throw new RangeError('Calculated notification interval must be non-negative.');
  }
  if (lastNotificationTime === null) {
    return 0;
  }
  if (!Number.isFinite(lastNotificationTime)) {
    throw new TypeError('Last notification time must be finite or null.');
  }

  return Math.max(0, calculatedIntervalMs - (currentTime - lastNotificationTime));
}
