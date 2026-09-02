import { initJsPsych } from 'jspsych';
import htmlButtonResponse from '@jspsych/plugin-html-button-response';
import htmlKeyboardResponse from '@jspsych/plugin-html-keyboard-response';
import fullscreen from '@jspsych/plugin-fullscreen';
import webgazerCalibrate from '@jspsych/plugin-webgazer-calibrate';
import webgazerInitCamera from '@jspsych/plugin-webgazer-init-camera';
import webgazerValidate from '@jspsych/plugin-webgazer-validate';
import webgazerExtension from '@jspsych/extension-webgazer';

import './gaze-test.css';
import {
  MAX_INTERVAL_MS as GAZE_SOUND_MAX_INTERVAL_MS,
  MIN_INTERVAL_MS as GAZE_SOUND_MIN_INTERVAL_MS,
  delayUntilNextNotification,
  intervalForDistance,
  shouldPlaySoundAtDistance,
} from './sound-frequency-curve.js';
import {
  DEFAULT_DISPLAY_INPUTS,
  calculateDisplayCalibration,
  degreesToPixels,
} from './visual-angle.js';
import {
  CONFIDENCE_LEVEL,
  calculateGazeConfidenceEllipse,
  confidenceShadeOpacity,
} from './gaze-confidence.js';
import {
  DEFAULT_GAZE_SAMPLE_RATE_HZ,
  DEFAULT_GAZE_TIME_WINDOW_MS,
  MAX_GAZE_SAMPLE_RATE_HZ,
  MIN_GAZE_SAMPLE_RATE_HZ,
  MIN_GAZE_TIME_WINDOW_MS,
  advanceGazeSamplingClock,
  calculateGazeSamplingSettings,
  shouldAcceptGazeSample,
  trimGazeSamplesToWindow,
} from './gaze-sampling.js';

const CALIBRATION_POINTS = [
  [10, 10],
  [50, 10],
  [90, 10],
  [10, 50],
  [50, 50],
  [90, 50],
  [10, 90],
  [50, 90],
  [90, 90],
];

const VALIDATION_POINTS = [
  [25, 25],
  [75, 25],
  [50, 50],
  [25, 75],
  [75, 75],
];

const VALIDATION_TASK = 'gaze-test-validation';
const VALIDATION_ROI_RADIUS_PX = 200;
const MINIMUM_VALIDATION_PERCENT = 50;
const SWEEP_DURATION_MS = 8000;
const SWEEP_LEFT_FRACTION = 0.1;
const SWEEP_RIGHT_FRACTION = 0.9;
const GAZE_STALE_MS = 1000;
const DEFAULT_GAZE_THRESHOLD_DEGREES = 5;
const SOUND_EFFECTS = {
  alert: {
    label: 'Alert',
    source: '/audio/alert.mp3',
  },
  ding: {
    label: 'Ding',
    source: '/audio/ding.mp3',
  },
  'wooden-fish': {
    label: 'Wooden fish',
    source: '/audio/wooden-fish.mp3',
  },
  none: {
    label: 'None',
    source: null,
  },
};

let nextSessionAction = 'recalibrate';
let animationFrameId = null;
let gazeListenerActive = false;
let gazeStaleTimerId = null;
let gazeSamples = [];
let confidenceBoundAvailable = false;
let gazeSamplingClockTime = null;
let gazeTimeWindowMs = DEFAULT_GAZE_TIME_WINDOW_MS;
let gazeSampleRateHz = DEFAULT_GAZE_SAMPLE_RATE_HZ;
let showConfidenceRadius = false;
let enableGazeColorChange = true;
let selectedSoundEffect = null;
let selectedSoundCurve = 'square';
let playSoundWithinInnerZone = true;
let gazeThresholdDegrees = DEFAULT_GAZE_THRESHOLD_DEGREES;
let displayCalibration = calculateDisplayCalibration(DEFAULT_DISPLAY_INPUTS);
let gazeAudioContext = null;
let soundBeatTimerId = null;
let soundPlaybackActive = false;
let currentSoundBeatIntervalMs = GAZE_SOUND_MAX_INTERVAL_MS;
let lastSoundBeatTime = null;

const soundBuffers = new Map();
const soundLoadPromises = new Map();
const soundLoadErrors = new Map();
const activeSoundSources = new Set();

const jsPsych = initJsPsych({
  display_element: 'jspsych-target',
  extensions: [
    {
      type: webgazerExtension,
      params: {
        round_predictions: false,
        sampling_interval: 1000 / DEFAULT_GAZE_SAMPLE_RATE_HZ,
      },
    },
  ],
});

function card(title, content, extraClass = '') {
  const className = ['gaze-test-card', extraClass].filter(Boolean).join(' ');
  return `
    <section class="${className}">
      <h1>${title}</h1>
      ${content}
    </section>
  `;
}

function getGazeAudioContext() {
  if (gazeAudioContext !== null) {
    return gazeAudioContext;
  }

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser does not support the Web Audio API.');
  }

  gazeAudioContext = new AudioContextConstructor();
  return gazeAudioContext;
}

