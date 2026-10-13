# PostgreSQL experiment storage

The experiment in the current `legacy` checkout now sends JSON directly to a
Node server and PostgreSQL. Study instructions, stimulus parameters, trial
counts, staircase rules, task routes, pause/replay logic, and recorded data
field names are unchanged. The `beta` branch was inspected as a reference;
its account UI and hosted Supabase deployment were not merged or modified.

## Run locally

Requirements: Node 22+, npm, PostgreSQL binaries, and Python 3 for the one-time
archive import. PHP, Apache, Spark, Docker, and Supabase are not required.

```bash
npm install
# On this Ubuntu machine, binaries have already been extracted into .runtime.
# On another Ubuntu 26.04 machine without PostgreSQL:
bash scripts/setup-postgres-ubuntu.sh

npm start
```

Open the experiment at `http://127.0.0.1:8000/Motion` (or `/Orientation`,
`/Centrality`, `/Bar`) and the read-only viewer at
`http://127.0.0.1:8000/database`. The existing experiment landing page is retained.

Startup builds the experiment, starts the project-managed PostgreSQL cluster
if needed, and ensures the SQL schema exists. **Startup does not invoke the
archive reader or importer.** Live ingestion does not read, generate, or parse
CSV. Former CSV filename patterns are retained as logical `.json` save keys,
not filesystem output files. `save_data.php` is retired by the Node server.

The old PHP CSV portal and its files are retained in the repository as legacy
code. The new server supplies the SQL viewer at `/database`; it does not execute
the old PHP portal or write new data into its CSV directory. This local database
is separate from `beta`'s hosted Supabase database and portal. Integrating it with
that portal would require an explicit mapping of its authentication and run schema.

Data and credentials live under `.runtime/`, outside Vite's `dist/` directory,
and are ignored by Git. Rebuilding the frontend does not remove SQL data.
Old `dist/data` CSVs are preserved under `data/pre-sql-*` before rebuilding.

PostgreSQL binds only to `127.0.0.1:55432` by default and uses SCRAM password
authentication. Its generated password is stored in `.runtime/postgres.password`
with mode `0600`. The cluster stays running when the web server exits; stop it
explicitly with `npm run db:stop`, or start/check it with `npm run db:start`.

Configuration:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Connect to an existing PostgreSQL database; skip local cluster launch. Requires privileges to create the `experiment_data` schema and its tables. |
| `PG_BIN` | Directory containing native `initdb` and `pg_ctl` binaries. |
| `EXPERIMENT_RUNTIME_DIR` | Persistent cluster, binaries, log, and password location; defaults to `.runtime`. |
| `EXPERIMENT_PG_PORT` | Local PostgreSQL port; defaults to `55432`. Keep it fixed for an initialized running cluster. |
| `HOST`, `PORT` | Web server bind address and port; defaults to `127.0.0.1`, `8000`. |
| `DATABASE_VIEWER_TOKEN` | Bearer token for viewer access. Required when the web server binds publicly or the viewer is accessed through a proxy. Enter it in the viewer's connection form. |
| `EXPERIMENT_API_URL` | Vite development proxy target; defaults to `http://127.0.0.1:8000`. |

`aws-start-server.sh` uses PM2 and port 8001. The existing
`ocular-start-server-legacy.sh` uses tmux, the Cloudflare tunnel, and port 8002.
Both start the same Node/PostgreSQL backend; the static-only fallback is removed
so startup cannot silently produce an experiment that cannot save.

For development, run `npm run serve` in one terminal and `npm run dev` in another.
Vite proxies `/api` and `/database`; development writes are real database writes
and no longer report a successful save while skipping it.

## Import the existing archive once

```bash
npm run db:import -- ./server-data.zip
```

The importer starts/checks the database and runs a **single transaction**:

1. Compute the archive SHA-256 and lock that import identity.
2. Preserve every non-directory entry's original bytes, path, and checksum.
3. Parse CSVs and CSV backups once, retaining every original column name and
   cell string, including empty cells, JSON-shaped strings, and multiline text.
4. Commit all files/rows and an import report together. A malformed CSV or other
   failure rolls back the complete import.

