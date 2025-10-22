#!/bin/bash
# Delete running pm2 php
echo "Deleting pm2 instance"
pm2 delete php-server
pm2 delete cloudflared-tunnel

# Build the project
echo "Building the project..."
npm run build

# Copy PHP file to dist
echo "Copying save_data.php to dist..."
cp save_data.php dist/

# Start PHP server in dist directory
echo "Starting PHP server on 0.0.0.0:8000..."
pm2 start "php -S 0.0.0.0:8000 -t dist" --name php-server
pm2 start "cloudflared tunnel --url http://localhost:8000" --name cloudflared-tunnel
echo "Waiting for Cloudflare Tunnel to initialize..."
sleep 5
echo "Your Cloudflare HTTPS URL is:"
curl --silent http://127.0.0.1:4040/api/tunnels | grep -o 'https://[^"]*'