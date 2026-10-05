Copy `staging.env.example` to `staging.env` and populate it locally. The folder is ignored except templates and this document. Restrict the real file to your user (`chmod 600 env/staging.env`). No credentials are needed for the local PostgreSQL policy tests.

`DATABASE_URL` is the protected direct PostgreSQL connection used by migration/import tools. `SUPABASE_SERVICE_ROLE_KEY` is server-only. Put only the project URL and publishable key into Vite configuration; Vite does not automatically read this folder. Do not expose server values to Vite or copy this folder to a web host.

The schema has not been applied to a hosted project. A project URL, publishable key, privileged local credentials, approved study/consent configuration, and staging access are required for real Auth, Data API, Storage, email, and ingestion acceptance checks. Region, backup scheduling, independent Storage preservation, retention, and host redirects remain deployment configuration.

`SUPABASE_SECRET_KEY` supports current `sb_secret_` server keys; it takes precedence over the optional legacy `SUPABASE_SERVICE_ROLE_KEY`. Both must stay server-only.

Staging commands, run with Node in the repository root:

- `node scripts/validate-staging.mjs`: read-only Auth/Storage/database preflight, with a redacted report in `test/results/staging-preflight.json`.
- `node scripts/provision-staging-buckets.mjs`: create missing private buckets using the configured project's default upload limit, then verify privacy.
- `node scripts/apply-staging-migrations.mjs`: apply ordered migrations, record checksum/version atomically, and skip unchanged applied migrations. Requires the database target to match the configured API project. Never point this file at production for this rehearsal.

The preflight reports missing schema/buckets before initial provisioning; it must pass again afterwards. Raw API responses and database connection errors are omitted to avoid logging secrets. Preserve the original `DATABASE_URL` privately when diagnosing connection problems; do not put it in archived reports.

Hosted PostgreSQL verification uses `env/supabase-ca.crt` and verifies both the certificate chain and hostname. The certificate was fetched from the URL used in Supabase's official dashboard source. `DATABASE_SSL_ROOT_CERT` may override the local certificate path. Never disable TLS verification to make the staging gate pass.

Shared authentication is implemented. Vite reads only the two explicitly selected public values into the browser build. The local dev server uses `/api/auth` and the shared server handler; the production build calls the deployed `username-auth` Edge Function. For staging preview, use `npm run preview -- --port 5173 --strictPort` so its browser origin matches the configured Auth callback origin.

`SUPABASE_ACCESS_TOKEN` is the local Management API/CLI token used by `scripts/deploy-staging-auth.mjs` and `scripts/configure-staging-auth.mjs`. It is server-only and is not stored in deployed function secrets or frontend assets. The deploy script passes only the rate-limit salt and Auth redirect URL as custom function secrets. The function uses Supabase's injected project keys.

Authentication Site URL/callback allowlist and the 12-character password minimum were configured in staging. Actual email delivery still requires an operator-owned test inbox/SMTP verification; automated acceptance generates and verifies recovery links without sending emails.

Legacy admin/account provisioning is described in
[admin and legacy account instructions](../docs/admin-legacy-access.md).
Optional `DATA_PORTAL_USER` and `DATA_PORTAL_PASS_HASH` preserve customized old PHP
admin credentials; they are server-only. Never put passwords or hashes in `VITE_`
variables. Migrated legacy accounts initially use their exact user ID as their
password and can change it after sign-in.
