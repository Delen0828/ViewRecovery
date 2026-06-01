import { initJsPsych } from "jspsych";
import htmlKeyboardResponse from "@jspsych/plugin-html-keyboard-response";
import jsPsychVirtualChinrest from "@jspsych/plugin-virtual-chinrest";
import jsPsychHtmlButtonResponse from "@jspsych/plugin-html-button-response";
import jsPsychFullscreen from "@jspsych/plugin-fullscreen";
// import imageButtonResponse from '@jspsych/plugin-image-button-response';

import './style.css';
import { CENTRAL_FIXATION_TASK_CONFIG } from './experiment-config.js';
const FULLSCREEN_PROMPT_ID = 'fullscreen-return-prompt';
const FULLSCREEN_STATUS_ID = 'fullscreen-return-status';
let fullscreenPromptVisible = false;
let fullscreenMonitoringEnabled = true;

function requestBrowserFullscreen() {
  const root = document.documentElement;
  const requestFullscreenMethod = root.requestFullscreen
    || root.webkitRequestFullscreen
    || root.mozRequestFullScreen
    || root.msRequestFullscreen;

  if (!requestFullscreenMethod) {
    return Promise.reject(new Error('Fullscreen API is not supported in this browser.'));
  }

  const requestResult = requestFullscreenMethod.call(root);
  if (requestResult && typeof requestResult.then === 'function') {
    return requestResult;
  }

  return Promise.resolve();
}

