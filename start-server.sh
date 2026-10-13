#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/server-common.sh"
build_experiment
# Starts PostgreSQL and initializes the schema; never imports server-data.zip.
exec node "$APP_DIR/server/index.mjs"
