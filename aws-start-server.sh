#!/bin/bash
# Delete running pm2 php
echo "Deleting pm2 instance"
pm2 delete php-server-nontrack

# Build the project
echo "Building the project..."
npm run build

# Copy PHP files to dist
echo "Copying PHP files to dist..."
cp save_data.php dist/
cp router.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on 0.0.0.0:8001..."
pm2 start "php -S 0.0.0.0:8001 -t dist dist/router.php" --name php-server-nontrack
