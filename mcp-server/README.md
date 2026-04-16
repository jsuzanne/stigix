# SD-WAN Traffic Generator - MCP Server

Model Context Protocol (MCP) server for orchestrating multiple SD-WAN traffic generator instances via natural language through Claude Desktop.

## Overview

This MCP server provides a natural language interface to manage and coordinate traffic generation tests across multiple SD-WAN sites. It's completely independent from the existing traffic generator application and communicates only via public REST APIs.

## Features

- **Multi-Agent Orchestration**: Manage multiple traffic generator instances from a single interface
- **Natural Language Control**: Use Claude Desktop to control tests with plain English
- **Traffic Profiles**: Pre-configured profiles for voice, IoT, and enterprise traffic
- **Test Management**: Start, stop, and monitor coordinated tests across sites
- **Read-Only Safety**: Uses read-only volumes for existing config/logs
- **Zero Code Changes**: No modifications to existing traffic-gen or web-ui services

## Architecture

```
Claude Desktop (Natural Language)
         ↓
    MCP Server (Python)
         ↓
   REST APIs (JWT Auth)
         ↓
 Traffic Generator Agents
```

## Prerequisites

- Docker and Docker Compose
- Existing SD-WAN Traffic Generator deployment
- Claude Desktop (for natural language interaction)

## Installation

### 1. Build the MCP Server

```bash
cd stigix
docker compose build mcp-server
```

### 2. Configure Agents

Create `config/agents.json`:

```json
{
  "agents": [
    {
      "id": "paris",
      "name": "Paris Branch",
      "url": "http://stigix:8080",
      "jwt_secret": "your-jwt-secret-from-docker-compose"
    }
  ]
}
```

### 3. Start the MCP Server

```bash
# Start with demo profile (optional)
docker compose --profile demo up -d mcp-server

# Or add to default services
docker compose up -d
```

## Transport Modes

The MCP server supports two transport modes:

1. **SSE (Server-Sent Events) - Default**
   - Runs as a web server on port 3100
   - Best for remote access (SSH tunnels, Cloudflare Tunnel)
   - Supports health checks (`/health`)
   - Logs to stderr, traffic on HTTP

2. **STDIO (Standard Input/Output)**
   - Communicates via stdin/stdout
   - Best for local Claude Desktop (via `docker exec`)
   - Configured by setting `MCP_TRANSPORT=stdio`

---

## Claude Desktop Setup

### Option A: Local Setup (STDIO via Docker)

Use this if Claude Desktop is running on the **same machine** as Docker.

```json
{
  "mcpServers": {
    "sdwan-traffic-gen": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "-e", "MCP_TRANSPORT=stdio",
        "sdwan-mcp",
        "python",
        "-m",
        "src.server"
      ]
    }
  }
}
```

### Option B: Remote Setup (SSE via SSH Tunnel)

Use this if Claude Desktop is on your Mac/PC and the server is on a remote Linux machine (e.g., `192.168.123.102`).

1. **Start the SSH Tunnel:**

   ```bash
   ssh -N -L 3100:localhost:3100 user@192.168.123.102
   ```

2. **Configure Claude Desktop:**

   ```json
   {
     "mcpServers": {
       "sdwan-traffic-gen": {
         "command": "npx",
         "args": [
           "-y",
           "@modelcontextprotocol/inspector",
           "http://localhost:3100/sse"
         ]
       }
     }
   }
   ```

**Note**: This requires `node` and `npx` installed on your machine. Alternatively, you can use the MCP Inspector directly or any SSE-compatible MCP client.

---

## Testing

### Testing SSE Transport

1. **Start MCP server (SSE mode)**
   ```bash
   docker compose up -d mcp-server
   ```

2. **Check health endpoint**
   ```bash
   curl http://localhost:3100/health
   # Expected: {"status": "ok"}
   ```

3. **Check SSE endpoint**
   ```bash
   curl -N http://localhost:3100/sse
   # Expected: Connection stays open
   ```

4. **Remote Test (from Mac)**
   ```bash
   ssh -N -L 3100:localhost:3100 user@remote-host &
   curl http://localhost:3100/health
   ```

### Troubleshooting

**SSE Connection Refused**
- Check `MCP_TRANSPORT=sse` environment variable
- Verify port 3100 is exposed in `docker-compose.yml`
- Check container logs: `docker logs sdwan-mcp`