function loadSoundEffect(soundEffect, retryAfterError = false) {
  if (soundEffect === 'none') {
    return Promise.resolve(null);
  }

  const soundConfig = SOUND_EFFECTS[soundEffect];
  if (!soundConfig?.source) {
    return Promise.reject(new Error(`Unknown sound effect: ${soundEffect}`));
  }

  if (soundBuffers.has(soundEffect)) {
    return Promise.resolve(soundBuffers.get(soundEffect));
  }

  if (soundLoadPromises.has(soundEffect)) {
    return soundLoadPromises.get(soundEffect);
  }

  if (soundLoadErrors.has(soundEffect) && !retryAfterError) {
    return Promise.reject(soundLoadErrors.get(soundEffect));
  }

  soundLoadErrors.delete(soundEffect);

  const loadPromise = Promise.resolve()
    .then(async () => {
      const response = await window.fetch(soundConfig.source);
      if (!response.ok) {
        throw new Error(`Could not load ${soundConfig.source} (${response.status}).`);
      }

      const audioData = await response.arrayBuffer();
      const audioBuffer = await getGazeAudioContext().decodeAudioData(audioData);
      soundBuffers.set(soundEffect, audioBuffer);
      return audioBuffer;
    })
    .catch((error) => {
      soundLoadErrors.set(soundEffect, error);
      throw error;
    })
    .finally(() => {
      soundLoadPromises.delete(soundEffect);
    });

  soundLoadPromises.set(soundEffect, loadPromise);
  return loadPromise;
}

function preloadSoundEffects() {
  Object.keys(SOUND_EFFECTS).forEach((soundEffect) => {
    if (soundEffect !== 'none') {
      loadSoundEffect(soundEffect).catch(() => {
        // The selection page exposes the error and lets the participant retry.
      });
    }
  });
}

function resumeGazeAudioContext() {
  if (selectedSoundEffect === null || selectedSoundEffect === 'none') {
    return;
  }

  try {
    const audioContext = getGazeAudioContext();
    if (audioContext.state !== 'running') {
      audioContext.resume().catch((error) => {
        console.error('Unable to start gaze sound playback.', error);
      });
    }
  } catch (error) {
    console.error('Unable to start gaze sound playback.', error);
  }
}

function gazeSoundInterval(distanceFromCrosshair) {
  const maximumDistance = Math.hypot(window.innerWidth / 2, window.innerHeight / 2);
  return intervalForDistance(
    distanceFromCrosshair,
    maximumDistance,
    selectedSoundCurve,
    getGazeThresholdPx(),
  );
}

function getGazeThresholdPx() {
  return degreesToPixels(gazeThresholdDegrees, displayCalibration.pixelsPerDegree);
}

function clearSoundBeatTimer() {
  if (soundBeatTimerId !== null) {
    window.clearTimeout(soundBeatTimerId);
    soundBeatTimerId = null;
  }
}

function stopActiveSoundSources() {
  activeSoundSources.forEach((source) => {
    source.onended = null;

    try {
      source.stop();
    } catch {
      // A source that ended naturally no longer needs to be stopped.
    }

    source.disconnect();
  });
  activeSoundSources.clear();
}

function stopGazeSoundPlayback(preserveLastBeatTime = false) {
  clearSoundBeatTimer();
  stopActiveSoundSources();
  soundPlaybackActive = false;
  currentSoundBeatIntervalMs = GAZE_SOUND_MAX_INTERVAL_MS;
  if (!preserveLastBeatTime) {
    lastSoundBeatTime = null;
  }
}

function playGazeSoundBeat() {
  const audioBuffer = soundBuffers.get(selectedSoundEffect);
  if (!audioBuffer) {
    return false;
  }

  let audioContext;
  try {
    audioContext = getGazeAudioContext();
  } catch {
    return false;
  }

  if (audioContext.state !== 'running') {
    resumeGazeAudioContext();
    return false;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    activeSoundSources.delete(source);
    source.disconnect();
  };

  activeSoundSources.add(source);

  try {
    source.start();
    lastSoundBeatTime = performance.now();
    return true;
  } catch {
    activeSoundSources.delete(source);
    source.onended = null;
    source.disconnect();
    return false;
  }
}

function scheduleNextSoundBeat() {
  clearSoundBeatTimer();

  if (!soundPlaybackActive || lastSoundBeatTime === null) {
    return;
  }

  const delay = delayUntilNextNotification(
    lastSoundBeatTime,
    performance.now(),
    currentSoundBeatIntervalMs,
  );

  soundBeatTimerId = window.setTimeout(() => {
    soundBeatTimerId = null;

    if (!soundPlaybackActive) {
      return;
    }

    if (!playGazeSoundBeat()) {
      stopGazeSoundPlayback();
      return;
    }

    scheduleNextSoundBeat();
  }, delay);
}

function updateGazeSound(distanceFromCrosshair) {
  if (
    selectedSoundEffect === null ||
    selectedSoundEffect === 'none' ||
    !soundBuffers.has(selectedSoundEffect)
  ) {
    stopGazeSoundPlayback();
    return;
  }

  if (
    !shouldPlaySoundAtDistance(
      distanceFromCrosshair,
      playSoundWithinInnerZone,
      getGazeThresholdPx(),
    )
  ) {
    stopGazeSoundPlayback(true);
    return;
  }

  currentSoundBeatIntervalMs = gazeSoundInterval(distanceFromCrosshair);

  if (!soundPlaybackActive) {
    soundPlaybackActive = true;
    if (lastSoundBeatTime === null && !playGazeSoundBeat()) {
      soundPlaybackActive = false;
      return;
    }
  }

  scheduleNextSoundBeat();
}

