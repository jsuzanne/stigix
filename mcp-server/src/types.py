"""
Pydantic models for SD-WAN MCP Server.

This module defines all data models used throughout the MCP server,
including agents, test runs, statistics, and API responses.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, HttpUrl


class Agent(BaseModel):
    """Configuration for a single SD-WAN traffic generator agent."""
    
    id: str = Field(..., description="Unique identifier for the agent")
    name: str = Field(..., description="Human-readable name")
    url: HttpUrl = Field(..., description="Base URL of the agent's web-ui API")
    jwt_secret: str = Field(..., description="JWT secret for authentication")


class AgentConfig(BaseModel):
    """Root configuration containing all agents."""
    
    agents: List[Agent] = Field(default_factory=list, description="List of configured agents")


class AgentStats(BaseModel):
    """Statistics from a single agent."""
    
    total_requests: int = Field(0, description="Total number of requests made")
    success_rate: float = Field(0.0, description="Success rate percentage (0-100)")
    top_app: Optional[str] = Field(None, description="Most requested application")
    errors: int = Field(0, description="Total number of errors")
    requests_by_app: Dict[str, int] = Field(default_factory=dict, description="Requests per application")
    errors_by_app: Dict[str, int] = Field(default_factory=dict, description="Errors per application")


class AgentStatus(BaseModel):
    """Status information for a single agent."""
    
    id: str = Field(..., description="Agent ID")
    name: str = Field(..., description="Agent name")
    status: str = Field(..., description="Current status: running, stopped, error")
    url: str = Field(..., description="Agent URL")
    stats: Optional[AgentStats] = Field(None, description="Current statistics")


class StigixEndpoint(BaseModel):
    """A Stigix endpoint (Fabric or Internet)."""
    
    id: str = Field(..., description="Unique endpoint ID")
    kind: str = Field(..., description="'fabric' or 'internet'")
    role: str = Field(..., description="'source', 'target', or 'both'")
    capabilities: List[str] = Field(default_factory=list, description="List of capabilities (xfr-source, voice, etc.)")
    test_ip: Optional[str] = Field(None, description="Inner fabric IP (for kind=fabric)")
    public_ip: Optional[str] = Field(None, description="Public IP (for kind=internet)")
    api_base_url: Optional[str] = Field(None, description="Agent API base URL")
    version: Optional[str] = Field(None, description="Node software version (e.g. 2.0.60)")
    build: Optional[str] = Field(None, description="Node build/commit hash")
    meta: Dict[str, Any] = Field(default_factory=dict, description="Metadata tags/info")


class TestRun(BaseModel):
    """A traffic generation test run across multiple agents."""
    
    id: str = Field(..., description="Unique global test ID (e.g., G-20260205-1015)")
    local_id: Optional[str] = Field(None, description="Local agent-side test ID (e.g., CONV-0001)")
    start_time: datetime = Field(..., description="Test start timestamp")
    end_time: Optional[datetime] = Field(None, description="Test end timestamp")
    source_id: str = Field(..., description="ID of the source endpoint (fabric only)")
    target_id: str = Field(..., description="ID of the target endpoint")
    profile: str = Field(..., description="Traffic profile name (voice, iot, enterprise)")
    duration: str = Field(..., description="Test duration string (e.g., 5s, 1m)")
    bitrate: Optional[str] = Field(None, description="Planned bitrate (e.g., 300M)")
    label: Optional[str] = Field(None, description="Optional user-defined label")
    status: str = Field("running", description="Test status: running, completed, failed")
    metrics: Optional[Dict[str, float]] = Field(None, description="Key performance metrics")
    # XFR-only: inline result captured synchronously when the daemon returns
    xfr_result: Optional[Dict[str, Any]] = Field(
        None,
        description="For XFR tests: complete result metrics captured synchronously at test completion."
    )
    error: Optional[str] = Field(None, description="Error message if status=error")


def compute_conv_verdict(max_blackout_ms: Optional[Union[float, int, str]]) -> Optional[str]:
    """Calculate standard verdict string from max_blackout_ms.
    Returns None if max_blackout_ms is None / empty (no blackout measured yet).
    """
    if max_blackout_ms is None or max_blackout_ms == "":
        return None
    try:
        mb = float(max_blackout_ms)
    except (TypeError, ValueError):
        return None
    if mb == 0:
        return "PERFECT"
    if mb < 1000:
        return "GOOD"
    if mb < 5000:
        return "DEGRADED"
    if mb < 10000:
        return "BAD"
    return "CRITICAL"


class ConvMetrics(BaseModel):
    """Metrics from a convergence (conv) or failover test.

    Numeric fields default to None (not 0) when absent so callers can distinguish
    'not measured' from 'measured zero'. String fields default to None so an empty
    string returned by the daemon is normalised to None.
    """

    # Packet counts
    sent: Optional[float] = None
    received: Optional[float] = None

    # Loss
    loss_percent: Optional[float] = None
    loss_pct: Optional[float] = None  # Deprecated alias for backwards compatibility
    uplink_loss_pct: Optional[float] = None
    tx_loss_pct: Optional[float] = None  # Alias
    downlink_loss_pct: Optional[float] = None
    rx_loss_pct: Optional[float] = None  # Alias

    # Blackout
    max_blackout_ms: Optional[float] = None

    # RTT & Jitter
    latency_ms: Optional[float] = None
    avg_rtt_ms: Optional[float] = None  # Alias
    jitter_ms: Optional[float] = None

    # Metadata & Path
    duration_s: Optional[float] = None
    egress_path: Optional[str] = None
    verdict: Optional[str] = None

    @classmethod
    def from_daemon(cls, d: Dict[str, Any]) -> "ConvMetrics":
        """Build a ConvMetrics from a raw daemon dict, normalising empty strings to None."""
        def _first_valid(source: Dict[str, Any], *keys: str) -> Any:
            for k in keys:
                if k in source and source[k] is not None and source[k] != "":
                    return source[k]
            return None

        def _f(val: Any) -> Optional[float]:
            if val is None or val == "":
                return None
            try:
                return float(val)
            except (TypeError, ValueError):
                return None

        def _s(val: Any) -> Optional[str]:
            if val is None or val == "":
                return None
            return str(val)

        sent_val = _f(_first_valid(d, "sent", "tx_total"))
        rcvd_val = _f(_first_valid(d, "received", "rx_total"))
        loss_val = _f(_first_valid(d, "loss_pct", "loss_percent", "total_loss_pct", "live_loss_pct"))
        tx_loss = _f(_first_valid(d, "tx_loss_pct", "uplink_loss_pct", "uplinkLoss"))
        rx_loss = _f(_first_valid(d, "rx_loss_pct", "downlink_loss_pct", "downlinkLoss"))
        max_bo = _f(_first_valid(d, "max_blackout_ms", "maxBlackout", "blackout"))
        lat_val = _f(_first_valid(d, "avg_rtt_ms", "latency_ms", "current_rtt_ms"))
        jit_val = _f(_first_valid(d, "jitter_ms", "avg_jitter_ms"))
        dur_val = _f(_first_valid(d, "duration_s", "durationSec"))
        egress_val = _s(_first_valid(d, "egress_path", "egressPath"))
        
        verdict_raw = _s(d.get("verdict"))
        verdict_val = verdict_raw if verdict_raw else compute_conv_verdict(max_bo)

        return cls(
            sent=sent_val,
            received=rcvd_val,
            loss_percent=loss_val,
            loss_pct=loss_val,
            uplink_loss_pct=tx_loss,
            tx_loss_pct=tx_loss,
            downlink_loss_pct=rx_loss,
            rx_loss_pct=rx_loss,
            max_blackout_ms=max_bo,
            latency_ms=lat_val,
            avg_rtt_ms=lat_val,
            jitter_ms=jit_val,
            duration_s=dur_val,
            egress_path=egress_val,
            verdict=verdict_val,
        )


class TestStatus(BaseModel):
    """Current status of a running or completed test."""

    test_id: str = Field(..., description="Global Test ID")
    local_id: Optional[str] = Field(None, description="Local agent-side test ID")
    status: str = Field(..., description="Test status (running, completed, failed)")
    source_id: str = Field(..., description="Source ID")
    target_id: str = Field(..., description="Target ID")
    # conv tests: typed ConvMetrics (supports string fields like egress_path / verdict)
    # xfr / voice / iot: falls back to generic Dict[str, Any]
    metrics: Optional[Union[ConvMetrics, Dict[str, Any]]] = Field(
        None,
        description="Current metrics. Conv tests return ConvMetrics; other profiles return a raw dict."
    )


class TestSummary(BaseModel):
    """Summary information for a test run (History)."""
    
    id: str = Field(..., description="Test ID")
    label: Optional[str] = Field(None, description="Test label")
    start_time: datetime = Field(..., description="Start timestamp")
    status: str = Field(..., description="Test status")
    source_id: str = Field(..., description="Source endpoint")
    target_id: str = Field(..., description="Target endpoint")
    profile: str = Field(..., description="Traffic profile used")
