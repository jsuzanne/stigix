"""
Pytest fixtures for MCP contract tests.

Launches the mock Stigix nodes and the MCP harness as session-scoped fixtures.
Uses a persistent event loop to keep the MCP session alive across all tests.
"""

import asyncio
import logging
import os
import sys
import threading
import time
from typing import Dict

import httpx
import pytest
import uvicorn
import yaml

# Add tests/ to path for local imports
sys.path.insert(0, os.path.dirname(__file__))

from mock_stigix_node import create_app
from mcp_harness import MCPTestHarness, ToolEntry, _generate_args_from_schema, _timeout_class_to_ms

logger = logging.getLogger(__name__)

MOCK_PRIMARY_PORT = 19080
MOCK_CANARY_PORT = 19081
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "tools_manifest.yaml")


# ---------------------------------------------------------------------------
# Persistent event loop for session-scoped async resources
# ---------------------------------------------------------------------------

class _EventLoopThread:
    """Runs an asyncio event loop in a background thread.
    Allows synchronous fixtures to schedule coroutines on it."""

    def __init__(self):
        self.loop = None
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        # Wait until the loop is running
        for _ in range(50):
            if self.loop is not None and self.loop.is_running():
                return
            time.sleep(0.1)
        raise RuntimeError("Event loop thread did not start in time")

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run_coroutine(self, coro, timeout=60):
        """Schedule a coroutine on the background loop and wait for the result."""
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result(timeout=timeout)

    def stop(self):
        if self.loop and self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
        if self._thread:
            self._thread.join(timeout=5)


# ---------------------------------------------------------------------------
# Mock server runners (background threads)
# ---------------------------------------------------------------------------

def _run_mock_server(port: int, node_id: str):
    """Run a mock Stigix node in a background thread."""
    app = create_app(port=port, node_id=node_id)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    server.run()


# ---------------------------------------------------------------------------
# Mock admin client (switch modes, read requests)
# ---------------------------------------------------------------------------

class MockAdmin:
    """HTTP client for controlling mock Stigix nodes during tests."""

    def __init__(self, port: int, loop_thread: _EventLoopThread):
        self.base = f"http://127.0.0.1:{port}"
        self._loop_thread = loop_thread

    async def _set_mode(self, mode: str, slow_delay: float = 15.0):
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{self.base}/admin/set-mode",
                json={"mode": mode, "slow_delay": slow_delay},
            )
            r.raise_for_status()
            return r.json()

    async def _get_requests(self):
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{self.base}/admin/requests")
            r.raise_for_status()
            return r.json()

    async def _clear_requests(self):
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.delete(f"{self.base}/admin/requests")
            r.raise_for_status()

    def set_mode(self, mode: str, slow_delay: float = 15.0):
        return self._loop_thread.run_coroutine(self._set_mode(mode, slow_delay))

    def get_requests(self):
        return self._loop_thread.run_coroutine(self._get_requests())

    def clear_requests(self):
        return self._loop_thread.run_coroutine(self._clear_requests())


# ---------------------------------------------------------------------------
# Harness wrapper (synchronous interface over async MCP client)
# ---------------------------------------------------------------------------

class SyncHarness:
    """Synchronous wrapper around the async MCPTestHarness.
    Schedules all MCP calls on a persistent event loop thread."""

    def __init__(self, harness: MCPTestHarness, loop_thread: _EventLoopThread):
        self._harness = harness
        self._loop_thread = loop_thread

    @property
    def tools(self):
        return self._harness._tools

    def call_tool(self, name, args, timeout_ms=30_000):
        return self._loop_thread.run_coroutine(
            self._harness.call_tool(name, args, timeout_ms=timeout_ms),
            timeout=max(timeout_ms / 1000 + 10, 60),
        )

    def health_probe(self):
        return self._loop_thread.run_coroutine(
            self._harness.health_probe(),
            timeout=30,
        )

    def disconnect(self):
        try:
            self._loop_thread.run_coroutine(self._harness.disconnect(), timeout=10)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Session-scoped fixtures (all synchronous)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def event_loop_thread():
    """Persistent event loop thread for the entire test session."""
    lt = _EventLoopThread()
    lt.start()
    yield lt
    lt.stop()


