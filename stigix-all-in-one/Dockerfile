# Build Stage for Web Dashboard
FROM public.ecr.aws/docker/library/node:20-slim AS builder
WORKDIR /app
COPY web-dashboard/package*.json ./
RUN npm ci
COPY web-dashboard/ ./
RUN npm run build

# Final Stage
FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
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

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install xfr binary
ARG TARGETARCH
RUN case ${TARGETARCH} in \
    "amd64")  ARCH="x86_64-unknown-linux-musl" ;; \
    "arm64")  ARCH="aarch64-unknown-linux-gnu" ;; \
    *)        ARCH="x86_64-unknown-linux-musl" ;; \
    esac && \
    curl -L "https://github.com/lance0/xfr/releases/latest/download/xfr-${ARCH}.tar.gz" | tar xz -C /usr/local/bin xfr

# Copy Web Dashboard production files
COPY web-dashboard/package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit
RUN npm install tsx --no-save

COPY --from=builder /app/dist ./dist
COPY web-dashboard/server.ts ./
COPY web-dashboard/targets-manager.ts ./
COPY web-dashboard/test-logger.ts ./
COPY web-dashboard/connectivity-logger.ts ./
COPY web-dashboard/iot-manager.ts ./
COPY web-dashboard/vyos-manager.ts ./
COPY web-dashboard/vyos-scheduler.ts ./
COPY web-dashboard/site-manager.ts ./
COPY web-dashboard/discovery-manager.ts ./
COPY web-dashboard/shared ./shared
COPY web-dashboard/utils ./utils
COPY web-dashboard/src/types ./src/types
COPY web-dashboard/tsconfig.json ./
COPY --from=builder /app/VERSION ./VERSION

# Copy components
COPY engines ./engines
COPY vyos ./vyos
COPY iot ./iot
COPY traffic-generator.sh ./
COPY stigix-all-in-one ./stigix-all-in-one

# Install Python dependencies
RUN pip3 install --no-cache-dir scapy flask prisma-sase -r iot/requirements.txt --break-system-packages || true

# Final preparations
RUN chmod +x /app/traffic-generator.sh \
    /app/engines/start_target.sh \
    /app/stigix-all-in-one/entrypoint.sh \
    && dos2unix /app/traffic-generator.sh /app/stigix-all-in-one/entrypoint.sh

# Create log directory
RUN mkdir -p /var/log/sdwan-traffic-gen

EXPOSE 8080 6100/udp 6101/udp 6200/udp 5201/tcp 5201/udp 8082/tcp 9000/tcp

ENTRYPOINT ["/app/stigix-all-in-one/entrypoint.sh"]
