import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentDataSync} from '../src/experiment-data.js';
import {randomUUID} from 'node:crypto';

class Storage {
  values=new Map();
  get length(){return this.values.size;}
  key(index){return [...this.values.keys()][index];}
  getItem(key){return this.values.get(key) ?? null;}
  setItem(key,value){this.values.set(key,value);}
  removeItem(key){this.values.delete(key);}
}
const run=()=>({id:randomUUID(),user_id:'TestJSON',task:'Motion',run_timestamp:'2026-10-13T12-00-00'});
const reply=body=>({ok:true,json:async()=>({success:true,batch_id:body.batch_id,accepted:body.events.length,...(body.save ? {filename:body.save.save_key} : {})})});

test('JSON transport preserves original keys/types, reconciles rollback, and preserves checkpoint metadata',async()=>{
  const bodies=[];const storage=new Storage();const context=run();
  const sync=createExperimentDataSync({getRun:()=>context,storage,uuid:randomUUID,request:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);return reply(body);
  }});
  try {
    const row={trial_index:1,overall_trial_number:1,user_id:'TestJSON',correct:true,rt:123.5,response:null,calculator_data:{width:40},stimulus:'A, "B"\nC'};
    const interrupted={trial_index:2,overall_trial_number:2,correct:false};
    const original=structuredClone(row);
    sync.record(row);sync.record(interrupted);sync.reconcile([row]);
    const snapshot={...row,save_file_prefix:'pause_checkpoint',save_pause_index:1,save_session_chunk_index:'',save_created_at:'2026-10-13T12:01:00Z',save_task:'Motion'};
    const result=await sync.save({save_key:'pause_checkpoint_test.json',prefix:'pause_checkpoint',rows:[snapshot],overwrite:true});
    assert.equal(result.filename,'pause_checkpoint_test.json');
    assert.deepEqual(row,original);
    assert.deepEqual(bodies[0].events[0].payload,original);
    assert.equal(bodies[2].events[0].included,false);
    assert.equal(bodies[2].events[0].event_sequence,bodies[1].events[0].event_sequence);
    assert.deepEqual(bodies.at(-1).save.rows,[snapshot]);
    assert.equal(sync.pending(),0);assert.equal(storage.length,0);
  } finally {sync.close();}
});

test('failed and lost acknowledgements retry the identical persisted batch after reload',async()=>{
  const storage=new Storage();const context=run();const attempts=[];
  const first=createExperimentDataSync({getRun:()=>context,storage,uuid:randomUUID,request:async(_url,options)=>{
    attempts.push(JSON.parse(options.body));throw new Error('Connection lost after commit');
  }});
  first.record({trial_index:0,correct:true});
  await assert.rejects(first.flush(),/Connection lost/);
  first.close();assert.equal(storage.length,1);
  const second=createExperimentDataSync({getRun:run,storage,uuid:randomUUID,request:async(_url,options)=>{
    const body=JSON.parse(options.body);attempts.push(body);return reply(body);
  }});
  try {await second.flush();assert.deepEqual(attempts[1],attempts[0]);assert.equal(storage.length,0);}
  finally {second.close();}
});

test('incorrect acknowledgement does not discard a pending row',async()=>{
  const storage=new Storage();const sync=createExperimentDataSync({getRun:run,storage,uuid:randomUUID,request:async()=>({ok:true,json:async()=>({success:true,batch_id:randomUUID(),accepted:1})})});
  try {
    sync.record({trial_index:0});await assert.rejects(sync.flush(),/does not match/);
    assert.equal(sync.pending(),1);assert.equal(storage.length,1);
  } finally {sync.close();}
});

test('changed global jsPsych properties update prior rows without adding a second event',async()=>{
  const bodies=[];const context=run();const sync=createExperimentDataSync({getRun:()=>context,storage:new Storage(),uuid:randomUUID,request:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);return reply(body);
  }});
  try {
    const row={trial_index:0};sync.record(row);row.user_id='TestJSON';sync.reconcile([row]);await sync.flush();
    assert.equal(bodies[0].events[0].event_sequence,bodies[1].events[0].event_sequence);
    assert.equal(bodies[1].events[0].payload.user_id,'TestJSON');
  } finally {sync.close();}
});

test('UI retries reuse pending immutable saves and later return their acknowledged result',async()=>{
  const bodies=[];let offline=true;const context=run();
  const sync=createExperimentDataSync({getRun:()=>context,storage:new Storage(),uuid:randomUUID,request:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    if (offline) throw new Error('Offline');
    return reply(body);
  }});
  try {
    const save={save_key:'session_retry.json',prefix:'session_chunk_complete',overwrite:false,rows:[{rt:10,save_created_at:'first'}]};
    await assert.rejects(sync.save(save),/Offline/);
    offline=false;
    const second=await sync.save({...save,rows:[{rt:10,save_created_at:'retry'}]});
    assert.deepEqual(bodies[0],bodies[1]);
    const third=await sync.save({...save,rows:[{rt:10,save_created_at:'later'}]});
    assert.deepEqual(third,second);assert.equal(bodies.length,2);
  } finally {sync.close();}
});
