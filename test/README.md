# Sequential verification archive

The current chart pipeline is [SQL-backed](../docs/portal-sql-pipeline.md).
`portal-sql-parity.mjs` compares SQL metrics with the previous definitions for
all 415 preserved CSV/backup files and is included in `npm test`. SQL acceptance
also covers summary visibility, write denial, invalidation, run ingestion updates,
final/chunk selection and the combined dashboard RPC. Use
`VIEWRECOVERY_STATIC=1 npx playwright test -c test/portal-sql.config.mjs` for the
compiled browser checks on port 5197. The live config reuses localhost:5173:
`VIEWRECOVERY_LIVE_BROWSER=1 npx playwright test -c test/portal-sql-live.config.mjs
--grep 'real Supabase file charts|real participant and administrator menus'`.

Run `npm ci`, then `npm test` from the repository root. Requires Node 22+ and Python 3. The runner stops on the first failure and stores each command's output in `test/results/`. `npm test` includes the production Vite build. All fixtures are synthetic; the real ZIP is read only by the inventory check and is never extracted into a public directory. Do not commit source filenames or participant cells as test output.

- `test_inventory.py`: exact supplied-archive inventory, multiline CSV parsing, separate backup counts, malformed shape retention, unsafe paths and expansion limits.
- `baseline.test.mjs`: executes the actual legacy staircase, pause rollback, deterministic catch selection, portal response predicates, Eastern date grouping, and active/rest duration calculations. These are executable baseline captures rather than copies of the staircase implementation.
- `database.test.mjs`: applies all migrations to PGlite's PostgreSQL engine; exercises SQL under anonymous, authenticated owner, other participant, and researcher roles. Tests settings versions/snapshots, storage visibility, transactional username reservations, durable rate limits, atomic batches/retries/conflicts, interruption/replay, incomplete completion denial, and successful 256-response completion.

The PGlite harness supplies minimal `auth.users`, `auth.uid()`, and Storage tables. It tests real PostgreSQL policies/functions/constraints but cannot verify Supabase's HTTP APIs, JWT processing, Auth configuration, email delivery, Storage server, or concurrent database connections. Those remain staging gates, not passing mocked integration tests.

## Restored portal and training configuration

See [parity report](../docs/portal-parity.md). `portal-metrics.test.mjs` checks
response/catch/rest definitions, full-trial duration, overlapping-save selection
and Eastern dates. `run-sync.test.mjs` checks persistent retries, account isolation,
interrupted drafts and completion failure. `browser/portal.spec.mjs` exercises
file overview/filtering/pagination, CSV previews, five charts and their controls,
saved configuration and task execution, including mobile screenshots.
`browser/staging-portal.spec.mjs` repeats the workflows against real Supabase with
temporary synthetic fixtures and tests all 256 trials, interruption/replay,
acknowledged completion and CSV export. Enable it with
`VIEWRECOVERY_LIVE_BROWSER=1`; fixtures are deleted afterward.

`browser/navigation.spec.mjs` verifies the simplified participant/admin menus,
user search and directory pagination, selected-user isolation, saved settings,
own-account password management, file views and mobile layout. The corresponding
`browser/staging-navigation.spec.mjs` uses temporary real participant/admin
accounts, an enrolled study and four private synthetic CSVs to verify scoped
charts, configuration persistence, actual original-file download and password
change. Its teardown removes all fixtures. Current evidence uses
`test/results/navigation-*`; screenshots are in
`test/results/navigation-screenshots/`.

## Current gates

| Plan step | State |
|---|---|
| 1 baseline/contracts | Local checks passed; deployment-owner choices documented |
| 2 database foundation | Local and hosted SQL, Auth/API preflight, private Storage and migration rerun checks passed; backup/restore pending release |
| 3 authentication/dashboard | Implemented and staging function deployed; handler, integration, browser and production-preview gates passed |
| 4–7 parameters, pipeline, import, full portal | Not implemented yet |
| 8 cutover | Requires staging acceptance and reconciliation; not started |

