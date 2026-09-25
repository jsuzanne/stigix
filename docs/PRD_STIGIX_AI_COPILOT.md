> **Last Updated:** 2026-09-20 | **Created:** 2026-09-20 (v2.0.55)

# PRD — Stigix In-App AI Copilot (BYO Key) & Dual-Mode Architecture

**Document Status:** Approved Specification / Ready for Implementation  
**Target Milestone:** Stigix V2.x  
**Components:** `web-dashboard` (UI, Express Server), `mcp-server` (Tool Registry), `config/` (Secure Key Storage)  
**Author:** Stigix Core Engineering Team  

---

## 1. Executive Summary & Objective

The **Stigix In-App AI Copilot** brings a native, interactive conversational assistant directly inside the Stigix Web Dashboard. Network and security engineers can orchestrate multi-site traffic generation, inject network impairments on VyOS routers, audit SASE security postures, and diagnose SD-WAN convergence using natural language — **without installing external desktop applications or setting up complex SSH tunnels/network proxies**.

### Key Tenets
1. **Bring Your Own Key (BYOK)**: Users provide their own Anthropic Claude API Key (`sk-ant-...`) stored securely on the node.
2. **Dual-Mode Coexistence**: Users can choose between:
   - **Mode 1 (In-App Copilot)**: Web-native chat interface accessible on any device (laptop, tablet, mobile).
   - **Mode 2 (External MCP Server)**: Power-user integration with Claude Desktop, Cursor, and IDEs via port 3100 (SSE/STDIO).
3. **Unified Tool Engine**: Both modes share the exact same underlying 53+ networking, VyOS, and telemetry tools.
4. **Human-in-the-Loop Safety**: High-impact actions (e.g., shutting router interfaces, stopping critical workloads) require explicit UI approval.

---

## 2. Security Architecture & Threat Model

