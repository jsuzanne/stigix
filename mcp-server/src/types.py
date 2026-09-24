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


class ConvMetrics(BaseModel):
    """Metrics from a convergence (conv) or failover test.

    Numeric fields default to None (not 0) when absent so callers can distinguish
    'not measured' from 'measured zero'. String fields default to None so an empty
    string returned by the daemon is normalised to None by the validator below.
    """

    # Packet counts
    sent: Optional[float] = None
    received: Optional[float] = None
    # Loss
    loss_percent: Optional[float] = None
    uplink_loss_pct: Optional[float] = None
    downlink_loss_pct: Optional[float] = None
    # Blackout
    max_blackout_ms: Optional[float] = None
    blackout_count: Optional[float] = None
    total_blackout_ms: Optional[float] = None
    # RTT
    latency_ms: Optional[float] = None
    min_latency_ms: Optional[float] = None
    max_latency_ms: Optional[float] = None
    # Jitter
    jitter_ms: Optional[float] = None
    min_jitter_ms: Optional[float] = None
    max_jitter_ms: Optional[float] = None
    # Metadata
    duration_s: Optional[float] = None
    # String fields — must NOT be in Dict[str, float]
    egress_path: Optional[str] = None
    verdict: Optional[str] = None

    @classmethod
    def from_daemon(cls, d: Dict[str, Any]) -> "ConvMetrics":
        """Build a ConvMetrics from a raw daemon dict, normalising empty strings to None."""
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

        return cls(
            sent=_f(d.get("sent") or d.get("tx_total")),
            received=_f(d.get("received") or d.get("rx_total")),
            loss_percent=_f(d.get("loss_pct") or d.get("loss_percent")),
            uplink_loss_pct=_f(d.get("uplink_loss_pct") or d.get("uplinkLoss")),
            downlink_loss_pct=_f(d.get("downlink_loss_pct") or d.get("downlinkLoss")),
            max_blackout_ms=_f(d.get("max_blackout_ms") or d.get("maxBlackout") or d.get("blackout")),
            blackout_count=_f(d.get("blackout_count") or d.get("blackoutCount")),
            total_blackout_ms=_f(d.get("total_blackout_ms") or d.get("totalBlackoutMs")),
            latency_ms=_f(d.get("avg_rtt_ms") or d.get("latency_ms")),
            min_latency_ms=_f(d.get("min_rtt_ms") or d.get("minRtt")),
            max_latency_ms=_f(d.get("max_rtt_ms") or d.get("maxRtt")),
            jitter_ms=_f(d.get("jitter_ms") or d.get("avg_jitter_ms")),
            min_jitter_ms=_f(d.get("min_jitter_ms") or d.get("minJitter")),
            max_jitter_ms=_f(d.get("max_jitter_ms") or d.get("maxJitter")),
            duration_s=_f(d.get("duration_s") or d.get("durationSec")),
            egress_path=_s(d.get("egress_path") or d.get("egressPath")),
            verdict=_s(d.get("verdict")),
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
