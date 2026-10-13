import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,projectRoot} from './lib/postgres.mjs';

async function archiveHash(file) {
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(file)) sha.update(chunk);
  return sha.digest('hex');
}

export async function importArchive(pool, archive) {
  const checksum = await archiveHash(archive);
  const client = await pool.connect();
  let reader;
  let child;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`viewrecovery-import:${checksum}`]);
    const existing = await client.query('SELECT report FROM experiment_data.import_jobs WHERE archive_sha256=$1',[checksum]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      return {...existing.rows[0].report,skipped:true};
    }
    const job = await client.query('INSERT INTO experiment_data.import_jobs(archive_sha256,archive_name) VALUES ($1,$2) RETURNING id',[checksum,basename(archive)]);
    const report = {archive_sha256:checksum,files:0,csv_files:0,backup_files:0,artifacts:0,rows:0,bytes:0,identity_conflicts:0};
    child = spawn('python3',[join(projectRoot,'scripts/read-archive.py'),archive],{stdio:['ignore','pipe','pipe']});
    let errors='';
    child.stderr.on('data',chunk=>{errors+=chunk.toString();});
    const completion = new Promise((resolve,reject)=>{
      child.on('error',reject);
      child.on('close',code=>code===0 ? resolve() : reject(new Error(`Archive reader failed: ${errors.trim() || code}`)));
    });
    // Attach immediately so a reader failure never becomes an unhandled rejection.
    completion.catch(()=>{});
    reader = createInterface({input:child.stdout,crlfDelay:Infinity});
    for await (const line of reader) {
      const entry=JSON.parse(line);
      const bytes=Buffer.from(entry.bytes,'base64');
      if (createHash('sha256').update(bytes).digest('hex')!==entry.sha256) throw new Error(`Checksum mismatch: ${entry.path}`);
      const file = await client.query(`INSERT INTO experiment_data.source_files(import_job_id,original_path,sha256,kind,user_id,task,run_timestamp,header,row_count,bytes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [job.rows[0].id,entry.path,entry.sha256,entry.kind,entry.user_id,entry.task,entry.run_timestamp,JSON.stringify(entry.header),entry.rows.length,bytes]);
      if (entry.rows.length) await client.query(`INSERT INTO experiment_data.source_rows(source_file_id,ordinal,payload)
        SELECT $1,ordinal,payload FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS r(payload,ordinal)`,[file.rows[0].id,JSON.stringify(entry.rows)]);
      report.files++;
      report[entry.kind==='csv' ? 'csv_files' : entry.kind==='backup' ? 'backup_files' : 'artifacts']++;
      report.rows+=entry.rows.length;
      report.bytes+=bytes.length;
      report.identity_conflicts+=entry.rows.filter(row=>entry.user_id && row.user_id && row.user_id!==entry.user_id).length;
    }
    await completion;
    if (await archiveHash(archive)!==checksum) throw new Error('Archive changed during import.');
    await client.query('UPDATE experiment_data.import_jobs SET report=$1,completed_at=now() WHERE id=$2',[report,job.rows[0].id]);
    await client.query('COMMIT');
    return {...report,skipped:false};
  } catch (error) {
    reader?.close(); child?.kill();
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const pool=await openDatabase();
  try { console.log(JSON.stringify(await importArchive(pool,resolve(process.argv[2] || join(projectRoot,'server-data.zip'))),null,2)); }
  finally { await pool.end(); }
}
