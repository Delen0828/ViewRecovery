import './sound-frequency-test.css';
import {
  CENTER_THRESHOLD_PX,
  CURVE_LABELS,
  INNER_SOUND_RADIUS_PX,
  MAX_INTERVAL_MS,
  intervalForDistance,
  shouldPlaySoundAtDistance,
} from './sound-frequency-curve.js';

const SLIDER_RESOLUTION = 1000;

const SOUND_EFFECTS = {
  alert: { label: 'Alert', source: '/audio/alert.mp3' },
  ding: { label: 'Ding', source: '/audio/ding.mp3' },
  'wooden-fish': { label: 'Wooden fish', source: '/audio/wooden-fish.mp3' },
  none: { label: 'None', source: null },
};

const slider = document.getElementById('distance-slider');
const distanceOutput = document.getElementById('distance-output');
const frequencyOutput = document.getElementById('frequency-output');
const intervalOutput = document.getElementById('interval-output');
const curveNote = document.getElementById('curve-note');
const innerZoneSelect = document.getElementById('inner-zone-select');
const curveSelect = document.getElementById('curve-select');
const leftDistanceLabel = document.getElementById('left-distance-label');
const rightDistanceLabel = document.getElementById('right-distance-label');
const statusElement = document.getElementById('sound-effect-status');
const soundInputs = Array.from(document.querySelectorAll('input[name="gaze-sound-effect"]'));

let maximumDistancePx = getMaximumDistance();
let currentIntervalMs = MAX_INTERVAL_MS;
let selectedSoundEffect = null;
let audioContext = null;
let soundBeatTimerId = null;
let soundPlaybackActive = false;
let lastSoundBeatTime = null;

const soundBuffers = new Map();
const soundLoadPromises = new Map();
const activeSoundSources = new Set();

function getMaximumDistance() {
  return Math.hypot(window.innerWidth / 2, window.innerHeight / 2);
}

function getDistanceFromSlider() {
  return (Math.abs(Number(slider.value)) / SLIDER_RESOLUTION) * maximumDistancePx;
}

function isMutedByInnerZone(distancePx = getDistanceFromSlider()) {
  return !shouldPlaySoundAtDistance(distancePx, innerZoneSelect.value === 'play');
}

function updateReadout() {
  const distancePx = getDistanceFromSlider();
  currentIntervalMs = intervalForDistance(distancePx, maximumDistancePx, curveSelect.value);
  const frequencyHz = 1000 / currentIntervalMs;
  const roundedDistance = Math.round(distancePx);
  const roundedInterval = Math.round(currentIntervalMs);
  const mutedByInnerZone = isMutedByInnerZone(distancePx);

  distanceOutput.value = `${roundedDistance.toLocaleString()} px`;
  frequencyOutput.value = `${frequencyHz.toFixed(2)} Hz`;
  intervalOutput.textContent = mutedByInnerZone
    ? `Muted within 500 px · Curve interval ${roundedInterval.toLocaleString()} ms`
    : `One sound every ${roundedInterval.toLocaleString()} ms`;
  curveNote.textContent = `The first ${CENTER_THRESHOLD_PX} px stay at the slowest rate; after that, the ${CURVE_LABELS[curveSelect.value]} curve controls the rate.`;
  slider.setAttribute(
    'aria-valuetext',
    `${roundedDistance} pixels from center, ${frequencyHz.toFixed(2)} hertz${mutedByInnerZone ? ', muted' : ''}`,
  );

  syncPlaybackToSettings();
}

function updateDistanceScale() {
  maximumDistancePx = getMaximumDistance();
  const label = `${Math.round(maximumDistancePx).toLocaleString()} px`;
  leftDistanceLabel.textContent = label;
  rightDistanceLabel.textContent = label;
  updateReadout();
}

