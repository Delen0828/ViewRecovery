#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/server-common.sh"
build_experiment
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8001}"
pm2 delete php-server-nontrack 2>/dev/null || true
pm2 delete experiment-postgres 2>/dev/null || true
pm2 start "$APP_DIR/server/index.mjs" --name experiment-postgres --cwd "$APP_DIR" --interpreter node
