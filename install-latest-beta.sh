#!/bin/bash
# Install script for Stigix All-in-One (Migration Draft)
# Usage: ./install-stigix.sh [options]

set -e

# Default values
INSTALL_MODE="both"
DRY_RUN=false
REPO_URL="https://raw.githubusercontent.com/jsuzanne/stigix/main"
COMPOSE_URL="$REPO_URL/docker-compose-latest-beta.yml"

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

find_free_port() {
    local port=$1
    local max_port=$2
    while [ "$port" -le "$max_port" ]; do
        local in_use=false
        
        if [ "$in_use" = false ] && command -v lsof &> /dev/null; then
            if lsof -i :$port > /dev/null 2>&1; then
                in_use=true
            fi
        fi
        
        if [ "$in_use" = false ] && command -v ss &> /dev/null; then
            if ss -tln | grep -q -E "(^|:)$port($|[^0-9])"; then
                in_use=true
            fi
        fi
        
        if [ "$in_use" = false ] && command -v netstat &> /dev/null; then
            if netstat -an | grep -E "(^|[^0-9])$port($|[^0-9])" | grep -q -i listen; then
                in_use=true
            fi
        fi
        
        if [ "$in_use" = false ] && command -v curl &> /dev/null; then
            # Curl returns exit code 7 if connection is refused (port is closed).
            # Any other exit code (like 52 empty reply, 0 success, etc.) means port is open.
            curl -s --connect-timeout 1 http://127.0.0.1:$port >/dev/null 2>&1
            local curl_exit=$?
            if [ "$curl_exit" -ne 7 ]; then
                in_use=true
            fi
        fi
        
        if [ "$in_use" = false ]; then
            echo "$port"
            return 0
        fi
        port=$((port+1))
    done
    return 1
}

print_progress_bar() {
    local val=$1
    local max=$2
    local text=$3
    local width=30
    local pct=$(( val * 100 / max ))
    local num_filled=$(( val * width / max ))
    local num_empty=$(( width - num_filled ))
    
    local bar=""
    local k
    for ((k=0; k<num_filled; k++)); do bar="${bar}█"; done
    for ((k=0; k<num_empty; k++)); do bar="${bar}░"; done
    
    printf "\r   [%s] %3d%% - %s" "$bar" "$pct" "$text"
}

