#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test/results
run_check() {
  local label="$1"
  shift
  if "$@" > "test/results/$label.txt" 2>&1; then
    printf '%s: PASS (test/results/%s.txt)\n' "$label" "$label"
  else
    local status=$?
    printf '%s: FAIL (test/results/%s.txt)\n' "$label" "$label"
    cat "test/results/$label.txt"
    return "$status"
  fi
}
run_check step-01-python python3 -m unittest discover -s test -p 'test_*.py' -v
run_check step-01-node node test/baseline.test.mjs
run_check staging-env node test/env.test.mjs
run_check step-02-database node test/database.test.mjs
run_check portal-sql-parity node test/portal-sql-parity.mjs
run_check step-03-auth-handler node test/auth-handler.test.mjs
run_check admin-legacy-auth-csv node test/portal-csv.test.mjs
run_check portal-metrics node test/portal-metrics.test.mjs
run_check run-sync node test/run-sync.test.mjs
run_check step-03-run-context node test/run-context.test.mjs
run_check build node node_modules/vite/bin/vite.js build
run_check start-server-http node --test test/start-server-http.test.mjs

if [[ -f env/staging.env ]]; then
  run_check step-03-bundle-secrets node test/bundle-secrets.mjs
fi
