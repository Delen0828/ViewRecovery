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
Database viewer: `http://127.0.0.1:8000/database`.

Import the supplied historical archive separately, once:

```bash
npm run db:import -- ./server-data.zip
```

Startup never runs this import. Data persists under `.runtime/` across builds
and restarts. See [PostgreSQL data storage](docs/PostgreSQL_Data_Storage.md) for
the schema, preservation rules, launch options, branch scope, and validation.
