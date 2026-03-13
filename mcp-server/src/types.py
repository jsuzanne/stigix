"""
Pydantic models for SD-WAN MCP Server.

This module defines all data models used throughout the MCP server,
including agents, test runs, statistics, and API responses.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
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


class TestStatus(BaseModel):
    """Current status of a running or completed test."""
    
    test_id: str = Field(..., description="Global Test ID")
    local_id: Optional[str] = Field(None, description="Local agent-side test ID")
    status: str = Field(..., description="Test status (running, completed, failed)")
    source_id: str = Field(..., description="Source ID")
    target_id: str = Field(..., description="Target ID")
    metrics: Optional[Dict[str, float]] = Field(None, description="Current metrics")


class TestSummary(BaseModel):
    """Summary information for a test run (History)."""
    
    id: str = Field(..., description="Test ID")
    label: Optional[str] = Field(None, description="Test label")
    start_time: datetime = Field(..., description="Start timestamp")
    status: str = Field(..., description="Test status")
    source_id: str = Field(..., description="Source endpoint")
    target_id: str = Field(..., description="Target endpoint")
    profile: str = Field(..., description="Traffic profile used")
