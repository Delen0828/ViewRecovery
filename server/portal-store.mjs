import {fail} from './store.mjs';

function userScope(session) {
  if (session.role==='admin') return '';
  if (session.role==='user' && session.user_id) return session.user_id;
  fail('Unauthorized',401);
}
const scopeSql='($1=\'\' OR f.user_id=$1)';
function describe(file) {
  const metrics=file.metrics;
  return {name:file.name,reference:file.reference,source_kind:file.source_kind,status:file.status,
    user_id:file.user_id || '',task_type:file.task || metrics?.task || '',
    session_type:file.metric_type==='pause' ? 'break' : 'study',metric_type:file.metric_type,
    session_id:file.source_kind==='run' ? file.source_id : file.reference,
    session_time:file.session_date ? new Date(file.session_date).toISOString() : null,
    size_bytes:Number(file.size_bytes ?? metrics?.jsonBytes ?? 0),created_at:new Date(file.created_at).getTime()/1000,
    modified_at:new Date(file.modified_at).getTime()/1000,row_count:file.row_count ?? metrics?.rowCount,
    download_url:'/data-portal/download?file='+encodeURIComponent(file.reference),
    ...(metrics ? {duration:{totalMs:metrics.totalMs,trainingMs:metrics.trainingMs,restingMs:metrics.restingMs},
      catch_pass_rate:{correct:metrics.catchCorrect,total:metrics.catchTotal,accuracy:metrics.catchTotal ? 100*metrics.catchCorrect/metrics.catchTotal : null}} : {})};
}
async function summaries(pool,references) {
  if (references.length) await pool.query('SELECT experiment_data.ensure_portal_metrics($1::text[])',[references]);
}
export async function portalFiles(pool,session,params) {
  const user=userScope(session);
  const q=params.get('q') || '',from=params.get('date_from') || '',to=params.get('date_to') || '';
  const selected=params.get('user_id') || '';
  if (session.role==='user' && selected && selected!==user) fail('Access denied.',403);
  for (const value of [from,to]) if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) fail('Invalid date filter.');
  const requested=(params.get('metric_types') || 'final').split(',').filter(value=>['final','session','pause'].includes(value));
  const result=await pool.query(`SELECT f.* FROM experiment_data.portal_files f WHERE ${scopeSql}
    AND ($2='' OR strpos(lower(concat_ws(' ',f.user_id,f.task,f.reference,f.status,f.name)),lower($2))>0)
    AND ($3='' OR (f.created_at AT TIME ZONE 'America/New_York')::date >= NULLIF($3,'')::date)
    AND ($4='' OR (f.created_at AT TIME ZONE 'America/New_York')::date <= NULLIF($4,'')::date)
    AND ($5='' OR f.user_id=$5)
    ORDER BY f.created_at DESC,f.reference`,[user,q,from,to,selected]);
  await summaries(pool,result.rows.filter(file=>file.has_rows && requested.includes(file.metric_type)).map(file=>file.reference));
  const metrics=await pool.query('SELECT reference,metrics FROM experiment_data.portal_metrics WHERE reference=ANY($1::text[])',[result.rows.map(file=>file.reference)]);
  const byReference=new Map(metrics.rows.map(row=>[row.reference,row.metrics]));
  return {generated_at:Math.floor(Date.now()/1000),total:result.rowCount,files:result.rows.map(file=>describe({...file,metrics:byReference.get(file.reference)}))};
}

