FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY mcp-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY mcp-server/src/ ./src/
COPY mcp-server/profiles/ ./profiles/

# Volumes will be mounted at runtime
VOLUME ["/app/config", "/app/logs", "/app/data"]

# Expose SSE port (for future remote access)
EXPOSE 3100

# Environment
ENV PYTHONUNBUFFERED=1
ENV MCP_TRANSPORT=sse
ENV MCP_PORT=3100
ENV MCP_HOST=0.0.0.0

# Healthcheck for SSE endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD python -c "import httpx; httpx.get('http://localhost:3100/sse', timeout=2)" || exit 1

# Expose SSE port
EXPOSE 3100

# Run server (default transport is SSE based on ENV above)
# For STDIO usage via docker exec, override ENV: docker exec -e MCP_TRANSPORT=stdio ...
CMD ["python", "-m", "src.server"]
