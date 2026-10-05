# Simplified account interface

The account navigation now separates progress, training configuration and
password management. Every signed-in page uses the same header and active menu
state. Sign out remains available in the header while page data loads.

| Menu | Participant | Administrator |
|---|---|---|
| Progress | **My progress**: their own summary and all five chart types | **User progress**: search/select a user ID and view that user's summary and charts |
| Training settings | Edit/save measured display and task offsets; confirm/start training | Search/select a user ID and inspect their saved display/task settings |
| Account | Change the signed-in user's password after reauthentication | The same password form, always for the signed-in administrator |
| File download | No menu item | Historical file overview, filters, previews and original downloads; optional selected-user and unassigned filters |

The user picker searches the existing protected directory RPC, pages results in
groups of 50, and supports arrow keys, Enter and Escape. The selected user stays
in the URL when moving between progress, settings and downloads. Participant
pages use the signed-in participant ID, even if a `user` parameter is supplied.
Training, display, enrollment, run and artifact reads explicitly filter the
selected user's identifiers in addition to Supabase's row-level permissions.

Admins view other users' settings. Those users edit and confirm their own
measured setup through the existing settings/run RPCs. The admin preview uses
the selected user's saved viewport and screen measurements, rather than the
administrator's screen. No migration is required.

Progress enables all four tasks by default and removes the redundant participant
selector. The source control retains historical/recorded separation to avoid
counting the same session twice. Recorded-session previews remain available in
a collapsed history section. Training and file tables are no longer repeated
on unrelated pages.

`/dashboard` and `/` show progress, `/settings` shows configuration and
`/account` shows password management. Existing `/auth/change` and
`/data-portal/users.html` URLs still work. For participants, the old portal
overview also opens their progress. Admin `/data-portal/` opens File download;
direct file/run previews remain available under the existing guarded URLs.
Original download links ask private Storage to serve an attachment with its
original filename, rather than relying on a browser's cross-origin download
attribute.

Verification is recorded in
[the browser report](../test/results/navigation-browser.txt),
[the staging report](../test/results/navigation-staging-browser.txt),
[the regression report](../test/results/navigation-regression.txt), and
[screenshots](../test/results/navigation-screenshots/).
