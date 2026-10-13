#!/usr/bin/env bash
# Download/extract the distribution's PostgreSQL binaries without root or system services.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="${EXPERIMENT_RUNTIME_DIR:-$APP_DIR/.runtime}"
mkdir -p "$RUNTIME/postgres-packages" "$RUNTIME/postgres"
cd "$RUNTIME/postgres-packages"
apt-get download postgresql-18 postgresql-client-18 libpq5
for package_file in ./*.deb; do dpkg-deb -x "$package_file" "$RUNTIME/postgres"; done
echo "PostgreSQL extracted into $RUNTIME/postgres. Run npm run db:start."