function getAudioContext() {
  if (audioContext !== null) {
    return audioContext;
  }

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser does not support the Web Audio API.');
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

function loadSoundEffect(soundEffect) {
  if (soundBuffers.has(soundEffect)) {
    return Promise.resolve(soundBuffers.get(soundEffect));
  }

  if (soundLoadPromises.has(soundEffect)) {
    return soundLoadPromises.get(soundEffect);
  }

  const soundConfig = SOUND_EFFECTS[soundEffect];
  if (!soundConfig?.source) {
    return Promise.reject(new Error(`Unknown sound effect: ${soundEffect}`));
  }

  const loadPromise = window
    .fetch(soundConfig.source)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${soundConfig.source} (${response.status}).`);
      }
      return response.arrayBuffer();
    })
    .then((audioData) => getAudioContext().decodeAudioData(audioData))
    .then((audioBuffer) => {
      soundBuffers.set(soundEffect, audioBuffer);
      return audioBuffer;
    })
    .finally(() => {
      soundLoadPromises.delete(soundEffect);
    });

  soundLoadPromises.set(soundEffect, loadPromise);
  return loadPromise;
}

function setStatus(state, message) {
  statusElement.className = `sound-effect-status${state ? ` is-${state}` : ''}`;
  statusElement.textContent = message;
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
      // It is safe to ignore a source that has already finished.
    }
    source.disconnect();
  });
  activeSoundSources.clear();
}

function stopSoundPlayback() {
  clearSoundBeatTimer();
  stopActiveSoundSources();
  soundPlaybackActive = false;
  lastSoundBeatTime = null;
}

function playSoundBeat() {
  const audioBuffer = soundBuffers.get(selectedSoundEffect);
  if (!audioBuffer || !audioContext || audioContext.state !== 'running') {
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
  source.start();
  lastSoundBeatTime = performance.now();
  return true;
}

function scheduleNextSoundBeat() {
  clearSoundBeatTimer();

  if (!soundPlaybackActive || lastSoundBeatTime === null) {
    return;
  }

  const elapsedSinceLastBeat = performance.now() - lastSoundBeatTime;
  const delay = Math.max(0, currentIntervalMs - elapsedSinceLastBeat);

  soundBeatTimerId = window.setTimeout(() => {
    soundBeatTimerId = null;
    if (!soundPlaybackActive || !playSoundBeat()) {
      stopSoundPlayback();
      return;
    }
    scheduleNextSoundBeat();
  }, delay);
}

function startSoundPlayback() {
  stopSoundPlayback();
  soundPlaybackActive = true;
  if (!playSoundBeat()) {
    soundPlaybackActive = false;
    return;
  }
  scheduleNextSoundBeat();
}

function syncPlaybackToSettings() {
  if (
    selectedSoundEffect === null ||
    selectedSoundEffect === 'none' ||
    !soundBuffers.has(selectedSoundEffect)
  ) {
    return;
  }

  const soundConfig = SOUND_EFFECTS[selectedSoundEffect];
  if (isMutedByInnerZone()) {
    if (soundPlaybackActive) {
      stopSoundPlayback();
    }
    setStatus('ready', `${soundConfig.label} is muted inside 500 px.`);
    return;
  }

  setStatus('ready', `${soundConfig.label} is playing.`);
  if (soundPlaybackActive) {
    scheduleNextSoundBeat();
  } else {
    startSoundPlayback();
  }
}

async function selectSoundEffect(soundEffect) {
  selectedSoundEffect = soundEffect;
  stopSoundPlayback();

  if (soundEffect === 'none') {
    setStatus('ready', 'Sound playback is off.');
    return;
  }

  const soundConfig = SOUND_EFFECTS[soundEffect];
  if (!soundConfig) {
    setStatus('error', 'Choose a valid sound effect.');
    return;
  }

  setStatus('loading', `Loading ${soundConfig.label.toLowerCase()}…`);

  try {
    const context = getAudioContext();
    await context.resume();
    await loadSoundEffect(soundEffect);
  } catch (error) {
    console.error(`Unable to load ${soundConfig.label}.`, error);
    if (selectedSoundEffect === soundEffect) {
      setStatus('error', `${soundConfig.label} could not be loaded. Select it again to retry.`);
    }
    return;
  }

  if (selectedSoundEffect !== soundEffect) {
    return;
  }

  syncPlaybackToSettings();
}

slider.addEventListener('input', updateReadout);
innerZoneSelect.addEventListener('change', updateReadout);
curveSelect.addEventListener('change', updateReadout);

soundInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      selectSoundEffect(input.value);
    }
  });
});

window.addEventListener('resize', updateDistanceScale);
window.addEventListener('pagehide', stopSoundPlayback);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopSoundPlayback();
  } else if (selectedSoundEffect && selectedSoundEffect !== 'none' && soundBuffers.has(selectedSoundEffect)) {
    getAudioContext()
      .resume()
      .then(syncPlaybackToSettings)
      .catch(() => setStatus('error', 'Click the selected sound again to resume playback.'));
  }
});

updateDistanceScale();
