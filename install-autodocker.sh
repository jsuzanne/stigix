#!/bin/bash
# Install script for Stigix All-in-One (Migration Draft)
# Usage: ./install-stigix.sh [options]

set -e

# Default values
INSTALL_MODE="both"
DRY_RUN=false
CONTROLLER_URL=""
REPO_URL="https://raw.githubusercontent.com/jsuzanne/stigix/main"
COMPOSE_URL="$REPO_URL/docker-compose.yml"

show_help() {
    echo "🚀 Stigix All-in-One - Installation Script"
    echo "Usage: ./install-stigix.sh [options]"
    echo ""
    echo "Options:"
    echo "  --mode <target|source|both>  Set the deployment mode (Default: both)"
    echo "  --controller <URL>           Join a remote Stigix leader as a peer (direct mode)"
    echo "  --dry-run, -d                Download files and show what would happen without starting Docker"
    echo "  --help, -h                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  curl -fsSL $REPO_URL/install.sh | sudo bash"
    echo "  curl -fsSL $REPO_URL/install.sh | sudo bash -s -- --controller https://stigix-central.example.net"
    echo "  curl -fsSL $REPO_URL/install.sh | sudo bash -s -- --mode both"
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
JOIN_TOKEN=""
SITE_NAME_OVERRIDE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --mode|-m) INSTALL_MODE="$2"; shift 2 ;;
        --controller|-c) CONTROLLER_URL="$2"; shift 2 ;;
        --token|-t) JOIN_TOKEN="$2"; shift 2 ;;
        --site|-s) SITE_NAME_OVERRIDE="$2"; shift 2 ;;
        --dry-run|-d) DRY_RUN=true; shift ;;
        --help|-h) show_help ;;
        STX-*) JOIN_TOKEN="$1"; shift ;;
        *) echo "Unknown parameter passed: $1"; show_help ;;
    esac
done