function ensureFullscreenPrompt() {
  let promptElement = document.getElementById(FULLSCREEN_PROMPT_ID);
  if (promptElement) {
    return promptElement;
  }

  promptElement = document.createElement('div');
  promptElement.id = FULLSCREEN_PROMPT_ID;
  promptElement.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0, 0, 0, 0.78);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  `;

  promptElement.innerHTML = `
    <div style="max-width: 680px; width: 100%; background: #ffffff; border-radius: 12px; padding: 28px; text-align: center; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);">
      <h2 style="margin: 0 0 14px 0; font-size: 32px; color: #1f2933;">Fullscreen Required</h2>
      <p style="margin: 0 0 18px 0; font-size: 20px; color: #2d3748; line-height: 1.5;">
        You exited fullscreen mode. Please return to fullscreen to continue the experiment.
      </p>
      <button id="fullscreen-return-button" style="padding: 12px 28px; font-size: 20px; font-weight: 600; border: none; border-radius: 8px; background: #2c7be5; color: #fff; cursor: pointer;">
        Return to Fullscreen
      </button>
      <div id="${FULLSCREEN_STATUS_ID}" style="margin-top: 12px; min-height: 22px; color: #9a3412; font-size: 15px;"></div>
    </div>
  `;

  document.body.appendChild(promptElement);

  const returnButton = document.getElementById('fullscreen-return-button');
  if (returnButton) {
    returnButton.addEventListener('click', () => {
      const statusElement = document.getElementById(FULLSCREEN_STATUS_ID);
      if (statusElement) {
        statusElement.textContent = '';
      }

      requestBrowserFullscreen().catch(() => {
        if (statusElement) {
          statusElement.textContent = 'Fullscreen is blocked. Please allow fullscreen and try again.';
        }
      });
    });
  }

  return promptElement;
}

function showFullscreenPrompt() {
  if (!fullscreenMonitoringEnabled) {
    return;
  }

  const promptElement = ensureFullscreenPrompt();
  promptElement.style.display = 'flex';
  fullscreenPromptVisible = true;
}

function hideFullscreenPrompt() {
  const promptElement = document.getElementById(FULLSCREEN_PROMPT_ID);
  if (promptElement) {
    promptElement.style.display = 'none';
  }

  const statusElement = document.getElementById(FULLSCREEN_STATUS_ID);
  if (statusElement) {
    statusElement.textContent = '';
  }

  fullscreenPromptVisible = false;
}

function handleInteractionDataUpdate(record) {
  if (!selectedTask || !fullscreenMonitoringEnabled || !record || !record.event) {
    return;
  }

  if (record.event === 'fullscreenexit') {
    showFullscreenPrompt();
    jsPsych.pauseExperiment();
  } else if (record.event === 'fullscreenenter') {
    if (fullscreenPromptVisible) {
      hideFullscreenPrompt();
    }
    jsPsych.resumeExperiment();
  }
}

function handleExperimentFinish() {
  fullscreenMonitoringEnabled = false;
  hideFullscreenPrompt();
}

const jsPsych = initJsPsych({
  on_interaction_data_update: handleInteractionDataUpdate,
  on_finish: handleExperimentFinish
});
const timeline = [];
const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;

// const ColorAnimationTime = 500;
// Individual crosshair stage durations
const DURATION = 200; // 动画时长
const PRE_STIMULUS_CH_DURATION = 1000;  // Part 1: Initial crosshair before stimulus
const POST_STIMULUS_CH_DURATION = 500; // Part 3: Crosshair after stimulus  
const FEEDBACK_CH_DURATION = 1000;      // Final: Colored feedback crosshair
const CENTRAL_FIXATION_CATCH_TRIAL_PROPORTION = CENTRAL_FIXATION_TASK_CONFIG.catchTrialProportion;

// Task progress tracking
const SHOW_TASK_PROGRESS = true; // Global flag to enable/disable task progress display

// Position targeting configuration
const USE_SINGLE_POSITION = true; // Global flag to target only one position instead of all four
const TARGET_POSITION = 'left_upper'; // Which position to target when USE_SINGLE_POSITION is true

// Task routing configuration
const TASK_LINK_CONFIG = {
  Motion: {
    label: 'Motion Discrimination',
    description: 'Identify dot movement direction'
  },
  Orientation: {
    label: 'Orientation Discrimination',
    description: 'Identify stripe orientation'
  },
  Centrality: {
    label: 'Centrality Discrimination',
    description: 'Identify grid center color'
  },
  Bar: {
    label: 'Bar Comparison',
    description: 'Compare bar heights'
  }
};

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getCurrentTaskRouteSegment() {
  return window.location.pathname.split('/').filter(Boolean)[0] || '';
}

function getTaskFromRouteSegment(segment) {
  const normalizedSegment = safeDecodeURIComponent(segment).toLowerCase();
  return Object.keys(TASK_LINK_CONFIG).find(task => task.toLowerCase() === normalizedSegment) || null;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTaskLinksPage() {
  const root = document.getElementById('jspsych-target') || document.body;
  const routeSegment = getCurrentTaskRouteSegment();
  const invalidRouteMessage = routeSegment
    ? `<div class="task-link-warning">Unknown task path "/${escapeHtml(safeDecodeURIComponent(routeSegment))}". Use one of the task links below.</div>`
    : '';
  const taskLinks = Object.entries(TASK_LINK_CONFIG).map(([task, config]) => {
    const taskUrl = `${window.location.origin}/${task}`;
    return `
      <a class="task-link" href="/${task}">
        <span class="task-link-label">${config.label}</span>
        <span class="task-link-description">${config.description}</span>
        <code>${taskUrl}</code>
      </a>
    `;
  }).join('');

  root.innerHTML = `
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        background: #ccc;
        font-family: Arial, sans-serif;
      }
      .task-link-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        box-sizing: border-box;
      }
      .task-link-container {
        width: min(760px, 100%);
        background: white;
        border-radius: 10px;
        box-shadow: 0 6px 12px rgba(0,0,0,0.2);
        padding: 32px;
        color: #2c3e50;
      }
      .task-link-title {
        font-size: 28px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .task-link-subtitle {
        color: #5f6f7a;
        font-size: 16px;
        margin-bottom: 24px;
      }
      .task-link-warning {
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 6px;
        color: #856404;
        padding: 12px 14px;
        margin-bottom: 18px;
      }
      .task-link-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .task-link {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border: 2px solid #3498db;
        border-radius: 8px;
        padding: 16px;
        color: inherit;
        text-decoration: none;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .task-link:hover {
        background: #3498db;
        color: white;
      }
      .task-link-label {
        font-size: 18px;
        font-weight: bold;
      }
      .task-link-description {
        font-size: 14px;
        color: #667780;
      }
      .task-link:hover .task-link-description {
        color: #eef7ff;
      }
      .task-link code {
        margin-top: 6px;
        color: inherit;
        font-size: 13px;
        white-space: normal;
        word-break: break-all;
      }
      @media (max-width: 640px) {
        .task-link-grid {
          grid-template-columns: 1fr;
        }
        .task-link-container {
          padding: 24px;
        }
      }
    </style>
    <main class="task-link-page">
      <section class="task-link-container">
        <div class="task-link-title">View Recovery Task Links</div>
        <div class="task-link-subtitle">Open one direct task URL to start that survey.</div>
        ${invalidRouteMessage}
        <div class="task-link-grid">
          ${taskLinks}
        </div>
      </section>
    </main>
  `;
}

// The task is selected by direct URL, for example /Motion.
const selectedTask = getTaskFromRouteSegment(getCurrentTaskRouteSegment());
// let allTrialParameters = []; // Store all trial parameters for export

// Trial configuration based on testing checklist requirements
const TRIAL_CONFIG = {
  Motion: { 
    totalTrials: 320, 
    trialsPerBlock: 32, 
    blocks: 10,
    breakEvery: 64  // Break after every 2 blocks (2 * 32 = 64)
  },
  Orientation: { 
    totalTrials: 320, 
    trialsPerBlock: 32, 
    blocks: 10,
    breakEvery: 64  // Break after every 2 blocks
  },
  Centrality: { 
    totalTrials: 320, 
    trialsPerBlock: 32, 
    blocks: 10,
    breakEvery: 64  // Break after every 2 blocks (2 * 32 = 64)
  },
  Bar: { 
    totalTrials: 320, 
    trialsPerBlock: 32, 
    blocks: 10,
    breakEvery: 64  // Break after every 2 blocks (2 * 32 = 64)
  }
};

function getCentralFixationCatchTrialProportion() {
  const proportion = Number(CENTRAL_FIXATION_CATCH_TRIAL_PROPORTION);
  if (!Number.isFinite(proportion)) return 0;
  return Math.max(0, Math.min(1, proportion));
}

function getCentralFixationCatchTrialCount(totalTrials) {
  return Math.round(totalTrials * getCentralFixationCatchTrialProportion());
}

function getCentralFixationCatchTrialSlots(taskType, totalTrials) {
  const catchTrialCount = getCentralFixationCatchTrialCount(totalTrials);
  if (catchTrialCount <= 0) return new Set();

  const trialNumbers = Array.from({ length: totalTrials }, (_, index) => index + 1);
  const taskSeed = taskType
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const seed = taskSeed + Math.round(getCentralFixationCatchTrialProportion() * 100000);
  const shuffledTrialNumbers = shuffleArrayDeterministic(trialNumbers, seed);

  return new Set(shuffledTrialNumbers.slice(0, catchTrialCount));
}

// Staircase configuration - difficulty levels for adaptive testing
const STAIRCASE_CONFIG = {
  Motion: {
    parameter: 'directionRange',
    levels: [0, 20, 40, 60, 80, 100, 120, 140, 160], // degrees - higher = more difficult (0° to 160° range from vertical)
    startLevel: 0, // Start at level 0 (directionRange = 0)
    fixedParams: { motionSpeedDegreePerSecond: 10 }
  },
  Orientation: {
    parameter: 'tiltDegree', 
    levels: [0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45], // degrees - higher = more difficult (0° to 45°)
    startLevel: 0 // Start at level 0 (tiltDegree = 0)
  },
  Centrality: {
    parameter: 'centerPercentage',
    levels: [5, 10, 15, 20, 25, 30, 35, 40, 45], // percent - higher = more difficult (5% to 45%)
    startLevel: 0 // Start at level 0 (centerPercentage = 5)
  },
  Bar: {
    parameter: 'heightRatio',
    levels: [
      [1, 3], 
      [1.14, 2.86], 
      [1.29, 2.71], 
      [1.43, 2.57], 
      [1.57, 2.43], 
      [1.71, 2.29], 
      [1.86, 2.14], 
      [2, 2]
    ], // ratios - closer ratios = more difficult (lower: 1→2, higher: 3→2)
    startLevel: 0 // Start at level 0 (heightRatio = [1, 3])
  }
};

// Staircase state tracking
let staircaseState = {
  Motion: { level: 0, consecutiveCorrect: 0, consecutiveIncorrect: 0, responses: [] },
  Orientation: { level: 0, consecutiveCorrect: 0, consecutiveIncorrect: 0, responses: [] },
  Centrality: { level: 0, consecutiveCorrect: 0, consecutiveIncorrect: 0, responses: [] },
  Bar: { level: 0, consecutiveCorrect: 0, consecutiveIncorrect: 0, responses: [] }
};

// Manual pause state (press B during numbered trials)
const manualPauseState = {
  keyboardListener: null,
  listenerRegistered: false,
  isTrialAttemptActive: false,
  pauseRequested: false,
  forceEndCurrentTrial: false,
  activeTaskType: null,
  activeTrialNumber: null,
  activeTotalTrials: null,
  attemptDataCountSnapshot: 0,
  attemptStaircaseSnapshot: null
};

function cloneStaircaseState() {
  return JSON.parse(JSON.stringify(staircaseState));
}

function truncateDataToSnapshot(snapshotCount) {
  const allTrialData = jsPsych.data.get().values();
  if (Array.isArray(allTrialData) && allTrialData.length > snapshotCount) {
    allTrialData.length = snapshotCount;
  }
}

function ensureManualPauseKeyboardListener() {
  if (manualPauseState.listenerRegistered) return;

  manualPauseState.keyboardListener = jsPsych.pluginAPI.getKeyboardResponse({
    callback_function: function() {
      if (!manualPauseState.isTrialAttemptActive || manualPauseState.pauseRequested) {
        return;
      }

      manualPauseState.pauseRequested = true;
      manualPauseState.forceEndCurrentTrial = true;
      // Immediately disarm so B is ignored on the pause page itself.
      manualPauseState.isTrialAttemptActive = false;

      // End current trial now, then abort this trial-sequence timeline so we can show pause screen.
      jsPsych.finishTrial({
        manual_pause_interrupted: true,
        manual_pause_trial_number: manualPauseState.activeTrialNumber
      });
      jsPsych.abortCurrentTimeline();
    },
    valid_responses: ['b'],
    rt_method: 'performance',
    persist: true,
    allow_held_key: false
  });

  manualPauseState.listenerRegistered = true;
}

function beginManualPauseTrialAttempt(taskType, trialNum, totalTrials) {
  ensureManualPauseKeyboardListener();
  manualPauseState.isTrialAttemptActive = true;
  manualPauseState.pauseRequested = false;
  manualPauseState.forceEndCurrentTrial = false;
  manualPauseState.activeTaskType = taskType;
  manualPauseState.activeTrialNumber = trialNum;
  manualPauseState.activeTotalTrials = totalTrials;
  manualPauseState.attemptDataCountSnapshot = jsPsych.data.get().count();
  manualPauseState.attemptStaircaseSnapshot = cloneStaircaseState();
}

function endManualPauseTrialAttempt() {
  manualPauseState.isTrialAttemptActive = false;
}

function rollbackManualPauseTrialAttempt() {
  truncateDataToSnapshot(manualPauseState.attemptDataCountSnapshot);
  if (manualPauseState.attemptStaircaseSnapshot) {
    staircaseState = cloneStaircaseStateFromSnapshot(manualPauseState.attemptStaircaseSnapshot);
  }
  manualPauseState.forceEndCurrentTrial = false;
}

function cloneStaircaseStateFromSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

function isManualPauseForcedEnd(data) {
  return Boolean(
    manualPauseState.forceEndCurrentTrial ||
    (data && data.manual_pause_interrupted === true) ||
    (data && (data.response === null || typeof data.response === 'undefined') && manualPauseState.pauseRequested)
  );
}

// Default parameters for each stimulus type (used as base before applying staircase adjustments)
const STIMULUS_PARAMS = {
  Motion: {
    motionSpeedDegreePerSecond: 5, // Fixed parameter in degrees/second (matching stimulus-display.html)
    directionRange: 0            // Starting direction range (will be adjusted by staircase)
  },
  Orientation: {
    stripeSpacingDegree: 0.05, // Fixed parameter in degrees
    tiltDegree: 0             // Starting tilt degree (will be adjusted by staircase)
  },
  Centrality: {
    centerPercentage: 30  // Starting center percentage (will be adjusted by staircase)
  },
  Bar: {
    heightRatio: [1, 2]   // Starting height ratio (will be adjusted by staircase)
  }
};

// Staircase Algorithm Functions

// Reset staircase state for selected task
function resetStaircaseState(taskType) {
  if (staircaseState[taskType]) {
    staircaseState[taskType] = {
      level: STAIRCASE_CONFIG[taskType].startLevel,
      consecutiveCorrect: 0,
      consecutiveIncorrect: 0,
      responses: []
    };
    // Staircase reset
  }
}

// Get current difficulty value for a task type
function getCurrentDifficultyValue(taskType) {
  const config = STAIRCASE_CONFIG[taskType];
  const state = staircaseState[taskType];
  if (!config || !state) return null;
  
  const currentLevel = Math.max(0, Math.min(state.level, config.levels.length - 1));
  return config.levels[currentLevel];
}

// Update difficulty based on 3-up-1-down staircase rule
function updateDifficulty(taskType, isCorrect) {
  const state = staircaseState[taskType];
  const config = STAIRCASE_CONFIG[taskType];
  
  if (!state || !config) return;
  
  // Record response
  state.responses.push({
    correct: isCorrect,
    level: state.level,
    difficultyValue: getCurrentDifficultyValue(taskType)
  });
  
  if (isCorrect) {
    state.consecutiveCorrect++;
    state.consecutiveIncorrect = 0;
    
    // 3-up rule: increase difficulty after 3 consecutive correct responses
    if (state.consecutiveCorrect >= 3) {
      const newLevel = Math.min(state.level + 1, config.levels.length - 1);
      if (newLevel !== state.level) {
        state.level = newLevel;
        // Difficulty increased
      }
      state.consecutiveCorrect = 0;
    }
  } else {
    state.consecutiveIncorrect++;
    state.consecutiveCorrect = 0;
    
    // 1-down rule: decrease difficulty after 1 incorrect response
    if (state.consecutiveIncorrect >= 1) {
      const newLevel = Math.max(state.level - 1, 0);
      if (newLevel !== state.level) {
        state.level = newLevel;
        // Difficulty decreased
      }
      state.consecutiveIncorrect = 0;
    }
  }
  
  // Staircase state updated
}


// deg2Pixel function: Convert visual angles to pixel offsets using calculator data
function deg2Pixel(angleDeg, chinrestData = null, fallbackParams = {}) {
    // Try to get calculator data from jsPsych first
    const allData = jsPsych.data.get();
    const calculatorData = allData.values().find(trial => trial.calculator_data)?.calculator_data;
    
    if (calculatorData) {
        // Use calculator data for precise conversion
        // Using calculator data
        return angleDeg * calculatorData.pixelsPerDegree;
    } else if (chinrestData && chinrestData.px2deg) {
        // Fallback to chinrest data if available (commented out but kept for reference)
        // Using chinrest data
        return angleDeg * chinrestData.px2deg * 2; //deg of px2deg is double sided degree, angleDeg is one sided degree
    } else {
        // Final fallback to manual calculation with provided or default parameters
        // Using fallback parameters
        const viewingDistanceCm = fallbackParams.viewingDistanceCm || 80;
        const screenSizeCm = fallbackParams.screenSizeCm || [71, 51];
        const resolution = fallbackParams.resolution || [3840, 2160];
        
        // Original calculation method
        const physicalOffsetCm = viewingDistanceCm * Math.tan(angleDeg * Math.PI / 180);
        const pixelsPerCmX = resolution[0] / screenSizeCm[0];
        const pixelsPerCmY = resolution[1] / screenSizeCm[1];
        const pixelsPerCm = (pixelsPerCmX + pixelsPerCmY) / 2;
        
        return physicalOffsetCm * pixelsPerCm;
    }
}

function linspace(start, end, num) {
    const step = (end - start) / (num - 1);
    return Array.from({ length: num }, (_, i) => start + i * step);
}

const size = 10;
const xValues = linspace(-30, 30, size);  // left to right
const yValues = linspace(30, -30, size);  // top to bottom

const angleArray = yValues.map(y => xValues.map(x => [x, y]));


// Function to create motion stimulus
function createMotionStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, signalDirection = [-1, 1], position = 'left_upper', motionSpeedDegreePerSecond = 5, directionRange = 0) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	

	<svg id="stimulus" width="100%" height="100%"></svg>

    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // D3.js is already loaded in HTML, initialize animation directly
	//   console.log(angleArray);
      initMotionAnimation(angleArray,screenWidth,screenHeight, chinrestData, signalDirection, position, motionSpeedDegreePerSecond, directionRange);
    }
  };
}


// Function to create static grating stimulus
function createGratingStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', orientation = 'vertical', spacingDegree = 0.05, tiltDegree = 0) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
	<svg id="stimulus" width="100%" height="100%"></svg>

    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration for static display
    on_load: function() {
      // Initialize static grating display
      initGratingStimulus(angleArray,screenWidth,screenHeight, chinrestData, position, orientation, spacingDegree, tiltDegree);
    }
  };
}

// Function to create grid stimulus
function createGridStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', centerColor = 'black', centerPercentage = 25) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
    <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // Initialize grid stimulus
      initGridStimulus(angleArray,screenWidth,screenHeight, chinrestData, position, centerColor, centerPercentage);
    }
  };
}

// Function to create bar chart stimulus with adaptive heights
function createBarChartStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', heights = [1, 1]) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
     <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // Initialize bar chart stimulus
      initBarChartStimulus(angleArray,screenWidth,screenHeight, chinrestData, position, heights);
    }
  };
}

// 十字准线全局参数
const crosshairLength = 30; // 十字长度
const crosshairStroke = 2;  // 线宽

// 通用十字准线绘制函数
function drawCrosshair(svg, width, height, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke, color = 'black') {
  // 移除旧的十字
  svg.selectAll('.crosshair').remove();
  const centerX = width / 2;
  const centerY = height / 2;
  // 水平线
  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX - crosshairLen / 2)
    .attr('y1', centerY)
    .attr('x2', centerX + crosshairLen / 2)
    .attr('y2', centerY)
    .attr('stroke', color)
    .attr('stroke-width', crosshairStrokeWidth);
  // 垂直线
  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX)
    .attr('y1', centerY - crosshairLen / 2)
    .attr('x2', centerX)
    .attr('y2', centerY + crosshairLen / 2)
    .attr('stroke', color)
    .attr('stroke-width', crosshairStrokeWidth);
}

function drawXCrosshair(svg, width, height, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke, color = 'black') {
  svg.selectAll('.crosshair').remove();
  const centerX = width / 2;
  const centerY = height / 2;
  const halfLen = crosshairLen / (2 * Math.sqrt(2));

  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX - halfLen)
    .attr('y1', centerY - halfLen)
    .attr('x2', centerX + halfLen)
    .attr('y2', centerY + halfLen)
    .attr('stroke', color)
    .attr('stroke-width', crosshairStrokeWidth);

  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX - halfLen)
    .attr('y1', centerY + halfLen)
    .attr('x2', centerX + halfLen)
    .attr('y2', centerY - halfLen)
    .attr('stroke', color)
    .attr('stroke-width', crosshairStrokeWidth);
}

// Function to initialize motion animation
function initMotionAnimation(angleArray,screenWidth,screenHeight, chinrestData = null, signalDirection = [-1, 1], position = 'left_upper', motionSpeedDegreePerSecond = 5, directionRange = 0, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
	// 根据位置参数设置动画中心位置
	let animationCenterX, animationCenterY;
	const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
	
	switch(position) {
		case 'left_upper':
			animationCenterX = width / 2 - offset;
			animationCenterY = height / 2 - offset;
			break;
		case 'left_lower':
			animationCenterX = width / 2 - offset;
			animationCenterY = height / 2 + offset;
			break;
		case 'right_upper':
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 - offset;
			break;
		case 'right_lower':
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 + offset;
			break;
		default:
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 + offset;
	}
  const radius = deg2Pixel(5, chinrestData)/2;
  const dotRadius = 4;
  const numDots = 30; // All dots are now signal dots
  
  // DEBUG: Log what motion parameters are actually being used
  console.log(`🎯 INIT MOTION ANIMATION: Received directionRange = ${directionRange}°`);
  console.log(`🎯 INIT MOTION ANIMATION: Received motionSpeedDegreePerSecond = ${motionSpeedDegreePerSecond}°/s`);
  // motionSpeed is now passed as parameter

  let interval = null;
  let dots = [];
  let directions = [];
  let animationTimeout = null;
  
  // No rotation needed - dots will move within direction range from vertical
  const stimulusGroup = svg.append("g");

  function drawCircle() {
    // Clear previous circles
    stimulusGroup.selectAll("circle").remove();
    svg.selectAll(".crosshair").remove();
    
    // Draw light ring at the lost view center (in the rotated group)
    stimulusGroup.append("circle")
      .attr("cx", animationCenterX)
      .attr("cy", animationCenterY)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", "0");

    // 绘制屏幕中央的十字准线 (not rotated)
    drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
  }

  function initializeDots() {
    // Clear previous dots
    stimulusGroup.selectAll("circle:not(:first-child)").remove();
    dots = [];
    directions = [];

    for (let i = 0; i < numDots; i++) {
      let x, y;
      while (true) {
        x = Math.random() * 2 * radius - radius;
        y = Math.random() * 2 * radius - radius;
        if (x * x + y * y <= radius * radius) break;
      }
      const dot = stimulusGroup.append("circle")
        .attr("cx", animationCenterX + x)
        .attr("cy", animationCenterY + y)
        .attr("r", dotRadius)
        .attr("fill", "white"); // All dots are white
      dots.push({ elem: dot, x: x, y: y });

      // All dots are signal dots moving within direction range from vertical
      // Direction range: 0 means straight up/down, 180 means ±180° from vertical
      // signalDirection[1] > 0 means down, signalDirection[1] < 0 means up
      const baseAngle = signalDirection[1] > 0 ? 90 : -90; // 90° is down, -90° is up in standard coordinates
      const angleFromVertical = (Math.random() * 2 - 1) * directionRange; // Random angle within ±directionRange
      const radians = (baseAngle + angleFromVertical) * Math.PI / 180;
      directions.push([Math.cos(radians), Math.sin(radians)]);
    }
  }

  function updateDots() {
    // Convert degrees/second to degrees/frame by dividing by frame rate (60fps)
    const motionSpeedDegreesPerFrame = motionSpeedDegreePerSecond / 60;
    const motionSpeedPixels = deg2Pixel(motionSpeedDegreesPerFrame, chinrestData);
    for (let i = 0; i < numDots; i++) {
      let d = dots[i];
      d.x += directions[i][0] * motionSpeedPixels;
      d.y += directions[i][1] * motionSpeedPixels;

      // Check if outside the light ring
      if (d.x * d.x + d.y * d.y > radius * radius) {
        while (true) {
          let x = Math.random() * 2 * radius - radius;
          let y = Math.random() * 2 * radius - radius;
          if (x * x + y * y <= radius * radius) {
            d.x = x;
            d.y = y;
            break;
          }
        }
        // Re-randomize dot direction within range (all dots are signal dots)
        const baseAngle = signalDirection[1] > 0 ? 90 : -90; // 90° is down, -90° is up
        const angleFromVertical = (Math.random() * 2 - 1) * directionRange;
        const radians = (baseAngle + angleFromVertical) * Math.PI / 180;
        directions[i] = [Math.cos(radians), Math.sin(radians)];
      }

      d.elem
        .attr("cx", animationCenterX + d.x)
        .attr("cy", animationCenterY + d.y);
    }
  }

  function startAnimation() {
    const duration = 5; // Fixed 5 seconds
    const durationMs = duration * 1000;
    
    interval = setInterval(updateDots, 1000 / 60); // 60 fps
    
    animationTimeout = setTimeout(() => {
      stopAnimation();
    }, durationMs);
  }

  function stopAnimation() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }
  }

  drawCircle();
  initializeDots();
  startAnimation();
}


// Function to initialize static grating stimulus
function initGratingStimulus(angleArray, screenWidth, screenHeight, chinrestData = null, position = 'left_upper', orientation = 'vertical', spacingDegree = 0.05, tiltDegree = 0, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置刺激中心位置
  let stimulusCenterX, stimulusCenterY;
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
  
  switch(position) {
    case 'left_upper':
      stimulusCenterX = width / 2 - offset;
      stimulusCenterY = height / 2 - offset;
      break;
    case 'left_lower':
      stimulusCenterX = width / 2 - offset;
      stimulusCenterY = height / 2 + offset;
      break;
    case 'right_upper':
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 - offset;
      break;
    case 'right_lower':
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 + offset;
      break;
    default:
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 + offset;
  }

  function createStaticGrating(containerId, orientation = "vertical", spacing = 5) {
    // DEBUG: Log what grating parameters are actually being used
    console.log(`🎯 INIT GRATING STIMULUS: Received tiltDegree = ${tiltDegree}°`);
    console.log(`🎯 INIT GRATING STIMULUS: Received spacingDegree = ${spacingDegree}°`);
    console.log(`🎯 INIT GRATING STIMULUS: Received orientation = ${orientation}`);
    
    const radius = deg2Pixel(5, chinrestData)/2;
    const stripeWidth = 3; // 固定条纹宽度为3

    // Create a group for the rotated stimulus
    const stimulusGroup = svg.append("g")
      .attr("transform", `rotate(${tiltDegree}, ${stimulusCenterX}, ${stimulusCenterY})`);

    // Define circular clip mask (in the rotated group)
    stimulusGroup.append("clipPath")
      .attr("id", `clip-${containerId}`)
      .append("circle")
      .attr("cx", stimulusCenterX)
      .attr("cy", stimulusCenterY)
      .attr("r", radius);

    // Group for stripes (clipped and rotated)
    const g = stimulusGroup.append("g")
      .attr("clip-path", `url(#clip-${containerId})`);

    const spacingPixels = deg2Pixel(spacingDegree, chinrestData);
    const totalWidth = stripeWidth + spacingPixels; // 条纹宽度 + 间距
    
    if (orientation === "vertical") {
      // Add vertical stripes
      const numStripes = Math.ceil(width / totalWidth);
      for (let i = -numStripes; i < numStripes * 2; i++) {
        g.append("rect")
          .attr("x", i * totalWidth)
          .attr("y", 0)
          .attr("width", stripeWidth)
          .attr("height", height)
          .attr("fill", "#fff");
      }
    } else if (orientation === "horizontal") {
      // Add horizontal stripes
      const numStripes = Math.ceil(height / totalWidth);
      for (let i = -numStripes; i < numStripes * 2; i++) {
        g.append("rect")
          .attr("x", 0)
          .attr("y", i * totalWidth)
          .attr("width", width)
          .attr("height", stripeWidth)
          .attr("fill", "#fff");
      }
    }

    // Circle outline (in the rotated group)
    stimulusGroup.append("circle")
      .attr("cx", stimulusCenterX)
      .attr("cy", stimulusCenterY)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", "0");
  }

  createStaticGrating("stimulus", orientation, spacingDegree);
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

// Function to initialize grid stimulus
function initGridStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', centerColor = 'black', centerPercentage = 25, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置动画中心位置
  let animationCenterX, animationCenterY;
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
  
  switch(position) {
    case 'left_upper':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'left_lower':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 + offset;
      break;
    case 'right_upper':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'right_lower':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
      break;
    default:
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
  }

  const gridSize = 10;
  const cellSize = 10;
  
  // Calculate exact number of center cells needed
  const totalCells = gridSize * gridSize;
  const targetCenterCells = Math.round(centerPercentage / 100 * totalCells);
  
  // DEBUG: Log what percentage is actually being used
  console.log(`🎯 INIT GRID STIMULUS: Received centerPercentage = ${centerPercentage}%`);
  console.log(`Centrality ${position}: Target ${centerPercentage}% = ${targetCenterCells}/${totalCells} cells`);

  function drawStimulus(svgId) {
    const svg = d3.select(svgId);
    svg.selectAll("*").remove();  // Clear previous

    // 计算网格的起始位置，使其以计算出的中心为中心
    const gridStartX = animationCenterX - (gridSize * cellSize) / 2;
    const gridStartY = animationCenterY - (gridSize * cellSize) / 2;
    
    // Initialize grid with all cells unfilled
    let grid = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const dx = x - 4.5; // Center of 10x10 grid
        const dy = y - 4.5;
        const distFromCenter = Math.sqrt(dx * dx + dy * dy);
        grid.push({ x, y, filled: false, distFromCenter, index: y * gridSize + x });
      }
    }
    
    // Sort cells by distance from center (closest first)
    grid.sort((a, b) => a.distFromCenter - b.distFromCenter);
    
    // Fill the closest N cells to create the center pattern
    for (let i = 0; i < targetCenterCells; i++) {
      grid[i].filled = true;
    }
    
    // Add controlled noise while maintaining exact count
    // Find edge cells (filled cells next to unfilled, and vice versa) for swapping
    const noiseSwaps = Math.floor(targetCenterCells * 0.15); // 15% noise
    
    // Helper function to get neighbor indices
    function getNeighborIndices(index, size) {
      const x = index % size;
      const y = Math.floor(index / size);
      const neighbors = [];
      
      if (x > 0) neighbors.push(index - 1); // left
      if (x < size - 1) neighbors.push(index + 1); // right
      if (y > 0) neighbors.push(index - size); // top
      if (y < size - 1) neighbors.push(index + size); // bottom
      
      return neighbors;
    }
    
    // Sort back to original order first to work with grid indices
    grid.sort((a, b) => a.index - b.index);
    
    // Find edge cells for swapping
    const filledEdgeCells = [];
    const unfilledEdgeCells = [];
    
    grid.forEach((cell, idx) => {
      const neighbors = getNeighborIndices(idx, gridSize);
      const hasUnfilledNeighbor = neighbors.some(nIdx => !grid[nIdx].filled);
      const hasFilledNeighbor = neighbors.some(nIdx => grid[nIdx].filled);
      
      if (cell.filled && hasUnfilledNeighbor) {
        filledEdgeCells.push(idx);
      } else if (!cell.filled && hasFilledNeighbor) {
        unfilledEdgeCells.push(idx);
      }
    });
    
    // Randomly shuffle the edge cells
    for (let i = filledEdgeCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filledEdgeCells[i], filledEdgeCells[j]] = [filledEdgeCells[j], filledEdgeCells[i]];
    }
    for (let i = unfilledEdgeCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unfilledEdgeCells[i], unfilledEdgeCells[j]] = [unfilledEdgeCells[j], unfilledEdgeCells[i]];
    }
    
    // Swap edge cells to add noise while maintaining exact count
    const maxSwaps = Math.min(filledEdgeCells.length, unfilledEdgeCells.length, noiseSwaps);
    for (let i = 0; i < maxSwaps; i++) {
      const filledIdx = filledEdgeCells[i];
      const unfilledIdx = unfilledEdgeCells[i];
      
      // Swap the cells
      grid[filledIdx].filled = false;
      grid[unfilledIdx].filled = true;
    }
    
    // Count final center cells
    const finalCenterCells = grid.filter(cell => cell.filled).length;
    console.log(`Centrality ${position}: Final center cells=${finalCenterCells}/${totalCells} (${(finalCenterCells/totalCells*100).toFixed(1)}%)`);

    // 根据中心颜色参数决定是否翻转颜色
    if (centerColor === 'white') {
      grid.forEach(cell => cell.filled = !cell.filled);
    }

    // Draw grid
    svg.selectAll("rect")
      .data(grid)
      .enter()
      .append("rect")
      .attr("class", "cell")
      .attr("x", d => gridStartX + d.x * cellSize)
      .attr("y", d => gridStartY + d.y * cellSize)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("fill", d => d.filled ? "black" : "white")
      .attr("stroke", "#ccc")
      .attr("stroke-width", "0.5");
  }

  // Draw stimulus with current parameters
  drawStimulus("#stimulus");
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

