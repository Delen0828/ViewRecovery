#!/usr/bin/env bash
# Sourced by the three launchers, after they resolve APP_DIR.
require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "[Error] $1 is required and must be on PATH." >&2
        return 1
    }
}

prepare_server() {
    cd "$APP_DIR"
    require_command node
    require_command npm
    node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || {
        echo "[Error] Node.js 22 or newer is required." >&2
        return 1
    }
    if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
        echo "[Error] PORT must be an integer between 1 and 65535." >&2
        return 1
    fi
    PORT=$((10#$PORT))
    if [[ ! -f node_modules/serve-handler/package.json || ! -f node_modules/vite/bin/vite.js ]]; then
        echo "[Error] Install dependencies with npm ci (including build dependencies) first." >&2
        return 1
    fi
    NODE_BIN="$(command -v node)"
    SERVE_BIN="$APP_DIR/scripts/serve-built.mjs"
    export HOST PORT

    # Vite empties dist. Keep legacy data outside the public build directory.
    if [[ -d dist/data ]]; then
        mkdir -p data
        local backup_dir
        backup_dir="$(mktemp -d "$APP_DIR/data/legacy-dist-$(date +%Y%m%d_%H%M%S)-XXXXXX")"
        cp -a dist/data/. "$backup_dir/"
        echo "Backed up dist/data to $backup_dir"
    fi
    echo "Building the Vite application..."
    npm run build
    [[ -f dist/index.html && -f dist/data-portal/index.html && -f dist/data-portal/users.html && -f dist/data-portal/preview.html ]] || {
        echo "[Error] Build did not produce all application entry points." >&2
        return 1
    }
}
