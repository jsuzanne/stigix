#!/bin/bash
# Install script for Stigix All-in-One (Migration Draft)
# Usage: ./install-stigix.sh [options]

set -e

# Default values
INSTALL_MODE="both"
DRY_RUN=false
REPO_URL="https://raw.githubusercontent.com/jsuzanne/stigix/main"
COMPOSE_URL="$REPO_URL/docker-compose.example.stigix.yml"

show_help() {
    echo "🚀 Stigix All-in-One - Installation Script"
    echo "Usage: ./install-stigix.sh [options]"
    echo ""
    echo "Options:"
    echo "  --mode <target|source|both>  Set the deployment mode (Default: both)"
    echo "  --dry-run, -d                Download files and show what would happen without starting Docker"
    echo "  --help, -h                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  curl -sfL https://raw.githubusercontent.com/jsuzanne/stigix/main/install-stigix.sh | bash -s -- --mode both"
    echo "  curl -sfL https://raw.githubusercontent.com/jsuzanne/stigix/main/install-stigix.sh | bash -s -- --mode target --dry-run"
    exit 0
}

# Parse command line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --mode|-m) INSTALL_MODE="$2"; shift 2 ;;
        --dry-run|-d) DRY_RUN=true; shift ;;
        --help|-h) show_help ;;
        *) echo "Unknown parameter passed: $1"; show_help ;;
    esac
done

echo "🚀 Stigix (All-in-One) - Installation"
echo "=========================================="

# 1. Prerequisite Check: Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed."
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Error: Docker is installed but not running."
    echo "Please start the Docker Desktop / Daemon and try again."
    exit 1
fi

echo "✅ Docker is running."

# OS Detection
OS_TYPE=$(uname)
if [[ "$OS_TYPE" == "Linux" ]] && ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo "🐧 Platform: Native Linux detected. (Using host mode for full features)"
    COMPOSE_URL="$REPO_URL/docker-compose.example.stigix.yml"
elif [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "🍎 Platform: macOS detected. (Host mode has limitations on macOS, using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose.example.bridge.yml"
else
    echo "🪟 Platform: WSL/Windows or unknown detected. (Using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose.example.bridge.yml"
fi

# 2. Interactive Mode Selection if script is run without arguments and not piped
# We check if stdin is a terminal to allow interactive prompt
if [ -t 0 ] && [ "$INSTALL_MODE" == "both" ] && [[ ! " $@ " =~ " --mode " ]]; then
    echo ""
    echo "📌 Choose Deployment Mode:"
    echo "1) Both (Source + Target) [Default] - Runs Dashboard, Traffic Gen, and Echo targets"
    echo "2) Target Only - Deploys only the Echo/XFR targets"
    echo "3) Source Only - Deploys only the Dashboard and Traffic Gen"
    read -p "Select an option [1-3] (Default: 1): " MODE_CHOICE
    
    case $MODE_CHOICE in
        2) INSTALL_MODE="target" ;;
        3) INSTALL_MODE="source" ;;
        *) INSTALL_MODE="both" ;;
    esac
fi

echo "🎯 Selected Mode: $INSTALL_MODE"
INSTALL_DIR="stigix"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 3. Download Configuration
echo "📦 Downloading Base Configuration from GitHub..."
curl -sSL -o docker-compose.yml "$COMPOSE_URL"

# 4. Mode-specific adjustments (Creating the right docker-compose/env)
echo "STIGIX_ROLE=$INSTALL_MODE" > .env

# Base UI/Traffic Gen Config
if [ "$INSTALL_MODE" == "both" ] || [ "$INSTALL_MODE" == "source" ]; then
    echo "AUTO_START_TRAFFIC=true" >> .env
    echo "SLEEP_BETWEEN_REQUESTS=1" >> .env
fi

# 5. Add Commented Templates for common configurations
cat <<EOF >> .env

# --- Prisma SD-WAN Integration (Optional) ---
# PRISMA_SDWAN_TSGID=YOUR_TSG_ID
# PRISMA_SDWAN_REGION=Germany
# PRISMA_SDWAN_CLIENT_ID="your-client-id@tsgid.iam.panserviceaccount.com"
# PRISMA_SDWAN_CLIENT_SECRET="your-client-secret"

# --- Registry & Autodiscovery (Optional) ---
# STIGIX_REGISTRY_ENABLED=true
# STIGIX_REGISTRY_URL=https://stigix-registry.jlsuzanne.workers.dev
# STIGIX_INSTANCE_ID=local-node-$(hostname | cut -d'.' -f1)

# Site name for dashboard display
STIGIX_SITE_NAME=$(hostname | cut -d'.' -f1)
EOF

# Adjust the docker-compose.yml based on mode if needed
if [ "$INSTALL_MODE" == "target" ]; then
    echo "🔧 Adjusting docker-compose for TARGET mode..."
    # You could use sed to remove exposed ports like 8080 or 3100 if we wanted,
    # but since network_mode is host, ports are bound by the apps directly.
    echo "TARGET_ONLY=true" >> .env
elif [ "$INSTALL_MODE" == "source" ]; then
    echo "🔧 Adjusting docker-compose for SOURCE mode..."
    echo "SOURCE_ONLY=true" >> .env
fi

mkdir -p ./config ./logs ./mcp-data

echo "✅ Files prepared in $PWD"

# 5. Dry Run or Execution
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "🛑 [DRY RUN] Mode enabled. No containers were started."
    echo "📂 The following files have been created:"
    ls -la
    echo ""
    echo "🔍 To start the environment manually, run:"
    echo "    cd $(pwd)"
    echo "    docker compose pull"
    echo "    docker compose up -d"
    echo "=========================================="
    exit 0
fi

# 6. Start Services
echo "🔧 Pulling images and starting Stigix All-in-One..."
docker compose pull || echo "⚠️  Pull failed, trying to start anyway..."

# Pre-flight port check for dashboard
if [ "$INSTALL_MODE" != "target" ]; then
    echo "🔍 Checking if port 8080 is available..."
    if command -v lsof &> /dev/null; then
        if lsof -i :8080 > /dev/null 2>&1; then
            echo "❌ Error: Port 8080 is already in use by another application on your host."
            exit 1
        fi
    fi
fi

docker compose up -d

echo ""
echo "=========================================="
echo "✅ Stigix All-in-One Installation complete!"
echo ""

if [ "$INSTALL_MODE" == "target" ]; then
    echo "🎯 Target Site is active (XFR: 9000, Voice: 6100, Probes: 6200, iPerf: 5201)."
else
    echo "📊 Dashboard: http://localhost:8080"
    echo "🔑 Login: admin / admin"
fi
echo "📝 Check logs: cd stigix && docker compose logs -f"
echo "=========================================="
