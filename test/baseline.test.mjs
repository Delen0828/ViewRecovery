import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/main.js', 'utf8');
function block(from, to) { return source.slice(source.indexOf(from), source.indexOf(to)); }
const context = vm.createContext({});
vm.runInContext(block('const STAIRCASE_CONFIG =', '// Manual pause state') +
  block('// Reset staircase state', 'function getLatestCalculatorData()') +
  '\nglobalThis.api = {resetStaircaseState, updateDifficulty, getCurrentDifficultyValue, staircaseState, STAIRCASE_CONFIG}', context);
test('each task keeps 3-correct up, 1-incorrect down, and bounds', () => {
  for (const task of ['Motion', 'Orientation', 'Centrality', 'Bar']) {
    const a = context.api;
    a.resetStaircaseState(task);
    a.updateDifficulty(task, true); a.updateDifficulty(task, true);
    assert.equal(a.staircaseState[task].level, 0);
    a.updateDifficulty(task, true); assert.equal(a.staircaseState[task].level, 1);
    a.updateDifficulty(task, false); assert.equal(a.staircaseState[task].level, 0);
    for (let i = 0; i < 100; i++) a.updateDifficulty(task, true);
    assert.equal(a.staircaseState[task].level, a.STAIRCASE_CONFIG[task].levels.length - 1);
    for (let i = 0; i < 100; i++) a.updateDifficulty(task, false);
    assert.equal(a.staircaseState[task].level, 0);
  }
});
test('forced pause restores scientific state and truncates the interrupted attempt', () => {
  const c = vm.createContext({manualPauseState: {attemptDataCountSnapshot: 5, attemptStaircaseSnapshot: {level: 2}}, staircaseState: {level: 3}, truncateDataToSnapshot: n => { assert.equal(n, 5); }});
  vm.runInContext(block('function rollbackManualPauseTrialAttempt()', '// Default parameters'), c);
  vm.runInContext('rollbackManualPauseTrialAttempt()', c);
  assert.equal(c.staircaseState.level, 2);
  assert.equal(c.manualPauseState.forceEndCurrentTrial, false);
  assert.equal(vm.runInContext('isManualPauseForcedEnd({manual_pause_interrupted:true})', c), true);
});

test('catch slots remain deterministic and replace 13 of the 256 numbered trials',()=>{
  const c=vm.createContext({CENTRAL_FIXATION_CATCH_TRIAL_PROPORTION:0.05});
  vm.runInContext(block('function getCentralFixationCatchTrialProportion()', '// Staircase configuration')+
    block('function shuffleArrayDeterministic(', '// Function to generate trial sequence with adaptive'),c);
  for(const task of ['Motion','Orientation','Centrality','Bar']) {
    const a=vm.runInContext(`Array.from(getCentralFixationCatchTrialSlots('${task}',256))`,c);
    const b=vm.runInContext(`Array.from(getCentralFixationCatchTrialSlots('${task}',256))`,c);
    assert.deepEqual(a,b); assert.equal(a.length,13);
    assert.equal(new Set(a).size,13); assert.ok(a.every(n=>n>=1&&n<=256));
  }
});

const portalSource=fs.readFileSync('data-portal/app.js','utf8');
function portalBlock(from,to) { return portalSource.slice(portalSource.indexOf(`  function ${from}`),portalSource.indexOf(`  function ${to}`)); }
const portalContext=vm.createContext({TASKS:['Motion','Orientation','Centrality','Bar'],REST_TRIAL_CATEGORIES:new Set(['scheduled_break','manual_pause_screen']),easternDateKeyFormatter:new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})});
vm.runInContext([
  portalBlock('calculateDurationMetrics','setButtonBusy'),portalBlock('parseFiniteNumber','parseApiDate'),
  portalBlock('parseBoolean','compareDifficultySort'),portalBlock('normalizeTask','isAdminLogin'),
  portalBlock('parseSessionDate','formatSessionDateLabel'),portalBlock('isRestingRow','formatUnit'),
  portalBlock('extractResponseRecords','extractFileSessionSummary')
].join('\n'),portalContext);
test('portal fixture preserves blank-category response detection, accuracy and Eastern date grouping',()=>{
  const rows=[
    {user_id:'fixture',task_type:'Motion',overall_trial_number:'1',time_elapsed:'1000',trial_category:'',correct:'true',difficulty_level:'0',rt:'250'},
    {user_id:'fixture',task_type:'Motion',overall_trial_number:'2',time_elapsed:'2000',trial_category:'',correct:'false',difficulty_level:'1',rt:'300'},
    {user_id:'fixture',task_type:'Motion',overall_trial_number:'3',time_elapsed:'2300',trial_category:'fixation_catch_response',correct:'true',rt:'200'}
  ];
  portalContext.rows=rows;
  const records=vm.runInContext("extractResponseRecords({name:'final_complete_user_fixture_Motion_2026-10-04T02-30-00.csv'},rows)",portalContext);
  assert.equal(records.length,2);
  assert.equal(records.filter(r=>r.correct).length/records.length*100,50);
  assert.ok(records.every(r=>r.dateKey==='2026-10-03'));
});
test('portal durations separate trial phases and scheduled/manual rest',()=>{
  portalContext.rows=[
    {time_elapsed:'0',trial_category:'instructions'},
    {time_elapsed:'100',overall_trial_number:'1',task_type:'Motion'},
    {time_elapsed:'300',overall_trial_number:'1',task_type:'Motion'},
    {time_elapsed:'800',trial_category:'scheduled_break'},
    {time_elapsed:'1100',trial_category:'manual_pause_screen'},
    {time_elapsed:'1500',overall_trial_number:'2',task_type:'Motion'}
  ];
  const result=vm.runInContext('calculateDurationMetrics(rows)',portalContext);
  assert.equal(result.trainingMs,700); assert.equal(result.restingMs,800); assert.equal(result.totalMs,1500);
  assert.equal(result.trialDurations.get('Motion|1').durationMs,300);
});
