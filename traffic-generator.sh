#!/bin/bash
#
# SD-WAN Traffic Generator - Enhanced Version
# Purpose: Generate realistic enterprise application traffic for SD-WAN demos
# Usage: ./traffic-generator.sh [client-id]
#

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="/opt/sdwan-traffic-gen"
CONFIG_DIR="${SCRIPT_DIR}/config"
LOG_DIR="/var/log/sdwan-traffic-gen"
LOGFILE="${LOG_DIR}/traffic.log"
STATS_FILE="${LOG_DIR}/stats-${CLIENTID}.json"
VERSION_FILE="/app/VERSION"

# Get version
if [[ -f "$VERSION_FILE" ]]; then
    VERSION=$(cat "$VERSION_FILE")
else
    VERSION="1.1.0-patch.47"
fi

CLIENTID="${1:-client01}"
MAX_TIMEOUT=15
SLEEP_BETWEEN_REQUESTS=1

# Backoff timers (seconds)
B1=60       # 1 min - première erreur
B2=300      # 5 min - deuxième erreur
B3=1800     # 30 min - troisième erreur
B4=3600     # 1h - erreurs répétées
B5=10800    # 3h - site persistemment injoignable

# Stats counters
declare -A APP_COUNTERS

echo "============================================================================"
echo "🚀 SD-WAN TRAFFIC GENERATOR ${VERSION}"
echo "📝 Logs: ${LOGFILE}"
echo "📱 Client ID: ${CLIENTID}"
echo "============================================================================"
declare -A APP_ERRORS
declare -A BACKOFF_LEVEL
TOTAL_REQUESTS=0

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

function log_message() {
    local level="$1"
    shift
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [$level] $*" >> "$LOGFILE"
}

function log_info() {
    log_message "INFO" "$@"
}

function log_warn() {
    log_message "WARN" "$@"
}

function log_error() {
    log_message "ERROR" "$@"
}

# ============================================================================
# RANDOM SELECTION FUNCTIONS
# ============================================================================

function getRandomInterface() {
    # First, try to read from config file
    if [[ -f "${CONFIG_DIR}/interfaces.txt" ]]; then
        local iface
        iface=$(grep -v '^#' "${CONFIG_DIR}/interfaces.txt" | grep -v '^$' | sort -R 2>/dev/null | head -n 1)
        if [[ -n "$iface" ]]; then
            echo "$iface"
            return
        fi
    fi
    
    # Auto-detect active network interface
    # Try to find the default route interface
    local default_iface
    
    # Linux: use ip route
    if command -v ip &>/dev/null; then
        default_iface=$(ip route | grep '^default' | awk '{print $5}' | head -n 1)
        if [[ -n "$default_iface" ]]; then
            echo "$default_iface"
            return
        fi
    fi
    
    # macOS/BSD: use route -n get default
    if command -v route &>/dev/null; then
        default_iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}')
        if [[ -n "$default_iface" ]]; then
            echo "$default_iface"
            return
        fi
    fi
    
    # Fallback: try to find first active interface (not loopback)
    if command -v ifconfig &>/dev/null; then
        default_iface=$(ifconfig | grep -E '^[a-z]' | grep -v '^lo' | head -n 1 | cut -d: -f1)
        if [[ -n "$default_iface" ]]; then
            echo "$default_iface"
            return
        fi
    fi
    
    # Last resort fallback
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "en0"  # macOS default
    else
        echo "eth0"  # Linux default
    fi
}

function getRandomUserAgent() {
    if [[ -f "${CONFIG_DIR}/user_agents.txt" ]]; then
        local ua
        ua=$(sort -R "${CONFIG_DIR}/user_agents.txt" 2>/dev/null | head -n 1)
        if [[ -n "$ua" ]]; then
            echo "$ua"
        else
            echo "Mozilla/5.0 (compatible; SD-WAN-Traffic-Gen/1.0)"
        fi
    else
        echo "Mozilla/5.0 (compatible; SD-WAN-Traffic-Gen/1.0)"
    fi
}

# Weighted random selection for applications
# Global array to cache applications
DECLARE_APPS_LOADED=false
CACHED_APPS=()
CACHED_WEIGHTS=()
CACHED_ENDPOINTS=()
TOTAL_WEIGHT=0

