import {createHash} from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefixes = new Set(['final_complete', 'session_chunk_complete', 'pause_checkpoint']);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }

export function validateBatch(body) {
  if (!isObject(body) || !uuid.test(body.batch_id) || !isObject(body.run) || !uuid.test(body.run.id)) fail('A batch_id and run.id UUID are required.');
  for (const key of ['user_id', 'task', 'run_timestamp']) {
    if (typeof body.run[key] !== 'string' || !body.run[key].length || body.run[key].length > 100) fail(`Invalid run.${key}`);
  }
  if (!['Motion', 'Orientation', 'Centrality', 'Bar'].includes(body.run.task)) fail('Invalid task');
  if (!Array.isArray(body.events) || body.events.length > 10000) fail('Invalid events');
  const sequences = new Set();
  for (const event of body.events) {
    if (!isObject(event) || !Number.isSafeInteger(event.event_sequence) || event.event_sequence < 1 || event.event_sequence > 2147483647 || !isObject(event.payload) || typeof event.included !== 'boolean') fail('Invalid event');
    if (sequences.has(event.event_sequence)) fail('Duplicate event_sequence in batch');
    sequences.add(event.event_sequence);
  }
  if (body.save !== undefined) {
    const save = body.save;
    if (!isObject(save) || typeof save.save_key !== 'string' || !/^[A-Za-z0-9_.-]{1,250}$/.test(save.save_key) || !prefixes.has(save.prefix)) fail('Invalid save');
    if (!Array.isArray(save.rows) || !save.rows.length || save.rows.length > 10000 || !save.rows.every(isObject)) fail('Invalid save rows');
    if (typeof save.overwrite !== 'boolean' || (save.overwrite && save.prefix !== 'pause_checkpoint')) fail('Only pause checkpoints can be overwritten.');
  }
}

export async function ingest(pool, body) {
  validateBatch(body);
  const payloadHash = hash(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializes all batches for this run, including simultaneous retries and checkpoints.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.run.id]);
    const previous = await client.query('SELECT payload_hash, acknowledgement FROM experiment_data.ingest_batches WHERE batch_id = $1', [body.batch_id]);
    if (previous.rowCount) {
      if (previous.rows[0].payload_hash !== payloadHash) fail('This batch_id was already used for different data.', 409);
      await client.query('COMMIT');
      return previous.rows[0].acknowledgement;
    }
    const {run} = body;
    const existing = await client.query('SELECT user_id, task, run_timestamp FROM experiment_data.runs WHERE id = $1', [run.id]);
    if (existing.rowCount) {
      const old = existing.rows[0];
      if (old.task !== run.task || old.run_timestamp !== run.run_timestamp || (old.user_id !== 'unknown' && run.user_id !== 'unknown' && old.user_id !== run.user_id)) fail('Run metadata does not match existing data.', 409);
    }
    await client.query(`INSERT INTO experiment_data.runs(id, user_id, task, run_timestamp) VALUES ($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET user_id = CASE WHEN excluded.user_id = 'unknown' THEN experiment_data.runs.user_id ELSE excluded.user_id END, updated_at = now()`,
    [run.id, run.user_id, run.task, run.run_timestamp]);
    if (body.events.length) await client.query(`INSERT INTO experiment_data.events(run_id,event_sequence,included,payload)
      SELECT $1, e.event_sequence, e.included, e.payload FROM jsonb_to_recordset($2::jsonb) AS e(event_sequence integer,included boolean,payload jsonb)
      ON CONFLICT(run_id,event_sequence) DO UPDATE SET payload = excluded.payload, included = excluded.included, updated_at = now()`, [run.id, JSON.stringify(body.events)]);
    let saveId;
    if (body.save) {
      const save = body.save;
      const saveHash = hash(save.rows);
      const oldSave = await client.query('SELECT id, payload_hash, prefix FROM experiment_data.saves WHERE run_id=$1 AND save_key=$2', [run.id, save.save_key]);
      if (oldSave.rowCount && (oldSave.rows[0].prefix !== save.prefix || (!save.overwrite && oldSave.rows[0].payload_hash !== saveHash))) fail('An immutable save already exists with different data.', 409);
      const saved = await client.query(`INSERT INTO experiment_data.saves(run_id,save_key,prefix,payload_hash,row_count) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(run_id,save_key) DO UPDATE SET payload_hash=excluded.payload_hash,row_count=excluded.row_count,updated_at=now() RETURNING id`,
      [run.id, save.save_key, save.prefix, saveHash, save.rows.length]);
      saveId = saved.rows[0].id;
      await client.query('DELETE FROM experiment_data.save_rows WHERE save_id=$1', [saveId]);
      await client.query(`INSERT INTO experiment_data.save_rows(save_id,ordinal,payload)
        SELECT $1, ordinal, payload FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS r(payload,ordinal)`, [saveId, JSON.stringify(save.rows)]);
      if (save.prefix === 'final_complete') await client.query("UPDATE experiment_data.runs SET status='complete' WHERE id=$1", [run.id]);
    }
    const acknowledgement = {success: true, batch_id: body.batch_id, run_id: run.id, accepted: body.events.length,
      ...(body.save ? {save_id: saveId, filename: body.save.save_key, rows_saved: body.save.rows.length} : {})};
    await client.query('INSERT INTO experiment_data.ingest_batches(batch_id,run_id,payload_hash,acknowledgement) VALUES ($1,$2,$3,$4)', [body.batch_id, run.id, payloadHash, acknowledgement]);
    await client.query('COMMIT');
    return acknowledgement;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function overview(pool) {
  const counts = await pool.query(`SELECT
    (SELECT count(*)::integer FROM experiment_data.runs) AS runs,
    (SELECT count(*)::integer FROM experiment_data.events) AS events,
    (SELECT count(*)::integer FROM experiment_data.recorded_rows) AS included_rows,
    (SELECT count(*)::integer FROM experiment_data.saves) AS saves,
    (SELECT count(*)::integer FROM experiment_data.source_files) AS source_files,
    (SELECT count(*)::integer FROM experiment_data.source_rows) AS source_rows`);
  const jobs = await pool.query('SELECT id,archive_name,archive_sha256,report,completed_at FROM experiment_data.import_jobs ORDER BY id DESC');
  return {counts: counts.rows[0], imports: jobs.rows};
}

