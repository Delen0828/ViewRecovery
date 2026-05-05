#!/bin/bash

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

# Build the project
echo "Building the project..."
npm run build

# Copy PHP files to dist
echo "Copying PHP files to dist..."
cp save_data.php dist/
cp router.php dist/
cp data_portal.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on localhost:8000..."
cd dist && php -S localhost:8000 router.php
