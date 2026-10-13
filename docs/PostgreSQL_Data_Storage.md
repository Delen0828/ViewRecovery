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
`/Centrality`, `/Bar`), the data portal at `http://127.0.0.1:8000/data-portal/`,
and the read-only database viewer at `http://127.0.0.1:8000/database`.
The existing experiment landing page is retained.

Startup builds the experiment, starts the project-managed PostgreSQL cluster
if needed, and ensures the SQL schema exists. **Startup does not invoke the
archive reader or importer.** Live ingestion does not read, generate, or parse
CSV. Former CSV filename patterns are retained as logical `.json` save keys,
not filesystem output files. `save_data.php` is retired by the Node server.

The original portal layout is restored at `/data-portal/`, served by Node with
SQL-backed file lookup, charts, previews, and downloads. The PHP code remains as
a legacy reference and is not executed. This local database and restored portal
remain separate from `beta`'s hosted Supabase deployment.

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
| `DATABASE_URL` | Connect to an existing PostgreSQL database; skip local cluster launch. Requires privileges to create the `experiment_data` and `portal_auth` schemas and their tables. |
| `PG_BIN` | Directory containing native `initdb` and `pg_ctl` binaries. |
| `EXPERIMENT_RUNTIME_DIR` | Persistent cluster, binaries, log, and password location; defaults to `.runtime`. |
| `EXPERIMENT_PG_PORT` | Local PostgreSQL port; defaults to `55432`. Keep it fixed for an initialized running cluster. |
| `HOST`, `PORT` | Web server bind address and port; defaults to `127.0.0.1`, `8000`. `start-server.sh` selects the next available port if the default is busy. An explicit `PORT` stays fixed and is checked before building. |
| `DATABASE_VIEWER_TOKEN` | Bearer token for viewer access. Required when the web server binds publicly or the viewer is accessed through a proxy. Enter it in the viewer's connection form. |
| `BETTER_AUTH_URL` | Public web origin, e.g. `https://study.example.org`; required when accessing the portal through a public hostname or reverse proxy. Localhost and `127.0.0.1` work automatically. |
| `BETTER_AUTH_SECRET` | Stable auth signing secret of at least 32 characters. When unset, a secret is generated once in `.runtime/portal-auth.secret` with mode `0600`. |
| `DATA_PORTAL_USER`, `DATA_PORTAL_PASS_HASH` | Administrator username and legacy bcrypt hash used to seed the Better Auth account; defaults match the PHP portal. Existing migrated credentials are preserved on subsequent starts. |
| `DATA_PORTAL_PARTICIPANT_PASS_HASH` | Optional legacy shared participant bcrypt hash used during account migration. When unset, passwordless participants receive their exact User ID as their password. |
| `DATA_PORTAL_SESSION_TTL_SEC` | Better Auth SQL session lifetime; defaults to 24 hours. |
| `DATA_PORTAL_MAX_ATTEMPTS`, `DATA_PORTAL_ATTEMPT_WINDOW_SEC` | Sign-in request limit per client IP; defaults to 5 requests in 900 seconds. Signup is limited to 5 requests in 900 seconds. Limits are stored in SQL. |
| `DATA_PORTAL_TRUSTED_PROXIES` | Comma-separated exact proxy IPs allowed to supply Cloudflare/forwarded client IPs for rate limits. Defaults to `127.0.0.1,::1` for the local tunnel/proxy; set to empty to use only socket peer IPs. |
| `EXPERIMENT_API_URL` | Vite development proxy target; defaults to `http://127.0.0.1:8000`. |

`aws-start-server.sh` uses PM2 and port 8001. The existing
`ocular-start-server-legacy.sh` uses tmux, the Cloudflare tunnel, and port 8002.
Both start the same Node/PostgreSQL backend; the static-only fallback is removed
so startup cannot silently produce an experiment that cannot save.

For development, run `npm run serve` in one terminal and `npm run dev` in another.
Vite proxies `/api`, `/data-portal`, and `/database`; development writes are real database writes
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

## Restored data portal

The portal retains its original pages, styling, charts, admin/participant login,
file-type toggles, search, date filters, preview links, and downloads. D3 is
served locally, so portal rendering does not require a CDN.

Its data comes from `experiment_data`:

- SQL computes accuracy, difficulty, training/rest durations, and catch pass
  rates using the metric definitions previously introduced on `beta`.