Handling third-party LLM API keys in an open-source networking tool requires strict security isolation.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SECURITY PERIMETER                              │
│                                                                        │
│   [ User Browser ]                                                     │
│         │                                                              │
│         │ Stigix JWT Authenticated (HTTPS/WSS)                         │
│         ▼                                                              │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Stigix Backend (Node.js Express)                               │   │
│   │                                                                │   │
│   │  • Secure Storage: config/ai-config.json (chmod 600, Gitignored│   │
│   │  • Key Masking: UI only receives sk-ant-api03-••••••-XXXX     │   │
│   │  • Action Guardrails: Destructive tools require confirmation   │   │
│   │  • Outbound Only: Direct HTTPS to api.anthropic.com:443       │   │
│   │  • Secret Sanitization: Keys redacted from server logs/traces  │   │
│   └────────────────────────┬───────────────────────────────────────┘   │
│                            │                                           │
└────────────────────────────┼───────────────────────────────────────────┘
                             │ Outbound TLS 1.3
                             ▼
               [ Anthropic API (Claude) ]
```

### 2.1 Security Principles & Safeguards

| Threat Vector | Mitigation Strategy |
|---|---|
| **API Key Leakage to Browser** | The raw API key is **never** sent to the client browser after initial saving. The Settings API returns a masked token (`sk-ant-••••••••••••aB3d`). |
| **API Key Leakage in Git / Repositories** | `config/ai-config.json` and `.env` are strictly included in `.gitignore`. Stigix Secret Guard blocks any commit matching `sk-ant-` or Anthropic token patterns. |
| **Prompt Injection / Unauthorized Router Actions** | The LLM cannot autonomously execute destructive commands (e.g. `vyos_chaos: interface-down`, `delete_target`). The backend intercepts high-risk tool calls and generates an interactive **Approval Request** requiring explicit user confirmation in the UI. |
| **Server-Side API Proxying** | The client browser never communicates directly with Anthropic. All LLM calls originate from the Stigix backend container via outbound HTTPS (port 443), eliminating CORS issues and hiding credentials. |
| **Rate Limiting & Cost Control** | Configurable daily token cap and per-session max history limit to prevent runaway API costs. |

---

## 3. Architecture & Dual-Mode Coexistence

```text
                                  ┌───────────────────────────┐
                                  │   Stigix Core Tool Base   │
                                  │ (53 Tools: VyOS, Traffic, │
                                  │  Security, Probes, SLA...)│
                                  └─────────────┬─────────────┘
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        ▼                                               ▼
         ┌─────────────────────────────┐                 ┌─────────────────────────────┐
         │ Mode 1 : In-App AI Copilot  │                 │ Mode 2 : External MCP Server│
         │ (Web Chat Drawer / Modal)   │                 │ (FastMCP SSE on Port 3100)  │
         ├─────────────────────────────┤                 ├─────────────────────────────┤
         │ • @anthropic-ai/sdk Engine  │                 │ • Claude Desktop Client     │
         │ • Server-Sent Events Stream │                 │ • Local / SSH Bridge Script │
         │ • Interactive UI Cards      │                 │ • Full Headless Automation  │
         │ • 0 Network / Proxy Setup   │                 │ • Multi-Agent Workflows     │
         └─────────────────────────────┘                 └─────────────────────────────┘
```

---

## 4. User Experience & UI Specification

### 4.1 Chat Window Layout
The Copilot is accessible from anywhere in the Stigix dashboard:
1. **Floating Action Button (FAB)**: Located in the bottom-right corner (`🤖 Ask Stigix AI`) with unread status indicators.
2. **Slide-Out Drawer & Fullscreen Toggle**: Expandable glassmorphism drawer (450px default width) or full-view modal with dark/light theme support.
3. **Model Selector (Top Bar)**:
   - ⚡ **Claude 3.5 Sonnet** (Default — Fast, accurate, cost-effective)
   - 🧠 **Claude 3.7 Sonnet** (Advanced Reasoning & Multi-Step Diagnostics)
   - 🔬 **Claude 3.7 Opus** (Deep Architecture & PoC Report Synthesis)
4. **Context Badge**: Displays local site identity (e.g. `📍 Site: BR8-Ubuntu · 8 Peers Active`).

### 4.2 Interactive Message Cards
Instead of static plain text, the Copilot renders native interactive cards:
* **Tool Execution Badge**: `[ ⚡ Running: vyos_chaos (Latency +120ms on BR8-MPLS) ]` with live spinner.
* **Confirmation Guard Card**:
  ```text
  ┌─────────────────────────────────────────────────────────────┐
  │ ⚠️  Destructive Action Approval Required                    │
  │ Action: Shut down interface eth1 (BR8-MPLS) on VyOS router  │
  │ [ ✅ Confirm & Execute ]           [ ❌ Cancel Action ]      │
  └─────────────────────────────────────────────────────────────┘
  ```
* **Rich Diagnostic Summaries**: Inline tables, status pills (🟢/🟡/🔴), and 1-click clipboard copy buttons.
* **Quick Prompts Carousel**: Pre-loaded starter prompts (*"Summarize mesh connectivity"*, *"Run 30s failover test BR8 ➔ DC1"*, *"Audit security posture"*).

---

## 5. Settings Configuration Specification

In **Settings ➔ AI & Copilot**, operators configure the dual-mode environment:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 🤖 Stigix AI Copilot & MCP Configuration                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ ── Mode 1: In-App AI Copilot (Web Chat) ────────────────────────────── │
│                                                                        │
│ [x] Enable In-App AI Copilot                                           │
│                                                                        │
│ Anthropic API Key:                                                     │
│ [ sk-ant-api03-•••••••••••••••••••••••••••••••••••••••• ] [ Test Key ] │
│ 🔒 Key is encrypted and stored locally. Never shared or exported.      │
│                                                                        │
│ Default Model:                                                         │
│ (•) Claude 3.5 Sonnet (Recommended)                                   │
│ ( ) Claude 3.7 Sonnet (Thinking)                                      │
│ ( ) Claude 3.7 Opus                                                    │
│                                                                        │
│ Safety Guardrails:                                                     │
│ [x] Require manual confirmation before destructive network actions     │
│ [x] Inject live mesh topology context into system prompt               │
│                                                                        │
│ ── Mode 2: External MCP Server (Claude Desktop) ─────────────────────── │
│                                                                        │
│ Status: 🟢 Running (Port 3100 SSE)                                     │
│ Active Connections: 1 client connected                                 │
│                                                                        │
│ Claude Desktop Configuration:                                          │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ "stigix-br8": {                                                    │ │
│ │   "command": "npx",                                                │ │
│ │   "args": ["-y", "mcp-remote", "http://localhost:3100/sse"]        │ │
│ │ }                                                                  │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ [ 📋 Copy Configuration JSON ]                                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Backend API Specification

### 6.1 Endpoints

#### `GET /api/ai/config`
Retrieves AI configuration status (API key is always masked).
* **Response:**
  ```json
  {
    "enabled": true,
    "hasKey": true,
    "maskedKey": "sk-ant-api03-••••••••-AA",
    "defaultModel": "claude-3-5-sonnet-20241022",
    "requireConfirmation": true
  }
  ```

#### `POST /api/ai/config`
Saves or updates API key and preferences.
* **Payload:**
  ```json
  {
    "enabled": true,
    "apiKey": "sk-ant-api03-xxxx",
    "defaultModel": "claude-3-5-sonnet-20241022",
    "requireConfirmation": true
  }
  ```

#### `POST /api/ai/test-key`
Validates the API key against Anthropic API without saving.

#### `POST /api/ai/chat` (SSE Streaming)
Streams conversational responses, tool calls, and final completions.
* **Payload:**
  ```json
  {
    "messages": [
      { "role": "user", "content": "List all active targets and their services" }
    ],
    "model": "claude-3-5-sonnet-20241022",
    "confirmedActionId": null
  }
  ```
* **Event Stream (`text/event-stream`):**
  - `event: text_delta` — Incremental markdown text chunks.
  - `event: tool_start` — Notification that a tool is being executed (`{ tool: "list_endpoints", params: {} }`).
  - `event: tool_confirm_required` — High-impact tool paused waiting for user approval.
  - `event: tool_complete` — Tool output delivered back to LLM context.
  - `event: done` — Generation complete.

---

## 7. Implementation Roadmap & Phases

| Phase | Scope | Deliverables |
|---|---|---|
| **Phase 1: Backend Foundation & BYOK Storage** | Node.js `@anthropic-ai/sdk` integration, secure `config/ai-config.json` storage, API key validation endpoint, and Express SSE streaming handler. | `ai-manager.ts`, `ai-routes.ts` |
| **Phase 2: Unified Tool Dispatcher** | Bridge all 53 Stigix tools (CLI / MCP definitions) into Anthropic tool schema format with automated execution and confirmation guards. | `ai-tools-catalog.ts` |
| **Phase 3: Frontend Settings UI** | Settings ➔ AI & Copilot tab with masked key management, test connection button, and model selection. | `Settings.tsx` (AI Tab) |
| **Phase 4: In-App Chat Drawer & Interactive Cards** | Glassmorphism chat drawer (`AiCopilotDrawer.tsx`), markdown streaming renderer, tool execution badges, and approval modal. | `AiCopilotDrawer.tsx` |
| **Phase 5: Validation & Testing** | Comprehensive end-to-end testing against multi-branch topologies (BR8, DC1, BR5) and Secret Guard verification. | CI/CD build & docs update |

---

## 8. Conclusion

This architecture gives Stigix users the ultimate flexibility: **zero-setup instant browser AI** for everyday operations and **powerful desktop MCP** for advanced workflows, while keeping security and API key control firmly in the hands of the operator.