**Claude Desktop "Connection Failed"**
- Verify SSH tunnel is active
- Test endpoint manually with `curl`
- Check Claude logs: `~/Library/Logs/Claude/mcp*.log`

**JSON Parsing Errors with STDIO**
- Ensure you are passing `-e MCP_TRANSPORT=stdio` to `docker exec`
- Check logs (logs should go to stderr, not stdout)

---

## Usage Examples

### List Available Agents

**User**: "Quels sont les agents disponibles ?"

**Claude** calls: `list_agents()`

**Response**:
```json
[
  {
    "id": "paris",
    "name": "Paris Branch",
    "status": "running",
    "url": "http://stigix:8080"
  }
]
```

### Start a Traffic Test

**User**: "Lance un test voix de 3 minutes sur Paris"

**Claude** calls: `start_traffic_test(agents=["paris"], profile="voice", duration_minutes=3)`

**Response**:
```json
{
  "test_id": "test-20260205-1015",
  "message": "Test started on 1/1 agent(s)"
}
```

### Check Test Status

**User**: "Montre-moi les stats du test en cours"

**Claude** calls: `get_test_status()`

**Response**:
```json
{
  "id": "test-20260205-1015",
  "status": "running",
  "elapsed_seconds": 125,
  "agents": [
    {
      "id": "paris",
      "stats": {
        "total_requests": 850,
        "success_rate": 98.2
      }
    }
  ]
}
```

### Stop a Test

**User**: "Arrête le test test-20260205-1015"

**Claude** calls: `stop_traffic_test(test_id="test-20260205-1015")`

### List Recent Tests

**User**: "Liste les 5 derniers tests"

**Claude** calls: `list_tests(limit=5)`

### Change Traffic Profile

**User**: "Change Paris en profil IoT"

**Claude** calls: `set_traffic_profile(agent_id="paris", profile="iot")`

## Available Tools

| Tool | Description |
|------|-------------|
| `list_agents` | List all configured agents with status |
| `start_traffic_test` | Start coordinated test across agents |
| `stop_traffic_test` | Stop test and collect final stats |
| `get_test_status` | Get current test status |
| `list_tests` | List recent test runs |
| `set_traffic_profile` | Apply traffic profile to agent |

## Traffic Profiles

### voice.txt
VoIP and UC applications (Teams, Zoom, Google Meet, Webex)

### iot.txt
IoT and telemetry endpoints

### enterprise.txt
Enterprise SaaS applications (Office 365, Gmail, Slack, Salesforce, GitHub)

### Custom Profiles

Create custom profiles in `mcp-server/profiles/`:

```
# Format: domain|weight|endpoint
example.com|100|/api/v1
another.com|80|/health
```

## Directory Structure

```
mcp-server/
├── src/
│   ├── server.py          # Main MCP server
│   ├── types.py           # Pydantic models
│   ├── lib/
│   │   ├── config.py      # Agent configuration
│   │   ├── storage.py     # Test persistence
│   │   └── agent_client.py # HTTP client
│   └── tools/
│       ├── agents.py      # list_agents tool
│       ├── tests.py       # Test management tools
│       └── profiles.py    # Profile management
├── profiles/              # Traffic profile templates
├── Dockerfile
├── requirements.txt
└── README.md
```

## Troubleshooting

### MCP Server Not Appearing in Claude Desktop

1. Check Claude Desktop config syntax
2. Restart Claude Desktop
3. Check container logs: `docker compose logs mcp-server`

### Agent Connection Errors

1. Verify `config/agents.json` URLs are correct
2. Check JWT secrets match docker-compose.yml
3. Ensure agents are running: `docker compose ps`
4. Test API manually: `curl http://localhost:8080/api/status`

### Profile Not Found

1. Check profile exists in `mcp-server/profiles/`
2. Rebuild container if profiles were added after build
3. Check file permissions

## Development

### Running Locally (Outside Docker)

```bash
cd mcp-server

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export PYTHONUNBUFFERED=1
export LOG_LEVEL=DEBUG

# Run server
python -m src.server
```

### Testing Individual Tools

```python
import asyncio
from src.tools.agents import list_agents_tool

async def test():
    agents = await list_agents_tool()
    print(agents)

asyncio.run(test())
```

## Security Considerations

- JWT secrets should be strong and unique per agent
- MCP server has read-only access to config/logs
- All API calls use JWT authentication
- No direct database access
- Runs in isolated Docker container

## License

Same as parent SD-WAN Traffic Generator project

## Support

For issues or questions, see the main project repository.
