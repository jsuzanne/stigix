# Feasibility Study: Integrated AI Prompt Window for Stigix

## Overview
The goal is to provide a "no-setup" AI experience where a user can dialogue with a Stigix node directly from the Web Dashboard, without needing Claude Desktop or a local development environment.

## 1. Technical Architecture
The proposed solution uses a **Client-Server-Agent** model:

- **Frontend (UI)**: A React-based chat window integrated into the `web-dashboard`.
- **Backend (Orchestrator)**: The existing Dashboard Node.js server, acting as an **MCP Client**.
- **Agent (Stigix MCP)**: The Python MCP server already running on the node.
- **LLM API**: Integration with Anthropic (Claude) or OpenAI API (via the backend).

### Workflow
1. **User Input**: User types "Start a speedtest to DC1" in the dashboard chat.
2. **LLM Reasoning**: The Dashboard backend sends the prompt + tool schemas (from MCP) to the LLM (API).
3. **Tool Call**: The LLM returns a tool call (e.g., `run_test`).
4. **Execution**: The Dashboard backend executes the tool via its internal MCP Client connection to the local Python MCP server.
5. **Response**: The LLM summarizes the result and displays it in the chat UI.

## 2. Feasibility Assessment

### Connectivity & Ease of Use (High Feasibility)
- **Zero Config**: Users don't need to touch `claude_desktop_config.json`.
- **Universal**: Works on any browser (Mobile, Mac, PC).
- **Remote Access**: Since the Dashboard is already exposed, the AI is naturally available remotely.

### Security (High Feasibility)
- **API Keys**: LLM keys are stored as secrets in the Stigix environment/Docker, never exposed to the client.
- **RBAC**: Tool execution can be gated by the existing dashboard authentication.

### Implementation Effort (Moderate)
- **UI**: Requires a new `Chat.tsx` component and a sidebar/floating window.
- **Backend**: Requires implementing the `@modelcontextprotocol/sdk` in the Node.js API to bridge with the local Python server.

## 3. Options for Non-Dev Users (Current State)
For those who still want to use Claude Desktop without a dev environment:

1. **Standard One-Liner (Node.js)**: If they have Node installed, they can use:
   `npx -y @modelcontextprotocol/inspector http://<IP>:3100/sse`
   *(This acts as a universal bridge for Claude Desktop).*
2. **Docker Bridge**: We can provide a one-liner to run the bridge in a tiny container.

## 4. Recommendation
L'**Integrated Prompt Window** est le "Graal" pour ton Dashboard. Cela transforme Stigix en un assistant réseau autonome présent sur toutes les instances.

**Prochaines étapes suggérées** :
1. Choisir un emplacement UI (onglets, bouton flottant ?).
2. Définir comment l'utilisateur entre sa clé API (Authropic/OpenAI).
3. Créer un prototype de Client MCP dans le backend Node.js.