function setGazePointVisible(visible) {
  document.getElementById('gaze-point')?.classList.toggle('is-visible', visible);
  document
    .getElementById('gaze-confidence-bound')
    ?.classList.toggle(
      'is-visible',
      visible && showConfidenceRadius && confidenceBoundAvailable,
    );
}

function clearGazeStaleTimer() {
  if (gazeStaleTimerId !== null) {
    window.clearTimeout(gazeStaleTimerId);
    gazeStaleTimerId = null;
  }
}

function resetGazeDisplay(preserveLastSoundBeatTime = false) {
  clearGazeStaleTimer();
  stopGazeSoundPlayback(preserveLastSoundBeatTime);
  gazeSamples = [];
  confidenceBoundAvailable = false;
  gazeSamplingClockTime = null;
  setGazePointVisible(false);
}

function scheduleGazeStaleReset() {
  clearGazeStaleTimer();
  gazeStaleTimerId = window.setTimeout(
    () => resetGazeDisplay(true),
    GAZE_STALE_MS,
  );
}

function renderConfidenceBound(confidenceEllipse, color) {
  const confidenceBound = document.getElementById('gaze-confidence-bound');
  if (!confidenceBound || confidenceEllipse.sampleCount < 2) {
    confidenceBoundAvailable = false;
    confidenceBound?.classList.remove('is-visible');
    return;
  }

  // Cap DOM dimensions for pathological off-screen predictions while still
  // allowing the shade to extend well beyond the viewport.
  const maximumRenderRadius = Math.hypot(window.innerWidth, window.innerHeight) * 2;
  const semiMajorRadius = Math.min(
    confidenceEllipse.semiMajorRadius,
    maximumRenderRadius,
  );
  const semiMinorRadius = Math.min(
    confidenceEllipse.semiMinorRadius,
    maximumRenderRadius,
  );
  const opacityReferenceRadius = Math.max(
    1,
    Math.min(window.innerWidth, window.innerHeight) * 0.25,
  );
  const shadeOpacity = confidenceShadeOpacity(
    confidenceEllipse.semiMajorRadius,
    opacityReferenceRadius,
  );

  confidenceBound.style.left = `${confidenceEllipse.mean.x}px`;
  confidenceBound.style.top = `${confidenceEllipse.mean.y}px`;
  confidenceBound.style.width = `${Math.max(2, semiMajorRadius * 2)}px`;
  confidenceBound.style.height = `${Math.max(2, semiMinorRadius * 2)}px`;
  confidenceBound.style.backgroundColor = color;
  confidenceBound.style.transform = `translate(-50%, -50%) rotate(${confidenceEllipse.angleRadians}rad)`;
  confidenceBound.style.setProperty('--gaze-confidence-opacity', String(shadeOpacity));
  confidenceBoundAvailable = true;
}

function updateGazeDisplay(data) {
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    setGazePointVisible(false);
    stopGazeSoundPlayback(true);
    return;
  }

  const now = performance.now();
  if (!shouldAcceptGazeSample(gazeSamplingClockTime, now, gazeSampleRateHz)) {
    return;
  }
  gazeSamplingClockTime = advanceGazeSamplingClock(
    gazeSamplingClockTime,
    now,
    gazeSampleRateHz,
  );

  gazeSamples.push({ time: now, x: data.x, y: data.y });
  trimGazeSamplesToWindow(gazeSamples, now, gazeTimeWindowMs);

  const confidenceEllipse = calculateGazeConfidenceEllipse(gazeSamples);
  const averagedPosition = confidenceEllipse.mean;

  const gazePoint = document.getElementById('gaze-point');
  if (!gazePoint) {
    stopGazeSoundPlayback();
    return;
  }

  const distanceFromCrosshair = Math.hypot(
    averagedPosition.x - window.innerWidth / 2,
    averagedPosition.y - window.innerHeight / 2,
  );
  const gazeIsOnScreen =
    averagedPosition.x >= 0 &&
    averagedPosition.x <= window.innerWidth &&
    averagedPosition.y >= 0 &&
    averagedPosition.y <= window.innerHeight;

  gazePoint.style.left = `${averagedPosition.x}px`;
  gazePoint.style.top = `${averagedPosition.y}px`;

  const gazeColor =
    enableGazeColorChange && distanceFromCrosshair > getGazeThresholdPx()
      ? '#ef4444'
      : '#2563eb';
  gazePoint.style.backgroundColor = gazeColor;

  if (showConfidenceRadius) {
    renderConfidenceBound(confidenceEllipse, gazeColor);
  } else {
    confidenceBoundAvailable = false;
    document.getElementById('gaze-confidence-bound')?.classList.remove('is-visible');
  }
  scheduleGazeStaleReset();

  if (!gazeIsOnScreen) {
    setGazePointVisible(false);
    stopGazeSoundPlayback(true);
    return;
  }

  setGazePointVisible(true);
  updateGazeSound(distanceFromCrosshair);
}

