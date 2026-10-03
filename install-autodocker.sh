#!/bin/bash
# Install script for Stigix All-in-One (Migration Draft)
# Usage: ./install-stigix.sh [options]

set -e

# Default values
INSTALL_MODE="both"
DRY_RUN=false
CONTROLLER_URL=""
REPO_URL="https://raw.githubusercontent.com/jsuzanne/stigix/v2"
COMPOSE_URL="$REPO_URL/docker-compose.yml"

show_help() {
    echo "🚀 Stigix All-in-One - Installation Script"
    echo "Usage: ./install-stigix.sh [options]"
    echo ""
    echo "Options:"
    echo "  --mode <target|source|both>  Set the deployment mode (Default: both)"
    echo "  --controller <URL>           Join a remote Stigix leader as a peer (direct mode)"
    echo "  --ip, -i <IP>                Explicitly select IP to advertise to Leader (bypasses prompt)"
    echo "  --site, -s <Name>            Override site name for this node"
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
ADVERTISED_IP_OVERRIDE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --mode|-m) INSTALL_MODE="$2"; shift 2 ;;
        --controller|-c) CONTROLLER_URL="$2"; shift 2 ;;
        --token|-t) JOIN_TOKEN="$2"; shift 2 ;;
        --site|--site-name|--site_name|-s) SITE_NAME_OVERRIDE="$2"; shift 2 ;;
        --ip|-i) ADVERTISED_IP_OVERRIDE="$2"; shift 2 ;;
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
    
    DECODED_JSON=$(echo "$B64_CLEAN" | base64 -d 2>/dev/null || echo "$B64_CLEAN" | base64 -D 2>/dev/null || echo "$B64_CLEAN" | openssl base64 -d 2>/dev/null || echo "{}")
    
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
    elif command -v node &>/dev/null; then
        NODE_EXTRACT=$(node -e "try { const d=JSON.parse(process.argv[1]); (d.endpoints||[]).forEach(e=>console.log(e)); if (d.site_hint) console.log('SITE_HINT=' + d.site_hint); if (d.realm) console.log('REALM=' + d.realm); } catch(e){}" "$DECODED_JSON" 2>/dev/null)
        while IFS= read -r line; do
            if [[ "$line" =~ ^SITE_HINT=(.*) ]]; then
                TOKEN_SITE="${BASH_REMATCH[1]}"
            elif [[ "$line" =~ ^REALM=(.*) ]]; then
                TOKEN_REALM="${BASH_REMATCH[1]}"
            elif [ -n "$line" ]; then
                CANDIDATES+=("$line")
            fi
        done <<< "$NODE_EXTRACT"
    fi

    # Fallback to POSIX grep / sed if python/node was not available or output was empty
    if [ -z "$TOKEN_SITE" ]; then
        TOKEN_SITE=$(echo "$DECODED_JSON" | grep -o '"site_hint"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
    fi
    if [ -z "$TOKEN_REALM" ]; then
        TOKEN_REALM=$(echo "$DECODED_JSON" | grep -o '"realm"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
    fi
    if [ ${#CANDIDATES[@]} -eq 0 ]; then
        while IFS= read -r ep; do
            [ -n "$ep" ] && CANDIDATES+=("$ep")
        done < <(echo "$DECODED_JSON" | grep -o '"https\?://[^"]*"' | tr -d '"')
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
        LOCAL_IPS=()
        # 1. Inspect interfaces with 'ip' command, filtering out docker/libvirt/veth virtual bridges
        if command -v ip &>/dev/null; then
            while read -r iface ip; do
                if [[ ! "$iface" =~ ^(lo|docker|virbr|veth|vnet|br-) ]]; then
                    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ ! "$ip" =~ ^127\. ]] && [[ ! "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && [[ ! "$ip" =~ ^169\.254\. ]] && LOCAL_IPS+=("$ip")
                fi
            done < <(ip -4 -o addr show 2>/dev/null | awk '{print $2, $4}' | sed 's/\/.*//')
        fi
        # 2. Fallback to ifconfig if no interface IP found
        if [ ${#LOCAL_IPS[@]} -eq 0 ] && command -v ifconfig &>/dev/null; then
            for ip in $(ifconfig 2>/dev/null | grep -E 'inet [0-9]' | awk '{print $2}' | sed 's/addr://'); do
                [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ ! "$ip" =~ ^127\. ]] && [[ ! "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && [[ ! "$ip" =~ ^169\.254\. ]] && LOCAL_IPS+=("$ip")
            done
        fi
        # 3. Fallback to hostname -I if still empty
        if [ ${#LOCAL_IPS[@]} -eq 0 ] && command -v hostname &>/dev/null; then
            for ip in $(hostname -I 2>/dev/null); do
                [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ ! "$ip" =~ ^127\. ]] && [[ ! "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && [[ ! "$ip" =~ ^169\.254\. ]] && LOCAL_IPS+=("$ip")
            done
        fi

        # Probe external Public IP (essential for Cloud VPS like Hetzner, AWS, GCP, Oracle, or behind 1:1 NAT)
        EXT_PUB_IP=$(curl -4 -s --connect-timeout 2 -m 3 https://api.ipify.org 2>/dev/null || curl -4 -s --connect-timeout 2 -m 3 https://ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 2 -m 3 https://checkip.amazonaws.com 2>/dev/null || true)
        EXT_PUB_IP=$(echo "$EXT_PUB_IP" | tr -d ' \n\r\t')
        if [[ "$EXT_PUB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ ! "$EXT_PUB_IP" =~ ^127\. ]] && [[ ! "$EXT_PUB_IP" =~ ^10\. ]] && [[ ! "$EXT_PUB_IP" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && [[ ! "$EXT_PUB_IP" =~ ^192\.168\. ]] && [[ ! "$EXT_PUB_IP" =~ ^169\.254\. ]]; then
            LOCAL_IPS+=("$EXT_PUB_IP")
        fi

        UNIQUE_IPS=()
        for ip in "${LOCAL_IPS[@]}"; do
            skip=0
            for u in "${UNIQUE_IPS[@]}"; do
                [ "$u" = "$ip" ] && { skip=1; break; }
            done
            [ $skip -eq 0 ] && UNIQUE_IPS+=("$ip")
        done

        # Ensure CHOSEN_PRIMARY_IP is always initialized (e.g. single-IP Cloud hosts)
        [ ${#UNIQUE_IPS[@]} -gt 0 ] && CHOSEN_PRIMARY_IP="${UNIQUE_IPS[0]}"

        if [ -n "$ADVERTISED_IP_OVERRIDE" ]; then
            UNIQUE_IPS=("$ADVERTISED_IP_OVERRIDE")
            CHOSEN_PRIMARY_IP="$ADVERTISED_IP_OVERRIDE"
            echo "   🎯 Using specified advertised IP: $ADVERTISED_IP_OVERRIDE"
        elif [ ${#UNIQUE_IPS[@]} -gt 1 ]; then
            INTERACTIVE=0
            if [ -t 0 ]; then
                INTERACTIVE=1
            elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
                INTERACTIVE=2
            fi

            if [ $INTERACTIVE -gt 0 ]; then
                echo ""
                echo "   🌐 Multiple network interfaces / IPs detected on this host:"
                echo "      [1] All detected IPs (${UNIQUE_IPS[*]}) - Recommended"
                idx=2
                for ip in "${UNIQUE_IPS[@]}"; do
                    if [[ "$ip" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.) ]]; then
                        echo "      [$idx] $ip (Private LAN)"
                    else
                        echo "      [$idx] $ip (Public / Cloud IP)"
                    fi
                    ((idx++))
                done
                echo "      [$idx] Custom IP..."

                IP_CHOICE=""
                if [ $INTERACTIVE -eq 1 ]; then
                    read -t 15 -p "   👉 Select IP to advertise to Leader [Default: 1, auto-select in 15s]: " IP_CHOICE || true
                else
                    read -t 15 -p "   👉 Select IP to advertise to Leader [Default: 1, auto-select in 15s]: " IP_CHOICE < /dev/tty || true
                fi
                echo ""
                IP_CHOICE=${IP_CHOICE:-1}

                if [ "$IP_CHOICE" = "1" ]; then
                    echo "   ✅ Advertising all detected IPs."
                elif [ "$IP_CHOICE" -ge 2 ] && [ "$IP_CHOICE" -lt "$idx" ] 2>/dev/null; then
                    selected_idx=$((IP_CHOICE - 2))
                    SELECTED_IP="${UNIQUE_IPS[$selected_idx]}"
                    UNIQUE_IPS=("$SELECTED_IP")
                    CHOSEN_PRIMARY_IP="$SELECTED_IP"
                    echo "   ✅ Advertising selected IP: $SELECTED_IP"
                elif [ "$IP_CHOICE" = "$idx" ]; then
                    CUSTOM_IP=""
                    if [ $INTERACTIVE -eq 1 ]; then
                        read -p "   Enter custom IP: " CUSTOM_IP
                    else
                        read -p "   Enter custom IP: " CUSTOM_IP < /dev/tty
                    fi
                    if [ -n "$CUSTOM_IP" ]; then
                        UNIQUE_IPS=("$CUSTOM_IP")
                        CHOSEN_PRIMARY_IP="$CUSTOM_IP"
                        echo "   ✅ Advertising custom IP: $CUSTOM_IP"
                    fi
                else
                    echo "   ⚠️  Invalid choice ($IP_CHOICE), proceeding with all detected IPs."
                fi
            fi
        fi

        LOCAL_IPS_JSON="["
        first=1
        for ip in "${UNIQUE_IPS[@]}"; do
            [ $first -eq 1 ] && LOCAL_IPS_JSON+="\"$ip\"" || LOCAL_IPS_JSON+=",\"$ip\""
            first=0
        done
        LOCAL_IPS_JSON+="]"
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
[ -n "$TOKEN_REALM" ] && echo "STIGIX_CLUSTER_REALM=$TOKEN_REALM" >> .env
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
STIGIX_SITE_NAME="${SITE_NAME_OVERRIDE:-$(hostname | cut -d'.' -f1)}"
EOF

if [ -n "$SITE_NAME_OVERRIDE" ]; then
    if grep -q "^STIGIX_SITE_NAME=" .env 2>/dev/null; then
        sed -i.bak -E "s|^STIGIX_SITE_NAME=.*|STIGIX_SITE_NAME=$SITE_NAME_OVERRIDE|g" .env && rm -f .env.bak
    else
        echo "STIGIX_SITE_NAME=$SITE_NAME_OVERRIDE" >> .env
    fi
fi

if [ -n "$CHOSEN_PRIMARY_IP" ]; then
    if grep -q "^STIGIX_PRIVATE_IP=" .env 2>/dev/null; then
        sed -i.bak -E "s|^STIGIX_PRIVATE_IP=.*|STIGIX_PRIVATE_IP=$CHOSEN_PRIMARY_IP|g" .env && rm -f .env.bak
    else
        echo "STIGIX_PRIVATE_IP=$CHOSEN_PRIMARY_IP" >> .env
    fi
fi

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
        echo "STIGIX_SITE_NAME=${SITE_NAME_OVERRIDE:-$(hostname | cut -d'.' -f1)}" >> .env
    fi
    echo "✅ Controller URL written to .env (image: v2)"
fi

if [ -n "$JOINED_JWT_SECRET" ]; then
    if grep -q "^JWT_SECRET=" .env 2>/dev/null; then
        sed -i.bak -E "s|^JWT_SECRET=.*|JWT_SECRET=$JOINED_JWT_SECRET|g" .env && rm -f .env.bak
    fi
fi

if [ -n "$TOKEN_REALM" ]; then
    if grep -q "^STIGIX_CLUSTER_REALM=" .env 2>/dev/null; then
        sed -i.bak -E "s|^STIGIX_CLUSTER_REALM=.*|STIGIX_CLUSTER_REALM=$TOKEN_REALM|g" .env && rm -f .env.bak
    else
        echo "STIGIX_CLUSTER_REALM=$TOKEN_REALM" >> .env
    fi
fi

mkdir -p ./config ./logs ./mcp-data

FINAL_SITE_NAME="${SITE_NAME_OVERRIDE:-$(hostname | cut -d'.' -f1)}"
echo "{\"siteName\":\"$FINAL_SITE_NAME\"}" > ./config/site-name.json

if [ -n "$CHOSEN_PRIMARY_IP" ]; then
    IFACE_FOR_IP=$(ip -4 -o addr show 2>/dev/null | grep "$CHOSEN_PRIMARY_IP" | awk '{print $2}' | head -n 1)
    if [ -z "$IFACE_FOR_IP" ] && command -v ifconfig &>/dev/null; then
        IFACE_FOR_IP=$(ifconfig 2>/dev/null | grep -B 1 "$CHOSEN_PRIMARY_IP" | grep -E '^[a-zA-Z0-9]+' | awk '{print $1}' | tr -d ':' | head -n 1)
    fi
    if [ -n "$IFACE_FOR_IP" ]; then
        echo "$IFACE_FOR_IP" > ./config/interfaces.txt
    else
        DEFAULT_IFACE=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -n 1)
        [ -n "$DEFAULT_IFACE" ] && echo "$DEFAULT_IFACE" > ./config/interfaces.txt
    fi
fi

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

    # 4. Fleet WebSocket Tunnel Verification (when joining a cluster)
    if [ -n "$JOIN_TOKEN" ] || [ -n "$CONTROLLER_URL" ] || [ -n "$TOKEN_REALM" ]; then
        echo "🔍 Verifying Fleet Mesh WebSocket Tunnel with Leader..."
        TUNNEL_ESTABLISHED=false
        MAX_TUNNEL_WAIT=20
        for ((t=1; t<=MAX_TUNNEL_WAIT; t++)); do
            STATUS_JSON=$(curl -sf "http://localhost:$PORT/api/system/tunnel-status" 2>/dev/null || echo "{}")
            if echo "$STATUS_JSON" | grep -q '"tunnel_active":true'; then
                TUNNEL_ESTABLISHED=true
                LEADER_NAME=$(echo "$STATUS_JSON" | grep -o '"siteName":"[^"]*' | cut -d'"' -f4)
                [ -z "$LEADER_NAME" ] && LEADER_NAME=$(echo "$STATUS_JSON" | grep -o '"instanceId":"[^"]*' | cut -d'"' -f4)
                print_progress_bar $MAX_TUNNEL_WAIT $MAX_TUNNEL_WAIT "⚡ WebSocket Fleet Tunnel ESTABLISHED with Leader (${LEADER_NAME:-Leader})!"
                echo ""
                echo ""
                echo "   ╔═══════════════════════════════════════════════════════════════════════╗"
                echo "   ║  🎉 FLEET MESH CONNECTED & SYNCHRONIZED !                             ║"
                echo "   ╠═══════════════════════════════════════════════════════════════════════╣"
                echo "   ║  🟢 Node Status:    Online [ ⚡ WS TUNNEL ]                            ║"
                printf "   ║  👑 Leader Name:    %-49s ║\n" "${LEADER_NAME:-Leader}"
                echo "   ║  🔒 Security Realm: Synchronized & Enrolled                           ║"
                echo "   ║  📦 Provisioning:   Targets, Probes & Applications Active             ║"
                echo "   ╚═══════════════════════════════════════════════════════════════════════╝"
                echo ""
                break
            fi
            print_progress_bar $t $MAX_TUNNEL_WAIT "Awaiting Leader reverse dial (~10s cycle, attempt $t/$MAX_TUNNEL_WAIT)..."
            sleep 2
        done
        if [ "$TUNNEL_ESTABLISHED" = false ]; then
            echo ""
            echo "   ℹ️  Node is online and waiting for Leader dial."
            echo "   💡 Troubleshooting: If this node does not show '⚡ WS Tunnel' in your Leader dashboard within 1 min,"
            echo "      verify that Inbound TCP port $PORT is allowed in your Cloud firewall (AWS Security Group / GCP VPC rules)."
        fi
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
    echo "🤝 Peer registration is active."
fi
echo "📝 Check logs: cd stigix && docker compose logs -f"
echo "=========================================="
