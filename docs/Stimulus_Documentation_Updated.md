# Stimulus Configuration and Data Documentation
This document explains how stimulus parameters are defined and how data are recorded in the CSV output file.

---

## 1. Stimuli Configuration

### Motion

Dot speed: 5°/s\
Dot lifetime: 200 ms\
Stimulus duration: 200 ms\
Aperture: 5° diameter\
Number of dots: 100

The experiment reads speed from `STIMULUS_PARAMS.Motion.motionSpeedDegreePerSecond`. Although `STAIRCASE_CONFIG.Motion.fixedParams` contains 10°/s, the current motion trial sequence passes 5°/s to the renderer. Dots move at a nominal 60 updates per second. Each dot retains its direction until it exits the aperture, when its position and direction are randomized again. The visible stimulus stage uses `DURATION = 200` ms. The aperture radius is `deg2Pixel(5, chinrestData) / 2`, giving a 5° diameter with pixels determined by display calibration.

Sources: [timing constants](../src/main.js#L639), [motion parameters](../src/main.js#L1019), [motion renderer](../src/main.js#L1459), and [motion trial sequence](../src/main.js#L3070).

---

## 2. Staircase Configuration

Each stimulus type has a staircase parameter that controls **task difficulty**. The staircase levels increase as the task becomes harder.

| Stimulus Type | Parameter | Description | Levels (values) | Start Level | Notes |
|----------------|------------|--------------|-----------------|--------------|-------|
| **Motion** | `directionRange` | The maximum angular deviation (in degrees) on either side of the main Up/Down direction (±`directionRange`). A higher range = more variability = **harder** to perceive coherent motion. | [0, 20, 40, 60, 80, 100, 120, 140, 160] | 0° | Current trial speed: 5°/s. 0° means perfectly coherent motion. |
| **Orientation** | `tiltDegree` | The tilt angle (in degrees) of the oriented pattern from vertical. Larger tilts = **harder** to judge orientation. | [0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45] | 0° | Starts with a perfectly vertical stimulus. |
| **Centrality** | `centerPercentage` | The minority color percentage in a 10×10 grid. Values closer to 50% make the two color areas more similar and **harder** to discriminate. | [5, 10, 15, 20, 25, 30, 35, 40, 45] | 5% | Center color occupies `centerPercentage`% for `center_less`, or `100 - centerPercentage`% for `center_more`. This parameter does not change stimulus position. |
| **Bar** | `heightRatio` | Ratio between two bar heights. Ratios closer to 1:1 are **harder** to discriminate. | [[1,3], [1.14,2.86], [1.29,2.71], [1.43,2.57], [1.57,2.43], [1.71,2.29], [1.86,2.14], [2,2]] | [1,3] | Lower level = easier (more different heights). Higher = harder (more similar). |

---

## 3. Data Columns

Below are key columns recorded in the CSV file. Fields depend on the stage: presentation and response are separate rows, and response-specific fields are populated on response rows.

| Column | Meaning | Example |
|---------|----------|----------|
| `success` | Indicates whether a trial ran successfully. | `True` |
| `rt` | Reaction time in milliseconds. | `3152` |
| `trial_type` | The jsPsych plugin used for the stage. Motion presentation and response use keyboard trials. | `html-keyboard-response` |
| `trial_index` | Trial number within the experiment. | `3` |
| `plugin_version` | Version of the jsPsych plugin. | `2.1.0` |
| `time_elapsed` | Total time elapsed since experiment start (ms). | `2686852` |
| `user_id` | Participant identifier from the server-created run. | Participant ID |
| `auth_user_id` | Authenticated account identifier. | Account UUID |
| `run_id` | Identifier of the server-created experiment run. | Run UUID |
| `calculator_data` | JSON containing system and display info (resolution, screen size, etc.). | `{"resolution":[1920,1080],"screenSizeCm":[47.6,26.8],...}` |
| `selected_task` | Stimulus type for the trial (`Motion`, `Orientation`, etc.). | `Motion` |
| `stimulus` | The HTML or canvas-based visual stimulus presented. | `<style>...</style>` |
| `correct_direction` | The ground-truth motion or orientation direction. | `Up` |
| `task_type` | Task label for the response row. | `Motion` |
| `motion_position` | Named position of the motion stimulus. | `left_upper` |
| `motion_direction` | Nominal direction of coherent motion. | `Up` |
| `motion_direction_vector` | String representation of the direction vector; the sign of its second component determines Up/Down. | `[-1,1]` (Down) |
| `correct` | Whether the participant’s response was correct. | `True` |
| `userChoice` | Participant’s selected response. | `Down` |
| `difficulty_level` | Zero-based staircase level (0–8 for Motion/Centrality; 0–7 for Orientation/Bar). | `3` |
| `difficulty_value` | The actual value from the staircase (e.g., 60° for Motion level 3). | `60` |
| `staircase_parameter` | The name of the parameter varied for the task. | `directionRange` |

---

