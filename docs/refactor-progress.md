# Refactor execution ledger

Tests and verification output are archived in `test/`. A step advances only after its local checks pass. Live Supabase, browser, load, email, backup/restore, and production cutover checks are separate release gates; local emulation cannot establish these.

## Step 1 — baseline and contracts

Verified archive counts and CSV shape against `plan.md`; manifest generated privately at `/tmp/viewrecovery-archive-manifest.json` (contains original filenames). Only anonymous aggregate counts are committed. Tested actual baseline staircase functions for all tasks and the pause rollback function. Existing Vite build passed. Current filename producer uses `new Date().toISOString()` before stripping colons and timezone suffix: current-format timestamps are UTC; older producers remain unknown until reviewed.

Protocol contract: `contracts/protocol-v1.json`. Username uniqueness is trimmed lowercase ASCII; display label is independent. Enrollment is restricted and assigned by study staff. Registrations never link legacy history by username. Auth uses verified email, username/password login, and generic password/reset errors; unavailable username prompts registration.

Preserve Motion/Orientation/Centrality/Bar, 256 numbered trials including 13 catch slots (243 peripheral trials), chunks of 32, 5% catch proportion, and 3-correct/1-incorrect staircase. Portal hides Orientation/Bar by default; chart grouping uses America/New_York. Forced interrupted attempts roll back staircase and do not count as completed responses. Fullscreen interruption pauses and prompts return. Existing portal separates catch performance, uses nonempty difficulty plus correctness for ordinary response detection, and computes durations from elapsed deltas (falling back to RT), with scheduled/manual breaks counted as rest. These definitions require live browser parity checks before cutover.

Region, production membership assignments, consent text/version, verified legacy identity procedure, email delivery, retention, measured capacity, and host redirects require deployment-owner configuration. No production choices or account links are fabricated.

## Release boundary

Keep the legacy deployment active until staging acceptance, reconciliation review, final delta import, independent database/Storage restore checks, and explicit host configuration are complete. Never deploy a partially verified writer or expose archive/data under static hosting.

## Step 2 — database foundation (local and hosted staging checks passed)

Added versioned Supabase configuration and three SQL migrations for scoped research identities, studies/membership/enrollment, profiles/settings, immutable runs/chunks/attempts/events, idempotent ingestion, restricted provenance staging, private artifacts, username reservation/registration, and durable auth rate limiting. Anonymous clients have no protected table/RPC privileges; participant writes use controlled functions. Researcher scope is study membership, and client metadata never grants roles, enrollment, or legacy ownership.

Settings use CSS screen dimensions separately from viewport/DPR/physical measurements. SQL checks the full current renderer bounds and prescribed single position, preserves horizontal/vertical offset conversion, and validates Bar symmetry/nonnegative X. Run creation is the explicit per-run confirmation; versions and observed display must match saved settings. Future defaults cannot mutate a historical snapshot. Client-side display-change detection will be added in step 4 after authentication is verified.

Ingestion locks each run, checks owner/enrollment/status/schema/bounds, records a SHA-256 payload hash, commits batches atomically, and returns the prior acknowledgement for identical retries. Changed payloads/event identities conflict. Completed responses are unique per logical trial, interrupted attempts cannot later complete, and completion requires 256 acknowledged numbered responses plus a contiguous event sequence. The database catch-slot LCG exactly matches the current task generator for all four tasks. HTTP request limits, client outbox, and timing/browser integration remain steps 3–5.

Local PostgreSQL tests pass, including username transaction rollback on invalid reservations, normalized-name collision, expiry replacement, no metadata role escalation, rate-limit window expiry, storage authorization, scientific replay identity, and successful completion. Supabase Auth/Storage/JWT behavior, multi-connection registration races, API limits, restoration and capacity cannot be established by PGlite.

Staging credentials are stored in ignored `env/staging.env`. Only templates are eligible for source control. The hosted schema and private buckets are provisioned; all eight SQL acceptance tests also passed on staging. Migration reruns skip unchanged checksums. Auth/Data API/Storage preflight passed. Synthetic SQL fixtures were rolled back. Backup/PITR scheduling, independent restoration, capacity measurement and retention remain release gates; PHP removal remains step 8.


## Step 3 — shared authentication and dashboard (implemented and verified)

