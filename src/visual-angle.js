export const DEFAULT_DISPLAY_INPUTS = {
  resolutionWidthPx: 1920,
  resolutionHeightPx: 1080,
  screenWidthCm: 47.6,
  screenHeightCm: 26.8,
  viewingDistanceCm: 50,
};

function requirePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number.`);
  }
}

export function calculateDisplayCalibration({
  resolutionWidthPx,
  resolutionHeightPx,
  screenWidthCm,
  screenHeightCm,
  viewingDistanceCm,
}) {
  requirePositiveNumber(resolutionWidthPx, 'Resolution width');
  requirePositiveNumber(resolutionHeightPx, 'Resolution height');
  requirePositiveNumber(screenWidthCm, 'Screen width');
  requirePositiveNumber(screenHeightCm, 'Screen height');
  requirePositiveNumber(viewingDistanceCm, 'Viewing distance');

  const pixelsPerCmX = resolutionWidthPx / screenWidthCm;
  const pixelsPerCmY = resolutionHeightPx / screenHeightCm;
  const cmPerDegree = Math.tan(Math.PI / 180) * viewingDistanceCm;
  const pixelsPerDegree = ((pixelsPerCmX + pixelsPerCmY) / 2) * cmPerDegree;

  return {
    resolution: [resolutionWidthPx, resolutionHeightPx],
    screenSizeCm: [screenWidthCm, screenHeightCm],
    viewingDistanceCm,
    pixelsPerCmX,
    pixelsPerCmY,
    pixelsPerDegree,
  };
}

export function degreesToPixels(angleDegrees, pixelsPerDegree) {
  requirePositiveNumber(angleDegrees, 'Visual angle');
  requirePositiveNumber(pixelsPerDegree, 'Pixels per degree');
  return angleDegrees * pixelsPerDegree;
}
