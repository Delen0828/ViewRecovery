#!/bin/bash

SESSION="ViewRecover-legacy"
PORT=8002
TUNNEL_NAME="ViewRecover-legacy"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGIN_URL="http://localhost:$PORT"

echo "Killing old tmux session if exists..."
tmux kill-session -t $SESSION 2>/dev/null

echo "Building Node project..."
# 用 npx，确保本地 node_modules vite 可用
cd "$APP_DIR" || exit 1

# Back up server-saved data before Vite rebuilds dist.
if [ -d "dist/data" ]; then
    CURRENT_TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
    BACKUP_DIR="data/$CURRENT_TIMESTAMP"
    if mkdir -p "$BACKUP_DIR" && cp -a dist/data/. "$BACKUP_DIR/"; then
        echo "Backed up dist/data to $BACKUP_DIR"
    else
        echo "[Error] Failed to back up dist/data; aborting before build."
        exit 1
    fi
else
    echo "No dist/data directory found; skipping data backup."
fi

npx vite build
if [ $? -ne 0 ]; then
    echo "[Error] Vite build failed, aborting"
    exit 1
fi

echo "Ensuring dist exists..."
mkdir -p dist

echo "Copying PHP files..."
cp save_data.php dist/
cp router.php dist/
cp data_portal.php dist/

echo "Starting tmux session: $SESSION..."
tmux new-session -d -s $SESSION

if command -v php >/dev/null 2>&1; then
    SERVER_CMD="php -S 0.0.0.0:$PORT -t dist dist/router.php"
    echo "Starting PHP server on 0.0.0.0:$PORT..."
else
    SERVER_CMD="python3 -m http.server $PORT --directory dist"
    echo "[Warning] php not found; using python3 static server on 0.0.0.0:$PORT."
    echo "[Warning] save_data.php will not execute until php is installed."
fi

tmux send-keys -t $SESSION "cd $APP_DIR && $SERVER_CMD" C-m

sleep 2

echo "Starting Cloudflare tunnel to $ORIGIN_URL..."
tmux split-window -h -t $SESSION
tmux send-keys -t $SESSION "cloudflared tunnel run --url $ORIGIN_URL $TUNNEL_NAME" C-m

tmux select-layout -t $SESSION tiled

echo "[Succeed] ViewRecover started in tmux session: $SESSION"
echo "Attach with: tmux attach -t $SESSION"
