import {requireClient} from './supabase.js';
import {parseCsv} from '../portal-csv.js';
export async function accountAccess() {
 const {data,error}=await requireClient().rpc('account_access');
 if(error) throw new Error('Could not check account access.');
 return data==='admin'?'admin':'participant';
}
export async function userDirectory(search='',page=0) {
 const {data,error}=await requireClient().rpc('admin_user_status',{search,page_offset:page*50});
 if(error) throw new Error('Administrator access is required to view all users.');
 return {users:data,total:Number(data[0]?.total_users||0)};
}
export async function listArtifacts({participantId=null,page=0,unassigned=false,pageSize=25}={}) {
 let query=requireClient().from('portal_artifacts').select('id,participant_id,bucket,object_key,original_path,kind,bytes,row_count,task,identity_status,created_at,legacy_user_id,sha256,metrics,error_code',{count:'exact'}).order('original_path').order('id').range(page*pageSize,page*pageSize+pageSize-1);
 if(participantId) query=query.eq('participant_id',participantId);
 if(unassigned) query=query.is('participant_id',null);
 const {data,error,count}=await query;
 if(error) throw new Error('Could not load historical files.');
 return {files:data,total:count||0};
}
export async function artifactManifest(participantId=null,unassigned=false) {
 const files=[];let page=0,total;
 do {const result=await listArtifacts({participantId,unassigned,page:page++,pageSize:500});files.push(...result.files);total=result.total;if(!result.files.length)break;} while(files.length<total);
 return files;
}
const csvCache=new Map();
export function artifactData(file) {
 const key=`${file.id}|${file.sha256}`;
 if(!csvCache.has(key)) {
  const pending=artifactCsv(file).then(text=>({csv:parseCsv(text)})).catch(error=>{csvCache.delete(key);throw error;});
  csvCache.set(key,pending);
 }
 return csvCache.get(key).then(data=>({...data,metrics:file.metrics||null}));
}
export async function pagedRows(table,select,configure=q=>q) {
 const rows=[];let offset=0;
 for(;;) {
  const {data,error}=await configure(requireClient().from(table).select(select)).range(offset,offset+499);
  if(error)throw new Error(`Could not load ${table.replaceAll('_',' ')}.`);
  rows.push(...data);if(data.length<500)break;offset+=500;
 }
 return rows;
}
export async function sessionSummaries(participantId,source,{onProgress=()=>{},signal}={}) {
 const sessions=[];let offset=0,total=0;
 do {
  let query=requireClient().from('portal_sessions').select('id,participant_id,task,session_date,label,username,metrics,error_code',{count:'exact'}).eq('source',source).order('session_date').order('id').range(offset,offset+499);
  if(participantId)query=query.eq('participant_id',participantId);
  if(signal)query=query.abortSignal(signal);
  const {data,error,count}=await query;
  if(error){if(signal?.aborted)throw new DOMException('Load cancelled','AbortError');throw new Error('Could not load session summaries.');}
  total=count||0;
  sessions.push(...data.map(s=>({id:s.id,participantId:s.participant_id,task:s.task,date:s.session_date,label:s.label,username:s.username,metrics:s.metrics,errorCode:s.error_code})));
  onProgress(sessions.length,total);if(!data.length)break;offset+=500;
 } while(sessions.length<total);
 return sessions;
}
export async function recordedRun(id) {
 const [runResult,summaryResult]=await Promise.all([
  requireClient().from('experiment_runs').select('id,participant_id,task,status,started_at,ended_at,parameter_snapshot').eq('id',id).single(),
  requireClient().from('portal_sessions').select('metrics').eq('source','recorded').eq('id',id).single()
 ]);
 const run=runResult.data;
 if(runResult.error||!run)throw new Error('This run is unavailable or outside your account access.');
 if(summaryResult.error)throw new Error('Could not load session summaries.');
 const events=await pagedRows('experiment_events','payload,client_sequence',q=>q.eq('run_id',run.id).order('client_sequence'));
 return {run,rows:events.map(e=>e.payload),metrics:summaryResult.data.metrics};
}
export async function artifactUrl(artifact,download=false) {
 const {data,error}=await requireClient().storage.from(artifact.bucket).createSignedUrl(artifact.object_key,300,download?{download:artifact.original_path.split('/').at(-1)}:{});
 if(error) throw new Error('Could not authorize this file.');
 return data.signedUrl;
}
export async function artifactCsv(artifact) {
 const response=await fetch(await artifactUrl(artifact));
 if(!response.ok) throw new Error('Could not read this file.');
 const content=await response.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),n=>n.toString(16).padStart(2,'0')).join('');
 if(!artifact.sha256 || artifact.sha256!==digest) throw new Error('File checksum did not match the preserved original.');
 return new TextDecoder('utf-8',{fatal:true}).decode(content);
}
