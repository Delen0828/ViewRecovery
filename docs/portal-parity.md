# Legacy portal parity and personalized training

The comparison used `legacy:data_portal.php`, `legacy:data-portal/app.js`, all
three legacy portal HTML entries and their stylesheet, plus the legacy task
renderer and the parameter requirements in `plan.md`. The beta portal previously
provided authenticated run listings, administrator access and a basic raw CSV
preview; it omitted scientific charts, file summaries and usable training setup.

| Required function | Implementation |
| --- | --- |
| File inventory and overview | Filename/date filters, refresh, final files by default, optional chunk/checkpoint/other files, pagination, file count/total bytes/newest file, task/row/identity metadata |
| File duration and fixation-test pass rate | Elapsed-time deltas with RT fallback, separate training/rest segments, catch correctness and denominator, explicit unavailable metrics |
| File preview | Existing `/data-portal/preview.html` route, response/accuracy/duration/catch summaries, accuracy by difficulty, paginated original rows, authenticated checksum-verified downloads |
| User overview | User/session/response totals, accuracy, training/rest time, latest session and participant selection within the caller's authorized scope |
| All legacy visualization types | Accuracy across sessions, duration across sessions by task, accuracy by difficulty per session, average full-trial duration by difficulty per session; also adds mean difficulty across sessions |
| Chart controls | Task visibility, task selection for difficulty charts, session legend highlighting, point tooltips accessible by keyboard, Eastern dates, responsive SVGs |
| Deployment task visibility | Motion/Centrality are checked initially; Orientation/Bar can be enabled explicitly |
| Persistent personal configuration | Named display profiles, measured screen width/height and viewing distance, per-study/task offsets, saved defaults reloaded from Supabase |
| Mandatory setup and preview | Live stimulus bounds and pixel/degree readout, full bounds validation, Bar restrictions, study-prescribed location, explicit confirmation and fullscreen measurements |
| Run creation and execution | Verified owner and enrollment/consent gates, existing `save_settings`/`create_run` RPCs, immutable settings snapshot consumed by the legacy renderer |
| Supabase saves and results | Owner/run-specific persistent browser outbox, stable event/batch IDs, exact acknowledgements, interrupted attempt handling, retry controls, server-gated completion, recorded-run preview/CSV export |
| Account and study access | Existing shared authentication, administrator directory and RLS/private Storage policies remain the enforcement layer |

## Metric and data boundaries

Ordinary response detection continues to support historical rows with a blank
`trial_category`: they need valid correctness, task and difficulty. Catch
responses are summarized separately. Scheduled breaks and manual-pause screens
count as resting time; numbered-trial phases count as training time. Difficulty
duration uses the whole numbered trial, including its phases, rather than just
response RT. Interrupted attempts remain in raw recorded history and are omitted
from scientific response summaries.

Historical trend selection prefers a final CSV over chunks with the same
participant, task and original run timestamp. Runs without a final use their
completed chunks. Checkpoints, backups and unassigned/conflicting identities do
not enter user trends. File summaries use the original run timestamp from the
filename when available, rather than treating the Supabase upload time as the
experiment date. Historical files and recorded Supabase runs have separate
source selectors to avoid treating an original file and a canonical run as two
sessions.

This restores usable views over preserved originals; it does not perform the
scientific reconciliation/import of every historical event. That existing
release gate, million-trial performance testing, independent restoration tests
and production deployment remain separate work. A new user still needs a staff
approved active enrollment and current consent to start training. Protocol
locations remain `left_upper` (or mirrored `upper` for Bar); participants cannot
change trial counts, staircase rules or catch proportions.

## Verification and screenshots

`npm test` runs the baseline, geometry/RLS/ingestion SQL, Auth, parser, new metric
and outbox tests, production build, HTTP routing and secret scan.
`npm run test:browser` runs the browser fixtures, including desktop/mobile portal
views, filtering/pagination, safe CSV preview, chart selections, settings
persistence, invalid geometry and actual task launch.

The real backend test is:

```sh
VIEWRECOVERY_LIVE_BROWSER=1 npm run test:browser -- staging-portal.spec.mjs
```

It creates a temporary account, enrolled study and four synthetic private CSVs;
checks real Storage/RLS reads, checksum previews, all chart types, saved settings
and the run snapshot; exercises real trial ingestion and pause/replay; completes
all 256 trials (13 catch slots) with a controlled browser clock; and verifies
recorded-run CSV download. It removes its account, study, records and objects in
a dedicated `afterEach` teardown with a separate timeout budget. Browser-clock acceleration checks integration and protocol counts;
it is not a measurement of real-world stimulus timing.

Screenshots are in [test/results/portal-screenshots](../test/results/portal-screenshots).
The complete staging session passed with 256 completed attempts, 13 catch trials
and 243 peripheral responses. The static browser report, staging browser report
and consolidated regressions are saved as `test/results/portal-*.json`/`.txt`.
They contain only synthetic fixture data. The `staging-*` screenshots use real
Supabase reads and writes. Traces containing live tokens are disabled.

Pagination follows the [Supabase range API](https://supabase.com/docs/reference/javascript/range).
Screenshots are captured through [Playwright's screenshot API](https://playwright.dev/docs/screenshots).
