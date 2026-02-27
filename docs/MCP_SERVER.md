# MCP Server for SD-WAN Traffic Generator

**Model Context Protocol (MCP) Server for Multi-Agent Orchestration**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Natural Language Examples](#natural-language-examples)
- [Available Tools](#available-tools)
- [Traffic Profiles](#traffic-profiles)
- [Claude Desktop Setup](#claude-desktop-setup)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Overview

The MCP Server provides a **natural language interface** to orchestrate multiple SD-WAN traffic generator instances simultaneously. Using Claude Desktop, you can manage traffic tests across multiple sites with simple conversational commands.

### Key Features

✅ **Multi-Agent Orchestration** - Control multiple traffic generators from one interface  
✅ **Natural Language** - Use plain English/French with Claude Desktop  
✅ **Zero Code Changes** - Completely independent, communicates via REST APIs only  
✅ **Traffic Profiles** - Pre-configured templates for voice, IoT, enterprise traffic  
✅ **Test Management** - Start, stop, monitor coordinated tests  
✅ **Read-Only Safety** - Uses read-only volumes for existing config/logs  

---

## Architecture

```
┌─────────────────────┐
│  Claude Desktop     │  Natural Language Interface
│  (User)             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  MCP Server         │  Python 3.12 + MCP Protocol
│  (Docker Container) │
└──────────┬──────────┘
           │
           ▼ REST APIs (JWT Auth)
┌─────────────────────────────────────┐
│  Traffic Generator Agents           │
│  ┌─────────┐  ┌─────────┐  ┌──────┐│
│  │ Paris   │  │ London  │  │ NYC  ││
│  └─────────┘  └─────────┘  └──────┘│
└─────────────────────────────────────┘
```

**Communication Flow:**
1. User speaks to Claude Desktop in natural language
2. Claude calls MCP tools (list_agents, start_test, etc.)
3. MCP Server authenticates with JWT tokens
4. REST API calls to each traffic generator agent
5. Results aggregated and returned to Claude

---

## Quick Start

### 1. Build the MCP Server

```bash
cd /path/to/stigix
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
      "url": "http://sdwan-web-ui:8080",
      "jwt_secret": "your-jwt-secret-from-docker-compose"
    }
  ]
}
```

> **Note**: The `jwt_secret` must match the `JWT_SECRET` environment variable in your docker-compose.yml for each agent.

### 3. Start the MCP Server

```bash
# Option 1: Start with demo profile (recommended for testing)
docker compose --profile demo up -d

# Option 2: Add mcp-server to default services (remove profiles: ["demo"] from docker-compose.yml)
docker compose up -d
```

### 4. Verify It's Running

```bash
docker compose logs mcp-server
# Should see: "MCP Server ready (stdio transport)"
```

---

## Configuration

### Agent Configuration (`config/agents.json`)

Each agent requires:

| Field | Description | Example |
|-------|-------------|---------|
| `id` | Unique identifier | `"paris"` |
| `name` | Human-readable name | `"Paris Branch"` |
| `url` | Base URL of web-ui API | `"http://sdwan-web-ui-paris:8080"` |
| `jwt_secret` | JWT secret for auth | `"your-secret-key"` |

**Multi-Agent Example:**

```json
{
  "agents": [
    {
      "id": "paris",
      "name": "Paris Branch",
      "url": "http://sdwan-web-ui-paris:8080",
      "jwt_secret": "paris-secret-123"
    },
    {
      "id": "london",
      "name": "London Branch",
      "url": "http://sdwan-web-ui-london:8080",
      "jwt_secret": "london-secret-456"
    },
    {
      "id": "nyc",
      "name": "New York Office",
      "url": "http://sdwan-web-ui-nyc:8080",
      "jwt_secret": "nyc-secret-789"
    }
  ]
}
```

---

## Natural Language Examples

### List Available Agents

**English**: "What agents are available?"  
**French**: "Quels sont les agents disponibles ?"

**Claude calls**: `list_agents()`

**Response**:
```json
[
  {"id": "paris", "name": "Paris Branch", "status": "running"},
  {"id": "london", "name": "London Branch", "status": "stopped"}
]
```

---

### Start a Traffic Test

**English**: "Start a 3-minute voice test on Paris and London"  
**French**: "Lance un test voix de 3 minutes sur Paris et London"

**Claude calls**: `start_traffic_test(agents=["paris", "london"], profile="voice", duration_minutes=3)`

**Response**:
```json
{
  "test_id": "test-20260205-1015",
  "message": "Test started on 2/2 agent(s)"
}
```

---

### Check Test Status

**English**: "Show me the stats for the current test"  
**French**: "Montre-moi les stats du test en cours"

**Claude calls**: `get_test_status()`

**Response**:
```json
{
  "id": "test-20260205-1015",
  "status": "running",
  "elapsed_seconds": 125,
  "agents": [
    {
      "id": "paris",
      "stats": {"total_requests": 850, "success_rate": 98.2}
    }
  ]
}
```

---

### Stop a Test

**English**: "Stop test test-20260205-1015"  
**French**: "Arrête le test test-20260205-1015"

**Claude calls**: `stop_traffic_test(test_id="test-20260205-1015")`

---

### List Recent Tests

**English**: "List the last 5 tests"  
**French**: "Liste les 5 derniers tests"

**Claude calls**: `list_tests(limit=5)`

---

### Change Traffic Profile

**English**: "Switch Paris to IoT profile"  
**French**: "Change Paris en profil IoT"

**Claude calls**: `set_traffic_profile(agent_id="paris", profile="iot")`

---

## Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_agents` | List all configured agents with status | None |
| `start_traffic_test` | Start coordinated test across agents | `agents`, `profile`, `duration_minutes`, `label?` |
| `stop_traffic_test` | Stop test and collect final stats | `test_id` |
| `get_test_status` | Get current test status | `test_id?` (defaults to current) |
| `list_tests` | List recent test runs | `limit?` (default: 10) |
| `set_traffic_profile` | Apply traffic profile to agent | `agent_id`, `profile` |

---

## Traffic Profiles

### Built-in Profiles

#### `voice` - VoIP/UC Applications
- Microsoft Teams
- Zoom
- Google Meet
- Webex

#### `iot` - IoT & Telemetry
- IoT sensors
- MQTT telemetry

#### `enterprise` - Enterprise SaaS
- Office 365
- Gmail
- Slack
- Salesforce
- GitHub

### Custom Profiles

Create custom profiles in `mcp-server/profiles/custom.txt`:

```
# Format: domain|weight|endpoint
myapp.example.com|100|/api/v1
internal.company.com|80|/health
monitoring.example.com|60|/metrics
```

Then use: `set_traffic_profile(agent_id="paris", profile="custom")`

---

## Claude Desktop Setup

### macOS Configuration

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sdwan-traffic-gen": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "sdwan-mcp",
        "python",
        "-m",
        "src.server"
      ]
    }
  }
}
```

### Windows Configuration

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same content.

### Restart Claude Desktop

After editing the config, **restart Claude Desktop** to load the MCP server.

### Verify Integration

In Claude Desktop, you should see the MCP server listed in the settings. Try asking:

> "List the available SD-WAN agents"

---

## Troubleshooting

### MCP Server Not Appearing in Claude Desktop

**Symptoms**: Claude doesn't recognize MCP commands

**Solutions**:
1. Check config file syntax (valid JSON)
2. Restart Claude Desktop completely
3. Check container is running: `docker compose ps | grep mcp`
4. Check logs: `docker compose logs mcp-server`

---

### Agent Connection Errors

**Symptoms**: "Failed to get status for agent X"

**Solutions**:
1. Verify `config/agents.json` URLs are correct
2. Check JWT secrets match docker-compose.yml
3. Ensure agents are running: `docker compose ps`
4. Test API manually:
   ```bash
   curl http://localhost:8080/api/status
   ```

---

### Profile Not Found

**Symptoms**: "Profile not found: X"

**Solutions**:
1. Check profile exists: `ls mcp-server/profiles/`
2. Rebuild container if profiles were added after build:
   ```bash
   docker compose build mcp-server
   docker compose up -d mcp-server
   ```
3. Check file permissions

---

### Test Not Starting

**Symptoms**: "Test started on 0/2 agent(s)"

**Solutions**:
1. Check agent status: `list_agents()`
2. Verify JWT authentication is working
3. Check agent logs: `docker compose logs sdwan-web-ui`
4. Ensure `applications.txt` exists on each agent

---

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

### Adding New Tools

1. Create tool function in `src/tools/`
2. Register in `src/server.py`:
   - Add to `list_tools()`
   - Add to `call_tool()`
3. Rebuild container
4. Restart Claude Desktop

---

## Security Considerations

- ✅ JWT secrets should be strong and unique per agent
- ✅ MCP server has read-only access to config/logs
- ✅ All API calls use JWT authentication
- ✅ No direct database access
- ✅ Runs in isolated Docker container
- ✅ Optional profile prevents accidental startup

---

## File Structure

```
mcp-server/
├── src/
│   ├── server.py              # Main MCP server
│   ├── types.py               # Pydantic models
│   ├── lib/
│   │   ├── config.py          # Agent configuration
│   │   ├── storage.py         # Test persistence
│   │   └── agent_client.py    # HTTP client
│   └── tools/
│       ├── agents.py          # list_agents tool
│       ├── tests.py           # Test management tools
│       └── profiles.py        # Profile management
├── profiles/                  # Traffic profile templates
│   ├── voice.txt
│   ├── iot.txt
│   └── enterprise.txt
├── Dockerfile
├── requirements.txt
└── README.md
```

---

## Next Steps

1. ✅ Configure `config/agents.json`
2. ✅ Start MCP server with `--profile demo`
3. ✅ Configure Claude Desktop
4. ✅ Test with "List available agents"
5. ✅ Run your first coordinated test

---

**For more information**, see:
- Main project: [README.md](../README.md)
- MCP Protocol: https://modelcontextprotocol.io
- Claude Desktop: https://claude.ai/desktop
