import { initJsPsych } from 'jspsych';
import htmlButtonResponse from '@jspsych/plugin-html-button-response';
import htmlKeyboardResponse from '@jspsych/plugin-html-keyboard-response';
import fullscreen from '@jspsych/plugin-fullscreen';
import webgazerCalibrate from '@jspsych/plugin-webgazer-calibrate';
import webgazerInitCamera from '@jspsych/plugin-webgazer-init-camera';
import webgazerValidate from '@jspsych/plugin-webgazer-validate';
import webgazerExtension from '@jspsych/extension-webgazer';

import './gaze-test.css';

const CALIBRATION_POINTS = [
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
const GAZE_AVERAGE_WINDOW_MS = 50;
const GAZE_STALE_MS = 1000;
const GAZE_CENTER_THRESHOLD_PX = 200;
const GAZE_SOUND_MAX_INTERVAL_MS = 1200;
const GAZE_SOUND_MIN_INTERVAL_MS = 200;
const GAZE_SOUND_INTERVAL_MAPPING = 'quadratic';
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
let selectedSoundEffect = null;
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
        sampling_interval: 34,
      },
    },
  ],
});

function card(title, content) {
  return `
    <section class="gaze-test-card">
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
  const scalableDistance = Math.max(maximumDistance - GAZE_CENTER_THRESHOLD_PX, 1);
  const distanceProgress = Math.min(
    1,
    Math.max(0, (distanceFromCrosshair - GAZE_CENTER_THRESHOLD_PX) / scalableDistance),
  );

  return (
    GAZE_SOUND_MAX_INTERVAL_MS -
    (GAZE_SOUND_MAX_INTERVAL_MS - GAZE_SOUND_MIN_INTERVAL_MS) * distanceProgress ** 2
  );
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

function stopGazeSoundPlayback() {
  clearSoundBeatTimer();
  stopActiveSoundSources();
  soundPlaybackActive = false;
  currentSoundBeatIntervalMs = GAZE_SOUND_MAX_INTERVAL_MS;
  lastSoundBeatTime = null;
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

  const elapsedSinceLastBeat = performance.now() - lastSoundBeatTime;
  const delay = Math.max(0, currentSoundBeatIntervalMs - elapsedSinceLastBeat);

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

  currentSoundBeatIntervalMs = gazeSoundInterval(distanceFromCrosshair);

  if (!soundPlaybackActive) {
    soundPlaybackActive = true;
    if (!playGazeSoundBeat()) {
      soundPlaybackActive = false;
      return;
    }
  }

  scheduleNextSoundBeat();
}

function setGazePointVisible(visible) {
  document.getElementById('gaze-point')?.classList.toggle('is-visible', visible);
}

function clearGazeStaleTimer() {
  if (gazeStaleTimerId !== null) {
    window.clearTimeout(gazeStaleTimerId);
    gazeStaleTimerId = null;
  }
}

function resetGazeDisplay() {
  clearGazeStaleTimer();
  stopGazeSoundPlayback();
  gazeSamples = [];
  setGazePointVisible(false);
}

function scheduleGazeStaleReset() {
  clearGazeStaleTimer();
  gazeStaleTimerId = window.setTimeout(resetGazeDisplay, GAZE_STALE_MS);
}

function updateGazeDisplay(data) {
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    setGazePointVisible(false);
    stopGazeSoundPlayback();
    return;
  }

  const now = performance.now();
  const sampleWindowStart = now - GAZE_AVERAGE_WINDOW_MS;

  gazeSamples.push({ time: now, x: data.x, y: data.y });
  // Keep only predictions received during the most recent time window.
  while (gazeSamples.length > 0 && gazeSamples[0].time < sampleWindowStart) {
    gazeSamples.shift();
  }

  const averagedPosition = gazeSamples.reduce(
    (total, sample) => ({ x: total.x + sample.x, y: total.y + sample.y }),
    { x: 0, y: 0 },
  );

  averagedPosition.x /= gazeSamples.length;
  averagedPosition.y /= gazeSamples.length;

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
  gazePoint.style.backgroundColor =
    distanceFromCrosshair <= GAZE_CENTER_THRESHOLD_PX ? '#2563eb' : '#ef4444';
  scheduleGazeStaleReset();

  if (!gazeIsOnScreen) {
    setGazePointVisible(false);
    stopGazeSoundPlayback();
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
    validation_points: CALIBRATION_POINTS,
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

function setupSoundEffectSelector() {
  const fieldset = document.getElementById('sound-effect-fieldset');
  const statusElement = document.getElementById('sound-effect-status');
  const soundInputs = Array.from(
    document.querySelectorAll('input[name="gaze-sound-effect"]'),
  );
  const startButton = document.querySelector(
    '#jspsych-html-button-response-btngroup button[data-choice="0"]',
  );

  if (!fieldset || !statusElement || soundInputs.length === 0 || !startButton) {
    return;
  }

  let selectionVersion = 0;

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
    startButton.disabled = true;

    if (soundEffect === 'none') {
      setStatus('ready', 'No sound feedback will play.');
      startButton.disabled = false;
      return;
    }

    const soundConfig = SOUND_EFFECTS[soundEffect];
    if (!soundConfig) {
      setStatus('error', 'Choose a valid sound effect.');
      return;
    }

    if (soundBuffers.has(soundEffect)) {
      setStatus('ready', `${soundConfig.label} is ready.`);
      startButton.disabled = false;
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
    startButton.disabled = false;
  };

  startButton.disabled = true;
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

const pursuitInstructions = {
  type: htmlButtonResponse,
  stimulus: card(
    'Horizontal eye-gaze test',
    `
      <p>Follow the moving black dot with your eyes. A black crosshair will remain fixed at screen center.</p>
      <p>The red/blue dot shows the estimated gaze position. Its color is based only on distance from the center crosshair.</p>
      <p>Press <span class="keycap">SPACE</span> at any time to stop.</p>
      <fieldset class="sound-effect-fieldset" id="sound-effect-fieldset" aria-describedby="sound-effect-help sound-effect-status">
        <legend>Sound feedback</legend>
        <p class="secondary-copy" id="sound-effect-help">Choose one option before starting. Sounds repeat faster as gaze moves farther from the crosshair.</p>
        <div class="sound-effect-options">
          ${soundEffectOptionsMarkup()}
        </div>
        <p class="sound-effect-status" id="sound-effect-status" role="status" aria-live="polite">Select a sound option to continue.</p>
      </fieldset>
    `,
  ),
  choices: ['Start Motion Test'],
  on_load: setupSoundEffectSelector,
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
    sound_distance_threshold_px: GAZE_CENTER_THRESHOLD_PX,
    sound_interval_mapping: GAZE_SOUND_INTERVAL_MAPPING,
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
jsPsych.run([cameraInstructions, initializeCamera, repeatableTestSession]);
