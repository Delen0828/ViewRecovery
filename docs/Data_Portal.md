# Data portal

Run `npm start`, then open `/data-portal/` on the printed local URL. Startup builds
both the experiment and the React/HeroUI portal, applies SQL migrations, and
keeps existing account credentials and recorded data. For development, start
`npm run serve` and `npm run dev` in separate terminals.

Participants have three panels:

- **Dashboard:** a HeroUI calendar, daily sessions, current/upcoming session,
  a **Start Training** link to the scheduled study task, trial/session/accuracy/study-time
  summaries, and pinned progress charts. Training is disabled during scheduled
  breaks and when there is no current or upcoming study session.
- **Study Setup:** the experiment's resolution, physical screen size, viewing
  distance, task, and X/Y offsets, including calibrated grid, draggable position
  markers, keyboard adjustment, and pixels-per-degree readouts. Saved to SQL.
- **My Progress:** existing session ordering, task visibility toggles, chart
  point details, and accuracy/duration plots. Pin or unpin charts for Dashboard.

Administrators share a searchable user selector across Schedule, Manage Users,
Data Analytics, and File Download. Users without accounts but with retained data
are labeled **Data only** and remain available in analytics and downloads.
Manage Users includes **Study parameters**, with the same screen, task, stimulus
offsets, and monitor preview controls as the participant's Study Setup panel.
Administrators can save these settings for the selected participant; the changes
appear in that participant's portal and load when they next enter the experiment.
Account passwords are hashed. Password resets and ID changes revoke existing
sessions. Changing an ID updates database ownership, setup, and schedules while
preserving original experiment rows and archive bytes. Deletion removes access,
settings, and schedules but retains experiment data; startup will not recreate
a deleted account. Select **Also delete recorded experiment data** in the deletion
dialog to permanently remove the user's recorded sessions, saved results, imported
files, and cached metrics too, including data linked to previous IDs. The user list
refreshes after deletion. With retained data, the entry remains labeled **Data only**;
with data deleted, it disappears. Adding the same ID explicitly restores access to
any retained data. Manage Users also allows deleting a **Data only** user directly;
this always deletes their recorded data, including records linked to earlier IDs.

Data Analytics always shows all four charts, including accuracy and average trial duration by difficulty
across sessions, with session legends and hover comparison. Charts retain the
existing D3 metric definitions within HeroUI cards and controls; HeroUI does not
provide a chart renderer. File Download shows user, session type, task, Eastern
time, duration with blue training and grey break bars, and sanity check accuracy.
Sanity check rates are green at 80% or higher, amber at 60–79%, and red below 60%;
sessions without sanity checks show a dash. Preview and Download use matching
grey buttons with icons and text. Previews
use the metrics API; original data is fetched only when downloading.

## Scheduling

The full-width Calendar preview uses the ReUI Gantt core with a portal-styled
custom view over five Sunday–Saturday weeks: the previous week, current week,
and next three weeks. Compact day columns are grouped by week number (the week
containing January 1 is Week 1). The chart keeps room for at least three user
rows even when empty. Only users with sessions in the displayed date range
appear. Names are shown directly on slim
16px bars, with no separate user column or selection controls. Bars cannot be
dragged or resized.
Scroll horizontally or use the previous/next controls to explore the dates and
use **Today** to return to the current day. Calendars, agenda markers, Gantt bars,
and analytics share task colors: Motion blue, Orientation green, Centrality orange,
and Bar purple; breaks are always grey. Calendar dates can show multiple task dots.
Hover or focus a bar for the task, time, duration, and dates. The preview includes
unsaved edits. The user selector sits beside Sessions and only selects the user
being edited.

Each session row has date-only **Starts** and **Ends**, a **Scheduled time**, a
**Duration** in minutes, Study or Break, and the task. It repeats daily across
the inclusive date range. Both dates can be the same for a single occurrence.
Scheduled time uses Eastern Time, including daylight saving transitions; each
occurrence keeps the specified elapsed duration. Existing timestamp-only
sessions remain available as single occurrences in the editor.

Save to update the participant calendar. User dashboards refresh every 30
seconds; the single **Refresh** button in the top banner fetches the current page's
data, preferences, schedules, and file listings immediately. Scheduling saves use revisions and reject
concurrent stale edits. Sessions cannot overlap for the same user, including
occurrences that cross midnight. PostgreSQL is the source of truth.

## Experiment setup integration

The portal and experiment share defaults in `src/study-setup.js`. Portal
calibration matches the experiment's physical tangent conversion separately for
each axis. `GET /data-portal/api/preferences` returns the authenticated user's
saved `setup` with `task`, `resWidth`, `resHeight`, `screenWidth`, `screenHeight`,
`viewingDistance`, `xOffsetDeg`, and `yOffsetDeg`.
Administrators can inspect a user's preferences with `?user_id=A123` and update
them with `PUT /data-portal/api/preferences`, including `user_id` in the JSON body.

Clicking **Continue** in the main study checks the entered User ID against registered participant accounts
using `GET /api/experiment/participant?user_id=A123`. This ID-only endpoint returns
only the matched ID, study setup, and whether setup has been saved; it does not
require a portal login. Unknown, deleted, previous (renamed), admin, and data-only IDs cannot
continue. Any ID can be entered and submitted. Unknown IDs receive a warning and
a link to portal registration with the ID prefilled; **Continue** remains available
to try again. Lookup failures also allow retrying with **Continue**. A matched ID
loads the participant's settings and immediately advances to the next page.

After validation, saved monitor dimensions, resolution, viewing distance, and
stimulus offsets populate **Screen & Stimulus** automatically. Accounts without
saved setup use the shared defaults. Participants can review and adjust values
for the current run; edits in the experiment do not overwrite portal settings.
The task URL determines the task, including when saved setup names a different
task. **Start Training** opens that scheduled task URL with `?user_id=A123` to
prefill the participant's ID, which is validated when they click **Continue**.

The portal APIs enforce account scopes and admin permissions. Mutations require
a trusted Origin and JSON. The all-user scheduling overview is admin-only.

## Verification

```bash
npm run build
npm run db:start
npm test
npm run test:portal
npm run test:study-portal
```

The browser suite checks both roles, setup save/reload and dragging, chart
visibility and pinning, daily schedules, the all-user Gantt preview, and participant synchronization,
advanced charts, preview/download, account changes, invitation signup, and
desktop/mobile layout. Screenshots are saved under ignored `test/results/`.
