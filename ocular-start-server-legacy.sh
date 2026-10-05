#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="${SESSION:-ViewRecover-legacy}"
TUNNEL_NAME="${TUNNEL_NAME:-ViewRecover-legacy}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8002}"
source "$APP_DIR/scripts/server-common.sh"
require_command tmux
require_command cloudflared
prepare_server
ORIGIN_URL="http://$HOST:$PORT"

# Preserve the named tunnel/session configuration; replace only after build succeeds.
if tmux has-session -t "=$SESSION" 2>/dev/null; then
    tmux kill-session -t "=$SESSION"
fi
# tmux invokes a shell: quote every argument, including paths containing spaces.
printf -v SERVER_CMD '%q ' env "HOST=$HOST" "PORT=$PORT" "$NODE_BIN" "$SERVE_BIN"
printf -v TUNNEL_CMD '%q ' "$(command -v cloudflared)" tunnel run --url "$ORIGIN_URL" "$TUNNEL_NAME"
tmux new-session -d -s "$SESSION" -c "$APP_DIR" "exec $SERVER_CMD"
if ! tmux split-window -h -t "=$SESSION" -c "$APP_DIR" "exec $TUNNEL_CMD"; then
    tmux kill-session -t "=$SESSION"
    exit 1
fi
tmux select-layout -t "=$SESSION" tiled
echo "ViewRecovery and tunnel launched in tmux session: $SESSION"
echo "Attach to inspect startup: tmux attach -t '$SESSION'"
