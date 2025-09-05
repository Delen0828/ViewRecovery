#!/bin/bash

# Build the project
echo "Building the project..."
npm run build

# Copy PHP file to dist
echo "Copying save_data.php to dist..."
cp save_data.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on localhost:8000..."
cd dist && php -S localhost:8000