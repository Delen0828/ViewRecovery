# Stair Casing Implementation Design Report

## Executive Summary
Successfully implemented a 3-up-1-down adaptive stair casing algorithm for the ViewRecover jsPsych experiment. The system now allows participants to select a single stimulus type and adjusts difficulty dynamically based on performance.

## Implementation Details

### 1. Adaptive Difficulty Algorithm (3-up-1-down)
- **Rule**: After 3 consecutive correct responses, difficulty increases by 1 level
- **Rule**: After 1 incorrect response, difficulty decreases by 1 level
- **Bounds**: Difficulty levels are clamped to min/max values for each stimulus type
- **State Tracking**: System maintains consecutive correct/incorrect counts and response history

### 2. Difficulty Parameters by Stimulus Type

#### Motion Discrimination
- **Parameter**: `motionSpeed`
- **Levels**: [3, 4, 5, 6] pixels/frame
- **Effect**: Higher speed makes direction discrimination more difficult
<!-- 100, 71.4, 51, 36.4, 26, 18.6, 13.3, and 0% of signal dots.  -->
#### Orientation Discrimination  
- **Parameter**: `stripeSpacing` (spacing between stripes)
- **Levels**: [3, 2.5, 2, 1.5] pixels
- **Effect**: Closer spacing makes orientation discrimination more difficult

#### Centrality Discrimination
- **Parameter**: `centerPercentage` 
- **Levels**: [25, 30, 35, 40] percent
- **Effect**: Higher percentage (closer to 50%) makes centrality discrimination more difficult

#### Bar Comparison
- **Parameter**: `heightRatio` (for different height cases)
- **Levels**: [[1,3], [1,2.5], [1,2], [1,1.5]]
- **Effect**: Closer ratios make height comparison more difficult

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
  - `createMotionStimulus()` - added `motionSpeed` parameter
  - `createGratingStimulus()` - added `spacing` parameter  
  - `initMotionAnimation()` - uses dynamic `motionSpeed`
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
- `difficulty_level`: Current level index (0-3)
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
- Better threshold estimation
- Reduced testing fatigue
- Simple, reliable trial execution using jsPsych's conditional system
- No complex runtime timeline manipulation

#### Limitations
- Maximum 50 trials per session (configurable)
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

The stair casing implementation successfully transforms the experiment from a fixed-difficulty, multi-task battery into an adaptive, single-task assessment tool. This provides more precise difficulty calibration and improved participant experience while maintaining data quality for clinical assessment purposes.