// Function to initialize bar chart stimulus
function initBarChartStimulus(angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', heights = [1, 1], crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置动画中心位置
  let lostViewCenterX, lostViewCenterY, goodViewCenterX, goodViewCenterY;
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
  switch(position) {
    case 'upper':
      // 上位置：左柱在左视野，右柱在右视野
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 - offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 - offset;
      break;
    case 'lower':
      // 下位置：左柱在左视野，右柱在右视野
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 + offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 + offset;
      break;
    default:
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 - offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 - offset;
  }
  
  
  // DEBUG: Log what bar heights are actually being used
  console.log(`🎯 INIT BAR CHART STIMULUS: Received heights = [${heights[0]}, ${heights[1]}]`);
  
  // 使用传入的高度参数创建数据
  const data = [
    { color: "black", value: heights[0] * 30 }, // 将高度值转换为百分比
    { color: "black", value: heights[1] * 30 }
  ];
  svg.selectAll("*").remove(); // Clear previous content

  // 柱状图的尺寸
  const barWidth = 30;
  const barHeight = 100;
  
  // 在丢失视野中心绘制第一个柱状图（红色）
  const lostViewBarX = lostViewCenterX - barWidth / 2;
  const lostViewBarY = lostViewCenterY - barHeight / 2;
  
  svg.append("rect")
    .attr("x", lostViewBarX)
    .attr("y", lostViewBarY + (barHeight - (data[0].value / 100) * barHeight))
    .attr("width", barWidth)
    .attr("height", (data[0].value / 100) * barHeight)
    .attr("fill", data[0].color);
  
  // 在良好视野中心绘制第二个柱状图（蓝色）
  const goodViewBarX = goodViewCenterX - barWidth / 2;
  const goodViewBarY = goodViewCenterY - barHeight / 2;
  
  svg.append("rect")
    .attr("x", goodViewBarX)
    .attr("y", goodViewBarY + (barHeight - (data[1].value / 100) * barHeight))
    .attr("width", barWidth)
    .attr("height", (data[1].value / 100) * barHeight)
    .attr("fill", data[1].color);
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

const correctAudio = new Audio('/audio/correct.mp3');
const wrongAudio = new Audio('/audio/wrong.mp3');
correctAudio.preload = 'auto';
wrongAudio.preload = 'auto';

function playFeedbackSound(isCorrect, trialCategory = '') {
  const audio = isCorrect ? correctAudio : wrongAudio;
  const label = isCorrect ? 'correct' : 'wrong';
  const categoryText = trialCategory ? ` for ${trialCategory}` : '';

  try {
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        console.warn(`[Audio] Failed to play ${label} sound${categoryText}:`, error);
      });
    }
  } catch (error) {
    console.warn(`[Audio] Error while playing ${label} sound${categoryText}:`, error);
  }
}