function loadAppsToMemory() {
    local config_file="${CONFIG_DIR}/applications-config.json"
    local legacy_file="${CONFIG_DIR}/applications.txt"
    
    TOTAL_WEIGHT=0
    CACHED_APPS=()
    CACHED_WEIGHTS=()
    CACHED_ENDPOINTS=()
    
    if [[ -f "$config_file" ]]; then
        local apps_json=$(jq -r '.applications[] | if type == "string" then . else "\(.domain)|\(.weight)|\(.endpoint)" end' "$config_file" 2>/dev/null)
        while read -r line; do
            local app=$(echo "$line" | cut -d'|' -f1)
            local weight=$(echo "$line" | cut -d'|' -f2)
            local endpoint=$(echo "$line" | cut -d'|' -f3)
            [[ "$app" =~ ^#.*$ || -z "$app" ]] && continue
            CACHED_APPS+=("$app")
            CACHED_WEIGHTS+=("$weight")
            CACHED_ENDPOINTS+=("$endpoint")
            ((TOTAL_WEIGHT += weight))
        done <<< "$apps_json"
    elif [[ -f "$legacy_file" ]]; then
        while IFS='|' read -r app weight endpoint; do
            [[ "$app" =~ ^#.*$ || -z "$app" ]] && continue
            CACHED_APPS+=("$app")
            CACHED_WEIGHTS+=("$weight")
            CACHED_ENDPOINTS+=("$endpoint")
            ((TOTAL_WEIGHT += weight))
        done < "$legacy_file"
    fi
    DECLARE_APPS_LOADED=true
    log_info "Loaded ${#CACHED_APPS[@]} applications into memory (Total weight: $TOTAL_WEIGHT)"
}

# Weighted random selection for applications (Memory optimized)
function getWeightedApp() {
    if [[ "$DECLARE_APPS_LOADED" == "false" ]]; then
        loadAppsToMemory
    fi
    
    if [[ $TOTAL_WEIGHT -eq 0 ]]; then
        echo "google.com|/"
        return
    fi
    
    local rand=$((RANDOM % TOTAL_WEIGHT))
    local cumul=0
    
    for i in "${!CACHED_WEIGHTS[@]}"; do
        ((cumul += CACHED_WEIGHTS[i]))
        if ((rand < cumul)); then
            echo "${CACHED_APPS[$i]}|${CACHED_ENDPOINTS[$i]}"
            return
        fi
    done
    
    echo "${CACHED_APPS[0]}|${CACHED_ENDPOINTS[0]}"
}

# ============================================================================
# BACKOFF MANAGEMENT
# ============================================================================

function calculateBackoff() {
    local key=$1
    local level=${BACKOFF_LEVEL[$key]:-0}
    
    case $level in
        0) echo $B1 ;;
        1) echo $B2 ;;
        2) echo $B3 ;;
        3) echo $B4 ;;
        *) echo $B5 ;;
    esac
}

function checkBackoff() {
    local key=$1
    local current_time=$(date +'%s')
    
    # Check if backoff variable exists
    local backoff_var="${key}_BACKOFF"
    if [[ -v "$backoff_var" ]]; then
        local backoff_time="${!backoff_var}"
        if [[ $current_time -gt $backoff_time ]]; then
            # Backoff expired
            unset "$backoff_var"
            return 0
        else
            # Still in backoff
            return 1
        fi
    fi
    return 0
}

function setBackoff() {
    local key=$1
    local current_time=$(date +'%s')
    local backoff_duration=$(calculateBackoff "$key")
    local backoff_until=$((current_time + backoff_duration))
    
    local backoff_var="${key}_BACKOFF"
    eval "$backoff_var=$backoff_until"
    
    ((BACKOFF_LEVEL[$key]++))
    
    log_warn "Backoff set for $key until $backoff_until (level ${BACKOFF_LEVEL[$key]})"
}

function resetBackoff() {
    local key=$1
    BACKOFF_LEVEL[$key]=0
}

# ============================================================================
# STATS & MONITORING
# ============================================================================

