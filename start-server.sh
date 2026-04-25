#!/bin/bash

# Build the project
echo "Building the project..."
npm run build

# Copy PHP files to dist
echo "Copying PHP files to dist..."
cp save_data.php dist/
cp router.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on localhost:8000..."
cd dist && php -S localhost:8000 router.php
