#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/server-common.sh"
export HOST="${HOST:-127.0.0.1}"
# Check before rebuilding files that an existing study may still be serving.
PORT="$(node "$APP_DIR/scripts/select-server-port.mjs")"
export PORT
build_experiment
# Starts PostgreSQL and initializes the schema; never imports server-data.zip.
exec node "$APP_DIR/server/index.mjs"
