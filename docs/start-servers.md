# Starting the current build

Install Node.js 22 or newer and run `npm ci` with build dependencies included.
Keep staging configuration in `env/staging.env`. Vite reads that file directly;
do not source it into a shell or copy it into `dist`.

Each launcher resolves the repository from its own location, backs up any
`dist/data` to a unique `data/legacy-dist-*` directory, runs `npm run build`, and
serves the compiled multi-page application. PHP is no longer copied or launched.
Auth requests from this build use the deployed Supabase `username-auth` function.

| Command | Default address | Additional requirements |
| --- | --- | --- |
| `bash start-server.sh` | `http://localhost:5173` | Foreground server; Ctrl+C stops it |
| `bash aws-start-server.sh` | `http://0.0.0.0:8001` | PM2 on PATH |
| `bash ocular-start-server-legacy.sh` | `http://127.0.0.1:8002` tunnel origin | tmux and configured cloudflared on PATH |

The local default matches the current staging Auth origin. Override addresses
with `HOST` and `PORT`, for example `HOST=127.0.0.1 PORT=9000 bash start-server.sh`.
The server fails when its requested port is occupied.

The AWS launcher retains the PM2 name `php-server-nontrack` so it can replace the
old process. Override it with `PM2_NAME`. The tunnel launcher retains session and
tunnel name `ViewRecover-legacy`; override them with `SESSION` and `TUNNEL_NAME`.
It uses Bash to quote paths and arguments passed through tmux, including spaces.
Neither managed launcher stops its existing process before a successful build.
Attach to tmux or use `pm2 logs php-server-nontrack` to inspect runtime startup.
The scripts do not change PM2 boot persistence or Cloudflare tunnel credentials.

For a remote hostname or a different local origin, configure `AUTH_REDIRECT_URL`,
Supabase's allowed redirects and the deployed Edge Function origin consistently
before using login/signup/recovery there. The current staging authorization is
configured for `http://localhost:5173`; changing the listening port does not
update that authorization. Rebuild after changing either public Supabase value.

The static server exposes `dist` only, supplies `index.html` for SPA deep routes,
preserves explicit portal `.html` URLs, and disables directory listings and
symlink traversal. Legacy backups remain outside the served directory.
Experiment execution remains gated until the later refactor steps are complete.

Verification sources and archived results are in `test/`. Run launcher tests with
`python3 -m unittest discover -s test -p 'test_start_servers.py' -v`, then
`npm run build && node --test test/start-server-http.test.mjs`. The full `npm test`
runner includes both checks. HTTP tests require permission to bind loopback ports.
