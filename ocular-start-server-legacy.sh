#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/server-common.sh"
SESSION="${EXPERIMENT_TMUX_SESSION:-ViewRecover-legacy}"
PORT="${PORT:-8002}"
HOST="${HOST:-0.0.0.0}"
TUNNEL_NAME="${EXPERIMENT_TUNNEL_NAME:-ViewRecover-legacy}"
export HOST PORT
build_experiment
tmux kill-session -t "$SESSION" 2>/dev/null || true
# Quote command arguments to preserve spaces in paths and environment values.
printf -v server_command 'cd %q && env HOST=%q PORT=%q DATABASE_URL=%q DATABASE_VIEWER_TOKEN=%q EXPERIMENT_RUNTIME_DIR=%q PG_BIN=%q EXPERIMENT_PG_PORT=%q' \
  "$APP_DIR" "$HOST" "$PORT" "${DATABASE_URL:-}" "${DATABASE_VIEWER_TOKEN:-}" "${EXPERIMENT_RUNTIME_DIR:-}" "${PG_BIN:-}" "${EXPERIMENT_PG_PORT:-55432}"
for auth_variable in BETTER_AUTH_URL BETTER_AUTH_SECRET DATA_PORTAL_USER DATA_PORTAL_PASS_HASH DATA_PORTAL_PARTICIPANT_PASS_HASH DATA_PORTAL_SESSION_TTL_SEC DATA_PORTAL_MAX_ATTEMPTS DATA_PORTAL_ATTEMPT_WINDOW_SEC; do
  printf -v auth_assignment ' %q=%q' "$auth_variable" "${!auth_variable:-}"
  server_command+="$auth_assignment"
done
if [[ -v DATA_PORTAL_TRUSTED_PROXIES ]]; then
  printf -v auth_assignment ' DATA_PORTAL_TRUSTED_PROXIES=%q' "$DATA_PORTAL_TRUSTED_PROXIES"
  server_command+="$auth_assignment"
fi
server_command+=' node server/index.mjs'
tmux new-session -d -s "$SESSION" "$server_command"
printf -v tunnel_command 'cloudflared tunnel run --url %q %q' "http://localhost:$PORT" "$TUNNEL_NAME"
tmux split-window -h -t "$SESSION" "$tunnel_command"
tmux select-layout -t "$SESSION" tiled
echo "Experiment and PostgreSQL started in tmux session: $SESSION"
echo "Attach with: tmux attach -t $SESSION"
