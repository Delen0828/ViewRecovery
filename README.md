# View Recovery

Run the existing jsPsych experiment with a local PostgreSQL backend:

```bash
npm install
npm start
```

Requires Node 22+ and PostgreSQL binaries. If PostgreSQL is absent on Ubuntu
26.04, run `bash scripts/setup-postgres-ubuntu.sh` once first; an existing
PostgreSQL server can also be selected with `DATABASE_URL`.

Experiment: `http://127.0.0.1:8000/Motion` (also `/Orientation`, `/Centrality`, `/Bar`).
Data portal: `http://127.0.0.1:8000/data-portal/` (charts, previews, and downloads).
Database viewer: `http://127.0.0.1:8000/database`.

If port 8000 is busy, `npm start` selects the next available port and prints the
URLs to use. Set a fixed port with `PORT=8010 npm start`; if that port is busy,
startup exits before building with instructions to choose another port.

The portal uses Better Auth with User/Admin password login. Existing users are
migrated at startup; users without a password use their exact User ID as their
initial password, and the admin password is preserved. New user signup requires
invitation code `bright`. Email verification and third-party login are disabled.
For public hosting, set `BETTER_AUTH_URL` to the public web origin.

Import the supplied historical archive separately, once:

```bash
npm run db:import -- ./server-data.zip
```

Startup never runs this import. Data persists under `.runtime/` across builds
and restarts. See [PostgreSQL data storage](docs/PostgreSQL_Data_Storage.md) for
the schema, preservation rules, launch options, branch scope, and validation.