# Magic Join Token Resolution
if [ -n "$JOIN_TOKEN" ]; then
    echo "✨ Magic Join Token detected: ${JOIN_TOKEN:0:20}..."
    RAW_TOKEN="${JOIN_TOKEN#STX-}"
    IFS='.' read -r HDR_B64 PAYLOAD_B64 SIG_B64 <<< "$RAW_TOKEN"
    
    B64_CLEAN=$(echo "$PAYLOAD_B64" | tr '_-' '/+')
    case $(( ${#B64_CLEAN} % 4 )) in
        2) B64_CLEAN="${B64_CLEAN}==" ;;
        3) B64_CLEAN="${B64_CLEAN}=" ;;
    esac
    
    DECODED_JSON=$(echo "$B64_CLEAN" | base64 -d 2>/dev/null || echo "{}")
    
    CANDIDATES=()
    TOKEN_SITE=""
    TOKEN_REALM=""
    if command -v python3 &>/dev/null; then
        PY_EXTRACT=$(python3 -c "import sys, json; d=json.loads(sys.argv[1]); print('\n'.join(d.get('endpoints', []))); print('SITE_HINT=' + (d.get('site_hint') or '')); print('REALM=' + (d.get('realm') or ''))" "$DECODED_JSON" 2>/dev/null)
        while IFS= read -r line; do
            if [[ "$line" =~ ^SITE_HINT=(.*) ]]; then
                TOKEN_SITE="${BASH_REMATCH[1]}"
            elif [[ "$line" =~ ^REALM=(.*) ]]; then
                TOKEN_REALM="${BASH_REMATCH[1]}"
            elif [ -n "$line" ]; then
                CANDIDATES+=("$line")
            fi
        done <<< "$PY_EXTRACT"
    fi
    
    [ -n "$TOKEN_SITE" ] && [ -z "$SITE_NAME_OVERRIDE" ] && SITE_NAME_OVERRIDE="$TOKEN_SITE"
    
    echo "🔍 Probing Leader connectivity across candidate endpoints..."
    WINNING_LEADER=""
    for ep in "${CANDIDATES[@]}"; do
        ep="${ep%/}"
        echo "   • Testing $ep..."
        if curl -s -k -o /dev/null -w "%{http_code}" --connect-timeout 2 -m 3 "$ep/api/health" 2>/dev/null | grep -q "200"; then
            echo "   ✅ Connected to Leader at $ep"
            WINNING_LEADER="$ep"
            break
        fi
    done
    
    if [ -n "$WINNING_LEADER" ]; then
        CONTROLLER_URL="$WINNING_LEADER"
        echo "🔑 Redeeming single-use Magic Join token with Leader..."
        NODE_HOSTNAME=$(hostname | cut -d'.' -f1)
        CHOSEN_SITE="${SITE_NAME_OVERRIDE:-$NODE_HOSTNAME}"
        REDEEM_BODY="{\"token\":\"$JOIN_TOKEN\",\"instance_id\":\"$NODE_HOSTNAME\",\"hostname\":\"$NODE_HOSTNAME\",\"site_name\":\"$CHOSEN_SITE\"}"
        REDEEM_RES=$(curl -s -k -X POST -H "Content-Type: application/json" -d "$REDEEM_BODY" --connect-timeout 4 -m 6 "$WINNING_LEADER/api/fleet/join-redeem" 2>/dev/null || echo "{}")
        if echo "$REDEEM_RES" | grep -q -E '"success":true|"status":"ok"'; then
            echo "   ✅ Token redeemed successfully!"
            CLUSTER_JWT=$(echo "$REDEEM_RES" | grep -o '"jwt_secret":"[^"]*' | cut -d'"' -f4)
            if [ -n "$CLUSTER_JWT" ]; then
                JOINED_JWT_SECRET="$CLUSTER_JWT"
                echo "   🔒 Cluster security realm synchronized."
            fi
        else
            echo "   ⚠️  Redemption notice: $REDEEM_RES"
        fi
    elif [ ${#CANDIDATES[@]} -gt 0 ]; then
        CONTROLLER_URL="${CANDIDATES[0]}"
        echo "⚠️ Direct LAN probes timed out. Announcing to Cloudflare Rendezvous Relay..."
        REGISTRY_URL="https://registry.stigix.io"
        NODE_HOSTNAME=$(hostname | cut -d'.' -f1)
        CHOSEN_SITE="${SITE_NAME_OVERRIDE:-$NODE_HOSTNAME}"
        ANNOUNCE_PORT=8080
        if command -v find_free_port &>/dev/null; then
            FP=$(find_free_port 8080 8090)
            [ -n "$FP" ] && ANNOUNCE_PORT="$FP"
        fi
        LOCAL_IPS_JSON="[]"
        if command -v python3 &>/dev/null; then
            LOCAL_IPS_JSON=$(python3 -c "import socket, json
ips = set()
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    ips.add(s.getsockname()[0])
    s.close()
except: pass
try:
    for info in socket.getaddrinfo(socket.gethostname(), None):
        ip = info[4][0]
        if not ip.startswith('127.'): ips.add(ip)
except: pass
print(json.dumps(list(ips)))" 2>/dev/null || echo "[]")
        fi
        ANNOUNCE_BODY="{\"instance_id\":\"$NODE_HOSTNAME\",\"site_name\":\"$CHOSEN_SITE\",\"port\":$ANNOUNCE_PORT,\"ips\":$LOCAL_IPS_JSON}"
        if [ -n "$TOKEN_REALM" ]; then
            ANNOUNCE_RES=$(curl -s -k -X POST -H "Content-Type: application/json" -d "$ANNOUNCE_BODY" --connect-timeout 4 -m 6 "$REGISTRY_URL/realms/$TOKEN_REALM/register" 2>/dev/null || echo "{}")
            if echo "$ANNOUNCE_RES" | grep -q '"status":"ok"'; then
                echo "   ✅ Cloudflare Rendezvous announced (port $ANNOUNCE_PORT)! Private Leader will establish reverse tunnel automatically."
            fi
        fi
        # In Rendezvous mode, Leader dials peer; clear CONTROLLER_URL to avoid blocking reachability check
        CONTROLLER_URL=""
    fi
fi

# Validate and test reachability of --controller URL
if [ -n "$CONTROLLER_URL" ]; then
    while true; do
        if [[ ! "$CONTROLLER_URL" =~ ^https?:// ]]; then
            echo "❌ Error: --controller URL must start with http:// or https://"
            echo "   Example: --controller https://stigix-central.example.net"
            if [ -t 0 ]; then
                read -p "Enter valid controller URL (or leave empty to cancel): " CONTROLLER_URL
                if [ -z "$CONTROLLER_URL" ]; then exit 1; fi
                continue
            else
                exit 1
            fi
        fi
        CONTROLLER_URL="${CONTROLLER_URL%/}" # Remove trailing slash

        echo "🔍 Verifying controller reachability at $CONTROLLER_URL..."
        HTTP_CODE=$(curl -s -k -o /dev/null -w "%{http_code}" --connect-timeout 4 -m 6 "$CONTROLLER_URL/api/health" 2>/dev/null || echo "000")
        if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "404" ]; then
            # Try root URL as fallback
            FALLBACK_CODE=$(curl -s -k -o /dev/null -w "%{http_code}" --connect-timeout 4 -m 6 "$CONTROLLER_URL" 2>/dev/null || echo "000")
            if [ "$FALLBACK_CODE" != "000" ]; then
                HTTP_CODE=$FALLBACK_CODE
            fi
        fi

        if [ "$HTTP_CODE" != "000" ]; then
            echo "✅ Controller reached successfully (HTTP $HTTP_CODE) at $CONTROLLER_URL"
            echo "🔗 Direct peer mode: will join controller at $CONTROLLER_URL"
            break
        else
            echo "⚠️  Warning: Unable to reach controller at $CONTROLLER_URL (Connection timed out, refused, or DNS error)."
            if [ -t 0 ]; then
                echo "Options: [r] Retry / [e] Edit URL / [c] Continue anyway (offline install)"
                read -p "Choice [r/e/C]: " CTRL_CHOICE
                CTRL_CHOICE=${CTRL_CHOICE:-c}
                if [[ "$CTRL_CHOICE" =~ ^[Rr] ]]; then
                    continue
                elif [[ "$CTRL_CHOICE" =~ ^[Ee] ]]; then
                    read -p "Enter Controller URL: " CONTROLLER_URL
                    continue
                else
                    echo "⚠️  Proceeding with controller URL: $CONTROLLER_URL"
                    break
                fi
            else
                echo "⚠️  Non-interactive mode: proceeding with controller URL: $CONTROLLER_URL"
                break
            fi
        fi
    done
fi

echo "🚀 Stigix (All-in-One) - Installation"
echo "=========================================="

# 1. Prerequisite Check & Auto-Installation: Docker
OS_TYPE=$(uname)
IS_LINUX=false
if [[ "$OS_TYPE" == "Linux" ]] && ! grep -qi microsoft /proc/version 2>/dev/null; then
    IS_LINUX=true
fi

if ! command -v docker &> /dev/null; then
    echo "⚠️  Docker is not installed."
    
    if [ "$IS_LINUX" = true ]; then
        echo "🐧 Linux detected. Attempting automated Docker installation via official get.docker.com..."
        
        SUDO_CMD=""
        if [ "$EUID" -ne 0 ]; then
            if command -v sudo &> /dev/null; then
                SUDO_CMD="sudo"
            else
                echo "❌ Error: Root privileges or 'sudo' command required to install Docker."
                echo "Please install Docker manually: https://docs.docker.com/engine/install/"
                exit 1
            fi
        fi
        
        # Download and execute official Docker setup script
        if command -v curl &> /dev/null; then
            curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        elif command -v wget &> /dev/null; then
            wget -qO /tmp/get-docker.sh https://get.docker.com
        else
            echo "❌ Error: Neither 'curl' nor 'wget' is installed to download Docker."
            exit 1
        fi
        
        echo "⏳ Running Docker installation script (this may take 1-2 minutes)..."
        $SUDO_CMD sh /tmp/get-docker.sh
        rm -f /tmp/get-docker.sh
        
        # Add current user to docker group
        if [ "$EUID" -ne 0 ] && [ -n "$USER" ]; then
            $SUDO_CMD usermod -aG docker "$USER" 2>/dev/null || true
        fi
        
        # Start & enable Docker service
        if command -v systemctl &> /dev/null; then
            $SUDO_CMD systemctl start docker 2>/dev/null || true
            $SUDO_CMD systemctl enable docker 2>/dev/null || true
        elif command -v service &> /dev/null; then
            $SUDO_CMD service docker start 2>/dev/null || true
        fi
    elif [[ "$OS_TYPE" == "Darwin" ]]; then
        echo "🍎 Platform: macOS detected."
        echo "❌ Automated background installation is not supported on macOS."
        echo "Please install Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/"
        exit 1
    else
        echo "🪟 Platform: Windows / WSL detected."
        echo "❌ Please install Docker Desktop for Windows with WSL 2 integration:"
        echo "👉 https://docs.docker.com/desktop/setup/install/windows-install/"
        exit 1
    fi
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is still not found after installation attempt."
    echo "Please install Docker manually: https://docs.docker.com/get-docker/"
    exit 1
fi

# 2. Check if Docker daemon is running, try starting if on Linux
if ! docker info &> /dev/null; then
    if [ "$IS_LINUX" = true ]; then
        SUDO_CMD=""
        [ "$EUID" -ne 0 ] && command -v sudo &> /dev/null && SUDO_CMD="sudo"
        if command -v systemctl &> /dev/null; then
            $SUDO_CMD systemctl start docker 2>/dev/null || true
        elif command -v service &> /dev/null; then
            $SUDO_CMD service docker start 2>/dev/null || true
        fi
    fi
fi

if ! docker info &> /dev/null; then
    echo "❌ Error: Docker is installed but the Docker daemon is not accessible or not running."
    if [ "$IS_LINUX" = true ] && [ "$EUID" -ne 0 ]; then
        echo "💡 Tip: If you were just added to the 'docker' group, try running: newgrp docker"
        echo "   Or run the installer with sudo, or log out and log back in."
    else
        echo "Please start the Docker Desktop / Daemon and try again."
    fi
    exit 1
fi

echo "✅ Docker is running."

# OS Detection — Linux gets host mode, macOS/Windows get bridge mode
if [ "$IS_LINUX" = true ]; then
    echo "🐧 Platform: Native Linux detected. (Using host mode for full features)"
    COMPOSE_URL="$REPO_URL/docker-compose.yml"
elif [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "🍎 Platform: macOS detected. (Host mode not supported on macOS, using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose.bridge.yml"
else
    echo "🪟 Platform: WSL/Windows or unknown detected. (Using bridge mode)"
    COMPOSE_URL="$REPO_URL/docker-compose.bridge.yml"
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
# Generate a unique JWT secret for standalone installation or inherit cluster secret if joined
if [ -n "$JOINED_JWT_SECRET" ]; then
    JWT_SECRET="$JOINED_JWT_SECRET"
else
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || date +%s%N | sha256sum | head -c 64)
fi

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
echo "BETA=false" >> .env
echo "" >> .env
echo "# --- Docker Image Tag (Uncomment to lock version/tag) ---" >> .env
echo "# TAG=stable" >> .env

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

# Direct controller mode: inject STIGIX_CONTROLLER_URL
if [ -n "$CONTROLLER_URL" ]; then
    echo "" >> .env
    echo "# --- Direct Controller Mode ---" >> .env
    echo "# Set by --controller flag at install time. Bypasses Cloudflare discovery." >> .env
    echo "STIGIX_CONTROLLER_URL=$CONTROLLER_URL" >> .env
    echo "STIGIX_REGISTRY_ENABLED=true" >> .env
    # Direct mode requires the v2 image which includes the registry-manager changes
    echo "TAG=v2" >> .env
    # Set site name from hostname only if not already present
    if ! grep -q "^STIGIX_SITE_NAME=." .env 2>/dev/null; then
        echo "STIGIX_SITE_NAME=$(hostname | cut -d'.' -f1)" >> .env
    fi
    echo "✅ Controller URL written to .env (image: v2)"
fi

if [ -n "$JOINED_JWT_SECRET" ]; then
    if grep -q "^JWT_SECRET=" .env 2>/dev/null; then
        sed -i.bak -E "s|^JWT_SECRET=.*|JWT_SECRET=$JOINED_JWT_SECRET|g" .env && rm -f .env.bak
    fi
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
echo "✅ Stigix All-in-One Installation complete!"
echo ""

# Show installed version
INSTALLED_VERSION=$(docker exec stigix cat /app/VERSION 2>/dev/null || echo "")
if [ -n "$INSTALLED_VERSION" ]; then
    echo "📦 Installed version: $INSTALLED_VERSION"
fi

if [ "$INSTALL_MODE" == "target" ]; then
    echo "🎯 Target Site is active (XFR: 9000, Voice: 6100, Probes: 6200, iPerf: 5201)."
else
    echo "📊 Dashboard: http://localhost:$PORT"
    echo "🔑 Login: admin / admin"
    echo "💻 Console CLI (for headless/terminal control): docker exec -it stigix stigix-cli"
    echo "💡 Note: To change the Web UI port later, edit 'PORT' in stigix/.env and run: cd stigix && docker compose up -d"
fi
if [ -n "$CONTROLLER_URL" ]; then
    echo ""
    echo "🔗 Controller: $CONTROLLER_URL"
    echo "🤝 Peer registration is starting automatically."
    echo "💡 Tip: Run the following to watch live registration logs:"
    echo "   cd stigix && docker compose logs -f"
fi
echo "📝 Check logs: cd stigix && docker compose logs -f"
echo "=========================================="