function animateTarget(startTime) {
  const target = document.getElementById('moving-target');
  if (!target) {
    return;
  }

  const drawFrame = (timestamp) => {
    const elapsedLegs = (timestamp - startTime) / SWEEP_DURATION_MS;
    const legIndex = Math.floor(elapsedLegs);
    const legProgress = elapsedLegs - legIndex;
    const horizontalProgress = legIndex % 2 === 0 ? legProgress : 1 - legProgress;
    const horizontalFraction =
      SWEEP_LEFT_FRACTION +
      horizontalProgress * (SWEEP_RIGHT_FRACTION - SWEEP_LEFT_FRACTION);

    target.style.left = `${window.innerWidth * horizontalFraction}px`;
    target.style.top = `${window.innerHeight / 2}px`;
    animationFrameId = window.requestAnimationFrame(drawFrame);
  };

  animationFrameId = window.requestAnimationFrame(drawFrame);
}

function startPursuitTest() {
  document.body.classList.add('gaze-test-running');
  resetGazeDisplay();

  const gazeTracker = window.webgazer;
  animateTarget(performance.now());

  if (!gazeTracker?.isReady()) {
    return;
  }

  // The raw listener fires for newly generated predictions. Polling
  // getCurrentPrediction() can return the same cached position repeatedly.
  gazeTracker.setGazeListener(updateGazeDisplay);
  gazeListenerActive = true;
  gazeTracker.resume();
}

function stopPursuitTest() {
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (gazeListenerActive) {
    window.webgazer?.clearGazeListener();
    gazeListenerActive = false;
  }

  resetGazeDisplay();
  document.body.classList.remove('gaze-test-running');
  jsPsych.extensions.webgazer.pause();
}

function latestValidationNeedsRetry() {
  const validationRows = jsPsych.data.get().filter({ task: VALIDATION_TASK }).values();
  const latestValidation = validationRows.at(-1);
  const percentages = latestValidation?.percent_in_roi;

  return (
    !Array.isArray(percentages) ||
    percentages.some((percentage) => percentage < MINIMUM_VALIDATION_PERCENT)
  );
}

const cameraInstructions = {
  type: htmlButtonResponse,
  stimulus: card(
    'Camera permission required',
    `
      <p>This eye-gaze test needs access to your camera.</p>
      <p>The browser will ask for permission on the next screen. Camera initialization can take up to 30 seconds.</p>
      <p class="secondary-copy">Camera access is requested before fullscreen so the permission prompt remains visible.</p>
    `,
  ),
  choices: ['Continue'],
};

const initializeCamera = {
  type: webgazerInitCamera,
};

const displayCalibrationTrial = {
  type: htmlButtonResponse,
  stimulus: card(
    'Display calibration',
    `
      <p id="display-calibration-help">Enter the current display setup so gaze distance can be converted from pixels to visual degrees.</p>
      <div class="display-calibration-grid" aria-describedby="display-calibration-help">
        <fieldset class="display-calibration-group">
          <legend>Screen resolution</legend>
          <label>
            <span>Width</span>
            <span class="input-with-unit">
              <input id="display-resolution-width" type="number" min="1" step="1" value="${DEFAULT_DISPLAY_INPUTS.resolutionWidthPx}" />
              <span>px</span>
            </span>
          </label>
          <label>
            <span>Height</span>
            <span class="input-with-unit">
              <input id="display-resolution-height" type="number" min="1" step="1" value="${DEFAULT_DISPLAY_INPUTS.resolutionHeightPx}" />
              <span>px</span>
            </span>
          </label>
        </fieldset>
        <fieldset class="display-calibration-group">
          <legend>Screen dimensions</legend>
          <label>
            <span>Width</span>
            <span class="input-with-unit">
              <input id="display-width-cm" type="number" min="0.1" step="0.1" value="${DEFAULT_DISPLAY_INPUTS.screenWidthCm}" />
              <span>cm</span>
            </span>
          </label>
          <label>
            <span>Height</span>
            <span class="input-with-unit">
              <input id="display-height-cm" type="number" min="0.1" step="0.1" value="${DEFAULT_DISPLAY_INPUTS.screenHeightCm}" />
              <span>cm</span>
            </span>
          </label>
        </fieldset>
        <fieldset class="display-calibration-group">
          <legend>Viewing distance</legend>
          <label>
            <span>Eyes to screen</span>
            <span class="input-with-unit">
              <input id="display-viewing-distance-cm" type="number" min="0.1" step="0.5" value="${DEFAULT_DISPLAY_INPUTS.viewingDistanceCm}" />
              <span>cm</span>
            </span>
          </label>
        </fieldset>
      </div>
      <div class="display-calibration-preview" role="status" aria-live="polite">
        <span>Pixels per visual degree</span>
        <strong id="display-pixels-per-degree">${displayCalibration.pixelsPerDegree.toFixed(2)}</strong>
      </div>
      <p class="display-calibration-error" id="display-calibration-error" hidden>Enter a positive number in every field.</p>
    `,
  ),
  choices: ['Continue'],
  button_html: (choice) => `<button class="jspsych-btn" id="continue-display-calibration">${choice}</button>`,
  data: {
    task: 'display-calibration',
  },
  on_load: () => {
    const continueButton = document.getElementById('continue-display-calibration');
    const preview = document.getElementById('display-pixels-per-degree');
    const errorElement = document.getElementById('display-calibration-error');
    const inputs = {
      resolutionWidthPx: document.getElementById('display-resolution-width'),
      resolutionHeightPx: document.getElementById('display-resolution-height'),
      screenWidthCm: document.getElementById('display-width-cm'),
      screenHeightCm: document.getElementById('display-height-cm'),
      viewingDistanceCm: document.getElementById('display-viewing-distance-cm'),
    };

    const updateCalibration = () => {
      const values = Object.fromEntries(
        Object.entries(inputs).map(([name, input]) => [name, Number(input?.value)]),
      );

      try {
        displayCalibration = calculateDisplayCalibration(values);
        preview.textContent = displayCalibration.pixelsPerDegree.toFixed(2);
        errorElement.hidden = true;
        continueButton.disabled = false;
        Object.values(inputs).forEach((input) => input.removeAttribute('aria-invalid'));
      } catch {
        preview.textContent = '—';
        errorElement.hidden = false;
        continueButton.disabled = true;
        Object.values(inputs).forEach((input) => input.setAttribute('aria-invalid', 'true'));
      }
    };

    Object.values(inputs).forEach((input) => input.addEventListener('input', updateCalibration));
    updateCalibration();
  },
  on_finish: (data) => {
    data.display_calibration = { ...displayCalibration };
    jsPsych.data.addProperties({
      display_calibration: { ...displayCalibration },
    });
  },
};