// Function to save data to server
function saveDataToServer(filename, csvData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/save_data.php', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        // XHR Response received
        
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || 'Server save failed'));
            }
          } catch (e) {
            console.error('JSON Parse Error:', e);
            reject(new Error(`Invalid server response: ${xhr.responseText.substring(0, 100)}`));
          }
        } else {
          reject(new Error(`Server error: ${xhr.status} - ${xhr.responseText}`));
        }
      }
    };
    
    xhr.onerror = function() {
      reject(new Error('Network error'));
    };
    
    const postData = {
      filename: filename,
      filedata: csvData
    };
    
    xhr.send(JSON.stringify(postData));
  });
}

// Utility function to shuffle an array
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const SHARED_KEY_ICON_CSS = `
  .key-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
    height: 40px;
    padding: 0 10px;
    margin: 0 4px;
    box-sizing: border-box;
    font-family: monospace;
    font-size: 18px;
    font-weight: bold;
    color: #111;
    border: 2px solid #9b9b9b;
    border-radius: 6px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.6);
    background: linear-gradient(145deg, #f2f2f2, #d9d9d9);
  }
  .key-icon-square {
    width: 40px;
    min-width: 40px;
    padding: 0;
  }
  .key-icon-space {
    width: 86px;
    min-width: 86px;
  }
`;


