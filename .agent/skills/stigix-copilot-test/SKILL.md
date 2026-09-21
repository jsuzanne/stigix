---
name: stigix-copilot-test
description: >
  Guide for executing, extending, and maintaining the automated Stigix Copilot & FastMCP test suite
  (web-dashboard/tests/test-copilot-suite.ts). Use whenever AI Copilot tools (ai-tools.ts) or FastMCP tools
  (mcp-server/src/server.py) evolve, or to validate live Stigix instances autonomously.
---

# Stigix AI Copilot & MCP Automated Test Suite Skill

This skill defines the process for running, adding to, and maintaining the end-to-end automated test runner for Stigix AI Copilot and MCP tool integration.

## Purpose & Scope

The test suite (`web-dashboard/tests/test-copilot-suite.ts`) provides automated verification of:
1. **Core REST endpoints**: Fabric targets, mesh peer discovery, traffic generator state, security posture, DEM probes, VyOS underlays, speedtest jobs, and convergence probe lifecycle.
2. **AI Copilot & FastMCP Tool Execution**: Validates that all in-app TypeScript tools (`ai-tools.ts`) and Python FastMCP tools (`server.py`) execute properly against real node contexts, handle multi-node URL/IP routing, format telemetry metrics correctly, and enforce proper sorting (newest first).

---

## Running the Test Suite

### Command Syntax

Execute the test suite using `npx tsx` within the `web-dashboard` directory:

```bash
cd web-dashboard

# Run against a remote node with credentials (e.g., BR8)
npx tsx tests/test-copilot-suite.ts --host=http://192.168.123.102:8080 --user=admin --pass=admin

# Run against localhost
npx tsx tests/test-copilot-suite.ts --host=http://localhost:8080 --user=admin --pass=admin

# Run with a pre-generated JWT Token
npx tsx tests/test-copilot-suite.ts --host=http://192.168.123.102:8080 --token=<JWT_TOKEN>
```

## Mandatory Regression Policy: Test On Every Bug (TDD)

> [!IMPORTANT]
> **Golden Rule**: Every single bug fix, edge case, or user-reported issue related to Copilot tools, FastMCP, or API endpoints **MUST** have a corresponding automated regression test added to `web-dashboard/tests/test-copilot-suite.ts`.
>
> 1. **Identify the exact failing scenario** (e.g. invalid parameter parsing, wrong endpoint route, sorting bug, lifecycle crash).
> 2. **Implement the fix** in `ai-tools.ts` or `server.ts`.
> 3. **Add a dedicated test case** in `test-copilot-suite.ts` reproducing the exact call sequence.
> 4. **Execute against live node** (`npx tsx tests/test-copilot-suite.ts ...`) to confirm 100% PASS before committing.

---

## When to Use & Update

1. **Every Bug Fix**:
   - Whenever any tool error, 403/502/HTML response, routing issue, or missing field is fixed, add a targeted regression test.
2. **New Copilot/MCP Tools Added**:
   - When tools are added to `ai-tools.ts` or `mcp-server/src/server.py`, add a corresponding assertion in Section 2 of `test-copilot-suite.ts`.
3. **API Endpoint Schema or Route Changes**:
   - When modifying backend routes in `server.ts` or CLI endpoints, update both `ai-tools.ts` fallback mappings and the relevant suite assertions.
4. **Pre-Release Validation**:
   - Run the suite before tagging or merging to ensure 100% PASS across all sections.

---

## Test Suite Structure

The test suite is organized into two primary phases:

### Section 1: Core REST Endpoints
Validates raw HTTP APIs directly with JWT authentication:
- `GET /api/registry/status` (Mesh discovery)
- `GET /api/admin/targets` (Targets list)
- `GET /api/traffic/status` (Traffic generator)
- `GET /api/security/profile` (SASE security posture)
- `GET /api/probes` (DEM probes)
- `GET /api/vyos/routers` (VyOS underlay)
- **Convergence Lifecycle**: `POST /api/convergence/start` (UDP 6200 probe) ➔ `GET /api/convergence/status` ➔ `POST /api/convergence/stop` ➔ `GET /api/convergence/history` (metrics extraction).
- `GET /api/tests/xfr` (Speedtest history)

### Section 2: AI Copilot Tool Handlers Execution
Simulates the In-App AI Copilot invoking tools via `executeCopilotTool(toolName, args, remoteCtx)`:
- Node context routing (`resolveNodeContext` supporting `http://`, `https://`, and `IP:Port`).
- Bearer token forwarding for inter-node communication.
- Sorting verification (Speedtest & Convergence history sorted newest-first).

---

## Adding New Tests to `test-copilot-suite.ts`

When adding a new tool `my_new_tool`:

```typescript
// In web-dashboard/tests/test-copilot-suite.ts (Section 2)
await this.runTest('16. Tool "my_new_tool" (Description)', async () => {
    const res = await executeCopilotTool('my_new_tool', { agent_id: this.host, ...params }, remoteCtx);
    if (res.error) throw new Error(res.error);
    // Add specific schema / field assertions:
    if (res.expectedField === undefined) throw new Error('Missing expectedField');
    return res;
});
```

---

## Verification Checklist

- [ ] All tests pass (`15/15 PASS` or higher).
- [ ] No hardcoded passwords or sensitive tokens stored in git.
- [ ] TypeScript compiles cleanly (`npm run build` in `web-dashboard`).
- [ ] Changes committed to branch `v2`.
