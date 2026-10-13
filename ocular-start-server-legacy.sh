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
printf -v server_command 'cd %q && env HOST=%q PORT=%q DATABASE_URL=%q DATABASE_VIEWER_TOKEN=%q EXPERIMENT_RUNTIME_DIR=%q PG_BIN=%q EXPERIMENT_PG_PORT=%q node server/index.mjs' \
  "$APP_DIR" "$HOST" "$PORT" "${DATABASE_URL:-}" "${DATABASE_VIEWER_TOKEN:-}" "${EXPERIMENT_RUNTIME_DIR:-}" "${PG_BIN:-}" "${EXPERIMENT_PG_PORT:-55432}"
tmux new-session -d -s "$SESSION" "$server_command"
printf -v tunnel_command 'cloudflared tunnel run --url %q %q' "http://localhost:$PORT" "$TUNNEL_NAME"
tmux split-window -h -t "$SESSION" "$tunnel_command"
tmux select-layout -t "$SESSION" tiled
echo "Experiment and PostgreSQL started in tmux session: $SESSION"
echo "Attach with: tmux attach -t $SESSION"
