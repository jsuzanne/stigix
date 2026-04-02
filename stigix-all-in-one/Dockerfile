# Build Stage for Web Dashboard
FROM public.ecr.aws/docker/library/node:20-slim AS builder
WORKDIR /app
COPY web-dashboard/package*.json ./
RUN npm ci
COPY web-dashboard/ ./
RUN npm run build

# Final Stage
FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    iproute2 \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    iperf3 \
    tcpdump \
    libpcap-dev \
    gcc \
    procps \
    net-tools \
    dos2unix \
    ca-certificates \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI and Docker Compose (Static Binaries)
RUN set -x && \
    ARCH=$(uname -m) && \
    case "$ARCH" in \
        x86_64)  DOCKER_ARCH="x86_64";  COMPOSE_ARCH="x86_64" ;; \
        aarch64) DOCKER_ARCH="aarch64"; COMPOSE_ARCH="aarch64" ;; \
        *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac && \
    DOCKER_VER="29.3.0" && \
    COMPOSE_VER="v2.26.1" && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_VER}.tgz" | \
    tar -xzC /usr/local/bin --strip-components=1 docker/docker && \
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-${COMPOSE_ARCH}" \
    -o /usr/local/bin/docker-compose && \
    chmod +x /usr/local/bin/docker /usr/local/bin/docker-compose && \
    mkdir -p /usr/local/lib/docker/cli-plugins && \
    ln -s /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install xfr binary (Speedtest)
# Install xfr binary (Speedtest)
ARG XFR_VERSION=latest
ARG TARGETARCH
RUN case ${TARGETARCH} in \
    "amd64")  ARCH="x86_64-unknown-linux-musl" ;; \
    "arm64")  ARCH="aarch64-unknown-linux-gnu" ;; \
    *)        ARCH="x86_64-unknown-linux-musl" ;; \
    esac && \
    if [ "${XFR_VERSION}" = "latest" ]; then \
      URL="https://github.com/lance0/xfr/releases/latest/download/xfr-${ARCH}.tar.gz"; \
    else \
      URL="https://github.com/lance0/xfr/releases/download/${XFR_VERSION}/xfr-${ARCH}.tar.gz"; \
    fi && \
    curl -L "$URL" | tar xz -C /usr/local/bin xfr

# Copy Web Dashboard production files
COPY web-dashboard/package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit
RUN npm install tsx --no-save

COPY --from=builder /app/dist ./dist
COPY web-dashboard/server.ts ./
COPY web-dashboard/targets-manager.ts ./
COPY web-dashboard/target-manager.ts ./
COPY web-dashboard/test-logger.ts ./
COPY web-dashboard/connectivity-logger.ts ./
COPY web-dashboard/iot-manager.ts ./
COPY web-dashboard/vyos-manager.ts ./
COPY web-dashboard/vyos-scheduler.ts ./
COPY web-dashboard/site-manager.ts ./
COPY web-dashboard/discovery-manager.ts ./
COPY web-dashboard/registry-manager.ts ./
COPY web-dashboard/stigix-registry-client.ts ./
COPY web-dashboard/local-registry-server.ts ./
COPY web-dashboard/shared ./shared
COPY web-dashboard/utils ./utils
COPY web-dashboard/src/types ./src/types
COPY web-dashboard/tsconfig.json ./
COPY --from=builder /app/VERSION ./VERSION

# Copy components
COPY engines ./engines
COPY vyos ./vyos
COPY iot ./iot
COPY mcp-server /app/mcp-server
COPY traffic-generator.sh ./
COPY stigix-all-in-one ./stigix-all-in-one

# Install Python dependencies
RUN pip3 install --no-cache-dir requests scapy flask prisma-sase -r iot/requirements.txt -r mcp-server/requirements.txt --break-system-packages || true

# Final preparations
RUN chmod +x /app/traffic-generator.sh \
    /app/engines/start_target.sh \
    /app/stigix-all-in-one/entrypoint.sh \
    && dos2unix /app/traffic-generator.sh /app/stigix-all-in-one/entrypoint.sh

# Path Bridging (Ensure all scripts find config/logs in consistent locations)
RUN mkdir -p /var/log/sdwan-traffic-gen /opt/sdwan-traffic-gen /app/mcp-data && \
    ln -s /app/config /opt/sdwan-traffic-gen/config

EXPOSE 8080 6100/udp 6101/udp 6200/udp 5201/tcp 5201/udp 8082/tcp 9000/tcp 3100

ENTRYPOINT ["/app/stigix-all-in-one/entrypoint.sh"]