function enterFullscreenTrial(message) {
  return {
    type: fullscreen,
    fullscreen_mode: true,
    message: card(
      'Enter fullscreen',
      `<p>${message}</p><p class="secondary-copy">Fullscreen provides stable screen coordinates for calibration and gaze feedback.</p>`,
    ),
    button_label: 'Enter Fullscreen',
    delay_after: 500,
  };
}

const calibrationInstructions = {
  type: htmlButtonResponse,
  stimulus: card(
    'Calibrate eye tracking',
    `
      <p>Look directly at each dot and click it.</p>
      <p>Keep your head reasonably still and continue looking at the dot while you click.</p>
    `,
  ),
  choices: ['Start Calibration'],
};

const calibration = {
  type: webgazerCalibrate,
  calibration_points: CALIBRATION_POINTS,
  repetitions_per_point: 2,
  randomize_calibration_order: true,
};

const validationInstructions = {
  type: htmlButtonResponse,
  stimulus: card(
    'Check calibration accuracy',
    `
      <p>Look at each dot as it appears.</p>
      <p><strong>Do not click the validation dots.</strong></p>
    `,
  ),
  choices: ['Start Validation'],
  post_trial_gap: 1000,
};

function validationTrial() {
  return {
    type: webgazerValidate,
    validation_points: VALIDATION_POINTS,
    roi_radius: VALIDATION_ROI_RADIUS_PX,
    time_to_saccade: 1000,
    validation_duration: 2000,
    data: {
      task: VALIDATION_TASK,
    },
    on_start: () => {
      document.body.style.cursor = 'none';
    },
    on_finish: () => {
      document.body.style.cursor = '';
    },
  };
}

const automaticRecalibration = {
  timeline: [
    {
      type: htmlButtonResponse,
      stimulus: card(
        'Let’s recalibrate once',
        '<p>The measured accuracy was below the target at one or more positions. We will repeat calibration once.</p>',
      ),
      choices: ['Recalibrate'],
    },
    calibration,
    validationInstructions,
    validationTrial(),
  ],
  conditional_function: latestValidationNeedsRetry,
};

const calibrationSequence = [
  calibrationInstructions,
  calibration,
  validationInstructions,
  validationTrial(),
  automaticRecalibration,
];

const calibrationBranch = {
  timeline: [
    enterFullscreenTrial('Continue to calibrate the eye tracker and run the motion test.'),
    ...calibrationSequence,
  ],
  conditional_function: () => nextSessionAction === 'recalibrate',
};

const repeatBranch = {
  timeline: [enterFullscreenTrial('Continue to run the motion test again with the current calibration.')],
  conditional_function: () => nextSessionAction === 'repeat',
};

function soundEffectOptionsMarkup() {
  return Object.entries(SOUND_EFFECTS)
    .map(
      ([value, config]) => `
        <label class="sound-effect-option">
          <input type="radio" name="gaze-sound-effect" value="${value}" />
          <span class="sound-effect-option-body">
            <span class="sound-effect-option-name">${config.label}</span>
          </span>
        </label>
      `,
    )
    .join('');
}

function updatePursuitStartAvailability(startButton) {
  startButton.disabled =
    startButton.dataset.samplingControlsValid !== 'true' ||
    startButton.dataset.soundControlsValid !== 'true';
}