dump_process_on_port() {
    local port=$1
    echo "   [Process info for port $port]:"
    # Windows Git Bash check
    if [[ "$OS_TYPE" =~ MINGW|MSYS|CYGWIN ]]; then
        local win_ns=$(netstat -ano | grep -E ":$port " 2>/dev/null)
        if [ -n "$win_ns" ]; then
            echo "$win_ns" | sed 's/^/     /'
            return 0
        fi
    fi
    if command -v lsof &> /dev/null; then
        local lsof_out=$(lsof -i :$port 2>/dev/null)
        if [ -n "$lsof_out" ]; then
            echo "$lsof_out" | sed 's/^/     /'
            return 0
        fi
    fi
    if command -v ss &> /dev/null; then
        local ss_out=$(ss -tlnp | grep -E ":$port " 2>/dev/null)
        if [ -n "$ss_out" ]; then
            echo "$ss_out" | sed 's/^/     /'
            return 0
        fi
    fi
    if command -v netstat &> /dev/null; then
        local ns_out=$(netstat -anp 2>/dev/null | grep -E ":$port " 2>/dev/null)
        if [ -n "$ns_out" ]; then
            echo "$ns_out" | sed 's/^/     /'
            return 0
        fi
    fi
    echo "     (Could not retrieve process info; it might be owned by root or running in docker. Try running: sudo lsof -i :$port)"
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

# OS Detection — Linux gets host mode, macOS/Windows get bridge mode
OS_TYPE=$(uname)
if [[ "$OS_TYPE" == "Linux" ]] && ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo "🐧 Platform: Native Linux detected. (Using host mode for full features)"
    COMPOSE_URL="$REPO_URL/docker-compose-latest-beta.yml"
elif [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "🍎 Platform: macOS detected. (Host mode not supported on macOS, using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose-latest-beta.bridge.yml"
else
    echo "🪟 Platform: WSL/Windows or unknown detected. (Using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose-latest-beta.bridge.yml"
fi

INSTALL_DIR="stigix"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 3. Download Configuration
echo "📦 Downloading Base Configuration from GitHub..."
curl -sSL -o docker-compose.yml "$COMPOSE_URL"

# Align the volume mount filename to 'docker-compose.yml' on the host
if [ -f docker-compose.yml ]; then
    if command -v sed &> /dev/null; then
        sed -i.bak -E 's|-[[:space:]]+\./docker-compose.*:/app/docker-compose\.yml|- ./docker-compose.yml:/app/docker-compose.yml|g' docker-compose.yml && rm -f docker-compose.yml.bak
    fi
fi

# 4. Mode-specific adjustments (Creating the right docker-compose/env)
# Generate a unique JWT secret for this installation
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || date +%s%N | sha256sum | head -c 64)

PORT=8080
if [ "$INSTALL_MODE" != "target" ]; then
    echo "🔍 Checking for a free port for the Web Dashboard (range 8080-8090)..."
    FREE_PORT=$(find_free_port 8080 8090)
    if [ -n "$FREE_PORT" ]; then
        PORT=$FREE_PORT
        if [ "$PORT" -ne 8080 ]; then
            echo "⚠️  Port 8080 is in use."
            dump_process_on_port 8080
            if [ -t 0 ]; then
                read -p "Would you like to proceed with alternative port $PORT? [Y/n]: " PROMPT_CHOICE
                PROMPT_CHOICE=${PROMPT_CHOICE:-Y}
                if [[ "$PROMPT_CHOICE" =~ ^[Nn] ]]; then
                    echo "❌ Installation cancelled."
                    exit 1
                fi
                echo "✅ Proceeding with port $PORT."
            else
                echo "⚠️  Auto-selected alternative port: $PORT"
            fi
        else
            echo "✅ Port 8080 is free."
        fi
    else
        echo "❌ Error: All ports in the range 8080-8090 are in use."
        exit 1
    fi
fi

echo "STIGIX_ROLE=$INSTALL_MODE" > .env
echo "JWT_SECRET=$JWT_SECRET" >> .env
echo "PORT=$PORT" >> .env
echo "BETA=true" >> .env
echo "" >> .env
echo "# --- Docker Image Tag (Uncomment to lock version/tag) ---" >> .env
echo "# TAG=latest" >> .env

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
# STIGIX_REGISTRY_URL=https://registry.stigix.io
# STIGIX_INSTANCE_ID=local-node-$(hostname | cut -d'.' -f1)

# --- Stigix Cloud Probes (Signed URLs) ---
# The Target Worker URL where scenarios are hosted
STIGIX_TARGET_BASE_URL=https://target.stigix.io

# Master Key for target worker auth (must match MASTER_SIGNATURE_KEY on Cloudflare Worker)
# Key is derived per request as SHA256(PRISMA_SDWAN_TSGID:STIGIX_TARGET_MASTER_KEY)
# Leave commented if the worker runs in open-access mode (no key configured on CF side)
# STIGIX_TARGET_MASTER_KEY=

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
# Pre-create CLI persistence files so Docker mounts them as files (not dirs)
touch ./.stigix-cli.history ./.stigix-cli.json

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

docker compose up -d

echo ""
echo "🔍 Running post-installation diagnostics..."
sleep 5

CONTAINER_RUNNING=false
if [ "$(docker inspect -f '{{.State.Running}}' stigix 2>/dev/null)" = "true" ]; then
    CONTAINER_RUNNING=true
    echo "✓ Container 'stigix' is running."
else
    echo "❌ Error: Container 'stigix' is not running."
    echo "💡 Diagnostics: Check container logs by running 'docker logs stigix'"
    exit 1
fi

if [ "$INSTALL_MODE" != "target" ]; then
    echo "🔍 Checking HTTP responsiveness at http://localhost:$PORT..."
    HTTP_OK=false
    MAX_ATTEMPTS=15
    for ((i=1; i<=MAX_ATTEMPTS; i++)); do
        if curl -sfI "http://localhost:$PORT" > /dev/null 2>&1; then
            HTTP_OK=true
            print_progress_bar $MAX_ATTEMPTS $MAX_ATTEMPTS "Web Dashboard is fully responsive! "
            echo ""
            break
        fi
        print_progress_bar $i $MAX_ATTEMPTS "Waiting for Dashboard (attempt $i/$MAX_ATTEMPTS)..."
        sleep 2
    done

    if [ "$HTTP_OK" = false ]; then
        echo ""
        echo "⚠️  Warning: Web Dashboard is not responding yet."
        echo "💡 Diagnostics: The server might still be initializing. Run 'docker logs stigix' to verify."
    fi
fi

echo ""
echo "=========================================="
echo "✅ Stigix All-in-One Installation complete! [Beta]"
echo ""

# Show installed version
INSTALLED_VERSION=$(docker exec stigix cat /app/VERSION 2>/dev/null || echo "")
if [ -n "$INSTALLED_VERSION" ]; then
    echo "📦 Installed version: $INSTALLED_VERSION (beta/latest)"
fi

if [ "$INSTALL_MODE" == "target" ]; then
    echo "🎯 Target Site is active (XFR: 9000, Voice: 6100, Probes: 6200, iPerf: 5201)."
else
    echo "📊 Dashboard: http://localhost:$PORT"
    echo "🔑 Login: admin / admin"
    echo "💻 Console CLI (for headless/terminal control): docker exec -it stigix stigix-cli"
    echo "💡 Note: To change the Web UI port later, edit 'PORT' in stigix/.env and run: cd stigix && docker compose up -d"
fi
echo "📝 Check logs: cd stigix && docker compose logs -f"
echo "=========================================="
