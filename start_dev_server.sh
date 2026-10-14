#!/usr/bin/env bash
set -euo pipefail

export DATA_PORTAL_MAX_ATTEMPTS="${DATA_PORTAL_MAX_ATTEMPTS:-100}"
export DATA_PORTAL_ATTEMPT_WINDOW_SEC="${DATA_PORTAL_ATTEMPT_WINDOW_SEC:-60}"

exec bash "$(dirname "${BASH_SOURCE[0]}")/start-server.sh" "$@"