function updateStats() {
    local app=$1
    local code=$2
    
    # Clean app name (remove protocol and keep more parts for IPs)
    local app_name="${app#*://}"
    if [[ "$app_name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        # It's an IP, keep it full
        app_name="$app_name"
    else
        # It's a domain, keep it full for better mapping in the UI
        app_name="$app_name"
    fi
    
    # Initialiser les compteurs s'ils n'existent pas
    if [[ ! -v "APP_COUNTERS[$app_name]" ]]; then
        APP_COUNTERS[$app_name]=0
    fi
    if [[ ! -v "APP_ERRORS[$app_name]" ]]; then
        APP_ERRORS[$app_name]=0
    fi
    
    ((APP_COUNTERS[$app_name]++))
    ((TOTAL_REQUESTS++))
    
    if [[ "$code" == "000"* ]]; then
        ((APP_ERRORS[$app_name]++))
    fi
    
    # Write stats every 5 requests (or first request)
    if (( TOTAL_REQUESTS == 1 || (TOTAL_REQUESTS % 5) == 0 )); then
        writeStats
    fi
}

function writeStats() {
    {
        echo "{"
        echo "  \"timestamp\": $(date +%s),"
        echo "  \"client_id\": \"$CLIENTID\","
        echo "  \"total_requests\": $TOTAL_REQUESTS,"
        echo "  \"requests_by_app\": {"
        
        local first=true
        for app in "${!APP_COUNTERS[@]}"; do
            if [[ "$first" == "true" ]]; then
                first=false
            else
                echo ","
            fi
            echo -n "    \"$app\": ${APP_COUNTERS[$app]}"
        done
        echo ""
        echo "  },"
        
        echo "  \"errors_by_app\": {"
        first=true
        for app in "${!APP_ERRORS[@]}"; do
            if [[ "$first" == "true" ]]; then
                first=false
            else
                echo ","
            fi
            echo -n "    \"$app\": ${APP_ERRORS[$app]:-0}"
        done
        echo ""
        echo "  }"
        echo "}"
    } > "$STATS_FILE" 2>/dev/null || log_error "Failed to write stats"
}

# ============================================================================
# TRAFFIC GENERATION
# ============================================================================

function makeRequest() {
    local interface=$1
    local app=$2
    local endpoint=$3
    local user_agent=$4
    
    local url
    if [[ "$app" == http* ]]; then
        url="${app}${endpoint}"
    else
        url="https://${app}${endpoint}"
    fi
    
    local trace_id="$(date +'%s')-${CLIENTID}"
    
    log_info "$CLIENTID requesting $url via $interface (traceid: $trace_id)"
    
    # Execute curl and capture only HTTP code
    local http_code
    http_code=$(curl \
        --interface "$interface" \
        -H "User-Agent: $user_agent" \
        -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
        -H "Accept-Language: en-US,en;q=0.9,fr;q=0.8" \
        -sL \
        -m "$MAX_TIMEOUT" \
        -w "%{http_code}" \
        -o /dev/null \
        "$url" 2>/dev/null || echo "000")
    
    # Validate http_code
    if [[ -z "$http_code" ]] || [[ ! "$http_code" =~ ^[0-9]+$ ]]; then
        http_code="000"
    fi
    
    echo "${http_code}|${url}"
}

# ============================================================================
# MAIN LOOP
# ============================================================================

function main() {
    log_info "Starting SD-WAN Traffic Generator - Client: $CLIENTID"
    
    # Standard Interface Diagnostic
    local iface=$(getRandomInterface)
    log_info "📡 [TRAFFIC] System Interface: $iface (Source: dynamic selection)"
    
    # Ensure config exists
    if [[ ! -f "${CONFIG_DIR}/applications-config.json" && ! -f "${CONFIG_DIR}/applications.txt" ]]; then
        log_error "Configuration file not found (checked applications-config.json and applications.txt)!"
        exit 1
    fi
    
    # Cache config check: only re-read config every 10 requests to avoid jq overhead
    local config_check_counter=0
    local config_file="${CONFIG_DIR}/applications-config.json"
    local legacy_control_file="${CONFIG_DIR}/traffic-control.json"

    # Initial config read
    local enabled="false"
    if [[ -f "$config_file" ]]; then
        enabled=$(jq -r '.control.enabled // false' "$config_file" 2>/dev/null)
        SLEEP_BETWEEN_REQUESTS=$(jq -r '.control.sleep_interval // 1' "$config_file" 2>/dev/null)
    elif [[ -f "$legacy_control_file" ]]; then
        enabled=$(jq -r '.enabled // false' "$legacy_control_file" 2>/dev/null)
        SLEEP_BETWEEN_REQUESTS=$(jq -r '.sleep_interval // 1' "$legacy_control_file" 2>/dev/null)
    fi

    # Main loop
    while true; do
        # Check for reset signal
        if [[ -f "${LOG_DIR}/.reset_stats" ]]; then
            log_info "Reset signal received. Clearing internal counters."
            TOTAL_REQUESTS=0
            unset APP_COUNTERS
            declare -A APP_COUNTERS
            unset APP_ERRORS
            declare -A APP_ERRORS
            rm -f "${LOG_DIR}/.reset_stats"
            loadAppsToMemory
            writeStats
        fi

        # Re-read config every 10 iterations to pick up rate/enabled changes without jq per-request
        (( config_check_counter++ ))
        if (( config_check_counter >= 10 )); then
            config_check_counter=0
            if [[ -f "$config_file" ]]; then
                enabled=$(jq -r '.control.enabled // false' "$config_file" 2>/dev/null)
                SLEEP_BETWEEN_REQUESTS=$(jq -r '.control.sleep_interval // 1' "$config_file" 2>/dev/null)
            elif [[ -f "$legacy_control_file" ]]; then
                enabled=$(jq -r '.enabled // false' "$legacy_control_file" 2>/dev/null)
                SLEEP_BETWEEN_REQUESTS=$(jq -r '.sleep_interval // 1' "$legacy_control_file" 2>/dev/null)
            fi
        fi

        if [[ "$enabled" != "true" ]]; then
            # Traffic is paused, sleep and check again
            sleep 5
            config_check_counter=10  # force re-read on next iteration
            continue
        fi
        
        # Get random variables
        local interface=$(getRandomInterface)
        local user_agent=$(getRandomUserAgent)
        
        # Get weighted app selection
        local app_data=$(getWeightedApp)
        local app="${app_data%%|*}"
        local endpoint="${app_data#*|}"
        
        # Skip if empty
        if [[ -z "$app" ]]; then
            sleep 1
            continue
        fi
        
        # Create backoff key
        local backoff_key=$(echo "${interface}_${app}" | tr '.:/-' '_')
        
        # Check if in backoff
        if ! checkBackoff "$backoff_key"; then
            log_info "$CLIENTID skipping $app (in backoff)"
            sleep 1
            continue
        fi
        
        # Make request
        local result=$(makeRequest "$interface" "$app" "$endpoint" "$user_agent")
        local code="${result%%|*}"
        local url="${result#*|}"
        
        # Handle result
        if [[ "$code" == "000"* ]]; then
            setBackoff "$backoff_key"
            log_error "$CLIENTID FAILED $url via $interface - code: $code"
        else
            resetBackoff "$backoff_key"
            log_info "$CLIENTID SUCCESS $url - code: $code"
        fi
        
        # Update stats
        updateStats "$app" "$code"
        
        # Sleep between requests
        sleep "$SLEEP_BETWEEN_REQUESTS"
    done
}

# ============================================================================
# MASTER/WORKER MANAGEMENT
# ============================================================================

# Check for --worker flag
IS_WORKER=false
if [[ "$2" == "--worker" ]]; then
    IS_WORKER=true
fi

function master_loop() {
    log_info "🚀 [MASTER] Stigix Traffic Manager starting... (Version: $VERSION)"
    
    while true; do
        # Read config for client count and enabled status
        local config_file="${CONFIG_DIR}/applications-config.json"
        local client_count=1
        local enabled="false"
        
        if [[ -f "$config_file" ]]; then
            enabled=$(jq -r '.control.enabled // false' "$config_file" 2>/dev/null)
            client_count=$(jq -r '.control.client_count // 1' "$config_file" 2>/dev/null)
        fi

        # If traffic is disabled, we should have 0 workers
        if [[ "$enabled" != "true" ]]; then
            client_count=0
        fi
        
        # Get list of running worker PIDs — use word-boundary (-w) to avoid
        # a master PID like 1234 accidentally matching worker PID 12345
        local master_pid=$$
        local worker_pids=($(pgrep -f "traffic-generator.sh.*--worker" | grep -w -v "$master_pid" || true))
        local current_count=${#worker_pids[@]}
        
        if (( current_count < client_count )); then
            local to_start=$((client_count - current_count))
            log_info "📈 [MASTER] Scaling UP: $current_count -> $client_count. Starting $to_start new workers..."
            for i in $(seq 1 $to_start); do
                # Use timestamp suffix for uniqueness — avoids stats file collisions on restart
                local worker_id="client-$(printf "%02d" $((current_count + i)))-$(date +%s | tail -c 4)"
                /bin/bash "$0" "$worker_id" --worker &
                log_info "  + Worker $worker_id started (PID: $!)"
            done
        elif (( current_count > client_count )); then
            local to_stop=$((current_count - client_count))
            log_info "📉 [MASTER] Scaling DOWN: $current_count -> $client_count. Stopping $to_stop workers..."
            for i in $(seq 1 $to_stop); do
                local pid_to_kill=${worker_pids[$i-1]}
                log_info "  - Stopping Worker PID: $pid_to_kill"
                kill "$pid_to_kill" 2>/dev/null || true
            done
        fi
        
        # Check for reset signal
        if [[ -f "${LOG_DIR}/.reset_stats" ]]; then
            log_info "♻️ [MASTER] Reset signal received. Propagating to workers..."
            # Workers check for this file in their loop too, but we help by clearing it once they've had time
            # Actually, workers will see it themselves. We just wait.
            sleep 2
        fi

        sleep 5
    done
}

# ============================================================================
# INITIALIZATION
# ============================================================================

# Create directories if needed
mkdir -p "$CONFIG_DIR" "$LOG_DIR" 2>/dev/null || true

# Main Execution Path
if [[ "$IS_WORKER" == "true" ]]; then
    # We are a worker. We generate traffic.
    main
else
    # We are the master. We manage scaling.
    master_loop
fi