- `portal_files` exposes imported files, saved JSON snapshots, and canonical
  recorded runs. `portal_metrics` caches summaries by source revision and metric
  version; reads refresh stale summaries after new trial writes or pause rollback.
- Overview trends prefer historical final files over overlapping chunks from
  the same participant/task/run timestamp and exclude backups/checkpoints.
  Canonical live runs appear once; their snapshot saves do not duplicate their
  responses in overview charts. Active runs are included in trends and appear
  among session files in the file browser.
- Previews request SQL summaries as JSON, without fetching or parsing CSV.
  Downloads retrieve original historical bytes from SQL or JSON payloads for
  newly recorded runs and saves. Imported dates use the run timestamp in the
  filename; live save dates use their actual SQL creation/update timestamps.
- Admins can access all sources. Participants can access only sources owned by
  their participant ID, including previews and downloads. Imported filename
  ownership determines that scope; original row-ID mismatches remain preserved.
  Better Auth manages SQL sessions and signed HttpOnly cookies scoped to
  `/data-portal`. Authentication writes require JSON and a trusted Origin;
  logout revokes the stored session.

The database viewer token is separate from portal login. Existing portal admin
credentials and environment overrides continue to work. PHP is not required.

### Better Auth accounts and migration

The portal uses [Better Auth](https://better-auth.com/docs/adapters/postgresql)
with its [username plugin](https://better-auth.com/docs/plugins/username).
Select **User** or **Admin** on the login form. Both modes require a password;
the server checks the stored role before creating a session. A user cannot
gain administrator access by choosing Admin mode.

**Create User Account** asks for a User ID, email, password (8–128 characters),
and invitation code. The code must be exactly `bright` and is checked on the
server for every signup. Registration creates only user accounts and signs
them in immediately. Email verification and third-party login are disabled.
User IDs are immutable and case-sensitive so existing data ownership remains
unchanged. The email is account metadata; sign-in uses the User ID or admin
username.

Startup creates the `portal_auth` schema and migrates accounts before accepting
requests. To run the migration explicitly:

```bash
npm run auth:migrate
```

The migration runs in a transaction with an advisory lock. It discovers existing
participants from SQL data ownership (including legacy filename ownership) and
legacy user sessions. It preserves each participant ID exactly, including short
IDs and leading zeros. Accounts without a password receive a hashed password
equal to their User ID; a configured legacy participant password hash is retained.
The admin account retains its configured/default bcrypt hash. Migrated accounts
without an email receive an internal `@portal.invalid` address and can sign in
without email verification. Repeated migration adds missing accounts or passwords
and preserves existing hashes, including passwords changed through Better Auth.
Old portal sessions are invalidated; existing users sign in again.

`portal_auth."user"` stores role, username, and participant ownership;
`portal_auth.account` stores credential hashes; `portal_auth.session` stores
sessions. The verification and rate-limit tables complete the Better Auth schema.
Experiment records and archive bytes stay in `experiment_data`.

For hosted startup, set `BETTER_AUTH_URL` to the browser's public origin and
keep `BETTER_AUTH_SECRET` or the generated secret file stable across restarts.
Legacy credential variables seed new accounts; changing them after migration
does not overwrite an existing account password.

## Validation

```bash
npm run build
npm test
# One-time browser setup if Chromium is absent:
npx playwright install chromium
npm run test:browser
npm run test:portal
```

Integration tests use PostgreSQL and remove their own synthetic fixtures. They
cover JSON types, concurrent retries, mismatched acknowledgements, immutable
saves, checkpoint replacement, rollback, reader fidelity, importer idempotency,
invalid-request rejection, and viewer read access. Browser validation runs the
existing 256-trial Motion study with test time accelerated, including manual
pause/replay, seven scheduled breaks, eight session saves, and the final save.
It also checks the SQL viewer and its mobile layout.
Portal tests verify account migration, password preservation, invitation signup,
role enforcement, unverified-email login, session expiry/revocation, rate limits,
SQL summary values, account scoping, CSRF, source selection,
live refresh, original-byte downloads, and JSON types. Browser checks cover the
original portal layout, participant/admin workflows, SQL-only charts/previews,
live writes, locally served assets, and mobile rendering.

The database lifecycle follows PostgreSQL's
[initdb](https://www.postgresql.org/docs/current/app-initdb.html) and
[pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html) interfaces.
Ingestion uses node-postgres
[parameterized queries](https://node-postgres.com/features/queries) and
[transactions on a single client](https://node-postgres.com/features/transactions).