Added the shared Supabase client, verified-session guard, username sign-in, registration, recovery/password update, local logout, and safe return-route validation. Unknown usernames open registration with a prefilled label. Username reservation uniqueness and controlled Auth triggers prevent client metadata from granting enrollment, roles, or legacy ownership. Public auth calls have bounded request bodies, origin checks, durable salted IP/identity rate limits, and generic password/recovery errors.

The `username-auth` Edge Function is deployed to the configured staging project. Staging Site URL and exact callback allowlist are configured, and Auth enforces a 12-character password minimum. Local Vite development uses a server-only bridge to the same handler. Production browser code uses the deployed function. Credentials, the access token and the rate-limit salt stay outside public build inputs.

Root, task links, Auth routes, and all three portal HTML entry points share one account session. The dashboard reads RLS-scoped profiles, studies/enrollments, and paginated runs. The portal entry currently shows the same scoped run list; its charts/export/legacy-linking refactor remains step 7. Both startup scripts preserve Vite's compiled portal HTML instead of overwriting it with source files. No production frontend deployment or PHP removal occurred.

Removed manual participant-ID entry from the experiment source. The experiment entry now requires a confirmed run context owned by a verified session and records the server-created participant/run IDs. The scientific staircase, catch selection and pause rollback functions still pass the baseline suite. Task execution remains unavailable until the parameter editors and acknowledged submission pipeline are implemented and verified in steps 4–5.

Verification archive: 25 local tests plus Vite build and server-secret bundle scan; eight hosted SQL tests; ten real Auth/Data API/Storage checks plus synthetic-fixture cleanup; six browser cases (including real staging login, reload, portal navigation, recovery/password update and logout); and the real browser flow repeated against the built frontend/deployed Edge Function. All final checks passed. Temporary Auth accounts and private Storage objects were removed.

Actual verification/recovery email delivery was not exercised: tests generated and verified links without sending messages. Operator-owned inbox/SMTP testing, backup/restore, study/consent configuration, membership assignment, and production rollout remain explicit release work.

Next implementation step: step 4, display/training parameter editors and immutable server-validated session start. `STUDY_ID` can remain blank until an approved study is configured; tests use synthetic enrollment/consent fixtures.

## Requested administrator and legacy-login extension

Added server-authorized admin sign-in/all-user browsing, preferences/settings/run
and event reads, private historical file downloads and checksum-verified paginated
CSV previews. Signed-in accounts can change passwords after reauthentication.
Legacy provisioning preserves the PHP admin bcrypt hash and supports initial
passwords equal to the exact legacy user ID, including short IDs, without reducing
the configured minimum for new passwords. Public signup cannot grant admin roles.
This extension provides original-file access; canonical scientific reconciliation,
charts, experiment setup/writing and production cutover remain outstanding.

Staging provisioning created 13 legacy accounts and one administrator. The
original ZIP, private manifest and all 419 entries were stored and verified by
checksum (421 objects); 144,369 primary CSV rows and 2,576 backup rows remain
preserved in the originals. Nine filename/row identity conflicts are deliberately
unassigned and visible to administrators. The built static frontend passed real
Test1 login/private-file preview and all-user administrator browsing, plus the
existing login/recovery/logout flow. Temporary acceptance accounts were removed.
The full provisioning rerun verified all 421 stored objects again, created no
accounts or files, and left account password hashes, artifact identities and
ownership links unchanged. Evidence is archived in `test/results/admin-legacy-*`.

## Portal parity and personalized training

The file overview, checksum-verified preview, user summaries and legacy chart
types are now restored on Supabase-backed routes. Personal display/task settings
load and save through the existing controlled RPCs, with live geometry preview,
fullscreen confirmation and immutable run snapshots. The renderer now runs from
confirmed settings and uploads acknowledged events through a persistent browser
outbox. Recorded runs also have paginated preview and CSV export. See the
[parity report](portal-parity.md) for the feature mapping and verification.

Historical scientific reconciliation, large-data performance gates and
production cutover remain pending. Earlier step descriptions above record the
state at those milestones; task setup and charts are no longer placeholders.

## Simplified role-specific navigation

Participants now have My progress, Training settings and Account. Administrators
have User progress, Training settings, Account and File download. Searchable,
paged user dropdowns scope the admin charts and saved configuration; the selected
user carries across progress, settings and files. Account always changes the
signed-in user's password. Other users' measured settings are shown for admins,
with confirmation/editing retained in each user's own account. See the
[interface details](simplified-interface.md) and
[verification evidence](../test/results/navigation-verification.md).
