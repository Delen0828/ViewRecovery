#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-localhost}"
PORT="${PORT:-5173}"
source "$APP_DIR/scripts/server-common.sh"
prepare_server

echo "Starting ViewRecovery at http://$HOST:$PORT"
exec "$NODE_BIN" "$SERVE_BIN"
