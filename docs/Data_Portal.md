# Data portal

Run `npm start`, then open `/data-portal/` on the printed local URL. Startup builds
both the experiment and the React/HeroUI portal, applies SQL migrations, and
keeps existing account credentials and recorded data. For development, start
`npm run serve` and `npm run dev` in separate terminals.

Participants have three panels:

- **Dashboard:** a HeroUI calendar, daily sessions, current/upcoming session,
  trial/session/accuracy/study-time summaries, and pinned progress charts.
- **Study Setup:** the experiment's resolution, physical screen size, viewing
  distance, task, and X/Y offsets, including calibrated grid, draggable position
  markers, keyboard adjustment, and pixels-per-degree readouts. Saved to SQL.
- **My Progress:** existing session ordering, task visibility toggles, chart
  point details, and accuracy/duration plots. Pin or unpin charts for Dashboard.

Administrators share a searchable user selector across Schedule, Manage Users,
Data Analytics, and File Download. Users without accounts but with retained data
are labeled **Data only** and remain available in analytics and downloads.
Account passwords are hashed. Password resets and ID changes revoke existing
sessions. Changing an ID updates database ownership, setup, and schedules while
preserving original experiment rows and archive bytes. Deletion removes access,
settings, and schedules but retains experiment data; startup will not recreate
a deleted account. Adding the same ID explicitly restores access to its data.

Advanced analytics includes accuracy and average trial duration by difficulty
across sessions, with session legends and hover comparison. Charts retain the
existing D3 metric definitions within HeroUI cards and controls; HeroUI does not
provide a chart renderer. File Download shows user, session type, task, session
ID, Eastern time, duration, and row count instead of source filenames. Previews
use the metrics API; original data is fetched only when downloading.

## Scheduling with one CSV

The Schedule editor manages one session per row. Select a calendar date and use
**Add session**, choose start/end, Study or Break, and the task, then save. Both
date fields use Eastern Time, including daylight saving transitions. User
dashboards refresh their schedule every 30 seconds; Refresh fetches immediately.
Scheduling saves use revisions and reject concurrent stale edits.

**Export CSV** downloads a single `schedule.csv` containing all users:

```csv
session_id,user_id,starts_at,ends_at,session_type,task_type
,A123,2026-10-13T10:00:00-04:00,2026-10-13T10:30:00-04:00,study,Motion
,A123,2026-10-13T10:30:00-04:00,2026-10-13T10:40:00-04:00,break,Motion
```

**Import CSV** adds sessions with empty IDs and updates rows matching exported
UUIDs. Unmentioned sessions are retained; remove sessions in the editor.
Import applies all rows atomically. User IDs must exist, times must include a
timezone offset (`Z` or `±HH:MM`), end must follow start, and a user's sessions
cannot overlap. Supported task values are `Motion`, `Orientation`, `Centrality`,
and `Bar`; session types are `study` and `break`. CSV size is limited to 1 MB and
5,000 rows. PostgreSQL is the source of truth; CSV is the shared editing format.

## Experiment setup integration

The portal and experiment share defaults in `src/study-setup.js`. Portal
calibration matches the experiment's physical tangent conversion separately for
each axis. `GET /data-portal/api/preferences` returns the authenticated user's
saved `setup` with `task`, `resWidth`, `resHeight`, `screenWidth`, `screenHeight`,
`viewingDistance`, `xOffsetDeg`, and `yOffsetDeg`. This endpoint is ready for
future experiment import; the experiment currently retains manual setup.
Administrators can inspect a user's preferences with `?user_id=A123`.

The portal APIs enforce account scopes and admin permissions. Mutations require
a trusted Origin and JSON. Schedule CSV import/export is admin-only.

## Verification

```bash
npm run build
npm run db:start
npm test
npm run test:portal
```

The browser suite checks both roles, setup save/reload and dragging, chart
visibility and pinning, schedules and participant synchronization, CSV export,
advanced charts, preview/download, account changes, invitation signup, and
desktop/mobile layout. Screenshots are saved under ignored `test/results/`.