The schema/private buckets and username-auth Edge Function are now provisioned in staging. Test accounts and objects are temporary and have been cleaned up. The production frontend, experimental writer, archive import and PHP cutover have not been deployed. Task execution remains gated pending steps 4–5.


## Step 3 verification

- `env.test.mjs`: local env syntax/URI/key consistency and prevention of public secret variables.
- `auth-handler.test.mjs`: username/return-route validation, unknown usernames, generic errors, controlled registration metadata, rate limits, origin/method/request bounds and recovery responses.
- `run-context.test.mjs`: deny experiment entry without a confirmed run, isolate snapshots from editable defaults, and freeze nested snapshot values.
- `staging-auth.mjs`: real deployed endpoint, concurrent reservation, controlled identities, sessions/refresh/recovery/password update/logout, Data API isolation, private Storage and fixture cleanup. It never sends email.
- `browser/auth.spec.mjs`: direct-route guards, username prefill, registration confirmation, shared session/logout, typing/shortcut isolation and offsite-return rejection, using synthetic browser responses.
- `browser/staging-auth.spec.mjs`: temporary real staging account; actual login/dashboard reads/reload/portal navigation, password recovery UI and logout. The fixture account is removed after each test.
- `bundle-secrets.mjs`: inspect every built file for actual locally configured server secrets without printing their values.

`npm run test:browser` runs the fixture browser suite; the live browser case is skipped unless `VIEWRECOVERY_LIVE_BROWSER=1` is set. Live runs require Chromium (`npx playwright install chromium`), local staging configuration and network access.

Run real hosted checks with `npm run test:staging`. SQL fixtures roll back; API fixtures are explicitly cleaned up. Run the browser gate with `VIEWRECOVERY_LIVE_BROWSER=1 npm run test:browser`. To check the production bundle and deployed function, first build, then run `VIEWRECOVERY_LIVE_BROWSER=1 VIEWRECOVERY_PREVIEW=1 npm run test:browser -- staging-auth.spec.mjs`.

Reports are in `test/results/`: staging preflight/migrations/buckets, SQL tests, handler/context tests, Auth configuration/deployment, real Auth/API/Storage integration, browser JSON/text and production-preview results. Report and CLI output never include credentials or session tokens. Browser traces are disabled for live credential/session fixtures.

## Startup scripts

`test_start_servers.py` executes all three launchers with synthetic build and
process-manager commands. It checks working directories containing spaces,
legacy backups, manager replacement after successful builds, build/backup
failures, missing dependencies, incomplete entry points and invalid ports.
`start-server-http.test.mjs` exercises the actual static server against the built
application: deep routes, all portal entries, compiled assets, HEAD requests,
private-file isolation and occupied-port failure. PM2 and Cloudflare deployment
are simulated; no remote services are restarted by these tests.

Focused results are archived as `test/results/start-server-*.txt`.
See [startup instructions](../docs/start-servers.md) for usage and Auth origins.

## Admin and legacy access

- `test_legacy_access.py`: exact archive bytes, private extraction, identity
  conflicts, short IDs, collision/traversal rejection and missing identities.
- `portal-csv.test.mjs`: multiline/BOM/escaped CSV preservation, malformed-shape
  rejection and short legacy login rules versus new-registration rules.
- `database.test.mjs`: administrator directory/settings, artifact owner isolation,
  anonymous denial and prevention of self-granted admin access.
- `browser/auth.spec.mjs`: admin listing/preview with HTML displayed as text,
  participant admin denial and password confirmation/reauthentication.
- `staging-legacy-access.mjs`: imported short ID-password sign-in through the
  deployed function, hashed admin sign-in, directory/Storage permissions, password
  updates and old-password rejection; fixtures are deleted.
- `staging-legacy-provisioning.mjs`: reruns the actual provisioner, verifies all
  stored bytes again, and compares account/password hashes, artifact identities
  and ownership links to prove no duplicates or password resets.

Results use `test/results/admin-legacy-*`. Historical source-file browsing does
not count overlapping rows as canonical responses or complete the full scientific
import/reconciliation gate.
