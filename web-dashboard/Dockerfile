# Build Stage
FROM public.ecr.aws/docker/library/node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY web-dashboard/package*.json ./
RUN npm ci

# Copy source code (includes VERSION file)
COPY web-dashboard/ ./

# Build the application
RUN npm run build

# Runtime Stage
FROM public.ecr.aws/docker/library/node:20-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    iproute2 \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    iperf3 \
    python3 \
    python3-pip \
    python3-scapy \
    python3-requests \
    python3-urllib3 \
    docker.io \
    docker-compose \
    vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# Install xfr binary
ARG TARGETARCH
RUN case ${TARGETARCH} in \
    "amd64")  ARCH="x86_64-unknown-linux-musl" ;; \
    "arm64")  ARCH="aarch64-unknown-linux-gnu" ;; \
    *)        ARCH="x86_64-unknown-linux-musl" ;; \
    esac && \
    curl -L "https://github.com/lance0/xfr/releases/latest/download/xfr-${ARCH}.tar.gz" | tar xz -C /usr/local/bin xfr

COPY web-dashboard/package*.json ./
# Install production deps
RUN npm ci --omit=dev --prefer-offline --no-audit
# Install tsx separately
RUN npm install tsx --no-save

COPY --from=builder /app/dist ./dist
COPY web-dashboard/server.ts ./
COPY web-dashboard/test-logger.ts ./
COPY web-dashboard/connectivity-logger.ts ./
COPY web-dashboard/iot-manager.ts ./
COPY web-dashboard/vyos-manager.ts ./
COPY web-dashboard/vyos-scheduler.ts ./
COPY web-dashboard/site-manager.ts ./
COPY web-dashboard/discovery-manager.ts ./
COPY web-dashboard/shared ./shared
COPY web-dashboard/utils ./utils
COPY web-dashboard/tsconfig.json ./

# Copy VERSION file from builder (already in web-dashboard/)
COPY --from=builder /app/VERSION ./VERSION

# Copy engines orchestration script
COPY engines ./engines
# Copy VyOS orchestration script
COPY vyos ./vyos
# Copy IoT emulation script and devices template
COPY iot ./iot

# Install Python dependencies for IoT emulator and Site Detection
RUN pip3 install --no-cache-dir prisma-sase -r iot/requirements.txt --break-system-packages || true

# Labels for Docker Hub
LABEL org.opencontainers.image.title="SD-WAN Traffic Generator - Web UI"
LABEL org.opencontainers.image.description="Modern web dashboard for SD-WAN traffic generation and monitoring"
LABEL org.opencontainers.image.source="https://github.com/jsuzanne/stigix"
LABEL org.opencontainers.image.vendor="jsuzanne"

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/version || exit 1

CMD ["npx", "tsx", "server.ts"]
