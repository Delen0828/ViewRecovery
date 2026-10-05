// Definitions ported from the legacy PHP metrics and portal duration calculator.
export const TASKS = ['Motion', 'Orientation', 'Centrality', 'Bar'];
export const COLORS = {Motion:'#2563eb',Orientation:'#059669',Centrality:'#d97706',Bar:'#7c3aed'};
export function finite(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function boolean(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (['true','1','yes','correct'].includes(s)) return true;
  if (['false','0','no','incorrect'].includes(s)) return false;
  return null;
}
export function taskOf(row) {
  const candidates = [row.task_type,row.selected_task,row.task_route].join(' ').toLowerCase();
  return TASKS.find(t=>candidates.includes(t.toLowerCase())) ||
    ({up:'Motion',down:'Motion',vertical:'Orientation',horizontal:'Orientation',black:'Centrality',white:'Centrality',same:'Bar',different:'Bar'}[String(row.correct_direction).toLowerCase()]) || '';
}
export function catchResponse(row) {
  return row.trial_category === 'fixation_catch_response' ||
    (boolean(row.fixation_catch_trial) === true && String(row.correct_direction).toLowerCase() === 'x' && String(row.fixation_response_key ?? '').trim() !== '');
}
export function fileType(file) {
  const name = file.original_path?.split('/').at(-1) || '';
  if (name.startsWith('pause_checkpoint_')) return 'pause';
  if (name.startsWith('session_chunk_complete_')) return 'session';
  if (name.startsWith('final_complete_') || name.startsWith('user_')) return 'final';
  return 'other';
}
export function fileDate(file) {
  const m = file.original_path?.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : file.started_at || file.created_at || null;
}
export function dateKey(date) {
  if (!date || Number.isNaN(new Date(date).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
  const get = key=>parts.find(p=>p.type===key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function dateLabel(date) {
  return date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}) : 'Unknown';
}
export function duration(ms) {
  const seconds = Math.round(Math.max(0,ms || 0)/1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds/60)}m ${seconds%60}s`;
}
export function percent(correct,total) {return total ? `${(correct/total*100).toFixed(1)}%` : '—';}
export function csvObjects(csv) {return csv.rows.map(row=>Object.fromEntries(csv.header.map((key,i)=>[key,row[i]])));}
export function analyzeRows(rows, fallbackTask='') {
  let previous=null, trainingMs=0, restingMs=0, catchCorrect=0, catchTotal=0;
  const trials=new Map(), responses=[];
  for (const row of rows) {
    const elapsed=finite(row.time_elapsed), rt=finite(row.rt);
    const ms=Math.max(0,elapsed!==null && previous!==null && elapsed>=previous ? elapsed-previous : rt ?? 0);
    if(elapsed!==null) previous=elapsed;
    const task=taskOf(row)||fallbackTask, number=String(row.overall_trial_number??'').trim();
    const key=`${task}|${number}|${row.attempt_number || row.manual_pause_attempt_number || 1}`;
    if(['scheduled_break','manual_pause_screen'].includes(row.trial_category)) restingMs+=ms;
    else if(number && boolean(row.manual_pause_interrupted)!==true) {
      trainingMs+=ms;trials.set(key,(trials.get(key)||0)+ms);
    }
    if(boolean(row.manual_pause_interrupted)===true || row.attempt_state==='interrupted') continue;
    const correct=boolean(row.correct);
    if(correct===null) continue;
    if(catchResponse(row)) {catchTotal++;catchCorrect+=correct?1:0;continue;}
    const level=String(row.difficulty_level??'').trim();
    if(task && level!=='') responses.push({task,correct,level,key,rt});
  }
  const records=responses.map(r=>({...r,durationMs:trials.get(r.key)||r.rt||0}));
  const groups=new Map();
  for(const r of records) {
    const key=`${r.task}|${r.level}`;
    if(!groups.has(key))groups.set(key,{task:r.task,level:r.level,correct:0,total:0,durationMs:0});
    const g=groups.get(key);g.total++;g.correct+=r.correct?1:0;g.durationMs+=r.durationMs;
  }
  const levels=[...groups.values()].sort((a,b)=>a.level.localeCompare(b.level,undefined,{numeric:true})).map(g=>({...g,accuracy:g.correct/g.total*100,averageDurationMs:g.durationMs/g.total}));
  return {trainingMs,restingMs,totalMs:trainingMs+restingMs,catchCorrect,catchTotal,records,levels,
    total:records.length,correct:records.filter(r=>r.correct).length};
}
// Finals supersede chunks/checkpoints from the same original run. Chunks are
// distinct sessions only when that run has no final. Backups never enter trends.
export function trendFiles(files) {
  const candidates=files.filter(f=>f.kind==='.csv' && ['final','session'].includes(fileType(f)) && f.participant_id);
  const runKey=f=>`${f.participant_id}|${f.task}|${fileDate(f) || f.id}`;
  const finals=new Set(candidates.filter(f=>fileType(f)==='final').map(runKey));
  return candidates.filter(f=>fileType(f)==='final'||!finals.has(runKey(f))).sort((a,b)=>String(fileDate(a)).localeCompare(String(fileDate(b)))||a.id.localeCompare(b.id));
}