export async function sources(pool, {user_id = '', task = '', offset = 0, limit = 50} = {}) {
  const result = await pool.query(`WITH sources AS (
    SELECT 'run' AS kind, id::text AS id, user_id,task,run_timestamp AS name, status,
      (SELECT count(*)::integer FROM experiment_data.events e WHERE e.run_id=r.id AND included) AS row_count,updated_at AS created_at
      FROM experiment_data.runs r
    UNION ALL
    SELECT 'save', s.id::text,r.user_id,r.task,s.save_key,s.prefix,s.row_count,s.updated_at
      FROM experiment_data.saves s JOIN experiment_data.runs r ON r.id=s.run_id
    UNION ALL
    SELECT 'source',id::text,user_id,task,original_path,kind,row_count,NULL::timestamptz FROM experiment_data.source_files
  ) SELECT *,count(*) OVER()::integer AS total FROM sources
    WHERE ($1='' OR user_id=$1) AND ($2='' OR task=$2)
    ORDER BY created_at DESC NULLS LAST,kind,id LIMIT $3 OFFSET $4`, [user_id,task,limit,offset]);
  return {sources: result.rows, total: result.rows[0]?.total || 0, offset, limit};
}

export async function rows(pool, kind, id, {offset = 0, limit = 50} = {}) {
  const config = {
    run: ['events','run_id','event_sequence'], save: ['save_rows','save_id','ordinal'], source: ['source_rows','source_file_id','ordinal']
  }[kind];
  if (!config || (kind === 'run' ? !uuid.test(id) : !/^\d+$/.test(id))) fail('Invalid source');
  const [table,key,ordinal] = config;
  // Identifiers come exclusively from the fixed mapping above.
  const result = await pool.query(`SELECT ${ordinal} AS ordinal, payload${kind === 'run' ? ', included' : ''} FROM experiment_data.${table} WHERE ${key}=$1 ORDER BY ${ordinal} LIMIT $2 OFFSET $3`, [id,limit,offset]);
  const count = await pool.query(`SELECT count(*)::integer AS total FROM experiment_data.${table} WHERE ${key}=$1`, [id]);
  return {rows: result.rows, total: count.rows[0].total, offset, limit};
}
