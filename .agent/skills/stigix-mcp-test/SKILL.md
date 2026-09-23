---
name: stigix-mcp-test
description: >
  Mandatory checklist for any change to the Stigix MCP server (server.py tools,
  orchestrator.py, tools_manifest.yaml, mock_stigix_node.py).
  Run this skill BEFORE committing: it validates tool contracts, catches schema
  regressions, and ensures the manifest stays in sync with the implementation.
  Activate whenever @mcp.tool() functions are added, modified, or removed, or
  whenever orchestrator methods that back MCP tools change their response shape.
---

# Stigix MCP Test Skill

Use this skill **every time** you:
- Add or rename a `@mcp.tool()` function in `src/server.py`
- Modify an orchestrator method that backs an MCP tool (response shape, new keys, error format)
- Edit `tools_manifest.yaml` (args, expected_keys, skip flags)
- Edit `mock_stigix_node.py` (mock routes, response data)

> [!IMPORTANT]
> **Never commit MCP changes without running this checklist first.**
> The test suite runs in ~3 seconds with no live infrastructure required.

---

## Step 1 — Run the nominal suite

```bash
cd /Users/jsuzanne/Github/stigix/mcp-server
.venv/bin/pytest tests/test_mcp_nominal.py -v --timeout=300
```

**Expected baseline**: `79 passed, 2 skipped` (or more if new tools were added).

If any test **fails**, do NOT commit. Fix the root cause first (see Step 3).

---

## Step 2 — Check manifest coverage

After adding a new tool, verify it appears in the manifest **with** `nominal_args`:

```bash
cd /Users/jsuzanne/Github/stigix/mcp-server
python3 - << 'EOF'
import yaml, re

with open("src/server.py") as f:
    src = f.read()
tool_fns = re.findall(r'@mcp\.tool\(\)\s+async def (\w+)', src)

with open("tests/tools_manifest.yaml") as f:
    manifest = yaml.safe_load(f).get("tools", {})

missing    = [t for t in tool_fns if t not in manifest]
no_nominal = [t for t in tool_fns
              if t in manifest
              and manifest[t].get("nominal_args") is None
              and not manifest[t].get("skip_nominal")]

if missing:
    print("NOT IN MANIFEST:", missing)
if no_nominal:
    print("NO nominal_args (and not skip_nominal):", no_nominal)
if not missing and not no_nominal:
    print("All tools covered in manifest")
EOF
```

**Fix**: For each missing or uncovered tool, add an entry to `tests/tools_manifest.yaml`.
Use the Quick reference template at the bottom of this file.

---

## Step 3 — Fixing a failing nominal test

The failure message always shows:
```
Nominal call to '<tool_name>' failed checks: ['<check_name>']
Response: {<actual response>}
```

| Check | Meaning | Typical Fix |
|-------|---------|-------------|
| `is_dict` | Response is a string (unhandled exception) | Fix tool/orchestrator — raises exception that FastMCP wraps as string |
| `no_error` | Response contains `{"error": "..."}` | Check mock route shape, or orchestrator has a real bug |
| `expected_keys` | None of the expected keys are in response | Update `expected_keys` in manifest to match actual response |
| `timeout` | Tool took longer than `timeout_class` budget | Optimize or change `timeout_class` in manifest |
| `size` | Response exceeds `size_budget_kb` | Trim mock response or update the budget |

### Common root causes

**New tool but mock does not handle its endpoint:**
Add a route in `tests/mock_stigix_node.py` inside `_nominal_response()`.

**Orchestrator changed response shape:**
Update `expected_keys` in `tools_manifest.yaml` to match the new keys.

**Tool is state-dependent (requires a prior call):**
Set `skip_nominal: true` and add `skip_reason` in the manifest entry.

**Tool raises an unhandled exception (is_dict fails):**
Add a try/except in `server.py` or the orchestrator returning `{"error": str(e)}`.
FastMCP can only return dicts as tool results.

---

## Step 4 — Run targeted test for the modified tool

```bash
cd /Users/jsuzanne/Github/stigix/mcp-server
.venv/bin/pytest tests/test_mcp_nominal.py -k "<tool_name>" -v
```

Confirm it passes before proceeding to commit.

---

## Step 5 — Commit with the test result in the message

```bash
git add src/server.py tests/tools_manifest.yaml tests/mock_stigix_node.py
git commit -m "feat(mcp): add <tool_name> — 79/81 nominal tests pass"
```

Always mention the test result (`X passed, Y skipped`) in the commit message.

---

## Quick reference — manifest entry template

```yaml
  my_new_tool:
    category: read          # read | write | action
    scope: node             # node | vyos | security | voice | tcp
    min_node_version: "2.0.0"
    size_budget_kb: 20
    timeout_class: fast     # fast (2s) | medium (10s) | slow (30s)
    nominal_args:
      agent_id: mock-primary
      # add other required args here
    expected_keys: [key1, key2]   # at least one must appear in the response
    # skip_nominal: true          # uncomment if state-dependent
    # skip_reason: "Needs run_test to create state first"
    invalid_args:
      - agent_id: ""
      - agent_id: "'; DROP TABLE nodes; --"
```
