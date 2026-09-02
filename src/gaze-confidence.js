export const CONFIDENCE_LEVEL = 0.95;
export const CHI_SQUARE_95_DF2 = 5.991464547107979;
export const MAX_SHADE_OPACITY = 0.28;
export const MIN_SHADE_OPACITY = 0.08;

function requireFiniteCoordinate(sample, index) {
  if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y)) {
    throw new TypeError(`Gaze sample ${index} must have finite x and y coordinates.`);
  }
}

/**
 * Calculate a bivariate 95% confidence ellipse for the mean gaze position.
 * The ellipse is based on the sample covariance matrix divided by the number
 * of samples, then scaled by the 95% chi-square quantile for two dimensions.
 */
export function calculateGazeConfidenceEllipse(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new RangeError('At least one gaze sample is required.');
  }

  samples.forEach(requireFiniteCoordinate);

  const mean = samples.reduce(
    (total, sample) => ({ x: total.x + sample.x, y: total.y + sample.y }),
    { x: 0, y: 0 },
  );
  mean.x /= samples.length;
  mean.y /= samples.length;

  if (samples.length === 1) {
    return {
      mean,
      sampleCount: 1,
      semiMajorRadius: 0,
      semiMinorRadius: 0,
      angleRadians: 0,
    };
  }

  const centeredSums = samples.reduce(
    (total, sample) => {
      const offsetX = sample.x - mean.x;
      const offsetY = sample.y - mean.y;
      total.xx += offsetX * offsetX;
      total.xy += offsetX * offsetY;
      total.yy += offsetY * offsetY;
      return total;
    },
    { xx: 0, xy: 0, yy: 0 },
  );

  const sampleCovarianceDivisor = samples.length - 1;
  const confidenceScale = CHI_SQUARE_95_DF2 / samples.length;
  const covarianceXX = (centeredSums.xx / sampleCovarianceDivisor) * confidenceScale;
  const covarianceXY = (centeredSums.xy / sampleCovarianceDivisor) * confidenceScale;
  const covarianceYY = (centeredSums.yy / sampleCovarianceDivisor) * confidenceScale;

  const trace = covarianceXX + covarianceYY;
  const eigenvalueDifference = Math.hypot(
    covarianceXX - covarianceYY,
    2 * covarianceXY,
  );
  const majorEigenvalue = Math.max(0, (trace + eigenvalueDifference) / 2);
  const minorEigenvalue = Math.max(0, (trace - eigenvalueDifference) / 2);

  return {
    mean,
    sampleCount: samples.length,
    semiMajorRadius: Math.sqrt(majorEigenvalue),
    semiMinorRadius: Math.sqrt(minorEigenvalue),
    angleRadians: 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY),
  };
}

/**
 * Use less opacity for a larger bound so higher uncertainty looks lighter.
 */
export function confidenceShadeOpacity(semiMajorRadius, referenceRadius) {
  if (!Number.isFinite(semiMajorRadius) || semiMajorRadius < 0) {
    throw new RangeError('The confidence radius must be a non-negative number.');
  }
  if (!Number.isFinite(referenceRadius) || referenceRadius <= 0) {
    throw new RangeError('The reference radius must be a positive number.');
  }

  if (semiMajorRadius === 0) {
    return MAX_SHADE_OPACITY;
  }
  if (semiMajorRadius >= referenceRadius) {
    return MIN_SHADE_OPACITY;
  }

  const normalizedUncertainty = semiMajorRadius / referenceRadius;
  return (
    MAX_SHADE_OPACITY -
    normalizedUncertainty * (MAX_SHADE_OPACITY - MIN_SHADE_OPACITY)
  );
}
