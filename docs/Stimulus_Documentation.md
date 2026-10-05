 
# Stimulus Configuration and Data Documentation

This document explains how stimulus parameters are defined and how data are recorded in the CSV output file (e.g., `SMuser_000_2025-10-21_Motion.csv`).

---

## 1. Staircase Configuration

Each stimulus type has a staircase parameter that controls **task difficulty**. The staircase levels increase as the task becomes harder.

| Stimulus Type | Parameter | Description | Levels (values) | Start Level | Notes |
|----------------|------------|--------------|-----------------|--------------|-------|
| **Motion** | `directionRange` | The angular range (in degrees) within which dot directions vary around a main motion direction. A higher range = more variability = **harder** to perceive coherent motion. | [0, 25.71, 51.43, 77.14, 102.86, 128.57, 154.29, 180] | 0° | Fixed motion speed: 10°/s. 0° means perfectly coherent motion. |
| **Orientation** | `tiltDegree` | The tilt angle (in degrees) of the oriented pattern from vertical. Larger tilts = **harder** to judge orientation. | [0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45] | 0° | Starts with a perfectly vertical stimulus. |
| **Centrality** | `centerPercentage` | The percent distance from screen center used for stimulus placement. Larger percentage = more eccentric (further from center) = **harder** to perceive. | [10, 17.14, 24.29, 31.43, 38.57, 42.86, 46.43, 50] | 10% | 10% means near the center; 50% means near the screen edge. |
| **Bar** | `heightRatio` | Ratio between two bar heights. Ratios closer to 1:1 are **harder** to discriminate. | [[1,3], [1.14,2.86], [1.29,2.71], [1.43,2.57], [1.57,2.43], [1.71,2.29], [1.86,2.14], [2,2]] | [1,3] | Lower level = easier (more different heights). Higher = harder (more similar). |

---

## 2. Data Columns

Below are key columns recorded in the CSV file:

| Column | Meaning | Example |
|---------|----------|----------|
| `success` | Indicates whether a trial ran successfully. | `True` |
| `rt` | Reaction time in milliseconds. | `3152` |
| `trial_type` | The jsPsych plugin used for the trial. | `html-button-response` |
| `trial_index` | Trial number within the experiment. | `3` |
| `plugin_version` | Version of the jsPsych plugin. | `2.1.0` |
| `time_elapsed` | Total time elapsed since experiment start (ms). | `2686852` |
| `user_id` | Participant identifier (numeric). | `0` |
| `calculator_data` | JSON containing system and display info (resolution, screen size, etc.). | `{"resolution":[1920,1080],"screenSizeCm":[47.6,26.8],...}` |
| `selected_task` | Stimulus type for the trial (`Motion`, `Orientation`, etc.). | `Motion` |
| `stimulus` | The HTML or canvas-based visual stimulus presented. | `<style>...</style>` |
| `correct_direction` | The ground-truth motion or orientation direction. | `Up` |
| `task_type` | Specific condition (e.g., type of discrimination task). | `motion_discrimination` |
| `motion_position` | Spatial position of the motion stimulus. | `[x: 500, y: 300]` |
| `motion_direction` | Nominal direction of coherent motion. | `Up` |
| `motion_direction_vector` | Vector form of the direction. | `[1, 0]` |
| `correct` | Whether the participant’s response was correct. | `True` |
| `userChoice` | Participant’s selected response. | `Down` |
| `difficulty_level` | Index of the current staircase level (0–7). | `3` |
| `difficulty_value` | The actual value from the staircase (e.g., 77.14°). | `77.14` |
| `staircase_parameter` | The name of the parameter varied for the task. | `directionRange` |

---