@pytest.fixture(scope="session")
def mock_servers():
    """Start mock-primary (19080) and mock-canary (19081) in background threads."""
    primary_thread = threading.Thread(
        target=_run_mock_server,
        args=(MOCK_PRIMARY_PORT, "mock-primary"),
        daemon=True,
    )
    canary_thread = threading.Thread(
        target=_run_mock_server,
        args=(MOCK_CANARY_PORT, "mock-canary"),
        daemon=True,
    )

    primary_thread.start()
    canary_thread.start()

    # Wait for servers to be ready
    for port in [MOCK_PRIMARY_PORT, MOCK_CANARY_PORT]:
        for attempt in range(30):
            try:
                r = httpx.get(f"http://127.0.0.1:{port}/admin/mode", timeout=1.0)
                if r.status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        else:
            pytest.fail(f"Mock server on port {port} did not start within 6 seconds")

    yield {
        "primary_port": MOCK_PRIMARY_PORT,
        "canary_port": MOCK_CANARY_PORT,
    }


@pytest.fixture(scope="session")
def mock_admin(mock_servers, event_loop_thread):
    """MockAdmin client for the primary mock node."""
    return MockAdmin(mock_servers["primary_port"], event_loop_thread)


@pytest.fixture(scope="session")
def canary_admin(mock_servers, event_loop_thread):
    """MockAdmin client for the canary mock node."""
    return MockAdmin(mock_servers["canary_port"], event_loop_thread)


@pytest.fixture(scope="session")
def harness(mock_servers, event_loop_thread) -> SyncHarness:
    """Connect the MCP test harness to server.py over stdio."""
    h = MCPTestHarness(
        mock_port=mock_servers["primary_port"],
        canary_port=mock_servers["canary_port"],
    )
    tools = event_loop_thread.run_coroutine(h.connect(), timeout=30)
    logger.info(f"Harness connected. {len(tools)} tools discovered.")
    sync_h = SyncHarness(h, event_loop_thread)
    yield sync_h
    sync_h.disconnect()


# ---------------------------------------------------------------------------
# Tool manifest loading
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def tool_manifest() -> Dict[str, dict]:
    """Load and validate the tools manifest."""
    if not os.path.exists(MANIFEST_PATH):
        pytest.skip(f"Manifest not found: {MANIFEST_PATH}. Run generate_manifest.py first.")

    with open(MANIFEST_PATH) as f:
        data = yaml.safe_load(f)

    return data.get("tools", {})


@pytest.fixture(scope="session")
def tool_entries(harness, tool_manifest) -> list:
    """Build ToolEntry objects by merging discovered tools with manifest metadata."""
    entries = []
    discovered_names = {t.name for t in harness.tools}
    manifest_names = set(tool_manifest.keys())

    # Fail if any discovered tool is missing from manifest
    missing = discovered_names - manifest_names
    if missing:
        pytest.fail(
            f"Tools discovered by list_tools but MISSING from tools_manifest.yaml: {sorted(missing)}. "
            f"Run: python tests/generate_manifest.py"
        )

    for tool in harness.tools:
        manifest_entry = tool_manifest.get(tool.name, {})
        schema = tool.inputSchema if hasattr(tool, "inputSchema") else {}

        category = manifest_entry.get("category", "read")
        timeout_class = manifest_entry.get("timeout_class", "fast")
        size_budget = manifest_entry.get("size_budget_kb", 20)

        entry = ToolEntry(
            name=tool.name,
            input_schema=schema,
            category=category,
            timeout_class=timeout_class,
            timeout_ms=_timeout_class_to_ms(timeout_class),
            size_budget_kb=size_budget,
            default_args=_generate_args_from_schema(schema, tool.name),
            safe_defaults=manifest_entry.get("safe_defaults", True),
        )
        entries.append(entry)

    return entries