// Function to create a ready screen with countdown and spacebar continue
function createReadyScreen(taskName = "next task") {
  return {
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          .ready-container {
            text-align: center;
            color: black;
          }
          .ready-title {
            font-size: 32px;
            margin-bottom: 20px;
            font-weight: bold;
          }
          .task-info {
            font-size: 20px;
            margin-bottom: 30px;
            color: #444;
          }
          .countdown {
            font-size: 48px;
            font-weight: bold;
            margin: 20px 0;
            color: #333;
          }
          .start-instruction {
            font-size: 18px;
            margin-bottom: 20px;
          }
          ${SHARED_KEY_ICON_CSS}
        </style>
        <div class="ready-container">
          <div class="ready-title">Ready to Start?</div>
          <div class="task-info">About to begin: ${taskName}</div>
          <div class="countdown" id="countdown">30</div>
          <div class="start-instruction">Press <span class="key-icon key-icon-space">SPACE</span> when you're ready to continue.</div>
        </div>
      `;
    },
    choices: [' '],
    trial_duration: null,
    on_load: function() {
      let timeLeft = 30;
      const countdownElement = document.getElementById('countdown');
      
      const timer = setInterval(() => {
        timeLeft--;
        if (countdownElement) {
          countdownElement.textContent = timeLeft;
        }
        
        // Stop the timer when it reaches 0, but don't advance the trial
        if (timeLeft <= 0) {
          clearInterval(timer);
          if (countdownElement) {
            countdownElement.textContent = '0';
          }
        }
      }, 1000);
    }
  };
}

// Helper function to create break/pause screen with 30-second visual countdown
function createBreakScreen(taskType, breakNum, totalBreaks, trialsCompleted, totalTrials, options = {}) {
  const isManualPause = options.mode === 'manual_pause';
  const titleText = isManualPause ? 'Paused' : 'Time for a Break!';
  const taskInfoHtml = isManualPause
    ? `Manual break requested (<span class="key-icon key-icon-square">B</span>)<br>${taskType} Task<br>Trial ${options.trialNum} of ${totalTrials}`
    : `Break ${breakNum} of ${totalBreaks}<br>${taskType} Task<br>Completed ${trialsCompleted} of ${totalTrials} trials`;
  const startInstructionHtml = isManualPause
    ? `Press <span class="key-icon key-icon-space">SPACE</span> when you're ready to replay this trial.`
    : `Press <span class="key-icon key-icon-space">SPACE</span> when you're ready to continue.`;

  return {
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }
        .ready-container {
          text-align: center;
          color: black;
        }
        .ready-title {
          font-size: 32px;
          margin-bottom: 20px;
          font-weight: bold;
        }
        .task-info {
          font-size: 20px;
          margin-bottom: 30px;
          color: #444;
        }
        .countdown {
          font-size: 48px;
          font-weight: bold;
          margin: 20px 0;
          color: #333;
        }
        .start-instruction {
          font-size: 18px;
          margin-bottom: 20px;
        }
        ${SHARED_KEY_ICON_CSS}
      </style>
      <div class="ready-container">
        <div class="ready-title">${titleText}</div>
        <div class="task-info">${taskInfoHtml}</div>
        <div class="countdown" id="countdown">30</div>
        <div class="start-instruction">${startInstructionHtml}</div>
      </div>
    `,
    choices: [' '],
    trial_duration: null,
    on_load: function() {
      let timeLeft = 30;
      const countdownElement = document.getElementById('countdown');
      
      const timer = setInterval(() => {
        timeLeft--;
        if (countdownElement) {
          countdownElement.textContent = timeLeft;
        }
        
        if (timeLeft <= 0) {
          clearInterval(timer);
          if (countdownElement) {
            countdownElement.textContent = '0';
          }
        }
      }, 1000);
    }
  };
}

// Function to export trial parameters to a text file
// function exportTrialParameters() {
//   if (allTrialParameters.length === 0) return;
//   
//   // Create text content with one line per trial
//   let content = 'Trial Parameters Export\n';
//   content += `Task: ${selectedTask}\n`;
//   content += `Generated: ${new Date().toISOString()}\n`;
//   content += '=' .repeat(60) + '\n\n';
//   
//   allTrialParameters.forEach((params) => {
//     let line = `Trial ${params.trial}: Type=${params.type}, Position=${params.position}`;
//     
//     // Add task-specific parameters
//     switch(params.type) {
//       case 'Motion':
//         line += `, SignalDirection=${params.signalDirection}, MotionSpeedDegreePerSecond=${params.motionSpeedDegreePerSecond}`;
//         break;
//       case 'Orientation':
//         line += `, Orientation=${params.orientation}, StripeSpacingDegree=${params.stripeSpacingDegree}`;
//         break;
//       case 'Centrality':
//         line += `, CenterColor=${params.centerColor}, CenterPercentage=${params.centerPercentage}, RatioOrder=${params.ratioOrder}`;
//         break;
//       case 'Bar':
//         line += `, Heights=${params.heights}`;
//         break;
//     }
//     
//     line += `, TiltDegree=${params.tiltDegree}, DifficultyLevel=${params.difficultyLevel}`;
//     content += line + '\n';
//   });
//   
//   // Create and download the file
//   const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
//   const filename = `trial_parameters_${selectedTask}_${timestamp}.txt`;
//   const blob = new Blob([content], { type: 'text/plain' });
//   const url = URL.createObjectURL(blob);
//   
//   const a = document.createElement('a');
//   a.href = url;
//   a.download = filename;
//   document.body.appendChild(a);
//   a.click();
//   document.body.removeChild(a);
//   URL.revokeObjectURL(url);
//   
//   console.log(`Trial parameters exported to ${filename}`);
// }

// Helper function to create progress overlay HTML
function createProgressOverlay(taskType, trialNum, totalTrials) {
  if (!SHOW_TASK_PROGRESS) return '';
  
  // Get current difficulty information
  const currentLevel = staircaseState[taskType]?.level || 0;
  const currentValue = getCurrentDifficultyValue(taskType);
  const parameterName = STAIRCASE_CONFIG[taskType]?.parameter || 'unknown';
  
  // Format difficulty value for display
  let difficultyDisplay = currentValue;
  if (Array.isArray(currentValue)) {
    difficultyDisplay = `[${currentValue.join(', ')}]`;
  } else if (typeof currentValue === 'number') {
    difficultyDisplay = currentValue.toFixed(1);
  }
  
  return `
    <div id="progress-overlay" style="
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 14px;
      font-family: Arial, sans-serif;
      z-index: 1000;
      line-height: 1.4;
    ">
      <div>Task: ${taskType} | Trial ${trialNum} of ${totalTrials}</div>
      <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">
        Difficulty Level ${currentLevel + 1}/9 | ${parameterName}: ${difficultyDisplay}
      </div>
    </div>
  `;
}

const RESPONSE_PROMPT_CONFIG = {
  Motion: {
    question: 'What direction are the dots moving?',
    primaryKey: 'ArrowUp',
    primaryKeyLabel: '↑',
    primaryLabel: 'Up',
    secondaryKey: 'ArrowDown',
    secondaryKeyLabel: '↓',
    secondaryLabel: 'Down'
  },
  Orientation: {
    question: 'What orientation are the stripes?',
    primaryKey: 'ArrowLeft',
    primaryKeyLabel: '←',
    primaryLabel: 'Vertical',
    secondaryKey: 'ArrowRight',
    secondaryKeyLabel: '→',
    secondaryLabel: 'Horizontal'
  },
  Centrality: {
    question: 'Are there more black cells or white cells?',
    primaryKey: 'ArrowLeft',
    primaryKeyLabel: '←',
    primaryLabel: 'Black',
    secondaryKey: 'ArrowRight',
    secondaryKeyLabel: '→',
    secondaryLabel: 'White'
  },
  Bar: {
    question: 'The height of the bars are',
    primaryKey: 'ArrowLeft',
    primaryKeyLabel: '←',
    primaryLabel: 'Same',
    secondaryKey: 'ArrowRight',
    secondaryKeyLabel: '→',
    secondaryLabel: 'Different'
  }
};

function getResponsePromptConfig(taskType) {
  return RESPONSE_PROMPT_CONFIG[taskType] || RESPONSE_PROMPT_CONFIG.Motion;
}

function getTaskResponseChoices(taskType) {
  const promptConfig = getResponsePromptConfig(taskType);
  return [promptConfig.primaryKey, promptConfig.secondaryKey, ' '];
}

function createKeyIcon(label, extraClass = '') {
  const className = extraClass ? `key-icon ${extraClass}` : 'key-icon';
  return `<span class="${className}">${label}</span>`;
}

const TASK_INSTRUCTION_CONFIG = {
  Motion: {
    title: 'Motion Discrimination Task',
    pageOneParagraphs: [
      'You will see dots moving in your blind field, and they will move either up or down.',
      `Using your dominant hand, press ${createKeyIcon('↑')} if the dots move upward, and ${createKeyIcon('↓')} if the dots move downward.`,
      'The program will wait for your response before moving to the next trial. If you are not sure about the direction, please make your best guess.'
    ],
    noStimulusText: 'On those trials, you will not see any moving dots.'
  },
  Orientation: {
    title: 'Orientation Discrimination Task',
    pageOneParagraphs: [
      'You will see striped gratings in your blind field, and each one will be either vertical or horizontal.',
      `Using your dominant hand, press ${createKeyIcon('←')} if the stripes are vertical, and ${createKeyIcon('→')} if the stripes are horizontal.`,
      'The program will wait for your response before moving to the next trial. If you are not sure about the orientation, please make your best guess.'
    ],
    noStimulusText: 'On those trials, you will not see any grating stimulus.'
  },
  Centrality: {
    title: 'Centrality Discrimination Task',
    pageOneParagraphs: [
      'You will see a grid of black and white squares in your blind field, and you will judge whether there are more black or more white squares.',
      `Using your dominant hand, press ${createKeyIcon('←')} if you think there are more black squares, and ${createKeyIcon('→')} if you think there are more white squares.`,
      'The program will wait for your response before moving to the next trial. If you are not sure, please make your best guess.'
    ],
    noStimulusText: 'On those trials, you will not see any grid stimulus.'
  },
  Bar: {
    title: 'Bar Comparison Task',
    pageOneParagraphs: [
      'You will see two bars in your blind field, and you will judge whether their heights are the same or different.',
      `Using your dominant hand, press ${createKeyIcon('←')} if the bars are the same height, and ${createKeyIcon('→')} if the bars are different heights.`,
      'The program will wait for your response before moving to the next trial. If you are not sure, please make your best guess.'
    ],
    noStimulusText: 'On those trials, you will not see any bar stimulus.'
  }
};

function createTaskInstructionTrials(taskType) {
  const instructionConfig = TASK_INSTRUCTION_CONFIG[taskType];
  if (!instructionConfig) return [];

  const breakEvery = TRIAL_CONFIG[taskType]?.breakEvery || 64;
  const totalPages = 2;
  const pages = [
    instructionConfig.pageOneParagraphs,
    [
      'Please keep your eyes fixed on the cross in the center of the screen at all times.',
      `Occasionally, the cross will change from "➕" to "✖️", and when that happens, press <span class="key-icon key-icon-space">SPACE</span>. ${instructionConfig.noStimulusText}`,
      'You can press <span class="key-icon key-icon-square">B</span> at any time during numbered trials to take a manual pause and replay that trial.',
      `There will be a short break after completing ${breakEvery} trials to help you rest your eyes. A 30-second countdown timer will appear. You can press <span class="key-icon key-icon-space">SPACE</span> to continue early, or wait until it reaches 0 and press <span class="key-icon key-icon-space">SPACE</span> when you are ready. You are also welcome to take a longer break if needed.`
    ]
  ];

  return pages.map((pageParagraphs, index) => {
    const currentPage = index + 1;
    const paragraphsHtml = pageParagraphs.map(paragraph => `<p class="instruction-paragraph">${paragraph}</p>`).join('');

    return {
      type: htmlKeyboardResponse,
      stimulus: `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          .instruction-wrapper {
            width: min(980px, 92vw);
            text-align: center;
            color: black;
            padding: 0 24px;
            box-sizing: border-box;
          }
          .instruction-title {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 20px;
            color: black;
          }
          .instruction-page {
            font-size: 20px;
            color: black;
            margin-bottom: 30px;
          }
          .instruction-paragraph {
            font-size: 20px;
            line-height: 1.6;
            margin: 0 0 20px 0;
            color: black;
          }
          .instruction-paragraph:last-of-type {
            margin-bottom: 0;
          }
          .instruction-continue {
            margin-top: 30px;
            font-size: 18px;
            color: black;
          }
          ${SHARED_KEY_ICON_CSS}
        </style>
        <div class="instruction-wrapper">
          <div class="instruction-title">${instructionConfig.title}</div>
          <div class="instruction-page">Instructions ${currentPage} of ${totalPages}</div>
          ${paragraphsHtml}
          <div class="instruction-continue">Press <span class="key-icon key-icon-space">SPACE</span> to continue.</div>
        </div>
      `,
      choices: [' '],
      data: {
        trial_category: 'task_instruction',
        task_type: taskType,
        instruction_page: currentPage
      }
    };
  });
}

function createResponseQuestionStimulus(taskType, trialNum, totalTrials) {
  const promptConfig = getResponsePromptConfig(taskType);

  return `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #ccc;
        overflow: hidden;
      }
      .question-text {
        position: absolute;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: black;
        font-size: 18px;
        z-index: 10;
      }
      .instruction-text {
        position: absolute;
        top: 60%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: black;
        font-size: 16px;
        z-index: 10;
      }
      ${SHARED_KEY_ICON_CSS}
    </style>
    <div class="question-text">${promptConfig.question}</div>
    <div class="instruction-text">Press ${createKeyIcon(promptConfig.primaryKeyLabel)} for ${promptConfig.primaryLabel}, ${createKeyIcon(promptConfig.secondaryKeyLabel)} for ${promptConfig.secondaryLabel}, ${createKeyIcon('SPACE', 'key-icon-space')} for ✖️, ${createKeyIcon('B', 'key-icon-square')} for break</div>
    <svg id="stimulus" width="100%" height="100%"></svg>
    ${createProgressOverlay(taskType, trialNum, totalTrials)}
  `;
}

function getUserChoiceFromTaskResponse(response, taskType) {
  if (response === ' ') return 'X';
  if (!response) return 'No response';

  const promptConfig = getResponsePromptConfig(taskType);
  const responseKey = response.toLowerCase();
  const primaryKey = promptConfig.primaryKey.toLowerCase();
  const secondaryKey = promptConfig.secondaryKey.toLowerCase();

  if (responseKey === primaryKey) return promptConfig.primaryLabel;
  if (responseKey === secondaryKey) return promptConfig.secondaryLabel;

  return 'No response';
}

// // Generate base trial combinations for each stimulus type
// function generateMotionTrialCombinations() {
//   const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
//   const signalDirections = [[0,1], [0,-1]];
//   const combinations = [];
  
//   for (const position of positions) {
//     for (const signalDirection of signalDirections) {
//       combinations.push({ position, signalDirection });
//     }
//   }
//   return combinations; // 8 combinations
// }

// function generateGratingTrialCombinations() {
//   const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
//   const orientations = ['vertical', 'horizontal'];
//   const combinations = [];
  
//   for (const position of positions) {
//     for (const orientation of orientations) {
//       combinations.push({ position, orientation });
//     }
//   }
//   return combinations; // 8 combinations
// }

// function generateGridTrialCombinations() {
//   const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
//   const centerColors = ['black', 'white'];
//   const centerPercentages = [15, 30];
//   const combinations = [];
  
//   for (const position of positions) {
//     for (const centerColor of centerColors) {
//       for (const centerPercentage of centerPercentages) {
//         combinations.push({ position, centerColor, centerPercentage });
//       }
//     }
//   }
//   return combinations; // 16 combinations
// }

// function generateBarChartTrialCombinations() {
//   const positions = ['upper', 'lower'];
//   const barHeights = [
//     [1, 1], [2, 2], [3, 3], 
//     [1, 2], [2, 3], [1, 3]
//   ];
//   const combinations = [];
  
//   for (const position of positions) {
//     for (const heights of barHeights) {
//       combinations.push({ position, heights });
//     }
//   }
//   return combinations; // 12 combinations
// }

// Balanced condition generation functions
function getConditionsForTask(taskType) {
  const positions = USE_SINGLE_POSITION ? 
    (taskType === 'Bar' ? [TARGET_POSITION === 'left_upper' ? 'upper' : 'lower'] : [TARGET_POSITION]) :
    (taskType === 'Bar' ? ['upper', 'lower'] : ['left_upper', 'left_lower', 'right_upper', 'right_lower']);
  
  switch(taskType) {
    case 'Motion':
      const motionDirections = [[0, 1], [0, -1]]; // up, down
      const motionConditions = [];
      for (const position of positions) {
        for (const direction of motionDirections) {
          motionConditions.push({ position, signalDirection: direction });
        }
      }
      return motionConditions; // 8 conditions
      
    case 'Orientation':
      const orientations = ['vertical', 'horizontal'];
      const orientationConditions = [];
      for (const position of positions) {
        for (const orientation of orientations) {
          orientationConditions.push({ position, orientation });
        }
      }
      return orientationConditions; // 8 conditions
      
    case 'Centrality':
      const centerColors = ['black', 'white'];
      const ratioOrders = ['center_more', 'center_less']; // which way the center color dominates
      const centralityConditions = [];
      for (const position of positions) {
        for (const centerColor of centerColors) {
          for (const ratioOrder of ratioOrders) {
            centralityConditions.push({ position, centerColor, ratioOrder });
          }
        }
      }
      return centralityConditions; // 16 conditions
      
    case 'Bar':
      const heightTypes = ['same', 'different']; // same = [1,1], different = heightRatio
      const barOrders = ['left_higher', 'right_higher']; // which side is higher for different heights
      const barConditions = [];
      for (const position of positions) {
        for (const heightType of heightTypes) {
          if (heightType === 'same') {
            // Create two same conditions per position to balance to 8 total
            barConditions.push({ position, heightType, barOrder: 'equal_1' });
            barConditions.push({ position, heightType, barOrder: 'equal_2' });
          } else {
            for (const barOrder of barOrders) {
              barConditions.push({ position, heightType, barOrder });
            }
          }
        }
      }
      return barConditions; // 8 conditions (2 positions × 4 height combinations)
      
    default:
      throw new Error(`Unknown task type: ${taskType}`);
  }
}

function getConditionFromTrialNumber(taskType, trialNum) {
  const conditions = getConditionsForTask(taskType);
  const blockSize = conditions.length; // 8 for all tasks
  const blockNum = Math.floor((trialNum - 1) / blockSize);
  const conditionIndex = (trialNum - 1) % blockSize;
  
  // Create a shuffled order for this specific block
  const blockSeed = blockNum * 1000 + taskType.charCodeAt(0); // Simple deterministic seed
  const shuffledConditions = shuffleArrayDeterministic(conditions, blockSeed);
  
  return shuffledConditions[conditionIndex];
}

// Deterministic shuffle using a simple LCG (Linear Congruential Generator)
function shuffleArrayDeterministic(array, seed) {
  const shuffled = [...array];
  let rng = seed;
  
  // Simple LCG parameters (same as used in some languages)
  const a = 1664525;
  const c = 1013904223;
  const m = Math.pow(2, 32);
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    rng = (a * rng + c) % m;
    const j = Math.floor((rng / m) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Function to generate trial sequence with adaptive difficulty parameters
function generateTrialSequence(taskType, trialNum, totalTrials = null, conditionTrialNum = trialNum) {
  // Use totalTrials from config if not provided
  if (!totalTrials) {
    totalTrials = TRIAL_CONFIG[taskType].totalTrials;
  }
  
  // Generating trial sequence
  
  // NOTE: Staircase parameters are now calculated dynamically at trial runtime, not pre-generated
  
  // Get balanced condition for this trial number
  const condition = getConditionFromTrialNumber(taskType, conditionTrialNum);
  
  let trialSequence = [];
  
  switch(taskType) {
    case 'Motion':
      const { position, signalDirection } = condition;
      
      trialSequence = generateMotionTrialSequence(
        { position, signalDirection }, 
        taskType, 
        trialNum, 
        totalTrials
      );
      break;
      
    case 'Orientation':
      const { position: orientationPosition, orientation } = condition;
      
      trialSequence = generateGratingTrialSequence(
        { position: orientationPosition, orientation },
        taskType,
        trialNum,
        totalTrials
      );
      break;
      
    case 'Centrality':
      const { position: centralityPosition, centerColor, ratioOrder } = condition;
      
      trialSequence = generateGridTrialSequence(
        { position: centralityPosition, centerColor, ratioOrder },
        taskType,
        trialNum,
        totalTrials
      );
      break;
      
    case 'Bar':
      const { position: barPosition, heightType, barOrder } = condition;
      
      trialSequence = generateBarChartTrialSequence(
        { position: barPosition, heightType, barOrder },
        taskType,
        trialNum,
        totalTrials
      );
      break;
  }
  
  return trialSequence;
}

function generateCentralFixationCatchTrialSequence(taskType = selectedTask, trialNum = 1, totalTrials = 1) {
  const trialSequence = [];

  // Part 1: Pre-stimulus fixation cross
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    data: {
      trial_category: 'fixation_catch_pre',
      task_type: taskType,
      overall_trial_number: trialNum
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Part 2: Central fixation orientation change during the stimulus display window.
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    data: {
      trial_category: 'fixation_catch_stimulus',
      task_type: taskType,
      overall_trial_number: trialNum,
      fixation_catch_trial: true,
      fixation_cross_orientation: 'X',
      fixation_stimulus_duration_ms: DURATION,
      peripheral_stimulus_presented: false
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawXCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Part 3: Post-stimulus fixation cross
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    data: {
      trial_category: 'fixation_catch_post',
      task_type: taskType,
      overall_trial_number: trialNum
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Part 4: Response waits indefinitely. The fixation returns to + so the answer is not visible.
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return createResponseQuestionStimulus(taskType, trialNum, totalTrials);
    },
    choices: getTaskResponseChoices(taskType),
    data: {
      trial_category: 'fixation_catch_response',
      task_type: taskType,
      overall_trial_number: trialNum,
      fixation_catch_trial: true,
      correct_direction: 'X',
      fixation_cross_orientation: '+',
      fixation_response_key: 'Space',
      fixation_response_window_ms: null,
      fixation_response_window: 'unlimited',
      peripheral_stimulus_presented: false,
      staircase_updated: false
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      if (isManualPauseForcedEnd(data)) {
        return;
      }
      const userChoice = getUserChoiceFromTaskResponse(data.response, taskType);
      const correct = userChoice === data.correct_direction;
      data.correct = correct;
      data.userChoice = userChoice;
      data.fixation_response_detected = userChoice === 'X';
      data.catch_trial_proportion = getCentralFixationCatchTrialProportion();
      playFeedbackSound(correct, 'fixation_catch_response');
    }
  });

  // Part 5: Feedback crosshair for the independent fixation task
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
        }
      </style>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    data: {
      trial_category: 'fixation_catch_feedback',
      task_type: taskType,
      overall_trial_number: trialNum
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);

      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial && previousTrial.correct ? 'green' : 'red';

      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });

  return trialSequence;
}

// Function to generate a single trial sequence for motion stimulus
function generateMotionTrialSequence(combination, taskType = 'Motion', trialNum = 1, totalTrials = 1) {
  const { position, signalDirection } = combination;
  const trialSequence = [];
  
  // Part 1: Pre-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Part 2: Motion stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      const motionSpeedDegreePerSecond = STIMULUS_PARAMS.Motion.motionSpeedDegreePerSecond;
      const directionRange = currentDifficultyValue;
      return createMotionStimulus(angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position, motionSpeedDegreePerSecond, directionRange).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation at runtime
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      const motionSpeedDegreePerSecond = STIMULUS_PARAMS.Motion.motionSpeedDegreePerSecond;
      const directionRange = currentDifficultyValue;
      
      // DEBUG: Log dynamic motion parameters
      console.log(`🔧 DYNAMIC MOTION STAIRCASE for Trial ${trialNum}:`);
      console.log(`   Current Level: ${staircaseState[taskType].level}`);
      console.log(`   DirectionRange: ${directionRange}°`);
      console.log(`   MotionSpeedDegreePerSecond: ${motionSpeedDegreePerSecond}°/s`);
      console.log(`   SignalDirection: [${signalDirection[0]}, ${signalDirection[1]}]`);
      console.log(`   Position: ${position}`);
      
      initMotionAnimation(
        angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position, motionSpeedDegreePerSecond, directionRange, crosshairLength, crosshairStroke
      );
    }
  });
  
  // Part 3: Post-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Part 4: Response trial
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return createResponseQuestionStimulus(taskType, trialNum, totalTrials);
    },
    choices: getTaskResponseChoices(taskType),
    data: {
      correct_direction: signalDirection[1] > 0 ? 'Down' : 'Up',
      task_type: taskType,
      motion_position: position,
      motion_direction: signalDirection[1] > 0 ? 'Down' : 'Up',
      motion_direction_vector: `[${signalDirection[0]},${signalDirection[1]}]`
    },
    on_start: function(trial) {
      // Motion trial started
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      if (isManualPauseForcedEnd(data)) {
        return;
      }
      const userChoice = getUserChoiceFromTaskResponse(data.response, taskType);
      const correct = userChoice === data.correct_direction;
      
      console.log(`Motion trial: ${correct ? 'CORRECT' : 'INCORRECT'} (Answer: ${data.correct_direction})`);
      playFeedbackSound(correct, 'motion_response');
      
      // Store trial data with difficulty information (before updating for next trial)
      data.correct = correct;
      data.userChoice = userChoice;
      data.difficulty_level = staircaseState[taskType].level;
      data.difficulty_value = getCurrentDifficultyValue(taskType);
      data.staircase_parameter = STAIRCASE_CONFIG[taskType].parameter;
      
      // Update staircase difficulty based on response for next trial
      updateDifficulty(taskType, correct);
    }
  });
  
  // Part 5: Feedback crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
        }
      </style>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial && previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

// Function to generate similar trial sequences for other stimulus types
function generateGratingTrialSequence(combination, taskType = 'Orientation', trialNum = 1, totalTrials = 1) {
  const { position, orientation } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Grating stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      const stripeSpacingDegree = STIMULUS_PARAMS.Orientation.stripeSpacingDegree;
      const tiltDegree = currentDifficultyValue;
      return createGratingStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, orientation, stripeSpacingDegree, tiltDegree).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation at runtime
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      const stripeSpacingDegree = STIMULUS_PARAMS.Orientation.stripeSpacingDegree;
      const tiltDegree = currentDifficultyValue;
      
      // DEBUG: Log dynamic orientation parameters
      console.log(`🔧 DYNAMIC ORIENTATION STAIRCASE for Trial ${trialNum}:`);
      console.log(`   Current Level: ${staircaseState[taskType].level}`);
      console.log(`   TiltDegree: ${tiltDegree}°`);
      console.log(`   StripeSpacingDegree: ${stripeSpacingDegree}°`);
      console.log(`   Orientation: ${orientation}`);
      console.log(`   Position: ${position}`);
      
      initGratingStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, orientation, stripeSpacingDegree, tiltDegree, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return createResponseQuestionStimulus(taskType, trialNum, totalTrials);
    },
    choices: getTaskResponseChoices(taskType),
    data: {
      correct_direction: orientation === 'vertical' ? 'Vertical' : 'Horizontal',
      task_type: taskType,
      orientation_position: position,
      orientation_type: orientation
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      if (isManualPauseForcedEnd(data)) {
        return;
      }
      const userChoice = getUserChoiceFromTaskResponse(data.response, taskType);
      const correct = userChoice === data.correct_direction;
      
      console.log(`Orientation trial: ${correct ? 'CORRECT' : 'INCORRECT'} (Answer: ${data.correct_direction})`);
      playFeedbackSound(correct, 'orientation_response');
      
      // Store trial data with difficulty information (before updating for next trial)
      data.correct = correct;
      data.userChoice = userChoice;
      data.difficulty_level = staircaseState[taskType].level;
      data.difficulty_value = getCurrentDifficultyValue(taskType);
      data.staircase_parameter = STAIRCASE_CONFIG[taskType].parameter;
      
      // Update staircase difficulty based on response for next trial
      updateDifficulty(taskType, correct);
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
        }
      </style>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial && previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

function generateGridTrialSequence(combination, taskType = 'Centrality', trialNum = 1, totalTrials = 1) {
  const { position, centerColor, ratioOrder } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Grid stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let finalCenterPercentage;
      if (ratioOrder === 'center_more') {
        // Center color should be MORE dominant (> 50%)
        finalCenterPercentage = 100 - currentDifficultyValue;
      } else {
        // Center color should be LESS dominant (< 50%)  
        finalCenterPercentage = currentDifficultyValue;
      }
      return createGridStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, finalCenterPercentage).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation at runtime
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let finalCenterPercentage;
      if (ratioOrder === 'center_more') {
        // Center color should be MORE dominant (> 50%)
        finalCenterPercentage = 100 - currentDifficultyValue;
      } else {
        // Center color should be LESS dominant (< 50%)  
        finalCenterPercentage = currentDifficultyValue;
      }
      
      // DEBUG: Log dynamic centrality parameters
      console.log(`🔧 DYNAMIC CENTRALITY STAIRCASE for Trial ${trialNum}:`);
      console.log(`   Current Level: ${staircaseState[taskType].level}`);
      console.log(`   Raw centerPercentage from staircase: ${currentDifficultyValue}`);
      console.log(`   RatioOrder: ${ratioOrder}`);
      console.log(`   Final centerPercentage: ${finalCenterPercentage}`);
      console.log(`   CenterColor: ${centerColor}`);
      console.log(`   Position: ${position}`);
      
      initGridStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, finalCenterPercentage, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return createResponseQuestionStimulus(taskType, trialNum, totalTrials);
    },
    choices: getTaskResponseChoices(taskType),
    data: function() {
      // Dynamic calculation for response data
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let finalCenterPercentage;
      if (ratioOrder === 'center_more') {
        finalCenterPercentage = 100 - currentDifficultyValue;
      } else {
        finalCenterPercentage = currentDifficultyValue;
      }
      return {
        correct_direction: (centerColor === 'black' && finalCenterPercentage > 50) || (centerColor === 'white' && finalCenterPercentage < 50) ? 'Black' : 'White',
        task_type: taskType,
        centrality_position: position,
        center_color: centerColor,
        final_center_percentage: finalCenterPercentage
      };
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      if (isManualPauseForcedEnd(data)) {
        return;
      }
      const userChoice = getUserChoiceFromTaskResponse(data.response, taskType);
      const correct = userChoice === data.correct_direction;
      
      console.log(`Centrality trial: ${correct ? 'CORRECT' : 'INCORRECT'} (Answer: ${data.correct_direction})`);
      playFeedbackSound(correct, 'centrality_response');
      
      // Store trial data with difficulty information (before updating for next trial)
      data.correct = correct;
      data.userChoice = userChoice;
      data.difficulty_level = staircaseState[taskType].level;
      data.difficulty_value = getCurrentDifficultyValue(taskType);
      data.staircase_parameter = STAIRCASE_CONFIG[taskType].parameter;
      
      // Update staircase difficulty based on response for next trial
      updateDifficulty(taskType, correct);
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
        }
      </style>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial && previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

function generateBarChartTrialSequence(combination, taskType = 'Bar', trialNum = 1, totalTrials = 1) {
  const { position, heightType, barOrder } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Bar chart stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let heights;
      if (heightType === 'same') {
        heights = [1, 1];
      } else {
        // heightType === 'different'
        if (barOrder === 'left_higher') {
          heights = [currentDifficultyValue[1], currentDifficultyValue[0]]; // [higher, lower]
        } else { // 'right_higher'
          heights = [currentDifficultyValue[0], currentDifficultyValue[1]]; // [lower, higher]
        }
      }
      return createBarChartStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, heights).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      // Dynamic staircase parameter calculation at runtime
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let heights;
      if (heightType === 'same') {
        heights = [1, 1];
      } else {
        // heightType === 'different'
        if (barOrder === 'left_higher') {
          heights = [currentDifficultyValue[1], currentDifficultyValue[0]]; // [higher, lower]
        } else { // 'right_higher'
          heights = [currentDifficultyValue[0], currentDifficultyValue[1]]; // [lower, higher]
        }
      }
      
      // DEBUG: Log dynamic bar parameters
      console.log(`🔧 DYNAMIC BAR STAIRCASE for Trial ${trialNum}:`);
      console.log(`   Current Level: ${staircaseState[taskType].level}`);
      console.log(`   Raw heightRatio from staircase: [${currentDifficultyValue[0]}, ${currentDifficultyValue[1]}]`);
      console.log(`   HeightType: ${heightType}`);
      console.log(`   BarOrder: ${barOrder}`);
      console.log(`   Final calculated heights: [${heights[0]}, ${heights[1]}]`);
      console.log(`   Position: ${position}`);
      
      initBarChartStimulus(angleArray, screenWidth, screenHeight, chinrestData, position, heights, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      return createResponseQuestionStimulus(taskType, trialNum, totalTrials);
    },
    choices: getTaskResponseChoices(taskType),
    data: function() {
      // Dynamic calculation for response data
      const currentDifficultyValue = getCurrentDifficultyValue(taskType);
      let heights;
      if (heightType === 'same') {
        heights = [1, 1];
      } else {
        if (barOrder === 'left_higher') {
          heights = [currentDifficultyValue[1], currentDifficultyValue[0]];
        } else {
          heights = [currentDifficultyValue[0], currentDifficultyValue[1]];
        }
      }
      return {
        correct_direction: heights[0] === heights[1] ? 'Same' : 'Different',
        task_type: taskType,
        bar_position: position,
        bar_height_type: heightType,
        bar_height_configuration: barOrder,
        bar_heights_array: `[${heights[0]},${heights[1]}]`
      };
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      if (isManualPauseForcedEnd(data)) {
        return;
      }
      const userChoice = getUserChoiceFromTaskResponse(data.response, taskType);
      const correct = userChoice === data.correct_direction;
      
      console.log(`Bar trial: ${correct ? 'CORRECT' : 'INCORRECT'} (Answer: ${data.correct_direction})`);
      playFeedbackSound(correct, 'bar_response');
      
      // Store trial data with difficulty information (before updating for next trial)
      data.correct = correct;
      data.userChoice = userChoice;
      data.difficulty_level = staircaseState[taskType].level;
      data.difficulty_value = getCurrentDifficultyValue(taskType);
      data.staircase_parameter = STAIRCASE_CONFIG[taskType].parameter;
      
      // Update staircase difficulty based on response for next trial
      updateDifficulty(taskType, correct);
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
        }
      </style>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial && previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

if (!selectedTask) {
  renderTaskLinksPage();
} else {
  resetStaircaseState(selectedTask);
  jsPsych.data.addProperties({
    selected_task: selectedTask,
    task_route: `/${selectedTask}`,
    central_fixation_catch_trial_proportion: getCentralFixationCatchTrialProportion()
  });

// Enter fullscreen mode at the very beginning
timeline.push({
  type: jsPsychFullscreen,
  fullscreen_mode: true,
  message: `
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #ccc !important;
        font-family: Arial, sans-serif;
        color: black;
      }
      .fullscreen-message {
        text-align: center;
        color: black;
        padding: 24px 36px;
      }
      .fullscreen-title {
        font-size: 32px;
        font-weight: bold;
        margin: 0 0 18px 0;
      }
      .fullscreen-text {
        font-size: 20px;
        margin: 0 0 16px 0;
        line-height: 1.6;
      }
      .fullscreen-text:last-of-type {
        margin-bottom: 0;
      }
    </style>
    <div class="fullscreen-message">
      <h2 class="fullscreen-title">Welcome to the Experiment</h2>
      <p class="fullscreen-text">
        This experiment requires fullscreen mode for optimal viewing and accurate measurements.
      </p>
      <p class="fullscreen-text">
        Click the button below to enter fullscreen mode and begin.
      </p>
    </div>
  `,
  button_label: 'Enter Fullscreen & Continue'
});

timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #ccc;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      .startup-message {
        text-align: center;
        color: black;
        font-size: 32px;
        font-weight: bold;
        line-height: 1.4;
        padding: 0 24px;
      }
    </style>
    <div class="startup-message">Press continue to start the experiment.</div>
  `,
  choices: ['Continue'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn">${choice}</button></div>`
});