function setupGazeSamplingControls(startButton) {
  const timeWindowInput = document.getElementById('gaze-time-window-ms');
  const sampleRateInput = document.getElementById('gaze-sample-rate-hz');
  const samplingSummary = document.getElementById('gaze-sampling-summary');
  const samplingError = document.getElementById('gaze-sampling-error');

  if (!timeWindowInput || !sampleRateInput || !samplingSummary || !samplingError) {
    return;
  }

  timeWindowInput.value = String(gazeTimeWindowMs);
  sampleRateInput.value = String(gazeSampleRateHz);

  const updateSamplingSettings = () => {
    const timeWindowMs = Number(timeWindowInput.value);
    const sampleRateHz = Number(sampleRateInput.value);
    const timeWindowIsValid =
      Number.isFinite(timeWindowMs) &&
      timeWindowMs >= MIN_GAZE_TIME_WINDOW_MS;
    const sampleRateIsValid =
      Number.isFinite(sampleRateHz) &&
      sampleRateHz >= MIN_GAZE_SAMPLE_RATE_HZ &&
      sampleRateHz <= MAX_GAZE_SAMPLE_RATE_HZ;

    timeWindowInput.toggleAttribute('aria-invalid', !timeWindowIsValid);
    sampleRateInput.toggleAttribute('aria-invalid', !sampleRateIsValid);
    samplingError.hidden = timeWindowIsValid && sampleRateIsValid;
    startButton.dataset.samplingControlsValid = String(
      timeWindowIsValid && sampleRateIsValid,
    );

    if (timeWindowIsValid && sampleRateIsValid) {
      const settings = calculateGazeSamplingSettings({ timeWindowMs, sampleRateHz });
      gazeTimeWindowMs = settings.timeWindowMs;
      gazeSampleRateHz = settings.sampleRateHz;

      const intervalLabel = settings.sampleIntervalMs.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
      const sampleCountLabel = settings.estimatedSamplesPerWindow.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
      samplingSummary.textContent = `Target interval: ${intervalLabel} ms; about ${sampleCountLabel} samples per window. Windows may overlap. The actual rate is limited by WebGazer’s prediction rate.`;
    } else {
      samplingSummary.textContent = '';
    }

    updatePursuitStartAvailability(startButton);
  };

  timeWindowInput.addEventListener('input', updateSamplingSettings);
  sampleRateInput.addEventListener('input', updateSamplingSettings);
  updateSamplingSettings();
}

function setupGazeFeedbackControls() {
  const confidenceRadiusInput = document.getElementById('gaze-confidence-radius');
  const colorChangeInput = document.getElementById('gaze-color-change');

  if (!confidenceRadiusInput || !colorChangeInput) {
    return;
  }

  confidenceRadiusInput.checked = showConfidenceRadius;
  colorChangeInput.checked = enableGazeColorChange;

  confidenceRadiusInput.addEventListener('change', () => {
    showConfidenceRadius = confidenceRadiusInput.checked;
  });
  colorChangeInput.addEventListener('change', () => {
    enableGazeColorChange = colorChangeInput.checked;
  });
}

function setupSoundEffectSelector() {
  const fieldset = document.getElementById('sound-effect-fieldset');
  const statusElement = document.getElementById('sound-effect-status');
  const soundInputs = Array.from(
    document.querySelectorAll('input[name="gaze-sound-effect"]'),
  );
  const innerZoneSelect = document.getElementById('gaze-inner-zone-select');
  const thresholdInput = document.getElementById('gaze-threshold-degrees');
  const thresholdPixels = document.getElementById('gaze-threshold-pixels');
  const thresholdError = document.getElementById('gaze-threshold-error');
  const curveSelect = document.getElementById('gaze-curve-select');
  const startButton = document.querySelector(
    '#jspsych-html-button-response-btngroup button[data-choice="0"]',
  );

  if (
    !fieldset ||
    !statusElement ||
    soundInputs.length === 0 ||
    !innerZoneSelect ||
    !thresholdInput ||
    !thresholdPixels ||
    !thresholdError ||
    !curveSelect ||
    !startButton
  ) {
    return;
  }

  let selectionVersion = 0;
  let soundSelectionReady = false;

  const thresholdIsValid = () => {
    const threshold = Number(thresholdInput.value);
    return Number.isFinite(threshold) && threshold >= 0.1 && threshold <= 90;
  };

  const updateStartAvailability = () => {
    startButton.dataset.soundControlsValid = String(
      soundSelectionReady && thresholdIsValid(),
    );
    updatePursuitStartAvailability(startButton);
  };

  const setStatus = (state, message) => {
    statusElement.classList.remove('is-loading', 'is-ready', 'is-error');
    if (state !== null) {
      statusElement.classList.add(`is-${state}`);
    }
    statusElement.textContent = message;
    fieldset.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  };

  const applySelection = async (soundEffect) => {
    const currentSelectionVersion = ++selectionVersion;
    selectedSoundEffect = soundEffect;
    soundSelectionReady = false;
    updateStartAvailability();

    if (soundEffect === 'none') {
      setStatus('ready', 'No sound feedback will play.');
      soundSelectionReady = true;
      updateStartAvailability();
      return;
    }

    const soundConfig = SOUND_EFFECTS[soundEffect];
    if (!soundConfig) {
      setStatus('error', 'Choose a valid sound effect.');
      return;
    }

    if (soundBuffers.has(soundEffect)) {
      setStatus('ready', `${soundConfig.label} is ready.`);
      soundSelectionReady = true;
      updateStartAvailability();
      return;
    }

    setStatus('loading', `Loading ${soundConfig.label.toLowerCase()}…`);

    try {
      await loadSoundEffect(soundEffect, soundLoadErrors.has(soundEffect));
    } catch (error) {
      if (
        currentSelectionVersion !== selectionVersion ||
        selectedSoundEffect !== soundEffect ||
        !document.contains(startButton)
      ) {
        return;
      }

      console.error(`Unable to load ${soundConfig.label}.`, error);
      setStatus(
        'error',
        `${soundConfig.label} could not be loaded. Select it again to retry, or choose another option.`,
      );
      return;
    }

    if (
      currentSelectionVersion !== selectionVersion ||
      selectedSoundEffect !== soundEffect ||
      !document.contains(startButton)
    ) {
      return;
    }

    setStatus('ready', `${soundConfig.label} is ready.`);
    soundSelectionReady = true;
    updateStartAvailability();
  };

  startButton.dataset.soundControlsValid = 'false';
  updatePursuitStartAvailability(startButton);
  innerZoneSelect.value = playSoundWithinInnerZone ? 'play' : 'mute';
  thresholdInput.value = String(gazeThresholdDegrees);
  curveSelect.value = selectedSoundCurve;

  innerZoneSelect.addEventListener('change', () => {
    playSoundWithinInnerZone = innerZoneSelect.value === 'play';
  });

  curveSelect.addEventListener('change', () => {
    selectedSoundCurve = curveSelect.value;
  });

  thresholdInput.addEventListener('input', () => {
    if (thresholdIsValid()) {
      gazeThresholdDegrees = Number(thresholdInput.value);
      thresholdPixels.textContent = `Equivalent to ${getGazeThresholdPx().toFixed(1)} px with this display calibration.`;
      thresholdInput.removeAttribute('aria-invalid');
      thresholdError.hidden = true;
    } else {
      thresholdPixels.textContent = '';
      thresholdInput.setAttribute('aria-invalid', 'true');
      thresholdError.hidden = false;
    }
    updateStartAvailability();
  });
  thresholdPixels.textContent = `Equivalent to ${getGazeThresholdPx().toFixed(1)} px with this display calibration.`;

  startButton.addEventListener('click', resumeGazeAudioContext, {
    capture: true,
  });

  soundInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        applySelection(input.value);
      }
    });

    input.addEventListener('click', () => {
      if (
        input.checked &&
        input.value === selectedSoundEffect &&
        soundLoadErrors.has(input.value)
      ) {
        applySelection(input.value);
      }
    });
  });

  if (selectedSoundEffect !== null) {
    const rememberedInput = soundInputs.find((input) => input.value === selectedSoundEffect);
    if (rememberedInput) {
      rememberedInput.checked = true;
      applySelection(selectedSoundEffect);
    }
  }
}

