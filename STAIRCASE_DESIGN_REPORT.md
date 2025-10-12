# Stair Casing Implementation Design Report

## Executive Summary
Successfully implemented a 3-up-1-down adaptive stair casing algorithm for the ViewRecover jsPsych experiment with 8 difficulty levels. The system now allows participants to select a single stimulus type and adjusts difficulty dynamically based on performance across a wider range of difficulty parameters.

## Implementation Details

### 1. Adaptive Difficulty Algorithm (3-up-1-down)
- **Rule**: After 3 consecutive correct responses, difficulty increases by 1 level
- **Rule**: After 1 incorrect response, difficulty decreases by 1 level
- **Bounds**: Difficulty levels are clamped to min/max values for each stimulus type
- **State Tracking**: System maintains consecutive correct/incorrect counts and response history

### 2. Difficulty Parameters by Stimulus Type (8 Levels)

#### Motion Discrimination
- **Parameter**: `directionRange`
- **Levels**: [0, 25.71, 51.43, 77.14, 102.86, 128.57, 154.29, 180] degrees
- **Range**: 0° (easiest - all dots move straight down) to 180° (hardest - complete randomness)
- **Effect**: Higher direction range makes motion detection more difficult
- **Implementation**: All 30 dots are signal dots moving within ±directionRange degrees from vertical (downward)
- **No noise dots**: Unlike previous implementation, all dots contribute to the signal

#### Orientation Discrimination  
- **Parameter**: `tiltDegree`
- **Levels**: [0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45] degrees
- **Range**: 0° (easiest) to 45° (hardest)
- **Effect**: Greater tilt angle makes orientation discrimination more difficult

#### Centrality Discrimination
- **Parameter**: `centerPercentage` 
- **Levels**: [10, 17.14, 24.29, 31.43, 38.57, 42.86, 46.43, 50] percent
- **Range**: 10% (easiest, 10:90 ratio) to 50% (hardest, 50:50 ratio)
- **Effect**: Closer to 50% makes centrality discrimination more difficult

#### Bar Comparison
- **Parameter**: `heightRatio`
- **Levels**: 
  - Level 1: [1, 3] - easiest (1:3 ratio)
  - Level 2: [1.14, 2.86]
  - Level 3: [1.29, 2.71]
  - Level 4: [1.43, 2.57]
  - Level 5: [1.57, 2.43]
  - Level 6: [1.71, 2.29]
  - Level 7: [1.86, 2.14]
  - Level 8: [2, 2] - hardest (2:2 ratio)
- **Effect**: Lower bar increases from 1→2, higher bar decreases from 3→2, making comparison more difficult

### 3. User Experience Flow

#### Previous Flow (All Tasks Sequential)
1. User ID input
2. Visual angle calculator
3. Motion trials (96 trials)
4. Orientation trials (96 trials) 
5. Centrality trials (96 trials)
6. Bar comparison trials (96 trials)
7. Results

#### New Flow (Single Task with Adaptation)
1. User ID input
2. Visual angle calculator
3. **Stimulus Selection Screen**
   - User selects ONE task type
   - Clear visual interface with descriptions
4. Selected task with adaptive difficulty
   - Difficulty adjusts based on 3-up-1-down rule
   - Real-time performance tracking
5. Trials and Breaks
   -  Motion: Trial counter shows 1-96 (12 blocks × 8 trials), breaks every 24 trials
   -  Orientation: Trial counter shows 1-96 (12 blocks × 8 trials), breaks every 24 trials 
   -  Centrality: Trial counter shows 1-96 (6 blocks × 16 trials), breaks every 32 trials
   -  Bar: Trial counter shows 1-96 (8 blocks × 12 trials), breaks every 24 trials
6. Results

### 4. Key Code Modifications

#### Added Components
- `STAIRCASE_CONFIG` object defining difficulty levels for each task
- `staircaseState` object tracking current difficulty and performance
- `updateDifficulty()` function implementing 3-up-1-down logic
- `getCurrentDifficultyValue()` helper function
- `generateAdaptiveTrialSequence()` function for dynamic trial generation
- Stimulus selection interface with task buttons
- Pre-generated conditional trial nodes for all task types

#### Modified Components
- Trial generation functions now accept difficulty parameters:
  - `createMotionStimulus()` - uses `directionRange` instead of `tiltDegree`
  - `createGratingStimulus()` - added `spacing` parameter  
  - `initMotionAnimation()` - implements direction range logic with all signal dots
  - `initGratingStimulus()` - uses dynamic `spacing`
- Response handlers now:
  - Track difficulty level in trial data
  - Call `updateDifficulty()` after each response
  - Store difficulty value for analysis
- Timeline structure: Pre-generates all trials with conditional functions

#### Removed/Commented Components
- Commented out fixed block structure for all 4 tasks
- Removed sequential presentation of all stimulus types
- Eliminated fixed difficulty parameters
- Removed complex dynamic trial addition logic

### 5. Data Collection Enhancements

Each trial now records:
- `difficulty_level`: Current level index (0-7)
- `difficulty_value`: Actual parameter value used
- `correct`: Whether response was correct
- Standard trial data (RT, response, etc.)

This enables analysis of:
- Difficulty progression over time
- Threshold estimation
- Performance stability
- Learning effects

### 6. Technical Considerations

#### Advantages
- More efficient testing (single task focus)
- Adaptive to individual ability levels
- Better threshold estimation with 8 levels providing finer granularity
- Reduced testing fatigue
- Simple, reliable trial execution using jsPsych's conditional system
- No complex runtime timeline manipulation
- Wider difficulty range covering more participant abilities
- Motion stimulus improvements:
  - All signal dots (no noise) provide clearer signal
  - Direction range parameter is more intuitive than rotation
  - 0-180° range covers full spectrum from perfect coherence to randomness

#### Limitations
- Maximum 96 trials per session (configurable)
- Fixed step sizes (1 level at a time)
- No reversal tracking for threshold calculation
- Pre-generates more trial nodes than needed (but skips unused ones)

#### Implementation Notes
- Uses jsPsych's `conditional_function` to skip trials for non-selected tasks
- All trials are pre-generated in the timeline before `jsPsych.run()`
- Trial sequences are generated dynamically based on current difficulty
- Each trial node checks if it should run based on task selection and trial count

### 7. Future Enhancements

Potential improvements:
1. Add reversal tracking for psychometric threshold calculation
2. Implement weighted staircase (e.g., 2-up-1-down for 70.7% threshold)
3. Add practice trials before main task
4. Include confidence ratings
5. Implement PEST or QUEST adaptive algorithms
6. Add multi-session support with saved states

## Conclusion

The stair casing implementation successfully transforms the experiment from a fixed-difficulty, multi-task battery into an adaptive, single-task assessment tool with 8 difficulty levels. The expanded range from 4 to 8 levels provides more precise difficulty calibration, better coverage of participant abilities, and improved threshold estimation while maintaining data quality for clinical assessment purposes.