async function findFile(pool,session,reference) {
  // Retain legacy filename links, while new links identify sources unambiguously.
  const result=await pool.query(`SELECT f.* FROM experiment_data.portal_files f WHERE ${scopeSql}
    AND (f.reference=$2 OR f.name=$2 OR f.name='data/' || $2)
    ORDER BY (f.reference=$2) DESC,f.modified_at DESC,f.reference LIMIT 1`,[userScope(session),reference]);
  if (!result.rowCount) fail('Not found',404);
  return result.rows[0];
}
export async function portalPreview(pool,session,reference) {
  const file=await findFile(pool,session,reference);
  if (!file.has_rows) fail('This source has no experiment rows.',400);
  await summaries(pool,[file.reference]);
  const result=await pool.query('SELECT metrics FROM experiment_data.portal_metrics WHERE reference=$1',[file.reference]);
  return {file:describe(file),metrics:result.rows[0].metrics};
}
export async function portalDownload(pool,session,reference) {
  const file=await findFile(pool,session,reference);
  if (file.source_kind==='source') {
    const result=await pool.query('SELECT bytes FROM experiment_data.source_files WHERE id=$1',[file.source_id]);
    return {name:file.name,content:result.rows[0].bytes,type:file.name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/octet-stream'};
  }
  const query=file.source_kind==='save' ?
    "SELECT jsonb_pretty(coalesce(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb)) AS data FROM experiment_data.save_rows WHERE save_id=$1" :
    "SELECT jsonb_pretty(coalesce(jsonb_agg(payload ORDER BY event_sequence),'[]'::jsonb)) AS data FROM experiment_data.recorded_rows WHERE run_id=$1";
  const result=await pool.query(query,[file.source_id]);
  return {name:file.name,content:Buffer.from(result.rows[0].data),type:'application/json; charset=utf-8'};
}

export async function portalTrends(pool,session) {
  const result=await pool.query(`WITH eligible AS (
    SELECT f.* FROM experiment_data.portal_files f WHERE ${scopeSql} AND f.has_rows
      AND (f.source_kind='run' OR (f.source_kind='source' AND f.status='csv' AND f.metric_type IN ('final','session')))
  ) SELECT f.* FROM eligible f WHERE f.source_kind='run' OR f.metric_type='final' OR NOT EXISTS(
    SELECT 1 FROM eligible final WHERE final.source_kind='source' AND final.metric_type='final'
      AND final.user_id IS NOT DISTINCT FROM f.user_id AND final.task IS NOT DISTINCT FROM f.task AND final.session_date=f.session_date)
    ORDER BY f.session_date,f.name,f.reference`,[userScope(session)]);
  await summaries(pool,result.rows.map(file=>file.reference));
  const cached=await pool.query('SELECT reference,metrics FROM experiment_data.portal_metrics WHERE reference=ANY($1::text[])',[result.rows.map(file=>file.reference)]);
  const byReference=new Map(cached.rows.map(row=>[row.reference,row.metrics]));
  const users=new Map(),sequence=new Map();
  const accuracySeries=[],durationSeries=[],difficultySeries=[],fileSessions=[];
  for (const file of result.rows) {
    const metrics=byReference.get(file.reference);if (!metrics) continue;
    const userId=file.user_id || 'Unknown',userLabel=`User ${userId}`;
    const sessionIndex=(sequence.get(userId) || 0)+1;sequence.set(userId,sessionIndex);
    const date=new Date(file.session_date);
    const dateKey=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
    const context={userId,userLabel,task:metrics.task || file.task,fileName:file.name,reference:file.reference,
      dateLocal:date.toISOString(),dateKey,sessionIndex,sessionLabel:`Session ${sessionIndex}`};
    const accuracy=metrics.total ? 100*metrics.correct/metrics.total : 0;
    accuracySeries.push({...context,total:metrics.total,correct:metrics.correct,accuracy});
    durationSeries.push({...context,durationMs:metrics.totalMs,trainingMs:metrics.trainingMs,restingMs:metrics.restingMs,sessions:1});
    fileSessions.push(durationSeries.at(-1));
    for (const level of metrics.levels) difficultySeries.push({...context,task:level.task,difficultyLevel:level.level,
      difficultySortValue:Number.isFinite(Number(level.level)) ? Number(level.level) : level.level,
      total:level.total,correct:level.correct,accuracy:level.accuracy,durationMs:level.durationMs,averageDurationMs:level.averageDurationMs});
    const user=users.get(userId) || {id:userId,label:userLabel,trials:0,correct:0,sessions:0,durationMs:0,trainingMs:0,restingMs:0};
    user.trials+=metrics.total;user.correct+=metrics.correct;user.sessions++;
    user.durationMs+=metrics.totalMs;user.trainingMs+=metrics.trainingMs;user.restingMs+=metrics.restingMs;users.set(userId,user);
  }
  return {generated_at:Math.floor(Date.now()/1000),csv_files:result.rows.map(describe),loaded_file_count:result.rowCount,
    failed_file_count:0,records:[],file_sessions:fileSessions,accuracy_series:accuracySeries,duration_series:durationSeries,
    difficulty_series:difficultySeries,user_summaries:[...users.values()].map(user=>({...user,accuracy:user.trials ? 100*user.correct/user.trials : 0}))};
}