function setupPursuitOptions() {
  const startButton = document.querySelector(
    '#jspsych-html-button-response-btngroup button[data-choice="0"]',
  );
  if (!startButton) {
    return;
  }

  startButton.dataset.samplingControlsValid = 'false';
  startButton.dataset.soundControlsValid = 'false';
  startButton.disabled = true;
  setupGazeSamplingControls(startButton);
  setupGazeFeedbackControls();
  setupSoundEffectSelector();
}

const pursuitInstructions = {
  type: htmlButtonResponse,
  stimulus: card(
    'Horizontal eye-gaze test',
    `
      <p class="pursuit-setup-intro">Follow the moving black dot with your eyes. A black crosshair remains fixed at screen center. Press <span class="keycap">SPACE</span> to stop.</p>
      <div class="gaze-setup-grid">
        <fieldset class="gaze-setup-section gaze-sampling-fieldset" aria-describedby="gaze-sampling-help gaze-sampling-summary gaze-sampling-error">
          <legend>Gaze sampling</legend>
          <p class="setup-section-help" id="gaze-sampling-help">The window controls which accepted samples contribute to both the average dot and confidence radius.</p>
          <div class="gaze-sampling-controls">
            <label class="gaze-setup-control" for="gaze-time-window-ms">
              <span>Time window</span>
              <span class="parameter-input-with-unit">
                <input id="gaze-time-window-ms" type="number" min="${MIN_GAZE_TIME_WINDOW_MS}" step="1" value="${DEFAULT_GAZE_TIME_WINDOW_MS}" />
                <span>ms</span>
              </span>
            </label>
            <label class="gaze-setup-control" for="gaze-sample-rate-hz">
              <span>Sample rate</span>
              <span class="parameter-input-with-unit">
                <input id="gaze-sample-rate-hz" type="number" min="${MIN_GAZE_SAMPLE_RATE_HZ}" max="${MAX_GAZE_SAMPLE_RATE_HZ}" step="1" value="${DEFAULT_GAZE_SAMPLE_RATE_HZ}" />
                <span>Hz</span>
              </span>
            </label>
          </div>
          <p class="gaze-sampling-summary" id="gaze-sampling-summary" role="status" aria-live="polite"></p>
          <p class="gaze-sampling-error" id="gaze-sampling-error" hidden>Use a time window of at least ${MIN_GAZE_TIME_WINDOW_MS} ms and a sample rate of ${MIN_GAZE_SAMPLE_RATE_HZ}–${MAX_GAZE_SAMPLE_RATE_HZ.toLocaleString()} Hz.</p>
        </fieldset>
        <fieldset class="gaze-setup-section gaze-feedback-fieldset">
          <legend>Visual feedback</legend>
          <p class="setup-section-help">These options are independent and can be used in any combination.</p>
          <div class="gaze-feedback-options">
            <label class="gaze-feedback-toggle" for="gaze-confidence-radius">
              <span class="gaze-feedback-toggle-copy">
                <strong>Confidence radius</strong>
                <small>Show a pale blue ${Math.round(CONFIDENCE_LEVEL * 100)}% confidence ellipse.</small>
              </span>
              <input id="gaze-confidence-radius" type="checkbox" role="switch" />
              <span class="gaze-toggle-control" aria-hidden="true"></span>
            </label>
            <label class="gaze-feedback-toggle" for="gaze-color-change">
              <span class="gaze-feedback-toggle-copy">
                <strong>Color change</strong>
                <small>Change the dot and radius from blue to red outside the threshold.</small>
              </span>
              <input id="gaze-color-change" type="checkbox" role="switch" />
              <span class="gaze-toggle-control" aria-hidden="true"></span>
            </label>
          </div>
        </fieldset>
      </div>
      <fieldset class="sound-effect-fieldset" id="sound-effect-fieldset" aria-describedby="sound-effect-help sound-effect-status">
        <legend>Sound feedback</legend>
        <p class="secondary-copy" id="sound-effect-help">Choose one option before starting. Sounds repeat faster as gaze moves farther from the crosshair.</p>
        <div class="sound-effect-options">
          ${soundEffectOptionsMarkup()}
        </div>
        <div class="sound-tuning-controls">
          <label class="sound-tuning-control" for="gaze-inner-zone-select">
            <span>Sound inside threshold</span>
            <select id="gaze-inner-zone-select">
              <option value="play">Play</option>
              <option value="mute">Mute</option>
            </select>
          </label>
          <label class="sound-tuning-control" for="gaze-threshold-degrees">
            <span>Threshold (visual degrees)</span>
            <span class="threshold-input-with-unit">
              <input id="gaze-threshold-degrees" type="number" min="0.1" max="90" step="0.1" value="${DEFAULT_GAZE_THRESHOLD_DEGREES}" aria-describedby="gaze-threshold-error" />
              <span>°</span>
            </span>
            <small id="gaze-threshold-pixels" class="sound-threshold-equivalent"></small>
            <small id="gaze-threshold-error" class="sound-threshold-error" hidden>Enter 0.1–90°.</small>
          </label>
          <label class="sound-tuning-control" for="gaze-curve-select">
            <span>Frequency curve</span>
            <select id="gaze-curve-select">
              <option value="linear">Linear</option>
              <option value="square">Square: x²</option>
              <option value="exponential">Exponential: exp(x)</option>
              <option value="logarithmic">Logarithmic: log(x)</option>
            </select>
          </label>
        </div>
        <p class="sound-effect-status" id="sound-effect-status" role="status" aria-live="polite">Select a sound option to continue.</p>
      </fieldset>
    `,
    'pursuit-setup-card',
  ),
  choices: ['Start Motion Test'],
  on_load: setupPursuitOptions,
};

