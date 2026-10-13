const STORAGE_PREFIX = 'viewrecovery-postgres-batch-v1:';
function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

// Transport metadata is separate from each unmodified jsPsych row.
export function createExperimentDataSync({getRun, storage = browserStorage(), request = globalThis.fetch.bind(globalThis), uuid = () => crypto.randomUUID(), retryDelay = 1500} = {}) {
  const queue = [];
  const rowSequences = new WeakMap();
  const current = new Map();
  const saveReplies = new Map();
  const completedSaves = new Map();
  let sequence = 0;
  let chain = Promise.resolve();
  let timer;
  let closed = false;
  let warned = false;

  if (storage) {
    for (let i=0; i<storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      try {
        const pending = JSON.parse(storage.getItem(key));
        if (!pending?.body?.batch_id || !Number.isFinite(pending.order)) throw new Error('Invalid pending batch');
        queue.push(pending);
      } catch (error) { console.error('[Data Save] Unreadable pending batch retained:',key,error); }
    }
    queue.sort((a,b)=>a.order-b.order);
  }
  let order = Math.max(Date.now(), ...queue.map(batch=>batch.order));

  function schedule(delay = 250) {
    if (closed || timer || !queue.length) return;
    timer = setTimeout(()=>{
      timer = undefined;
      flush().catch(error=>{
        if (!warned) console.warn('[Data Save] Pending JSON data retained for retry:',error.message);
        warned = true;
        schedule(retryDelay);
      });
    },delay);
  }
  function enqueue(events, save) {
    const body = {batch_id:uuid(),run:{...getRun()},events,...(save ? {save} : {})};
    const pending = {order:++order,body};
    queue.push(pending);
    try { storage?.setItem(STORAGE_PREFIX+body.batch_id,JSON.stringify(pending)); }
    catch (error) { console.error('[Data Save] Browser persistence unavailable; pending data remains in memory:',error); }
    schedule();
    return body.batch_id;
  }
  function serializeRow(row,included = true) {
    let event_sequence = rowSequences.get(row);
    if (!event_sequence) { event_sequence=++sequence; rowSequences.set(row,event_sequence); }
    return {event_sequence,included,payload:JSON.parse(JSON.stringify(row))};
  }
  function record(row) {
    const event = serializeRow(row);
    current.set(event.event_sequence,event);
    enqueue([event]);
  }
  function reconcile(rows) {
    const next = new Map();
    const updates = [];
    for (const row of rows) {
      const event = serializeRow(row);
      const previous = current.get(event.event_sequence);
      next.set(event.event_sequence,event);
      if (!previous || JSON.stringify(previous)!==JSON.stringify(event)) updates.push(event);
    }
    for (const [key,event] of current) {
      if (!next.has(key)) updates.push({...event,included:false});
    }
    current.clear();
    for (const [key,event] of next) current.set(key,event);
    // Bound individual batches without changing row order or any study values.
    for (let i=0; i<updates.length; i+=50) enqueue(updates.slice(i,i+50));
  }
  async function send() {
    while (queue.length) {
      const pending = queue[0];
      const response = await request('/api/experiment/ingest',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.body),
        signal:AbortSignal.timeout(20000)
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('Invalid server acknowledgement'); }
      if (!response.ok || !result.success) throw new Error(result.error || `Server error: ${response.status}`);
      if (result.batch_id!==pending.body.batch_id || result.accepted!==pending.body.events.length) throw new Error('Server acknowledgement does not match the pending batch');
      if (pending.body.save) {
        saveReplies.set(pending.body.batch_id,result);
        if (!pending.body.save.overwrite) completedSaves.set(`${pending.body.run.id}:${pending.body.save.save_key}`,result);
      }
      // A lost acknowledgement retries this same immutable batch_id.
      try {storage?.removeItem(STORAGE_PREFIX+pending.body.batch_id);}
      catch (error) {console.warn('[Data Save] Acknowledged batch could not be removed from browser storage; replay is safe:',error);}
      queue.shift();
      warned = false;
    }
    return {success:true};
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer=undefined; }
    const work = chain.catch(()=>{}).then(send);
    chain=work;
    return work;
  }
  async function save(save) {
    const logicalKey=`${getRun().id}:${save.save_key}`;
    if (!save.overwrite && completedSaves.has(logicalKey)) return completedSaves.get(logicalKey);
    // Reuse a pending immutable save after an earlier network error, even if
    // the UI regenerates its save_created_at metadata while retrying.
    const existing=!save.overwrite && queue.find(batch=>batch.body.run.id===getRun().id && batch.body.save?.save_key===save.save_key);
    const id = existing ? existing.body.batch_id : enqueue([],save);
    try {
      await flush();
      const result = saveReplies.get(id);
      saveReplies.delete(id);
      return result;
    } catch (error) { schedule(retryDelay); throw error; }
  }
  schedule();
  return {record,reconcile,save,flush,pending:()=>queue.length,close:()=>{closed=true;clearTimeout(timer);}};
}