// User ID input trial
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #ccc;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      .user-id-container {
        text-align: center;
        color: black;
        padding: 0 24px;
        width: 100%;
        box-sizing: border-box;
      }
      .user-id-title {
        font-size: 32px;
        margin-bottom: 18px;
        font-weight: bold;
      }
      .user-id-input {
        font-size: 20px;
        padding: 12px 14px;
        margin: 12px 0 8px 0;
        border: 2px solid #8f8f8f;
        border-radius: 6px;
        width: min(280px, 85vw);
        background: #e4e4e4;
        color: black;
        text-align: center;
      }
      .user-id-input::placeholder {
        color: #5a5a5a;
      }
      .user-id-instruction {
        font-size: 20px;
        margin: 0 0 12px 0;
        color: black;
      }
      .error-message {
        color: #8b0000;
        font-size: 16px;
        margin-top: 10px;
        display: none;
      }
    </style>
    <div class="user-id-container">
      <div class="user-id-title">Enter Your User ID</div>
      <div class="user-id-instruction">Please enter your participant ID</div>
      <input type="text" id="user-id-input" class="user-id-input" placeholder="e.g., A123" maxlength="10">
      <div id="error-message" class="error-message">Letters and numbers only</div>
    </div>
  `,
  choices: ['Continue'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn" id="continue-btn">${choice}</button></div>`,
  on_load: function() {
    const continueBtn = document.getElementById('continue-btn');
    const userIdInput = document.getElementById('user-id-input');
    const errorMessage = document.getElementById('error-message');
    
    // Disable continue button initially
    continueBtn.disabled = true;
    continueBtn.style.opacity = '0.5';
    
    const participantIdPattern = /^[A-Za-z0-9]+$/;

    // Store user ID value in a variable that persists
    let currentUserId = '';
    
    // Validate input on each keystroke
    userIdInput.addEventListener('input', function() {
      const value = this.value;
      const isValid = participantIdPattern.test(value);
      currentUserId = value; // Store the current value
      
      if (isValid) {
        errorMessage.style.display = 'none';
        continueBtn.disabled = false;
        continueBtn.style.opacity = '1';
      } else {
        if (value.length > 0) {
          errorMessage.style.display = 'block';
        } else {
          errorMessage.style.display = 'none';
        }
        continueBtn.disabled = true;
        continueBtn.style.opacity = '0.5';
      }
    });
    
    // Store the user ID when continue button is clicked
    continueBtn.addEventListener('click', function() {
      if (participantIdPattern.test(currentUserId)) {
        // Store user ID in jsPsych data for all subsequent trials
        jsPsych.data.addProperties({
          user_id: currentUserId
        });
      }
    });
    
    // Focus on input field
    userIdInput.focus();
  },
  on_finish: function(data) {
    // The user ID should already be stored in jsPsych data from the button click
    const allData = jsPsych.data.get();
    const userIdFromData = allData.values()[0]?.user_id;
    if (userIdFromData) {
      data.user_id = userIdFromData;
    }
  }
});

