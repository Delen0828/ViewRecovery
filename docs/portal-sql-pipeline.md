# SQL-backed portal — October 5, 2026 (Eastern)

Results charts now use only data returned from SQL. Historical overview loads no longer download CSVs, sign Storage URLs, fetch individual checksums, or analyze raw rows in the browser. File-list durations/pass rates and preview charts use the same SQL summaries. Original bytes are fetched when opening a raw-row preview or downloading a file; recorded-run previews fetch raw SQL events for their source-row table/export, while their chart values come from SQL summaries.

**Data flow.** `public.portal_dashboard` returns authorized profile, participant, study, enrollment and paginated run metadata plus account access in one RPC. `public.portal_sessions` returns historical or recorded session summaries in 500-row pages. The frontend renders all five existing charts from those summaries, including stored mean difficulty and per-difficulty durations. It cancels obsolete source requests, reports progress across SQL pages, and explicitly marks missing summaries as incomplete rather than rebuilding them from files.

`public.session_metrics` stores versioned summaries linked to exactly one artifact or run. Its RLS follows the source artifact/run's visibility; anonymous reads and authenticated writes are denied. The two portal views use `security_invoker`, retaining source-table RLS. The dashboard RPC also runs with the caller's permissions. Existing participant, researcher and administrator access remains enforced in SQL.

Historical candidates are selected in SQL with the existing filename/date rules: final CSVs supersede chunks from the same participant/task/run timestamp; backups and checkpoints do not enter session trends. Original artifact access and download policies remain in force. A source checksum/task change invalidates its summary. Raw-preview caching includes the artifact checksum.

**Summary generation.** SQL implements the existing response, catch, training/rest, elapsed/RT and full-trial duration definitions. Recorded summaries update atomically after an acknowledged ingestion batch and after run creation/status changes. Batch retries preserve the existing acknowledgement behavior. Every phase of an interrupted recorded attempt is excluded before calculating metrics; raw events remain available in the source-row preview. The refresh happens once per batch rather than per event.

The server-only backfill verifies each object's SHA-256, parses its preserved cells and sends rows to SQL for calculation. Before committing each summary, it independently compares the SQL result with the previous JavaScript definitions. A mismatch rolls back that summary and stops the job. Malformed files retain an explicit unavailable result. The job is resumable, and the legacy provisioner now creates summaries for newly preserved CSV/backup artifacts. This adds derived metrics; it does not convert historical files into canonical experiment events or resolve existing identity conflicts.

**Applied deployment.** `202610050001_portal_metrics.sql` was applied to the configured hosted project after local SQL/browser verification. All 415 historical CSV/backup files passed checksum verification and metric reconciliation, covering 146,945 source rows. Final audit: 421 original artifacts, 14 participants, 415 summaries, 60 historical overview sessions, zero missing overview summaries, and zero leftover synthetic accounts, studies or Storage objects. The compiled frontend was rebuilt, and the existing local static server was verified against the updated build.

**Measured improvement.** For the same largest participant's 19 overview sessions:

| Chart-data load | Before | SQL summaries |
| --- | ---: | ---: |
| HTTP application requests | 64 | **1** |
| CSV bytes / decoded summary JSON | 36,578,030 | **15,002** |
| Measured first request sequence | 3.93 s | **0.71 s** |
| Subsequent measured loads | 2.59 s | **0.17–0.19 s** |

The old loader parsed/analyzed approximately 0.7 seconds of data in addition to network waits. The SQL-summary path performs no such raw-row analysis in the browser. Its authenticated SQL plan took approximately 53 ms. These are server-side read-only HTTP replays, excluding browser authentication, account metadata and rendering; decoded JSON size is not compressed wire size. Frontend metadata consolidation additionally reduces an administrator's selected-user path to four application requests including user verification and the summary read, excluding token refreshes/CORS preflights.

**Verification.**

- `npm test`: passed, including the new all-archive SQL parity gate, PostgreSQL policy/ingestion tests, production build, static HTTP routing and secret scan.
- Fourteen hosted SQL acceptance cases: passed in a rollback-only transaction.
- Twenty-one production static browser checks: passed; five opt-in live cases skipped in that run. Checks cover SQL-only result values, zero Storage/raw-event requests for overview charts, incomplete data, 501-session pagination, cancellation, previews, settings, navigation and mobile layout.
- Two live browser workflows: passed against the rebuilt existing static server and real Supabase. These verify participant/admin access, SQL charts, previews/downloads and a complete 256-trial run with 13 catch trials, interruption/replay, recorded summaries and CSV export. Synthetic fixtures were removed.
- Backfill rerun: skipped all 415 unchanged files, with zero repeated downloads or summary writes.

Anonymous reports: `test/results/portal-sql-parity.json`, `portal-metrics-backfill-initial.json`, `portal-metrics-backfill.json`, `portal-sql-browser.json`, `portal-sql-database-live.txt`, `portal-sql-live.json`, `portal-sql-performance.json` and `portal-sql-cleanup.json`. The initial backfill report's aggregate overview snapshot includes concurrent live verification fixtures; the rerun and final cleanup audit contain the final historical counts.

**Reproduction.** Apply migrations with `node scripts/apply-staging-migrations.mjs`, then run `node scripts/backfill-portal-metrics.mjs` using the protected local staging environment. Use `--force` to explicitly rebuild unchanged summaries. Run `node scripts/profile-sql-portal.mjs` for an anonymous, read-only performance report. `node test/portal-sql-parity.mjs` verifies all archive files locally without cloud access. The static browser configuration uses port 5197; the live configuration reuses the existing localhost:5173 server to match current Auth callbacks. Future changes to metric definitions require a new migration/version and reconciliation before publishing new summaries.
