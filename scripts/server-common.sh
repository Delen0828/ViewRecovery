#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

build_experiment() {
  # Retain any old CSV directory before Vite clears dist. Live ingestion never reads it.
  if [ -d "$APP_DIR/dist/data" ]; then
    local backup_dir
    mkdir -p "$APP_DIR/data"
    backup_dir="$(mktemp -d "$APP_DIR/data/pre-sql-XXXXXXXX")"
    cp -a "$APP_DIR/dist/data/." "$backup_dir/"
    echo "Preserved old dist/data in $backup_dir"
  fi
  npm run build
}