// Visual Angle Calculator UI
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #ccc;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
      }
      .calculator-container {
        text-align: center;
        color: black;
        padding: 24px 28px;
        width: 100%;
        box-sizing: border-box;
      }
      .calculator-title {
        font-size: 32px;
        margin-bottom: 8px;
        color: black;
        font-weight: bold;
      }
      .calculator-subtitle {
        font-size: 20px;
        color: black;
        margin-bottom: 18px;
      }
      .input-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 15px;
        margin: 15px 0;
      }
      .input-section {
        background: #bdbdbd;
        padding: 12px;
        border-radius: 8px;
      }
      .section-title {
        font-size: 18px;
        font-weight: bold;
        color: black;
        margin-bottom: 8px;
      }
      .input-group {
        margin: 8px 0;
        text-align: left;
      }
      .input-label {
        display: block;
        font-size: 14px;
        color: black;
        margin-bottom: 3px;
        font-weight: 500;
      }
      .calculator-input {
        width: 100%;
        padding: 8px;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        text-align: center;
        box-sizing: border-box;
        background: #e0e0e0;
        color: black;
      }
      .calculator-input:focus {
        outline: 2px solid #555;
      }
      .calculator-input.invalid {
        outline: 2px solid #e74c3c;
      }
      .unit-label {
        font-size: 12px;
        color: #3f3f3f;
        margin-top: 3px;
      }
      .error-message {
        color: #e74c3c;
        font-size: 12px;
        margin-top: 5px;
        display: none;
      }
      .preview-section {
        background: #c4c4c4;
        padding: 10px;
        border-radius: 6px;
        margin: 10px 0;
      }
      .preview-title {
        font-size: 16px;
        font-weight: bold;
        color: black;
        margin-bottom: 6px;
      }
      .preview-text {
        font-size: 14px;
        color: black;
        margin: 3px 0;
      }
      .instructions {
        background: #c8c8c8;
        padding: 8px;
        border-radius: 4px;
        margin: 10px 0;
        font-size: 14px;
        color: black;
        text-align: center;
      }
    </style>
    <div class="calculator-container">
      <div class="calculator-title">Visual Angle Calculator</div>
      <div class="calculator-subtitle">Enter your display setup parameters for accurate visual angle calculations</div>
      
      <div class="instructions">
        Enter your display parameters for accurate visual angle calculations
      </div>
      
      <div class="input-grid">
        <div class="input-section">
          <div class="section-title">Screen Resolution</div>
          <div class="input-group">
            <label class="input-label">Width (pixels)</label>
            <input type="number" id="resolution-width" class="calculator-input" placeholder="1920" value="1920">
          </div>
          <div class="input-group">
            <label class="input-label">Height (pixels)</label>
            <input type="number" id="resolution-height" class="calculator-input" placeholder="1080" value="1080">
          </div>
        </div>
        
        <div class="input-section">
          <div class="section-title">Screen Dimensions</div>
          <div class="input-group">
            <label class="input-label">Width (cm)</label>
            <input type="number" id="screen-width" class="calculator-input" placeholder="47.6" step="0.1" value="47.6">
            <div class="unit-label">Visible screen width</div>
          </div>
          <div class="input-group">
            <label class="input-label">Height (cm)</label>
            <input type="number" id="screen-height" class="calculator-input" placeholder="26.8" step="0.1" value="26.8">
            <div class="unit-label">Visible screen height</div>
          </div>
        </div>

        <div class="input-section">
          <div class="section-title">Viewing Distance</div>
          <div class="input-group">
            <label class="input-label">Distance (cm)</label>
            <input type="number" id="viewing-distance" class="calculator-input" placeholder="50" step="0.5" value="50">
            <div class="unit-label">Eye to screen distance</div>
          </div>
        </div>
      </div>
      
      <div class="preview-section">
        <div class="preview-title">Calculated Values</div>
        <div class="preview-text">Pixels per degree: <span id="preview-ppd">--</span></div>
        <div class="preview-text">Pixels per cm (X): <span id="preview-ppcm-x">--</span></div>
        <div class="preview-text">Pixels per cm (Y): <span id="preview-ppcm-y">--</span></div>
      </div>
    </div>
  `,
  choices: ['Continue with Experiment'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn" id="continue-calc-btn">${choice}</button></div>`,
  on_load: function() {
    const continueBtn = document.getElementById('continue-calc-btn');
    const inputs = {
      resWidth: document.getElementById('resolution-width'),
      resHeight: document.getElementById('resolution-height'),
      screenWidth: document.getElementById('screen-width'),
      screenHeight: document.getElementById('screen-height'),
      viewingDistance: document.getElementById('viewing-distance')
    };
    
    const previews = {
      ppd: document.getElementById('preview-ppd'),
      ppcmX: document.getElementById('preview-ppcm-x'),
      ppcmY: document.getElementById('preview-ppcm-y')
    };
    
    // Disable continue button initially
    continueBtn.disabled = true;
    continueBtn.style.opacity = '0.5';
    
    function validateInput(input, min = 1, max = 10000) {
      const value = parseFloat(input.value);
      return !isNaN(value) && value >= min && value <= max;
    }
    
    function updateCalculations() {
      const values = {
        resWidth: parseFloat(inputs.resWidth.value),
        resHeight: parseFloat(inputs.resHeight.value),
        screenWidth: parseFloat(inputs.screenWidth.value),
        screenHeight: parseFloat(inputs.screenHeight.value),
        viewingDistance: parseFloat(inputs.viewingDistance.value)
      };
      
      // Check if all values are valid
      const allValid = Object.values(values).every(v => !isNaN(v) && v > 0);
      
      if (allValid) {
        // Calculate pixels per cm
        const pixelsPerCmX = values.resWidth / values.screenWidth;
        const pixelsPerCmY = values.resHeight / values.screenHeight;
        
        // Calculate pixels per degree
        // For 1 degree visual angle: tan(1°) * viewing distance = cm
        const cmPerDegree = Math.tan(Math.PI / 180) * values.viewingDistance;
        const pixelsPerDegree = (pixelsPerCmX + pixelsPerCmY) / 2 * cmPerDegree;
        
        // Update previews
        previews.ppd.textContent = pixelsPerDegree.toFixed(2);
        previews.ppcmX.textContent = pixelsPerCmX.toFixed(2);
        previews.ppcmY.textContent = pixelsPerCmY.toFixed(2);
        
        // Enable continue button
        continueBtn.disabled = false;
        continueBtn.style.opacity = '1';
      } else {
        previews.ppd.textContent = '--';
        previews.ppcmX.textContent = '--';
        previews.ppcmY.textContent = '--';
        
        continueBtn.disabled = true;
        continueBtn.style.opacity = '0.5';
      }
    }
    
    // Add validation and calculation for all inputs
    Object.values(inputs).forEach(input => {
      input.addEventListener('input', function() {
        const isValid = validateInput(this);
        this.classList.toggle('invalid', !isValid);
        updateCalculations();
      });
    });
    
    // Store the calculated parameters when continue is clicked
    continueBtn.addEventListener('click', function() {
      const calculatorData = {
        resolution: [parseFloat(inputs.resWidth.value), parseFloat(inputs.resHeight.value)],
        screenSizeCm: [parseFloat(inputs.screenWidth.value), parseFloat(inputs.screenHeight.value)],
        viewingDistanceCm: parseFloat(inputs.viewingDistance.value),
        pixelsPerCmX: parseFloat(inputs.resWidth.value) / parseFloat(inputs.screenWidth.value),
        pixelsPerCmY: parseFloat(inputs.resHeight.value) / parseFloat(inputs.screenHeight.value),
        pixelsPerDegree: parseFloat(previews.ppd.textContent)
      };
      
      // Store in jsPsych data
      jsPsych.data.addProperties({
        calculator_data: calculatorData
      });
    });
    
    // Initial calculation
    updateCalculations();
  },
  on_finish: function(data) {
    // Data is already stored in jsPsych via the button click event
  }
});

// Original chinrest trial (commented out for manual visual angle calculation)
// var chinrestTrial = {
// 	type: jsPsychVirtualChinrest,
// 	blindspot_reps: 3,
// 	resize_units: "none"
// };
// timeline.push(chinrestTrial);

// Clinic version uses the combination generation functions below

// CLINIC VERSION - Single stimulus type with adaptive difficulty (stair casing)

