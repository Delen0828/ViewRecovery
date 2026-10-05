import {requireClient} from '../services/supabase.js';
import {getVerifiedSession} from '../services/auth.js';
const PREFIX='viewrecovery-events-v1:';
// Each immutable batch is retained until Supabase acknowledges its exact key.
// Browser storage is keyed by verified owner AND run, including interrupted work.
export function createRunSync(run,ownerId,{storage=localStorage,client=requireClient(),verify=getVerifiedSession}={}) {
 const key=`${PREFIX}${ownerId}:${run.id}`;
 let state=JSON.parse(storage.getItem(key)||'null')||{run,ownerId,next:0,batches:[],draft:null,attempts:{},complete:false,finishRequested:false};
 if(state.ownerId!==ownerId||state.run.id!==run.id)throw new Error('Pending records belong to a different account or run.');
 let chain=Promise.resolve();
 const persist=()=>storage.setItem(key,JSON.stringify(state));
 function event(payload,attempt=null) {
  const data=JSON.parse(JSON.stringify(payload));
  for(const k of ['correct','difficulty_level','fixation_catch_trial','manual_pause_interrupted'])if(data[k]===null)delete data[k];
  return {id:crypto.randomUUID(),phase:String(data.trial_category||data.trial_type||'event').slice(0,80),payload:data,...(attempt?{attempt_id:attempt.id,logical_trial:attempt.logical,attempt_number:attempt.number}: {})};
 }
 function enqueue(events) {
  let batch=[],next=state.next;const batches=[];
  const push=()=>{if(batch.length)batches.push({key:crypto.randomUUID(),events:batch});batch=[];};
  for(const item of events) {
   item.sequence=next++;
   if(batch.length&&(batch.length>=50||new TextEncoder().encode(JSON.stringify([...batch,item])).length>240000))push();
   if(new TextEncoder().encode(JSON.stringify(item)).length>240000)throw new Error('An event exceeds the upload limit. Its local draft is retained.');
   batch.push(item);
  }
  push();state.next=next;state.batches.push(...batches);persist();
 }
 function endAttempt(interrupted=false) {
  const draft=state.draft;if(!draft)return;
  const events=draft.events.map(item=>{
   if(interrupted){item.payload.manual_pause_interrupted=true;delete item.payload.correct;item.phase='interrupted';}
   return item;
  });
  enqueue(events);state.draft=null;persist();
 }
 // Reloaded draft attempts never become successful responses by assumption.
 if(state.draft)endAttempt(true);
 async function send() {
  const session=await verify();
  if(!session||session.user.id!==ownerId)throw new Error('Sign in with the owner of this run to synchronize pending data.');
  while(state.batches.length) {
   const batch=state.batches[0];
   const {data,error}=await client.rpc('ingest_events',{run:run.id,batch_key:batch.key,schema_version:1,events:batch.events});
   if(error)throw new Error(error.message);
   if(data?.accepted!==batch.events.length||data?.batch_key!==batch.key)throw new Error('The server did not acknowledge this batch.');
   state.batches.shift();persist();
  }
  if(state.finishRequested&&!state.complete) {
   const {data,error}=await client.rpc('complete_run',{run:run.id,expected_events:state.next});
   if(error||data?.status!=='complete')throw new Error(error?.message||'Run completion was not acknowledged.');
   state.complete=true;storage.removeItem(key);
  }
  return {success:true,run_id:run.id,events:state.next};
 }
 function flush(complete=false) {
  if(complete){state.finishRequested=true;persist();}
  const work=chain.catch(()=>{}).then(send);chain=work;return work;
 }
 return {
  beginAttempt(logical){if(state.draft)endAttempt(true);const number=(state.attempts[logical]||0)+1;state.attempts[logical]=number;state.draft={id:crypto.randomUUID(),logical,number,events:[]};persist();},
  record(row){if(state.complete)return;if(row.overall_trial_number&&state.draft){const payload={...row,attempt_number:state.draft.number};state.draft.events.push(event(payload,state.draft));persist();}else if(!row.overall_trial_number)enqueue([event(row)]);},
  endAttempt,flush,
  pending(){return {batches:state.batches.length,events:state.next,draft:Boolean(state.draft),complete:state.complete};}
 };
}
export function pendingRuns(ownerId,storage=localStorage) {
 const runs=[];
 for(let i=0;i<storage.length;i++) {
  const key=storage.key(i);if(!key?.startsWith(`${PREFIX}${ownerId}:`))continue;
  try{const state=JSON.parse(storage.getItem(key));if(state.ownerId===ownerId&&!state.complete&&(state.batches.length||state.draft||state.finishRequested))runs.push(state.run);}catch{/* Retain unreadable records for local recovery. */}
 }
 return runs;
}
