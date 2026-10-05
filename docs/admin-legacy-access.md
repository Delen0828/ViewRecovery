# Administrator and legacy accounts

Open `/admin/login` for admin sign-in and `/admin` for all-user browsing. The
administrator role is stored in `private.administrators`, never granted by
client-editable metadata. Ordinary participants cannot query the admin directory,
read other participants' records or sign their private files.

The protected `scripts/provision-legacy-access.mjs` imports the old PHP admin
username and bcrypt password hash. It uses `DATA_PORTAL_USER` and
`DATA_PORTAL_PASS_HASH` from `env/staging.env` when supplied, otherwise the defaults
in `data_portal.php`. The default username is `admin`; the old password remains
the password represented by the imported hash. Its plaintext is not recoverable
from that hash. A production PHP environment with custom values must supply those
same overrides locally before provisioning.

Legacy users are created from the exact IDs found in CSV rows. Their username is
case-insensitive; their initial password is the exact, case-sensitive user ID.
For example, `Test1` signs in with password `Test1`. Short legacy IDs are supported;
new public registrations retain their three-character minimum.

Every signed-in account has a **Change password** link. The form requires the
current password and matching new passwords of at least 12 characters. Imported
ID passwords use Supabase's password-hash import; the project's minimum for new
passwords remains unchanged. Rerunning provisioning preserves changed passwords.
No email addresses were present in the legacy source; these migrated accounts use
internal addresses under `accounts.invalid`, with no email sent. Email-based
recovery requires attaching a verified real email later; password changes work
from an authenticated session.

The admin page lists all registered users, their account origin, historical file
and source-row totals, recorded-run totals and latest recorded run. Selecting a
user shows preferences, display/training settings, runs and events, and private
historical files. Files have authorized downloads and checksum-verified CSV row
previews. Views are paginated and stored HTML is displayed as text.

The provisioner preserves the source ZIP, a manifest, and all original archive
entries byte-for-byte in private Storage, outside the static website. Participants
can view only their assigned historical files. A filename/row identity mismatch
is left unassigned and can be reviewed by the administrator; filename-only matches
do not silently assign ownership. All files, including backups/support files and
identity conflicts, remain available under **All files** or **Unassigned files**.
This implements historical-file access; it does not claim that overlapping source
rows have been reconciled into canonical trials or complete runs. Scientific
normalization, charts, ingestion and experiment setup remain later refactor gates.

Apply migrations, then provision staging with:

```bash
node scripts/apply-staging-migrations.mjs
node scripts/provision-legacy-access.mjs server-data.zip
```

Provisioning checks archive paths/limits and username collisions before creating
accounts. It refuses to adopt unrelated existing accounts, does not overwrite
Storage objects, verifies stored checksums, and can resume/repeat without resetting
passwords. Reports contain counts and check outcomes; private manifests, usernames,
passwords and source cells are not logged. Temporary local files are private and
removed after provisioning.

Tests and reports are archived under `test/` as `admin-legacy-*`. Local database
and browser fixtures run before staging acceptance and real provisioning. Live
password tests use temporary users and clean them up.

Current staging has 13 legacy accounts and the administrator, with all 419 archive
entries plus the ZIP and manifest verified in private Storage. The nine identity
conflicts remain under **Unassigned files**. `Test1` login and file preview, admin
all-user browsing and recovery/logout were verified against the built static app.
