import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {openDatabase} from '../scripts/lib/postgres.mjs';
import {ingest} from '../server/store.mjs';
import {createServer} from '../server/index.mjs';
import {importArchive} from '../scripts/import-archive.mjs';
import {createExperimentDataSync} from '../src/experiment-data.js';

test('PostgreSQL persistence, HTTP API, and one-time archive import',async t=>{
  const pool=await openDatabase();const runIds=[];const imports=[];let server;
  const temp=mkdtempSync(join(tmpdir(),'viewrecovery-sql-test-'));
  function batch(events=[{event_sequence:1,included:true,payload:{trial_index:0,user_id:'SQLTest',correct:true,rt:12.5,response:null,calculator_data:{x:5}}}],run) {
    if (!run) {run={id:randomUUID(),user_id:'SQLTest',task:'Motion',run_timestamp:'2026-10-13T12-00-00'};runIds.push(run.id);}
    return {batch_id:randomUUID(),run,events};
  }
  try {
    await t.test('concurrent duplicate batches acknowledge once and JSON types round-trip',async()=>{
      const body=batch();
      const replies=await Promise.all([ingest(pool,body),ingest(pool,body)]);
      assert.deepEqual(replies[0],replies[1]);
      const result=await pool.query('SELECT payload FROM experiment_data.events WHERE run_id=$1',[body.run.id]);
      assert.equal(result.rowCount,1);assert.deepEqual(result.rows[0].payload,body.events[0].payload);
      await assert.rejects(ingest(pool,{...body,events:[{...body.events[0],payload:{correct:false}}]}),/different data/);
    });
    await t.test('pause overwrites replace rows, final saves are immutable, conflicts roll back events',async()=>{
      const first=batch();first.save={save_key:'pause_checkpoint_test.json',prefix:'pause_checkpoint',overwrite:true,rows:[{save_pause_index:1},{save_pause_index:1,rt:10}]};
      const result=await ingest(pool,first);
      const second=batch([],first.run);second.save={...first.save,rows:[{save_pause_index:2,rt:20}]};
      await ingest(pool,second);
      const saved=await pool.query('SELECT payload FROM experiment_data.save_rows WHERE save_id=$1',[result.save_id]);
      assert.deepEqual(saved.rows.map(row=>row.payload),second.save.rows);
      const final=batch([],first.run);final.save={save_key:'final_complete_test.json',prefix:'final_complete',overwrite:false,rows:[{correct:true}]};await ingest(pool,final);
      const conflict=batch([{event_sequence:99,included:true,payload:{correct:false}}],first.run);conflict.save={...final.save,rows:[{correct:false}]};
      await assert.rejects(ingest(pool,conflict),/immutable/);
      assert.equal((await pool.query('SELECT 1 FROM experiment_data.events WHERE run_id=$1 AND event_sequence=99',[first.run.id])).rowCount,0);
      assert.equal((await pool.query('SELECT status FROM experiment_data.runs WHERE id=$1',[first.run.id])).rows[0].status,'complete');
    });
    await t.test('rolled-back attempts are excluded from recorded rows and kept for inspection',async()=>{
      const first=batch();await ingest(pool,first);
      await ingest(pool,batch([{...first.events[0],included:false}],first.run));
      assert.equal((await pool.query('SELECT 1 FROM experiment_data.recorded_rows WHERE run_id=$1',[first.run.id])).rowCount,0);
      assert.equal((await pool.query('SELECT 1 FROM experiment_data.events WHERE run_id=$1',[first.run.id])).rowCount,1);
    });
    await t.test('HTTP transport and database viewer enforce formats, origins, pagination and read access',async()=>{
      server=createServer(pool,{host:'0.0.0.0',viewerToken:'test-viewer-token'});await server.portalAuthReady;server.listen(0,'127.0.0.1');await once(server,'listening');
      const base=`http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(base+'/api/health')).status,200);
      assert.equal((await fetch(base+'/')).status,200);
      assert.equal((await fetch(base+'/Orientation')).status,200);
      assert.equal((await fetch(base+'/api/database/overview')).status,401);
      const auth={Authorization:'Bearer test-viewer-token'};
      assert.equal((await fetch(base+'/api/database/overview',{headers:auth})).status,200);
      assert.equal((await fetch(base+'/api/database/sources?limit=201',{headers:auth})).status,400);
      assert.equal((await fetch(base+'/api/database/overview',{method:'POST',headers:auth})).status,405);
      assert.equal((await fetch(base+'/save_data.php',{method:'POST'})).status,410);
      assert.equal((await fetch(base+'/api/experiment/ingest',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
      assert.equal((await fetch(base+'/api/experiment/ingest',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://another.example'},body:'{}'})).status,403);
      assert.equal((await fetch(base+'/database/%2e%2e%2fsql/001-experiment.sql')).status,404);
      assert.equal((await fetch(base+'/data/secret.csv')).status,404);
      const context=batch().run;
      const sync=createExperimentDataSync({getRun:()=>context,storage:null,uuid:randomUUID,request:(path,options)=>fetch(base+path,options)});
      try {
        const row={trial_index:10,correct:true,response:'arrowleft',rt:143.2,difficulty_level:4};sync.record(row);
        await sync.save({save_key:'session_chunk_complete_test.json',prefix:'session_chunk_complete',overwrite:false,rows:[{...row,save_session_chunk_index:1}]});
        const data=await (await fetch(base+`/api/database/rows/run/${context.id}`,{headers:auth})).json();
        assert.deepEqual(data.rows[0].payload,row);
      } finally {sync.close();}
    });
    await t.test('import retains every file, raw bytes, multiline cells and backups; rerun skips; malformed import rolls back',async()=>{
      const archive=join(temp,'fixture.zip');
      execFileSync('python3',['-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('data/session_chunk_complete_user_SQLTest_Motion_session01_2026-10-13T12-00-00.csv','user_id,correct,stimulus,calculator_data\\nSQLTest,true,"line 1\\nline 2","{""x"":5}"\\n')
 z.writestr('data/pause_checkpoint_user_SQLTest_Motion_2026-10-13T12-00-00.csv.old.bak','user_id,rt\\nSQLTest,12.5\\n')
 z.writestr('data/save_log.txt',bytes([0,255,13,10]))`,archive]);
      const first=await importArchive(pool,archive);imports.push(first.archive_sha256);
      assert.equal(first.files,3);assert.equal(first.rows,2);assert.equal(first.csv_files,1);assert.equal(first.backup_files,1);assert.equal(first.artifacts,1);
      const second=await importArchive(pool,archive);assert.equal(second.skipped,true);
      const files=await pool.query(`SELECT f.* FROM experiment_data.source_files f JOIN experiment_data.import_jobs j ON j.id=f.import_job_id WHERE j.archive_sha256=$1`,[first.archive_sha256]);
      assert.equal(files.rowCount,3);
      for (const file of files.rows) assert.equal(createHash('sha256').update(file.bytes).digest('hex'),file.sha256);
      const csv=files.rows.find(file=>file.kind==='csv');
      const raw=await pool.query('SELECT payload FROM experiment_data.source_rows WHERE source_file_id=$1',[csv.id]);
      assert.deepEqual(raw.rows[0].payload,{user_id:'SQLTest',correct:'true',stimulus:'line 1\nline 2',calculator_data:'{"x":5}'});
      const bad=join(temp,'bad.zip');execFileSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('bad.csv','a,b\\n1\\n'); z.close()",bad]);
      await assert.rejects(importArchive(pool,bad),/Column count mismatch/);
      assert.equal((await pool.query("SELECT 1 FROM experiment_data.import_jobs WHERE archive_name='bad.zip'")).rowCount,0);
    });
  } finally {
    if (server) {server.close();await once(server,'close');}
    for (const id of runIds) {
      await pool.query('DELETE FROM experiment_data.save_rows WHERE save_id IN (SELECT id FROM experiment_data.saves WHERE run_id=$1)',[id]);
      for (const table of ['saves','ingest_batches','events']) await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`,[id]);
      await pool.query('DELETE FROM experiment_data.runs WHERE id=$1',[id]);
    }
    for (const checksum of imports) {
      await pool.query('DELETE FROM experiment_data.source_rows WHERE source_file_id IN (SELECT f.id FROM experiment_data.source_files f JOIN experiment_data.import_jobs j ON j.id=f.import_job_id WHERE j.archive_sha256=$1)',[checksum]);
      await pool.query('DELETE FROM experiment_data.source_files WHERE import_job_id IN (SELECT id FROM experiment_data.import_jobs WHERE archive_sha256=$1)',[checksum]);
      await pool.query('DELETE FROM experiment_data.import_jobs WHERE archive_sha256=$1',[checksum]);
    }
    await pool.query('DELETE FROM portal_auth."user" WHERE username=$1',['SQLTest']);
    await pool.end();rmSync(temp,{recursive:true,force:true});
  }
});
