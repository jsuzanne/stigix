#!/usr/bin/env python3
"""
MCP Client Harness — Connects to the Stigix MCP server over stdio (like Claude Desktop)
and provides helpers for calling tools, timing responses, and health probing.
"""

import asyncio
import json
import os
import sys
import time
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


@dataclass
class ToolCallResult:
    """Result of a single MCP tool call."""
    tool_name: str
    args: Dict[str, Any]
    raw_content: list  # list of TextContent / etc.
    parsed: Any  # parsed JSON (dict or list or str)
    is_error: bool
    elapsed_ms: float
    size_bytes: int
    stdout_captured: str = ""


@dataclass
class ToolEntry:
    """A tool from the manifest + its discovered schema."""
    name: str
    input_schema: Dict[str, Any]
    category: str = "read"  # read | write | destructive
    timeout_class: str = "fast"  # fast | medium | long
    timeout_ms: float = 10_000
    size_budget_kb: float = 20.0
    default_args: Dict[str, Any] = field(default_factory=dict)
    safe_defaults: bool = True


def _timeout_class_to_ms(cls: str) -> float:
    return {"fast": 10_000, "medium": 60_000, "long": 120_000}.get(cls, 10_000)


def _generate_args_from_schema(schema: Dict[str, Any], tool_name: str) -> Dict[str, Any]:
    """
    Generate placeholder arguments from a JSON Schema.
    Only fills required fields. agent_id always gets 'mock-primary'.
    """
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    args = {}

    for prop_name, prop_schema in properties.items():
        if prop_name not in required:
            continue

        prop_type = prop_schema.get("type", "string")

        if prop_name in ("agent_id", "source_id", "agent_id_a"):
            args[prop_name] = "mock-primary"
        elif prop_name in ("agent_id_b", "target_id"):
            args[prop_name] = "mock-canary"
        elif prop_name == "test_id":
            args[prop_name] = "G-TEST-0001"
        elif prop_name in ("probe_name", "app_name", "scenario_id", "router_id",
                           "app_id", "peer_id", "target_name_or_host", "probe_type"):
            args[prop_name] = "test-placeholder"
        elif prop_name == "bundle_type":
            args[prop_name] = "connectivity-probes"
        elif prop_name == "profile":
            args[prop_name] = "CONV-001"
        elif prop_name == "target":
            args[prop_name] = "1.1.1.1"
        elif prop_type == "string":
            args[prop_name] = "test-string"
        elif prop_type == "integer":
            args[prop_name] = 1
        elif prop_type == "number":
            args[prop_name] = 1.0
        elif prop_type == "boolean":
            args[prop_name] = False
        elif prop_type == "array":
            args[prop_name] = []
        elif prop_type == "object":
            args[prop_name] = {}
        else:
            args[prop_name] = "test-string"

    return args


class MCPTestHarness:
    """
    Wraps the official MCP SDK to talk to the Stigix server over stdio.
    Mimics exactly how Claude Desktop connects.
    """

    def __init__(self, mock_port: int = 19080, canary_port: int = 19081):
        self.mock_port = mock_port
        self.canary_port = canary_port
        self._session: Optional[ClientSession] = None
        self._cm = None  # context manager from stdio_client
        self._read_stream = None
        self._write_stream = None
        self._tools: List[Any] = []
        self._stdout_buffer: str = ""

    async def connect(self) -> List[Any]:
        """Launch server.py as a subprocess and connect via MCP stdio."""
        server_path = os.path.join(os.path.dirname(__file__), "..", "src", "server.py")
        server_path = os.path.abspath(server_path)

        env = {
            **os.environ,
            "STIGIX_CONTROLLER_URL": f"http://127.0.0.1:{self.mock_port}",
            "JWT_SECRET": "test-harness-secret",
            "LOG_LEVEL": "WARNING",
            "LOG_DIR": "/tmp/stigix-mcp-test-logs",
            "MCP_TRANSPORT": "stdio",
            "PYTHONUNBUFFERED": "1",
        }

        python_path = sys.executable
        server_params = StdioServerParameters(
            command=python_path,
            args=["-m", "src.server"],
            env=env,
            cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
        )

        self._cm = stdio_client(server_params)
        self._read_stream, self._write_stream = await self._cm.__aenter__()
        self._session = ClientSession(self._read_stream, self._write_stream)
        await self._session.__aenter__()
        await self._session.initialize()

        tools_result = await self._session.list_tools()
        self._tools = tools_result.tools
        logger.info(f"MCP session connected. Discovered {len(self._tools)} tools.")
        return self._tools

    async def list_tools(self) -> List[Any]:
        """Return discovered tools."""
        return self._tools

    async def call_tool(self, name: str, args: Dict[str, Any], timeout_ms: float = 30_000) -> ToolCallResult:
        """Call an MCP tool and return a structured result with timing."""
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self._session.call_tool(name, arguments=args),
                timeout=timeout_ms / 1000.0,
            )
            elapsed = (time.monotonic() - start) * 1000

            raw_content = result.content
            is_error = result.isError if hasattr(result, "isError") else False

            # Parse the first text block
            parsed = None
            text = ""
            if raw_content:
                first = raw_content[0]
                text = first.text if hasattr(first, "text") else str(first)
                try:
                    parsed = json.loads(text)
                except (json.JSONDecodeError, TypeError):
                    parsed = text

            return ToolCallResult(
                tool_name=name,
                args=args,
                raw_content=raw_content,
                parsed=parsed,
                is_error=is_error,
                elapsed_ms=elapsed,
                size_bytes=len(text.encode("utf-8")) if text else 0,
            )
        except asyncio.TimeoutError:
            elapsed = (time.monotonic() - start) * 1000
            return ToolCallResult(
                tool_name=name,
                args=args,
                raw_content=[],
                parsed={"error": f"MCP call timed out after {timeout_ms}ms"},
                is_error=True,
                elapsed_ms=elapsed,
                size_bytes=0,
            )
        except Exception as e:
            elapsed = (time.monotonic() - start) * 1000
            return ToolCallResult(
                tool_name=name,
                args=args,
                raw_content=[],
                parsed={"error": f"MCP call exception: {type(e).__name__}: {e}"},
                is_error=True,
                elapsed_ms=elapsed,
                size_bytes=0,
            )

    async def health_probe(self) -> ToolCallResult:
        """Call get_public_ip on mock-canary. Must succeed to prove the session isn't stuck."""
        return await self.call_tool("get_public_ip", {"agent_id": "mock-canary"}, timeout_ms=10_000)

    async def disconnect(self):
        """Gracefully close the MCP session."""
        if self._session:
            try:
                await self._session.__aexit__(None, None, None)
            except Exception:
                pass
        if self._cm:
            try:
                await self._cm.__aexit__(None, None, None)
            except Exception:
                pass
        self._session = None
        self._cm = None
