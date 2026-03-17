#!/bin/bash

# Stigix MCP Bridge Setup Script
# This script automates the creation of a local Python environment to run the Claude MCP bridge.

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_DIR/mcp-server"
VENV_PATH="$MCP_DIR/.venv"

echo "🚀 Setting up Stigix MCP Bridge in $MCP_DIR..."

if [ ! -d "$MCP_DIR" ]; then
    echo "❌ Error: mcp-server directory not found at $MCP_DIR"
    exit 1
fi

cd "$MCP_DIR"

# 1. Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed. Please install it first."
    exit 1
fi

# 2. Create Virtualenv if missing
if [ ! -d "$VENV_PATH" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv "$VENV_PATH"
fi

# 3. Install/Update Dependencies
echo "📥 Installing dependencies..."
"$VENV_PATH/bin/pip" install --upgrade pip
"$VENV_PATH/bin/pip" install -r "$MCP_DIR/requirements.txt"

echo ""
echo "✅ Setup Complete!"
echo "--------------------------------------------------------"
echo "To use this bridge in Claude Desktop, use these paths:"
echo ""
echo "Python: $VENV_PATH/bin/python3"
echo "Bridge: $MCP_DIR/bridge.py"
echo "--------------------------------------------------------"
echo "Example Test Command:"
echo "$VENV_PATH/bin/python3 $MCP_DIR/bridge.py http://<NODE_IP>:3100/sse"