A second invocation with the same archive checksum returns `skipped: true`
without reparsing or reinserting any entries. Concurrent invocations use the
same lock. A different archive checksum is a separate import, so overlapping
archive versions should be reviewed before importing them.

The supplied archive was imported successfully:

| Result | Count |
| --- | ---: |
| Original files | 419 |
| CSV files | 406 |
| CSV backup files | 9 |
| Other artifacts (cache, logs, `.gitkeep`) | 4 |
| Preserved source rows | 146,945 |
| Original uncompressed bytes | 225,727,596 |
| Stored checksum mismatches | 0 |
| Stored row-count mismatches | 0 |

Archive SHA-256:
`a69fafd86db8bec2cae5a212b77f18a18d200f332a0231b4740706e20ce5badf`.
The archive contains 2,576 filename/row participant-ID mismatches; these are
reported and preserved, not silently corrected. Historical final files, chunks,
checkpoints, and backups remain separate sources. Their overlapping rows must
not be summed as unique experimental responses.

## Data flow and SQL inspection

The jsPsych `on_data_update` callback queues each completed row without adding
transport fields to it. Run UUIDs and event sequence numbers live outside the
row's `payload`. JSON numbers, booleans, nulls, nested objects, and strings retain
their types in PostgreSQL `jsonb`. Original global properties applied later by
jsPsych are reconciled at saves. A manual pause marks the discarded attempt's
already recorded rows as excluded when the existing rollback removes them from
jsPsych; the raw rows remain available for inspection.

Unacknowledged JSON batches are retained in browser local storage and retried
with their original UUID after a network error or reload. SQL transactions
acknowledge only committed writes. Replaying an acknowledged batch is safe;
reusing a batch UUID for different content fails. Browsers with local storage
blocked or full retain the current queue in memory and log that durable browser
persistence is unavailable. Such a queue cannot survive closing the page.

Session and final saves are immutable within a run. Pause checkpoints overwrite
their prior rows atomically and retain `save_pause_index`. The existing
`save_file_prefix`, `save_created_at`, `save_task`, `save_session_chunk_index`,
and other study fields are preserved in save payloads.

| Relation in `experiment_data` | Contents |
| --- | --- |
| `runs` | Run identity, participant/task metadata, completion status. |
| `events` | Streamed jsPsych payloads, including excluded attempts. |
| `recorded_rows` | View of included rows excluding interrupted rows. |
| `saves`, `save_rows` | Session, pause, and final snapshot metadata and payloads. |
| `ingest_batches` | Immutable batch checksums and acknowledgements. |
| `import_jobs` | One-time archive checksums and reports. |
| `source_files`, `source_rows` | Original bytes and parsed historical cells. |

Example queries (existing data keys remain unchanged):

```sql
SELECT user_id, task, payload->>'overall_trial_number' AS overall_trial_number,
       payload->'correct' AS correct, payload->'rt' AS rt
FROM experiment_data.recorded_rows
WHERE payload ? 'correct';

SELECT original_path, kind, row_count
FROM experiment_data.source_files
ORDER BY original_path;
```

The viewer displays import counts/checksums, paginated live runs and snapshots,
historical files, participant/task filters, and original payload columns. It is
read-only; test writes use the actual experiment ingestion API. Remote database
reads require the configured viewer token. Database credentials never enter the
frontend bundle.

## Validation

```bash
npm run build
npm test
# One-time browser setup if Chromium is absent:
npx playwright install chromium
npm run test:browser
```

Integration tests use PostgreSQL and remove their own synthetic fixtures. They
cover JSON types, concurrent retries, mismatched acknowledgements, immutable
saves, checkpoint replacement, rollback, reader fidelity, importer idempotency,
invalid-request rejection, and viewer read access. Browser validation runs the
existing 256-trial Motion study with test time accelerated, including manual
pause/replay, seven scheduled breaks, eight session saves, and the final save.
It also checks the SQL viewer and its mobile layout.

The database lifecycle follows PostgreSQL's
[initdb](https://www.postgresql.org/docs/current/app-initdb.html) and
[pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html) interfaces.
Ingestion uses node-postgres
[parameterized queries](https://node-postgres.com/features/queries) and
[transactions on a single client](https://node-postgres.com/features/transactions).