// Single ready screen that only shows for the selected stimulus type
const conditionalReadyScreen = {
  type: htmlKeyboardResponse,
  stimulus: function() {
    // Only show the ready screen with countdown for the selected task
    if (!selectedTask) return '<p>Loading...</p>';
    
    const taskNames = {
      'Motion': 'Motion Discrimination Task',
      'Orientation': 'Orientation Discrimination Task', 
      'Centrality': 'Centrality Discrimination Task',
      'Bar': 'Bar Comparison Task'
    };
    
    const taskName = taskNames[selectedTask] || 'Unknown Task';
    
    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }
        .ready-container {
          text-align: center;
          color: black;
        }
        .ready-title {
          font-size: 32px;
          margin-bottom: 20px;
          font-weight: bold;
        }
        .task-info {
          font-size: 20px;
          margin-bottom: 30px;
          color: #444;
        }
        .countdown {
          font-size: 48px;
          font-weight: bold;
          margin: 20px 0;
          color: #333;
        }
        .start-instruction {
          font-size: 18px;
          margin-bottom: 20px;
        }
        ${SHARED_KEY_ICON_CSS}
      </style>
      <div class="ready-container">
        <div class="ready-title">Ready for ${taskName}?</div>
        <div class="task-info">
          The task will begin after a brief countdown.<br>
          If the central fixation changes from ➕ to ✖️, press <span class="key-icon key-icon-space">SPACE</span> immediately.
        </div>
        <div class="countdown" id="countdown">30</div>
        <div class="start-instruction">You can also press the <span class="key-icon key-icon-space">SPACE</span> to skip the countdown.</div>
      </div>
    `;
  },
  choices: [' '],
  trial_duration: 30000,
  conditional_function: function() {
    console.log(`Ready screen check - Selected: ${selectedTask}`);
    return selectedTask !== null;
  },
  on_load: function() {
    let timeLeft = 30;
    const countdownElement = document.getElementById('countdown');
    
    const countdown = setInterval(() => {
      timeLeft--;
      if (countdownElement) {
        countdownElement.textContent = timeLeft;
      }
      if (timeLeft <= 0) {
        clearInterval(countdown);
        if (countdownElement) {
          countdownElement.textContent = '0';
        }
      }
    }, 1000);
  }
};

function createPauseReplayTrialNode(taskType, trialNum, totalTrials, trialSequence) {
  const pauseScreen = createBreakScreen(
    taskType,
    0,
    0,
    trialNum - 1,
    totalTrials,
    { mode: 'manual_pause', trialNum }
  );

  return {
    timeline: [
      {
        timeline: trialSequence,
        on_timeline_start: function() {
          beginManualPauseTrialAttempt(taskType, trialNum, totalTrials);
        },
        on_timeline_finish: function() {
          endManualPauseTrialAttempt();
        }
      },
      {
        timeline: [pauseScreen],
        conditional_function: function() {
          return manualPauseState.pauseRequested;
        }
      }
    ],
    loop_function: function() {
      if (manualPauseState.pauseRequested) {
        rollbackManualPauseTrialAttempt();
        manualPauseState.pauseRequested = false;
        return true;
      }
      manualPauseState.forceEndCurrentTrial = false;
      return false;
    }
  };
}

// Function to generate all trials for selected task
function generateSelectedTaskTrials() {
  const trials = [];
  
  if (selectedTask) {
    // Reset trial parameters array for new task
    // allTrialParameters = [];
    
    const config = TRIAL_CONFIG[selectedTask];
    const totalTrials = config.totalTrials;
    const breakEvery = config.breakEvery;
    const catchTrialSlots = getCentralFixationCatchTrialSlots(selectedTask, totalTrials);
    let peripheralTrialCounter = 0;
    
    // Dynamically generating trials
    
    // Add two-page instructions for the selected task
    const instructionTrials = createTaskInstructionTrials(selectedTask);
    for (const instructionTrial of instructionTrials) {
      trials.push(instructionTrial);
    }

    // Add the ready screen
    trials.push(conditionalReadyScreen);
    
    // Calculate number of breaks
    const totalBreaks = Math.floor((totalTrials - 1) / breakEvery);
    let breakCounter = 0;
    
    // Generate trials for the selected task
    for (let i = 0; i < totalTrials; i++) {
      // Check if we need to insert a break
      if (i > 0 && i % breakEvery === 0) {
        breakCounter++;
        const breakScreen = createBreakScreen(
          selectedTask,
          breakCounter,
          totalBreaks,
          i,
          totalTrials
        );
        trials.push(breakScreen);
        console.log(`🛑 Added break ${breakCounter}/${totalBreaks} after trial ${i}`);
      }
      
      const overallTrialNumber = i + 1;
      const isFixationCatchTrial = catchTrialSlots.has(overallTrialNumber);
      const trialSequence = isFixationCatchTrial
        ? generateCentralFixationCatchTrialSequence(selectedTask, overallTrialNumber, totalTrials)
        : generateTrialSequence(selectedTask, overallTrialNumber, totalTrials, ++peripheralTrialCounter);
      
      trials.push(createPauseReplayTrialNode(selectedTask, overallTrialNumber, totalTrials, trialSequence));
    }
    
    console.log(`✅ Generated ready screen, ${peripheralTrialCounter} peripheral trial sequences, ${catchTrialSlots.size} fixation catch trial sequences, and ${breakCounter} breaks for ${selectedTask}`);
    
    // Export trial parameters after generation
    // exportTrialParameters();
  }
  
  return trials;
}

// Create a loading screen that generates trials
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: '<p>Loading experiment...</p>',
  choices: [],
  trial_duration: 100
});

// Create a single dynamic timeline that will be populated based on selection
const experimentTrials = {
  timeline: [] // Will be populated when conditional_function runs
};

// Generate the trials when the conditional function is called
experimentTrials.conditional_function = function() {
  // Only run if a task has been selected
  if (selectedTask) {
    // Generate the trials for the selected task
    const trials = generateSelectedTaskTrials();
    // Replace the timeline array with the generated trials
    experimentTrials.timeline = trials;
    return true; // Execute this timeline
  }
  return false; // Skip if no task selected
};

// Add the dynamic experiment trials to the timeline
timeline.push(experimentTrials);

// === OLD MOTION TRIALS (COMMENTED OUT) ===
/*
const motionCombinations = generateMotionTrialCombinations();
const motionTotalTrials = 12 * motionCombinations.length;
let motionTrialCounter = 0;
timeline.push(createReadyScreen('Motion Discrimination Task'));

*/

// === OLD GRATING TRIALS (COMMENTED OUT) ===
/*
*/

// Results and download screen
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: function() {
    const allData = jsPsych.data.get();
    const responseTrials = allData.values().filter(trial =>
      typeof trial.correct === 'boolean'
      && trial.trial_category !== 'fixation_catch_response'
    );
    const currentTaskTrials = responseTrials.filter(trial =>
      !selectedTask || trial.task_type === selectedTask || trial.selected_task === selectedTask
    );
    const currentTaskCorrect = currentTaskTrials.filter(trial => trial.correct === true).length;
    const currentTaskIncorrect = currentTaskTrials.length - currentTaskCorrect;
    const currentTaskAccuracy = currentTaskTrials.length > 0
      ? (currentTaskCorrect / currentTaskTrials.length * 100).toFixed(1)
      : '0.0';
    const taskLabel = TASK_LINK_CONFIG[selectedTask]?.label || selectedTask || 'Current Task';
    const resultNote = currentTaskTrials.length > 0
      ? `Based on ${currentTaskTrials.length} scored response${currentTaskTrials.length === 1 ? '' : 's'} from this task.`
      : 'No scored responses were found for this task.';
    
    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #ccc;
          overflow: auto;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          color: black;
        }
        #jspsych-html-button-response-stimulus {
          width: 100%;
        }
        .results-page {
          width: min(1120px, calc(100vw - 96px));
          margin: 0 auto;
          padding: 48px 0 24px;
          text-align: left;
          color: black;
          box-sizing: border-box;
        }
        .results-page h1 {
          margin: 0 0 10px;
          color: black;
          font-size: 36px;
          line-height: 1.15;
        }
        .results-task {
          margin: 0;
          color: #333;
          font-size: 22px;
          line-height: 1.4;
        }
        .results-summary {
          display: grid;
          grid-template-columns: minmax(260px, 0.9fr) minmax(360px, 1.1fr);
          align-items: end;
          gap: 64px;
          margin: 50px 0 36px;
          padding: 34px 0;
          border-top: 2px solid #8f8f8f;
          border-bottom: 2px solid #8f8f8f;
        }
        .accuracy-label {
          display: block;
          margin-bottom: 10px;
          color: #333;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .accuracy-value {
          display: block;
          color: black;
          font-size: 88px;
          font-weight: 700;
          line-height: 0.95;
        }
        .accuracy-value span {
          font-size: 36px;
          font-weight: 700;
        }
        .results-stats {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 10px 28px;
          margin: 0;
          font-size: 20px;
          line-height: 1.35;
        }
        .results-stats dt {
          color: #444;
          font-weight: 700;
        }
        .results-stats dd {
          margin: 0;
          color: black;
        }
        .results-note {
          margin: 0 0 28px;
          color: #333;
          font-size: 18px;
        }
        .server-status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          margin: 0;
          padding: 16px 0;
          border-top: 1px solid #8f8f8f;
          border-bottom: 1px solid #8f8f8f;
          color: black;
          font-size: 17px;
          line-height: 1.4;
        }
        .server-status.success {
          color: #14532d;
        }
        .server-status.error {
          color: #7f1d1d;
        }
        .server-status.info {
          color: #1e3a8a;
        }
        .status-badge {
          flex: 0 0 auto;
          min-width: 88px;
          border: 1px solid currentColor;
          border-radius: 999px;
          padding: 4px 12px;
          text-align: center;
          font-size: 14px;
          font-weight: 700;
        }
        .download-instruction {
          margin: 16px 0 0;
          color: #333;
          font-size: 17px;
        }
        #jspsych-html-button-response-btngroup {
          width: min(1120px, calc(100vw - 96px));
          margin: 34px auto 0 !important;
          display: flex;
          justify-content: flex-start;
          gap: 24px;
        }
        #jspsych-html-button-response-btngroup .jspsych-html-button-response-button {
          margin: 0 !important;
        }
        .result-download-btn,
        .result-finish-btn {
          margin: 0;
          min-width: 220px;
          padding: 14px 28px;
          border-radius: 10px;
          font-size: 20px;
          font-weight: 600;
          background: #cfcfcf;
          color: black;
          border: 1px solid #8f8f8f;
        }
        .result-download-btn:hover,
        .result-finish-btn:hover {
          background: #bdbdbd;
        }
        @media (max-width: 760px) {
          .results-page,
          #jspsych-html-button-response-btngroup {
            width: calc(100vw - 48px);
          }
          .results-page {
            padding-top: 32px;
          }
          .results-page h1 {
            font-size: 30px;
          }
          .results-task {
            font-size: 19px;
          }
          .results-summary {
            grid-template-columns: 1fr;
            gap: 28px;
            margin: 32px 0 26px;
          }
          .accuracy-value {
            font-size: 68px;
          }
          .results-stats {
            font-size: 18px;
          }
          .server-status {
            align-items: flex-start;
            flex-direction: column;
            gap: 10px;
          }
          #jspsych-html-button-response-btngroup {
            flex-direction: column;
            align-items: stretch;
          }
          .result-download-btn,
          .result-finish-btn {
            width: 100%;
          }
        }
      </style>
      <main class="results-page">
        <h1>Experiment Complete</h1>
        <p class="results-task">${escapeHtml(taskLabel)}</p>

        <section class="results-summary" aria-label="Current task performance">
          <p>
            <span class="accuracy-label">Accuracy</span>
            <strong class="accuracy-value">${currentTaskAccuracy}<span>%</span></strong>
          </p>
          <dl class="results-stats">
            <dt>Correct</dt>
            <dd>${currentTaskCorrect}</dd>
            <dt>Incorrect</dt>
            <dd>${currentTaskIncorrect}</dd>
            <dt>Total scored</dt>
            <dd>${currentTaskTrials.length}</dd>
          </dl>
        </section>

        <p class="results-note">${escapeHtml(resultNote)}</p>
        <section class="download-section" aria-label="Data export">
          <p id="server-save-status" class="server-status" aria-live="polite">
            <span id="save-status-text">Saving data to server...</span>
            <span id="save-status-icon" class="status-badge">Saving</span>
          </p>
          <p class="download-instruction">You can also download the detailed results as a CSV file.</p>
        </section>
      </main>
    `;
  },
  choices: ['Download CSV', 'Finish'],
  button_html: (choice) => {
    if (choice === 'Download CSV') {
      return `<button class="jspsych-btn result-download-btn" id="download-btn">${choice}</button>`;
    } else {
      return `<button class="jspsych-btn result-finish-btn" id="finish-btn">${choice}</button>`;
    }
  },
  on_load: function() {
    const downloadBtn = document.getElementById('download-btn');
    const saveStatusText = document.getElementById('save-status-text');
    const saveStatusIcon = document.getElementById('save-status-icon');
    const serverStatus = document.getElementById('server-save-status');
    
    // Get all experiment data
    const allData = jsPsych.data.get();
    const csvData = allData.csv();
    
    // Get user ID for filename
    const userId = allData.values()[0].user_id || 'unknown';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `user_${userId}_${timestamp}.csv`;
    
    console.log('Generated filename:', filename);
    console.log('User ID:', userId);
    console.log('Timestamp:', timestamp);
    
    // Check if we're in development mode (Vite dev server)
    const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost' && window.location.port !== '8000';
    
    if (isDevelopment) {
      // Skip server save in development mode
      saveStatusText.textContent = 'Development mode: server save disabled';
      saveStatusIcon.textContent = 'Local';
      serverStatus.classList.add('info');
    } else {
      // Automatically save data to server
      saveDataToServer(filename, csvData)
        .then(response => {
          saveStatusText.textContent = `Data saved to server: ${response.filename || filename}`;
          saveStatusIcon.textContent = 'Saved';
          serverStatus.classList.add('success');
          console.log('Server save successful:', response);
        })
        .catch(error => {
          saveStatusText.textContent = `Server save failed: ${error.message}`;
          saveStatusIcon.textContent = 'Error';
          serverStatus.classList.add('error');
          console.error('Server save error:', error);
        });
    }
    
    // Download button functionality
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        // Create and download the file
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Update button to show download completed
        downloadBtn.textContent = 'Downloaded';
        downloadBtn.disabled = true;
        
        // Add success message
        const downloadSection = document.querySelector('.download-section');
        if (downloadSection) {
          // Check if success message already exists
          if (!document.getElementById('download-success-message')) {
            const successMessage = document.createElement('div');
            successMessage.id = 'download-success-message';
            successMessage.style.cssText = `
              border-top: 1px solid #8f8f8f;
              color: #14532d;
              padding-top: 14px;
              margin-top: 18px;
              font-size: 16px;
              font-weight: 600;
              text-align: left;
              animation: fadeIn 0.5s ease-in;
            `;
            successMessage.textContent = 'Download complete. Your CSV file has been saved to your Downloads folder.';
            
            // Add CSS animation
            if (!document.getElementById('download-success-animation')) {
              const style = document.createElement('style');
              style.id = 'download-success-animation';
              style.innerHTML = `
                @keyframes fadeIn {
                  from { opacity: 0; transform: translateY(-10px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `;
              document.head.appendChild(style);
            }
            
            downloadSection.appendChild(successMessage);
          }
        }
      });
    }
  },
  on_finish: function(data) {
    if (data.response === 1) { // Finish button clicked
      // Show thank you message
      document.body.innerHTML = `
        <main style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background-color: #ccc; font-family: Arial, sans-serif; color: black; padding: 32px; box-sizing: border-box;">
          <section style="width: min(900px, 100%); text-align: center;">
            <h2 style="color: black; font-size: 36px; margin: 0 0 18px;">Thank You</h2>
            <p style="font-size: 22px; margin: 0 0 12px;">Your participation in this experiment is greatly appreciated.</p>
            <p style="font-size: 18px; margin: 0; color: #333;">You may now close this window.</p>
          </section>
        </main>
      `;
    }
  }
});

jsPsych.run(timeline);
}
