import {requireClient} from './supabase.js';
export async function loadDashboard(userId,page=0) {
 const client=requireClient();
 const queries=[
  client.from('profiles').select('display_username,preferences').eq('auth_user_id',userId).single(),
  client.from('participants').select('id,provenance').eq('auth_user_id',userId).maybeSingle(),
  client.from('studies').select('id,name,active,protocol_version'),
  client.from('enrollments').select('study_id,participant_id,active,consent_version,consented_at'),
  client.from('experiment_runs').select('id,participant_id,study_id,task,status,started_at,ended_at',{count:'exact'}).order('started_at',{ascending:false}).range(page*25,page*25+24)
 ];
 const results=await Promise.all(queries);
 if(results.some(result=>result.error)) throw new Error('Could not load your dashboard. Check your connection or sign in again.');
 return {profile:results[0].data,participant:results[1].data,studies:results[2].data,enrollments:results[3].data,runs:results[4].data,totalRuns:results[4].count||0};
}