const pursuitTrial = {
  type: htmlKeyboardResponse,
  stimulus: `
    <div class="pursuit-stage" aria-label="Horizontal eye-gaze motion test">
      <div class="fixation-crosshair" aria-hidden="true"></div>
      <div class="moving-target" id="moving-target" aria-hidden="true"></div>
    </div>
  `,
  choices: [' '],
  data: {
    task: 'horizontal-gaze-test',
    sweep_duration_ms: SWEEP_DURATION_MS,
    sound_effect: () => selectedSoundEffect,
    sound_interval_max_ms: GAZE_SOUND_MAX_INTERVAL_MS,
    sound_interval_min_ms: GAZE_SOUND_MIN_INTERVAL_MS,
    sound_interval_mapping: () => selectedSoundCurve,
    sound_inside_threshold: () => playSoundWithinInnerZone,
    gaze_time_window_ms: () => gazeTimeWindowMs,
    gaze_sample_rate_hz: () => gazeSampleRateHz,
    gaze_sample_interval_ms: () => 1000 / gazeSampleRateHz,
    gaze_confidence_radius_enabled: () => showConfidenceRadius,
    gaze_confidence_level: () => (showConfidenceRadius ? CONFIDENCE_LEVEL : null),
    gaze_color_change_enabled: () => enableGazeColorChange,
    gaze_threshold_degrees: () => gazeThresholdDegrees,
    gaze_threshold_px: () => getGazeThresholdPx(),
    pixels_per_degree: () => displayCalibration.pixelsPerDegree,
    threshold_affects: () =>
      enableGazeColorChange
        ? 'sound-gating-frequency-curve-and-gaze-feedback-color'
        : 'sound-gating-and-frequency-curve',
    sound_max_distance_basis: 'viewport-corner-radius',
  },
  on_load: startPursuitTest,
  on_finish: stopPursuitTest,
};

const exitFullscreenTrial = {
  type: fullscreen,
  fullscreen_mode: false,
  delay_after: 0,
};

const completionChoice = {
  type: htmlButtonResponse,
  stimulus: card(
    'Motion test stopped',
    '<p>Run the same motion again with the current calibration, or recalibrate before the next run.</p>',
  ),
  choices: ['Run Motion Again', 'Recalibrate'],
  on_finish: (data) => {
    nextSessionAction = data.response === 0 ? 'repeat' : 'recalibrate';
  },
};

const repeatableTestSession = {
  timeline: [
    calibrationBranch,
    repeatBranch,
    pursuitInstructions,
    pursuitTrial,
    exitFullscreenTrial,
    completionChoice,
  ],
  loop_function: () => true,
};

preloadSoundEffects();
jsPsych.run([
  cameraInstructions,
  initializeCamera,
  displayCalibrationTrial,
  repeatableTestSession,
]);
