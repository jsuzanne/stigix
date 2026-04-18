#!/bin/bash
set -e

# Create necessary directories
mkdir -p /var/log/sdwan-traffic-gen
mkdir -p /app/config
mkdir -p /app/mcp-data

# Set default values for XFR if not provided
export XFR_PORT=${XFR_PORT:-9000}
export XFR_MAX_DURATION=${XFR_MAX_DURATION:-3600}
export XFR_RATE_LIMIT=${XFR_RATE_LIMIT:-2}
export XFR_ALLOW_CIDR=${XFR_ALLOW_CIDR:-"0.0.0.0/0"}

echo "🚀 Starting Stigix All-in-One..."
echo "ROLE: source + target"

# Start supervisord
exec supervisord -c /app/stigix-all-in-one/supervisord.conf
