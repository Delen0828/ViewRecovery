#!/bin/bash
# Delete running pm2 php
echo "Deleting pm2 instance"
pm2 delete php-server

# Build the project
echo "Building the project..."
npm run build

# Copy PHP file to dist
echo "Copying save_data.php to dist..."
cp save_data.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on 0.0.0.0:8000..."
pm2 start "php -S 0.0.0.0:8000 -t dist" --name php-server