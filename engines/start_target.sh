#!/bin/bash

# Cleanup function to kill background processes on exit
cleanup() {
    echo "🛑 Cleaning up voice-echo processes..."
    kill $(jobs -p) 2>/dev/null
    exit 0
}

# Trap SIGTERM and SIGINT
trap cleanup SIGTERM SIGINT

# Pre-emptive cleanup for host-mode port conflicts
echo "🧹 Pre-cleaning local ports 6100, 6200, 5201, 8082..."
pkill -f "echo_server.py" || true
pkill -f "http_server.py" || true
pkill -f "iperf3" || true

echo "🚀 Starting SD-WAN Voice Echo Server..."
python3 -u /app/engines/echo_server.py --ports 6100,6200 &

echo "📊 Starting iperf3 Server (Logging to /tmp/iperf3.log)..."
iperf3 -s > /tmp/iperf3.log 2>&1 &

echo "🌐 Starting HTTP Service (Port ${TARGET_HTTP_PORT:-8082})..."
python3 -u /app/engines/http_server.py > /tmp/http_server.log 2>&1 &

# Keep container alive and exit if ANY background process exits
wait -n
cleanup
