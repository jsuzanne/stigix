import asyncio
import logging
import uuid
import httpx
import jwt
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from .registry import RegistryClient
from ..types import TestRun, TestStatus, StigixEndpoint

logger = logging.getLogger(__name__)

class TestOrchestrator:
    """
    Orchestrates traffic tests between Stigix endpoints.
    Drives real API calls to source agents for each target.
    """
    
    def __init__(self):
        # Store for mapping global_test_id -> {source_base_url, local_id}
        self._test_mappings: Dict[str, Dict] = {}
        self.jwt_secret = os.getenv("JWT_SECRET", "stigix-default-secret-2026")
        self.registry = RegistryClient()

    def _handle_exception(self, context: str, e: Exception) -> Dict[str, str]:
        logger.error(f"{context} failed: {e}")
        return {"error": str(e) or f"Operation failed: {type(e).__name__}"}

    def _generate_token(self) -> str:
        """Generates a JWT for agent authentication."""
        import time
        payload = {
            "id": "mcp-orchestrator",
            "username": "mcp-worker",
            "role": "admin",
            "exp": int(time.time()) + 3600
        }
        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")

    def _validate_target_capabilities(self, target: StigixEndpoint, profile: str, is_xfr: bool, is_conv: bool, is_voice: bool):
        """Ensures the target endpoint is technically capable of the requested test."""
        caps = [c.lower() for c in target.capabilities]
        
        if is_xfr:
            # XFR requires an XFR server (managed Stigix node or dedicated XFR target)
            if "xfr-target" not in caps and target.kind != "fabric":
                raise ValueError(f"Target {target.id} ({target.kind}) does not support XFR speedtests. Use a Fabric node or a dedicated XFR target.")
        
        elif is_conv:
            # Convergence probes require the internal probe daemon (only on Fabric nodes)
            if target.kind != "fabric":
                raise ValueError(f"Target {target.id} ({target.kind}) does not support Convergence probes. This profile requires a Stigix Fabric endpoint.")
        
        elif is_voice:
            # Voice requires a Voice Echo server (only on Fabric nodes or specific targets)
            if "voice" not in caps and target.kind != "fabric":
                raise ValueError(f"Target {target.id} ({target.kind}) does not support Voice simulation. This profile requires a Stigix Fabric endpoint.")
        
        elif "iot" in profile.lower():
            if "iot" not in caps and target.kind != "fabric":
                raise ValueError(f"Target {target.id} ({target.kind}) does not support IoT simulation.")

    async def run_tests(
        self, 
        source: StigixEndpoint, 
        targets: List[StigixEndpoint], 
        profile: str, 
        duration: str,
        bitrate: Optional[str] = None,
        label: Optional[str] = None,
        protocol: Optional[str] = None,
        direction: Optional[str] = None,
        pps: Optional[int] = None
    ) -> List[TestRun]:
        """
        Drives tests by calling the source agent's API for each target.
        """
        if source.kind != "fabric":
            raise ValueError(f"Direct source must be 'fabric'. {source.id} is {source.kind}.")
        
        # Determine test type
        is_convergence_profile = any(k in profile.lower() for k in ["conv", "failover", "path", "probe"])
        is_xfr_profile = any(k in profile.lower() for k in ["xfr", "speedtest", "throughput"])
        is_voice_profile = "voice" in profile.lower()

        # Validate capabilities for ALL targets before starting any test
        for target in targets:
            self._validate_target_capabilities(target, profile, is_xfr_profile, is_convergence_profile, is_voice_profile)
        
        # Convert duration (e.g., '10s') to seconds
        duration_sec = 10
        if duration.endswith('s'):
            duration_sec = int(duration[:-1])
        elif duration.endswith('m'):
            duration_sec = int(duration[:-1]) * 60

        test_runs = []
        headers = {"Authorization": f"Bearer {self._generate_token()}"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            for target in targets:
                target_ip = target.test_ip if target.kind == "fabric" else target.public_ip
                if not target_ip:
                    logger.warning(f"Target {target.id} has no valid IP, skipping.")
                    continue

                if is_xfr_profile:
                    api_url = f"{source.api_base_url}/api/tests/xfr"
                    payload = {
                        "mode": "custom",
                        "target": { "host": target_ip, "port": 9000 }, # XFR default port
                        "protocol": protocol.lower() if protocol else "tcp",
                        "direction": direction.lower() if direction else "client-to-server",
                        "duration_sec": duration_sec,
                        "bitrate": bitrate or "0", # 0 = max
                        "parallel_streams": 4
                    }
                elif is_convergence_profile:
                    api_url = f"{source.api_base_url}/api/convergence/start"
                    # Auto-build a label from the target's registry name when the caller
                    # did not provide one — avoids "Unknown" in the Failover dashboard.
                    effective_label = label or target.meta.get("site_name") or target.id
                    payload = {
                        "target": target_ip,
                        "port": 6100, # Convergence probe port
                        # Use pps directly if provided, else fallback to bitrate or 50
                        "rate": pps if pps is not None else (int(bitrate.replace('M', '')) if bitrate and 'M' in bitrate else 50),
                        "label": effective_label
                    }
                else:
                    # Fallback for voice or other tests
                    api_url = f"{source.api_base_url}/api/tests/xfr"
                    payload = {
                        "mode": "default",
                        "target": { "host": target_ip, "port": 9000 }
                    }

                # Generate local global ID for tracking
                global_id = f"G-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                
                try:
                    logger.info(f"Triggering test on {api_url} with payload {payload}")
                    response = await client.post(api_url, json=payload, headers=headers)
                    response.raise_for_status()
                    result = response.json()
                    
                    # Capture the native reference (sequence_id e.g. XFR-0007 / CONV-0001)
                    local_id = result.get("sequence_id") or result.get("testId") or result.get("id") or "CONV-000"
                    
                    # Store mapping for status checks
                    self._test_mappings[global_id] = {
                        "source_url": source.api_base_url,
                        "local_id": local_id,
                        "source_id": source.id,
                        "target_id": target.id,
                        "is_convergence": is_convergence_profile
                    }

                    test_runs.append(TestRun(
                        id=global_id,
                        local_id=local_id,
                        start_time=datetime.now(),
                        source_id=source.id,
                        target_id=target.id,
                        profile=profile,
                        duration=duration,
                        bitrate=str(pps) + " pps" if pps else (bitrate or "50 pps"),
                        label=label,
                        status="running"
                    ))
                except Exception as e:
                    logger.error(f"Failed to trigger test on agent {source.id} for target {target.id}: {e}")
                    # Return an error entry so Claude always has something to report
                    test_runs.append(TestRun(
                        id=global_id,
                        local_id="ERROR",
                        start_time=datetime.now(),
                        source_id=source.id,
                        target_id=target.id,
                        profile=profile,
                        duration=duration,
                        bitrate=bitrate or "",
                        label=label,
                        status="error",
                        error=str(e)
                    ))
        
        return test_runs

    async def get_status(self, test_id: str) -> TestStatus:
        """Fetch live status from the source agent."""
        if test_id not in self._test_mappings:
            raise ValueError(f"Test {test_id} not found.")
        
        mapping = self._test_mappings[test_id]
        
        if mapping.get("is_convergence"):
            # Convergence stats are often retrieved differently or just from the list
            api_url = f"{mapping['source_url']}/api/convergence/status" # Or similar
        else:
            api_url = f"{mapping['source_url']}/api/tests/xfr"
        
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(api_url, headers=headers)
                response.raise_for_status()
                data = response.json()
                
                if mapping.get("is_convergence"):
                    # 1. Try status endpoint (active tests)
                    job = None
                    if isinstance(data, list):
                        # Match by testId (from server.ts) or test_id (from python stats)
                        job = next((j for j in data if j.get("testId") == mapping["local_id"] or j.get("test_id") == mapping["local_id"]), None)
                    
                    # 2. If not found, try history endpoint (finished tests)
                    if not job:
                        try:
                            history_url = f"{mapping['source_url']}/api/convergence/history"
                            async with httpx.AsyncClient(timeout=5.0) as history_client:
                                h_resp = await history_client.get(history_url, headers=headers)
                                if h_resp.status_code == 200:
                                    history = h_resp.json()
                                    # Multiple entries might exist for the same test if it was restarted or appended.
                                    # We want the LAST one in the history array that matches.
                                    # Note: testId in history might be 'CONV-123 (Label)' so we use startswith
                                    matching_jobs = [j for j in history if str(j.get("testId", "")).startswith(mapping["local_id"]) or str(j.get("test_id", "")).startswith(mapping["local_id"])]
                                    if matching_jobs:
                                        job = matching_jobs[-1]
                                        job["running"] = False # Mark as finished
                        except Exception as e:
                            logger.warning(f"Failed to fetch history from {mapping['source_url']}: {e}")

                    if not job:
                        logger.warning(f"Job {mapping['local_id']} not found in convergence status or history on {mapping['source_url']}")
                        return TestStatus(test_id=test_id, status="unknown", source_id=mapping["source_id"], target_id=mapping["target_id"])
                    
                    # Normalize metrics
                    metrics = {
                        "loss_percent": job.get("loss_pct", 0) or job.get("loss_percent", 0),
                        "latency_ms": job.get("avg_rtt_ms", 0) or job.get("latency_ms", 0),
                        "jitter_ms": job.get("jitter_ms", 0)
                    }
                    
                    # Derive status from 'running' boolean if present, else fallback to 'status' string
                    status_str = "running"
                    if "running" in job:
                        status_str = "running" if job["running"] else "finished"
                    elif "status" in job:
                        status_str = job["status"]

                    return TestStatus(
                        test_id=test_id, 
                        local_id=mapping["local_id"],
                        status=status_str, 
                        source_id=mapping["source_id"], 
                        target_id=mapping["target_id"], 
                        metrics=metrics
                    )

                # Standard XFR jobs (from /api/tests/xfr)
                job = None
                if isinstance(data, list):
                    # Match by the unique string ID first
                    job = next((j for j in data if str(j.get("id")) == str(mapping["local_id"])), None)
                
                if not job:
                    return TestStatus(
                        test_id=test_id,
                        local_id=mapping["local_id"],
                        status="unknown",
                        source_id=mapping["source_id"],
                        target_id=mapping["target_id"]
                    )

                # Use sequence_id (e.g. XFR-0007) as local_id for user display if possible
                display_id = job.get("sequence_id") or mapping["local_id"]

                # Map Stigix job metrics to MCP status
                summary = job.get("summary") or {}
                
                # In bidirectional or other modes, we might want to show both, 
                # but received_mbps is the primary measure in the UI.
                throughput = summary.get("received_mbps", 0) or summary.get("sent_mbps", 0)
                
                metrics = {
                    "throughput_mbps": float(throughput),
                    "loss_percent": float(summary.get("loss_percent", 0)),
                    "latency_ms": float(summary.get("rtt_ms_avg", 0)) # Standardize with 'latency_ms'
                }

                # Normalize status
                raw_status = job.get("status", "running").lower()
                status_str = "running"
                if raw_status in ["completed", "finished", "success"]:
                    status_str = "finished"
                elif raw_status in ["failed", "error"]:
                    status_str = "failed"

                return TestStatus(
                    test_id=test_id,
                    local_id=display_id,
                    status=status_str,
                    source_id=mapping["source_id"],
                    target_id=mapping["target_id"],
                    metrics=metrics
                )
        except Exception as e:
            logger.error(f"Failed to get status from agent: {e}")
            raise

    async def set_traffic_status(self, source: StigixEndpoint, enabled: bool) -> dict:
        """Starts or stops the application traffic generation."""
        action = "start" if enabled else "stop"
        api_url = f"{source.api_base_url}/api/traffic/{action}"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"Setting traffic status on {source.id} to {enabled} via {api_url}")
            # POST with empty body as per server.ts implementation for start/stop
            response = await client.post(api_url, json={}, headers=headers)
            response.raise_for_status()
            return response.json()

    async def set_traffic_rate(self, source: StigixEndpoint, sleep_interval: float) -> dict:
        """Updates the traffic generation sleep interval (delay between requests)."""
        api_url = f"{source.api_base_url}/api/traffic/settings"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        payload = {"sleep_interval": sleep_interval}
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"Updating traffic rate on {source.id} to {sleep_interval}s via {api_url}")
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    async def set_voice_status(self, source: StigixEndpoint, enabled: bool) -> dict:
        """Starts or stops the voice simulation."""
        api_url = f"{source.api_base_url}/api/voice/control"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        payload = {"enabled": enabled}
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"Setting voice status on {source.id} to {enabled} via {api_url}")
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    async def stop_test(self, test_id: str) -> dict:
        """Stops an active test (primary for long-running convergence tests)."""
        if test_id not in self._test_mappings:
            # Maybe it's a local_id provided directly?
            # We'll try to find it in mappings
            mapping_key = next((k for k, v in self._test_mappings.items() if v.get("local_id") == test_id), None)
            if not mapping_key:
                raise ValueError(f"Test ID {test_id} not found in active mappings.")
            mapping = self._test_mappings[mapping_key]
        else:
            mapping = self._test_mappings[test_id]
        
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        if mapping.get("is_convergence"):
            api_url = f"{mapping['source_url']}/api/convergence/stop"
            payload = {"testId": mapping["local_id"]}
        else:
            return {"error": "Only convergence tests can be stopped manually at this time."}
            
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"Stopping test (local {mapping['local_id']}) via {api_url}")
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            
            # Since convergence_orchestrator.py has a grace period of 2-7s before writing final stats,
            # we should wait and poll the history endpoint to get the *real* final metrics.
            import asyncio
            history_url = f"{mapping['source_url']}/api/convergence/history"
            
            logger.info(f"Waiting for final metrics for {mapping['local_id']}...")
            for _ in range(10): # Wait up to 10 seconds
                await asyncio.sleep(1.0)
                try:
                    h_resp = await client.get(history_url, headers=headers)
                    if h_resp.status_code == 200:
                        history = h_resp.json()
                        # Note: testId in history might be 'CONV-123 (Label)' so we use startswith
                        matching_jobs = [j for j in history if str(j.get("testId", "")).startswith(mapping["local_id"]) or str(j.get("test_id", "")).startswith(mapping["local_id"])]
                        if matching_jobs:
                            job = matching_jobs[-1]
                            # Check if the metrics look somewhat final (not just 0s if it actually ran)
                            # or just return it because we waited
                            return {
                                "success": True,
                                "message": "Test stopped and final metrics captured",
                                "metrics": {
                                    "sent": job.get("sent", 0),
                                    "received": job.get("received", 0),
                                    "loss_pct": job.get("loss_pct", 0) or job.get("loss_percent", 0),
                                    "latency_ms": job.get("avg_rtt_ms", 0) or job.get("latency_ms", 0),
                                    "jitter_ms": job.get("jitter_ms", 0)
                                }
                            }
                except Exception as e:
                    logger.warning(f"Error polling history: {e}")
            
            # If we timeout waiting for history
            return {
                "success": True, 
                "message": "Stop command sent, but timed out waiting for final metrics from backend. Check status later.",
                "raw_response": response.json()
            }

    async def get_agent_dashboard(self, agent_id: str) -> Dict[str, Any]:
        """Fetch full dashboard data for a specific agent."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/admin/system/dashboard-data"
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to fetch dashboard for {agent_id}: {e}")
                return {"error": str(e)}

    async def _get_cloud_eicar_url(self, agent: any) -> str:
        """Fetch the actual Cloud EICAR URL from the agent (e.g. https://target.stigix.io/eicar.com.txt)."""
        try:
            headers = {"Authorization": f"Bearer {self._generate_token()}"}
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{agent.api_base_url}/api/security/cloud-eicar-url", headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    return data.get("url", "")
        except Exception:
            pass
        return ""

    async def _get_dns_test_name(self, agent: any, domain: str) -> str:
        """Look up the friendly test name for a DNS domain from the security profile."""
        try:
            headers = {"Authorization": f"Bearer {self._generate_token()}"}
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{agent.api_base_url}/api/security/profile", headers=headers)
                if r.status_code == 200:
                    profile = r.json()
                    items = profile.get("dns_security", {}).get("items", [])
                    for item in items:
                        if item.get("domain", "").rstrip(".") == domain.rstrip("."):
                            return item['name']
        except Exception:
            pass
        return domain

    async def _get_url_category_name(self, agent: any, target_url: str) -> str:
        """Look up the friendly category name for a URL from the security profile."""
        try:
            headers = {"Authorization": f"Bearer {self._generate_token()}"}
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{agent.api_base_url}/api/security/profile", headers=headers)
                if r.status_code == 200:
                    profile = r.json()
                    items = profile.get("url_filtering", {}).get("items", [])
                    for item in items:
                        if item.get("url", "").rstrip("/") == target_url.rstrip("/"):
                            return item['name']
        except Exception:
            pass
        # Fallback: use domain as label
        try:
            from urllib.parse import urlparse
            domain = urlparse(target_url).netloc or target_url
            return domain
        except Exception:
            return target_url

    async def trigger_security_test(self, agent_id: str, test_type: str, target: str) -> Dict[str, Any]:
        """Trigger a security test (DNS, URL, or Threat)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        # Route mapping
        if test_type == "dns":
            url = f"{agent.api_base_url}/api/security/dns-test"
            # Look up friendly test name from security profile
            dns_label = await self._get_dns_test_name(agent, target)
            payload = {"domain": target, "testName": dns_label, "mcp_source": "mcp"}
        elif test_type == "url":
            url = f"{agent.api_base_url}/api/security/url-test"
            # Look up friendly category name from security profile
            category_label = await self._get_url_category_name(agent, target)
            payload = {"url": target, "category": category_label, "mcp_source": "mcp"}
        elif test_type == "threat":
            url = f"{agent.api_base_url}/api/security/threat-test"
            if target.startswith("STIGIX-"): # Scenario ID — resolve actual cloud URL for label
                cloud_url = await self._get_cloud_eicar_url(agent)
                if cloud_url:
                    eicar_label = f"EICAR Test ({cloud_url})"
                else:
                    eicar_label = f"EICAR Test (Cloud: {target})"
                payload = {"scenarioId": target, "testName": eicar_label, "mcp_source": "mcp"}
            else:
                # Direct URL endpoint — same format as UI
                payload = {"endpoint": target, "testName": f"EICAR Test ({target})", "mcp_source": "mcp"}
        else:
            return {"error": f"Unsupported security test type: {test_type}"}
            
        logger.info(f"Triggering {test_type} security probe for agent {agent_id} on target: {target}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                # Enrich with MCP metadata for badge display in UI
                if isinstance(data, dict):
                    data["mcp_target"] = target
                    data["mcp_source"] = "mcp"  # Stored in details → triggers MCP badge in Security.tsx
                    # Surface the sequential test ID prominently so Claude can reference it
                    if "testId" in data:
                        data["test_id"] = data["testId"]
                    elif isinstance(data.get("results"), list) and data["results"]:
                        # threat-test wraps results in a list
                        data["test_id"] = data.get("testId")
                return data
            except Exception as e:
                logger.error(f"Security test {test_type} failed for {agent_id} on {target}: {e}")
                return {"error": str(e), "target": target}

    async def list_vyos_routers(self, agent_id: str) -> List[Dict[str, Any]]:
        """List VyOS routers managed by a specific Stigix node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return [{"error": f"Agent {agent_id} not found."}]
            
        url = f"{agent.api_base_url}/api/vyos/routers"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to list VyOS routers on {agent_id}: {e}")
                return [{"error": str(e)}]

    async def list_vyos_sequences(self, agent_id: str) -> List[Dict[str, Any]]:
        """List available VyOS configuration sequences on a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return [{"error": f"Agent {agent_id} not found."}]
            
        url = f"{agent.api_base_url}/api/vyos/sequences"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to list VyOS sequences on {agent_id}: {e}")
                return [{"error": str(e)}]

    async def run_vyos_sequence(self, agent_id: str, sequence_id: str) -> Dict[str, Any]:
        """Trigger a VyOS sequence execution on a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        url = f"{agent.api_base_url}/api/vyos/sequences/run/{sequence_id}"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to run VyOS sequence {sequence_id} on {agent_id}: {e}")
                return {"error": str(e)}

    async def get_vyos_history(self, agent_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch VyOS action history from a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return [{"error": f"Agent {agent_id} not found."}]
            
        url = f"{agent.api_base_url}/api/vyos/history?limit={limit}"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to fetch VyOS history from {agent_id}: {e}")
                return [{"error": str(e)}]

    async def set_vyos_scenario_status(self, agent_id: str, sequence_id: str, enabled: bool) -> Dict[str, Any]:
        """Enable or disable a specific VyOS configuration sequence on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                # 1. Fetch current sequences to find the target object
                sc_resp = await client.get(f"{agent.api_base_url}/api/vyos/sequences", headers=headers)
                sc_resp.raise_for_status()
                sequences = sc_resp.json()
                
                target_seq = next((s for s in sequences if s['id'] == sequence_id), None)
                if not target_seq:
                    return {"error": f"Sequence {sequence_id} not found on node {agent_id}"}
                
                # 2. Update the status
                target_seq['enabled'] = enabled
                
                # 3. Save it back
                save_resp = await client.post(f"{agent.api_base_url}/api/vyos/sequences", json=target_seq, headers=headers)
                save_resp.raise_for_status()
                
                status_str = "enabled" if enabled else "disabled"
                return {"success": True, "message": f"Sequence '{target_seq.get('name')}' {status_str} on {agent_id}"}
            except Exception as e:
                logger.error(f"Failed to set status for sequence {sequence_id} on {agent_id}: {e}")
                return {"error": str(e)}

    async def get_vyos_interfaces(self, agent_id: str, router_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Return VyOS router interfaces with their descriptions.
        Used by Claude to identify which interface to target before executing an action.
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return [{"error": f"Agent {agent_id} not found."}]

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/vyos/routers"

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                routers = response.json()

                result = []
                for router in routers:
                    if router_id and router.get("id") != router_id and router.get("name") != router_id:
                        continue
                    result.append({
                        "router_id": router.get("id"),
                        "router_name": router.get("name"),
                        "host": router.get("host"),
                        "status": router.get("status"),
                        "interfaces": [
                            {
                                "name": iface.get("name"),
                                "description": iface.get("description") or "(no description)",
                                "addresses": iface.get("address", []),
                                "status": iface.get("status", "unknown")  # up / down / unknown
                            }
                            for iface in router.get("interfaces", [])
                        ]
                    })
                return result
            except Exception as e:
                logger.error(f"Failed to fetch VyOS interfaces from {agent_id}: {e}")
                return [{"error": str(e)}]

    async def get_vyos_state(self, agent_id: str, router_id: str) -> Dict[str, Any]:
        """
        Fetch live state audit for a specific VyOS router:
          - Interface admin state (up/down)
          - Active QoS parameters per interface (delay, loss, rate)
          - Blackhole IP blocks (tag-999)

        Calls GET /api/vyos/routers/{router_id}/state on the Stigix agent,
        which runs 'vyos_sdwan_ctl.py get-state' against the live VyOS HTTP API.
        Read-only — no config changes.
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/vyos/routers/{router_id}/state"

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to fetch VyOS state for {router_id} on {agent_id}: {e}")
                return {"error": str(e), "router_id": router_id}

    async def vyos_execute_adhoc(
        self,
        agent_id: str,
        router_id: str,
        command: str,
        interface: Optional[str] = None,
        latency_ms: Optional[int] = None,
        loss_pct: Optional[float] = None,
        corruption_pct: Optional[float] = None,
        rate: Optional[str] = None,
        ip: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute an ad-hoc VyOS action by creating a temporary single-action sequence,
        running it immediately, then deleting it.
        Returns the result and the VyOS CLI equivalent for transparency.
        """
        import uuid

        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base_url = agent.api_base_url

        # Build parameters dict (only non-None values)
        parameters: Dict[str, Any] = {}
        if latency_ms is not None:
            parameters["latency"] = latency_ms
        if loss_pct is not None:
            parameters["loss"] = loss_pct
        if corruption_pct is not None:
            parameters["corrupt"] = corruption_pct
        if rate is not None:
            parameters["rate"] = rate
        if ip is not None:
            parameters["ip"] = ip

        # Translate MCP command to VyOS sequence command
        # set-impairment is the unified MCP command; legacy separate commands also map to set-qos
        _QOS_CMDS = {'set-impairment', 'set-latency', 'set-loss', 'set-rate', 'set-corruption'}
        seq_command = 'set-qos' if command in _QOS_CMDS else command

        # Build temp sequence payload
        seq_id = f"mcp-adhoc-{uuid.uuid4().hex[:8]}"
        iface_label = f":{interface}" if interface else ""
        sequence_payload = {
            "id": seq_id,
            "name": f"MCP: {command}{iface_label} on {router_id}",
            "enabled": False,
            "executionMode": "STEP_BY_STEP",
            "cycle_duration": 0,
            "currentStep": 0,
            "actions": [
                {
                    "id": "action-1",
                    "offset_minutes": 0,
                    "router_id": router_id,
                    "interface": interface or "",
                    "command": seq_command,
                    "parameters": parameters
                }
            ]
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                # Step 1 — Create the temp sequence
                create_resp = await client.post(
                    f"{base_url}/api/vyos/sequences",
                    json=sequence_payload,
                    headers=headers
                )
                create_resp.raise_for_status()

                # Step 2 — Run it immediately
                run_resp = await client.post(
                    f"{base_url}/api/vyos/sequences/run/{seq_id}",
                    headers=headers
                )
                run_resp.raise_for_status()
                run_result = run_resp.json() if run_resp.content else {"success": True}

                # Step 2b — Short wait so the server has time to write the history entry
                # with the correct sequence_name before we delete the temp sequence.
                # Without this, the history lookup can race and return 'Unknown'.
                await asyncio.sleep(0.4)

                # Step 3 — Fetch history to get CLI equivalent (last entry)
                history_resp = await client.get(
                    f"{base_url}/api/vyos/history?limit=1",
                    headers=headers
                )
                cli_equivalent = None
                if history_resp.status_code == 200:
                    history = history_resp.json()
                    if history:
                        cli_equivalent = history[0].get("cli_equivalent")

                # Step 4 — Delete the temp sequence
                await client.delete(
                    f"{base_url}/api/vyos/sequences/{seq_id}",
                    headers=headers
                )

                return {
                    "success": True,
                    "command": command,
                    "router_id": router_id,
                    "interface": interface,
                    "parameters": parameters,
                    "cli_equivalent": cli_equivalent,
                    "result": run_result
                }

            except Exception as e:
                # Cleanup: try to delete the temp sequence even on failure
                try:
                    async with httpx.AsyncClient(timeout=5.0) as cleanup_client:
                        await cleanup_client.delete(
                            f"{base_url}/api/vyos/sequences/{seq_id}",
                            headers=headers
                        )
                except Exception:
                    pass
                logger.error(f"VyOS ad-hoc action failed on {agent_id}: {e}")
                return {"error": str(e), "command": command, "router_id": router_id}


    async def get_dem_stats(self, agent_id: str) -> Dict[str, Any]:
        """Fetch Digital Experience Monitoring (DEM) stats from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/connectivity/stats?range=1h"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to fetch DEM stats for {agent_id}: {e}")
                return {"error": str(e) or f"Connection failed: {type(e).__name__}"}

    async def get_probe_performance(self, agent_id: str, probe_name: str) -> Dict[str, Any]:
        """Fetch detailed performance metrics for a specific probe."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/connectivity/stats?range=1h"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                last_results = data.get("lastResults", [])
                
                # Try exact match or fuzzy match by name/IP
                probe_lower = probe_name.lower()
                match = next((r for r in last_results if probe_lower in r.get("name", "").lower() or probe_lower in r.get("id", "").lower()), None)
                
                if not match:
                    return {"error": f"Probe '{probe_name}' not found in recent results. Available: {[r.get('name') for r in last_results[:10]]}"}
                
                return match
            except Exception as e:
                logger.error(f"Failed to fetch probe details for {agent_id}: {e}")
                return {"error": str(e) or f"Connection failed: {type(e).__name__}"}

    # -------------------------------------------------------------------------
    # Phase 1 Additions — Aligned with stigix-cli capabilities
    # -------------------------------------------------------------------------

    async def get_node_status(self, agent_id: str) -> Dict[str, Any]:
        """Fetch an aggregated node status summary (health, version, traffic, site info)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            result: Dict[str, Any] = {"agent_id": agent_id, "base_url": base}
            try:
                for path, key in [
                    ("/api/system/health", "health"),
                    ("/api/version", "version"),
                    ("/api/traffic/status", "traffic"),
                    ("/api/siteinfo", "site"),
                ]:
                    try:
                        r = await client.get(f"{base}{path}", headers=headers)
                        if r.status_code == 200:
                            result[key] = r.json()
                    except Exception as e:
                        result[key] = {"error": str(e) or f"Connection failed: {type(e).__name__}"}
                # Convergence status
                try:
                    r = await client.get(f"{base}/api/convergence/status", headers=headers)
                    if r.status_code == 200:
                        result["convergence"] = r.json()
                except Exception:
                    pass
                return result
            except Exception as e:
                return self._handle_exception(f"Failed to fetch node status for {agent_id}", e)

    async def get_traffic_stats(self, agent_id: str) -> Dict[str, Any]:
        """Fetch live traffic stats (per-app requests, error rates, client count)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                stats_r = await client.get(f"{base}/api/stats", headers=headers)
                traffic_r = await client.get(f"{base}/api/traffic/status", headers=headers)
                result: Dict[str, Any] = {}
                if stats_r.status_code == 200:
                    result["stats"] = stats_r.json()
                if traffic_r.status_code == 200:
                    result["traffic_status"] = traffic_r.json()
                return result
            except Exception as e:
                return self._handle_exception(f"Failed to fetch traffic stats for {agent_id}", e)

    async def get_traffic_logs(self, agent_id: str, limit: int = 50) -> Dict[str, Any]:
        """Fetch recent traffic generation logs from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/logs", headers=headers)
                r.raise_for_status()
                data = r.json()
                # Trim to requested limit if it's a list
                if isinstance(data, list):
                    data = data[:limit]
                elif isinstance(data, dict) and "logs" in data:
                    data["logs"] = data["logs"][:limit]
                return {"agent_id": agent_id, "logs": data}
            except Exception as e:
                return self._handle_exception(f"Failed to fetch traffic logs for {agent_id}", e)

    async def get_security_results_stats(self, agent_id: str) -> Dict[str, Any]:
        """
        Fetch the security scorecard for a node:
        - Weighted posture scores (URL Filter, DNS Security, Threat Prevention) out of 100
        - Score trend for the last 24 runs (url, dns, threat per entry)
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=15.0) as client:
            import asyncio
            latest_score_task = client.get(f"{base}/api/security/scores/latest", headers=headers)
            history_task      = client.get(f"{base}/api/security/scores?limit=24", headers=headers)

            score_r, hist_r = await asyncio.gather(
                latest_score_task, history_task,
                return_exceptions=True
            )

        result: Dict[str, Any] = {"agent_id": agent_id}

        # --- Weighted posture scores (the real scores shown in the dashboard) ---
        if not isinstance(score_r, Exception) and score_r.status_code == 200:
            entry = score_r.json()
            scores = entry.get("scores", {})
            result["posture_scores"] = {
                "url_filter":        scores.get("url"),
                "dns_security":      scores.get("dns"),
                "threat_prevention": scores.get("threat"),
                "_note": "Weighted % of malicious categories correctly blocked/sinkholed (out of 100). Matches the Security dashboard exactly."
            }
        else:
            result["posture_scores"] = {"error": str(score_r)}

        # --- Score trend (last 24 runs, newest first) ---
        if not isinstance(hist_r, Exception) and hist_r.status_code == 200:
            history = hist_r.json() if hist_r.content else []
            trend = [
                {
                    "ts":      h.get("timestamp"),
                    "type":    h.get("type"),
                    "url":     h.get("scores", {}).get("url"),
                    "dns":     h.get("scores", {}).get("dns"),
                    "threat":  h.get("scores", {}).get("threat"),
                    "trigger": h.get("trigger"),
                }
                for h in (history if isinstance(history, list) else [])
            ]
            result["score_trend"] = sorted(trend, key=lambda x: x.get("ts") or 0, reverse=True)[:24]
        else:
            result["score_trend"] = {"error": str(hist_r)}

        return result

    async def get_security_config(self, agent_id: str) -> Dict[str, Any]:
        """Fetch the security policy configuration (enabled modules, profile) from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                result: Dict[str, Any] = {}
                # Fetch config (enabled modules)
                cfg_r = await client.get(f"{base}/api/security/config", headers=headers)
                if cfg_r.status_code == 200:
                    result["config"] = cfg_r.json()
                # Fetch dynamic profile (list of test targets)
                prof_r = await client.get(f"{base}/api/security/profile", headers=headers)
                if prof_r.status_code == 200:
                    result["profile"] = prof_r.json()
                return result
            except Exception as e:
                logger.error(f"Failed to fetch security config for {agent_id}: {e}")
                return {"error": str(e)}

    async def get_security_profile_dynamic(self, agent_id: str, probe_type: str) -> Dict[str, Any]:
        """Fetch the dynamic list of security test targets from the node's actual security profile."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                if probe_type == "threat":
                    # Fetch all configured EICAR targets (Cloud + direct endpoints)
                    r = await client.get(f"{agent.api_base_url}/api/security/eicar-targets", headers=headers)
                    if r.status_code == 200:
                        data = r.json()
                        raw_targets = data.get("targets", [])
                        options = []
                        for t in raw_targets:
                            if t.get("type") == "cloud":
                                options.append({
                                    "name": f"EICAR Test (Stigix Cloud — {t.get('url', '')})",
                                    "target": t["target"],
                                    "type": "cloud",
                                    "url": t.get("url", "")
                                })
                            else:
                                options.append({
                                    "name": f"EICAR Test (Direct — {t.get('name', t['target'])})",
                                    "target": t["target"],
                                    "type": "direct",
                                    "url": t.get("url", t["target"])
                                })
                        return {"agent_id": agent_id, "probe_type": probe_type, "options": options}
                    return {"agent_id": agent_id, "probe_type": probe_type, "options": []}

                r = await client.get(f"{agent.api_base_url}/api/security/profile", headers=headers)
                r.raise_for_status()
                profile = r.json()

                # Map the real API structure: dns_security.items / url_filtering.items
                if probe_type == "dns":
                    raw = profile.get("dns_security", {}).get("items", [])
                    options = [{"name": item["name"], "domain": item["domain"]} for item in raw]
                elif probe_type == "url":
                    raw = profile.get("url_filtering", {}).get("items", [])
                    options = [{"category": item["name"], "url": item["url"]} for item in raw]
                else:
                    options = []

                return {"agent_id": agent_id, "probe_type": probe_type, "options": options}
            except Exception as e:
                logger.error(f"Failed to fetch security profile for {agent_id}: {e}")
                return {"error": str(e)}

    async def list_dem_probes(self, agent_id: str) -> Dict[str, Any]:
        """List all configured DEM (Digital Experience Monitoring) probes on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/connectivity/custom", headers=headers)
                r.raise_for_status()
                data = r.json()
                probes = data if isinstance(data, list) else data.get("targets", [])
                return {"agent_id": agent_id, "count": len(probes), "probes": probes}
            except Exception as e:
                logger.error(f"Failed to list DEM probes for {agent_id}: {e}")
                return {"error": str(e)}

    async def run_probes_now(self, agent_id: str) -> Dict[str, Any]:
        """Trigger an immediate run of all DEM probes on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=90.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/connectivity/test", headers=headers)
                r.raise_for_status()
                data = r.json()
                results = data if isinstance(data, list) else data.get("results", [data])
                return {"agent_id": agent_id, "probe_count": len(results), "results": results}
            except Exception as e:
                logger.error(f"Failed to run probes for {agent_id}: {e}")
                return {"error": str(e)}

    async def get_dem_probe_stats(self, agent_id: str) -> Dict[str, Any]:
        """Fetch historical DEM probe stats (global health score, per-probe latency, reliability)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                result: Dict[str, Any] = {"agent_id": agent_id}
                # Global stats
                stats_r = await client.get(f"{base}/api/connectivity/stats?range=1h", headers=headers)
                if stats_r.status_code == 200:
                    result["global_stats"] = stats_r.json()
                # Recent results
                results_r = await client.get(
                    f"{base}/api/connectivity/results?timeRange=1h&limit=500", headers=headers
                )
                if results_r.status_code == 200:
                    result["recent_results"] = results_r.json()
                # Probe config for context
                cfg_r = await client.get(f"{base}/api/connectivity/custom", headers=headers)
                if cfg_r.status_code == 200:
                    data = cfg_r.json()
                    result["probes_config"] = data if isinstance(data, list) else data.get("targets", [])
                return result
            except Exception as e:
                logger.error(f"Failed to fetch DEM probe stats for {agent_id}: {e}")
                return {"error": str(e)}

    async def list_fabric_targets(self, agent_id: str) -> Dict[str, Any]:
        """List all manually-managed Stigix peer/fabric targets configured on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/targets", headers=headers)
                r.raise_for_status()
                data = r.json()
                targets = data if isinstance(data, list) else data.get("targets", [])
                return {"agent_id": agent_id, "count": len(targets), "targets": targets}
            except Exception as e:
                logger.error(f"Failed to list fabric targets for {agent_id}: {e}")
                return {"error": str(e)}

    async def list_speedtest_history(self, agent_id: str, limit: int = 20) -> Dict[str, Any]:
        """Fetch the speedtest (XFR) history from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/tests/xfr", headers=headers)
                r.raise_for_status()
                data = r.json()
                jobs = data if isinstance(data, list) else data.get("jobs", [])
                return {"agent_id": agent_id, "count": len(jobs), "jobs": jobs[:limit]}
            except Exception as e:
                logger.error(f"Failed to fetch speedtest history for {agent_id}: {e}")
                return {"error": str(e)}

    # -------------------------------------------------------------------------
    # Phase 2 Additions
    # -------------------------------------------------------------------------

    async def run_security_url_batch(self, agent_id: str) -> Dict[str, Any]:
        """Run a batch URL filtering test using all enabled categories from the node's config."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                # 1. Get enabled categories from config
                cfg_r = await client.get(f"{base}/api/security/config", headers=headers)
                cfg_r.raise_for_status()
                config = cfg_r.json()
                enabled_cats = config.get("url_filtering", {}).get("enabled_categories", [])
                if not enabled_cats:
                    return {"error": "No URL categories enabled in security config."}

                # 2. Get the profile to resolve URL + name for each category
                prof_r = await client.get(f"{base}/api/security/profile", headers=headers)
                prof_r.raise_for_status()
                profile = prof_r.json()
                items = profile.get("url_filtering", {}).get("items", [])
                enabled_items = [i for i in items if i.get("id") in enabled_cats]
                if not enabled_items:
                    return {"error": "No matching URL items found in profile for the enabled categories."}

                tests = [{"url": i["url"], "category": i["name"]} for i in enabled_items]
            except Exception as e:
                return {"error": f"Failed to build URL batch test list: {e}"}

        # 3. Run the batch with a long timeout (180s)
        async with httpx.AsyncClient(timeout=190.0) as client:
            try:
                logger.info(f"Running URL batch test on {agent_id} ({len(tests)} categories)")
                r = await client.post(
                    f"{base}/api/security/url-test-batch",
                    json={"tests": tests},
                    headers=headers
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results", data if isinstance(data, list) else [])
                blocked = sum(1 for res in results if res.get("status", "").lower() in ["blocked", "denied"])
                allowed = sum(1 for res in results if res.get("status", "").lower() in ["allowed", "ok", "passed"])
                return {
                    "agent_id": agent_id,
                    "total": len(results),
                    "blocked": blocked,
                    "allowed": allowed,
                    "unknown": len(results) - blocked - allowed,
                    "results": results
                }
            except Exception as e:
                logger.error(f"URL batch test failed on {agent_id}: {e}")
                return {"error": str(e)}

    async def run_security_dns_batch(self, agent_id: str) -> Dict[str, Any]:
        """Run a batch DNS security test using all enabled tests from the node's config."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                # 1. Get enabled DNS tests from config
                cfg_r = await client.get(f"{base}/api/security/config", headers=headers)
                cfg_r.raise_for_status()
                config = cfg_r.json()
                enabled_tests = config.get("dns_security", {}).get("enabled_tests", [])
                if not enabled_tests:
                    return {"error": "No DNS tests enabled in security config."}

                # 2. Get the profile to resolve domain + name for each test
                prof_r = await client.get(f"{base}/api/security/profile", headers=headers)
                prof_r.raise_for_status()
                profile = prof_r.json()
                items = profile.get("dns_security", {}).get("items", [])
                enabled_items = [i for i in items if i.get("id") in enabled_tests]
                if not enabled_items:
                    return {"error": "No matching DNS items found in profile for the enabled tests."}

                tests = [{"domain": i["domain"], "testName": i["name"]} for i in enabled_items]
            except Exception as e:
                return {"error": f"Failed to build DNS batch test list: {e}"}

        # 3. Run the batch with a long timeout (180s)
        async with httpx.AsyncClient(timeout=190.0) as client:
            try:
                logger.info(f"Running DNS batch test on {agent_id} ({len(tests)} domains)")
                r = await client.post(
                    f"{base}/api/security/dns-test-batch",
                    json={"tests": tests},
                    headers=headers
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results", data if isinstance(data, list) else [])
                blocked = sum(1 for res in results if res.get("status", "").lower() in ["blocked", "denied"])
                allowed = sum(1 for res in results if res.get("status", "").lower() in ["allowed", "ok", "passed", "resolved"])
                return {
                    "agent_id": agent_id,
                    "total": len(results),
                    "blocked": blocked,
                    "allowed": allowed,
                    "unknown": len(results) - blocked - allowed,
                    "results": results
                }
            except Exception as e:
                logger.error(f"DNS batch test failed on {agent_id}: {e}")
                return {"error": str(e)}

    async def add_dem_probe(
        self, agent_id: str, name: str, target: str,
        probe_type: str = "HTTP", timeout_ms: int = 5000
    ) -> Dict[str, Any]:
        """Add a new DEM experience probe to a node (appends to existing list)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        probe_type = probe_type.upper()
        if probe_type == "ICMP":
            probe_type = "PING"
        if probe_type not in ["HTTP", "HTTPS", "PING", "TCP", "UDP", "DNS"]:
            return {"error": f"Invalid probe type '{probe_type}'. Valid: HTTP, HTTPS, PING, TCP, UDP, DNS"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                # Fetch existing probes first (don't overwrite)
                r_get = await client.get(f"{base}/api/connectivity/custom", headers=headers)
                r_get.raise_for_status()
                data = r_get.json()
                probes = data if isinstance(data, list) else data.get("targets", [])

                new_probe = {
                    "name": name,
                    "type": probe_type,
                    "target": target,
                    "timeout": timeout_ms,
                    "enabled": True
                }
                probes.append(new_probe)

                r = await client.post(
                    f"{base}/api/connectivity/custom",
                    json={"endpoints": probes},
                    headers=headers
                )
                r.raise_for_status()
                return {"success": True, "message": f"Probe '{name}' ({probe_type} → {target}) added to {agent_id}", "probe": new_probe}
            except Exception as e:
                logger.error(f"Failed to add DEM probe to {agent_id}: {e}")
                return {"error": str(e)}

    async def remove_dem_probe(self, agent_id: str, probe_name: str) -> Dict[str, Any]:
        """Remove a DEM probe by name (case-insensitive) from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r_get = await client.get(f"{base}/api/connectivity/custom", headers=headers)
                r_get.raise_for_status()
                data = r_get.json()
                probes = data if isinstance(data, list) else data.get("targets", [])

                # Find match by name (case-insensitive)
                match_idx = next(
                    (i for i, p in enumerate(probes) if p.get("name", "").lower() == probe_name.lower()),
                    None
                )
                if match_idx is None:
                    available = [p.get("name") for p in probes]
                    return {"error": f"Probe '{probe_name}' not found. Available: {available}"}

                removed = probes.pop(match_idx)
                r = await client.post(
                    f"{base}/api/connectivity/custom",
                    json={"endpoints": probes},
                    headers=headers
                )
                r.raise_for_status()
                return {"success": True, "message": f"Probe '{removed.get('name')}' removed from {agent_id}"}
            except Exception as e:
                logger.error(f"Failed to remove DEM probe from {agent_id}: {e}")
                return {"error": str(e)}

    async def add_fabric_target(
        self, agent_id: str, name: str, host: str,
        voice: bool = True, convergence: bool = True,
        xfr: bool = True, security: bool = True, connectivity: bool = True
    ) -> Dict[str, Any]:
        """Add a new Stigix fabric target/peer to a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        body = {
            "name": name,
            "host": host,
            "enabled": True,
            "capabilities": {
                "voice": voice,
                "convergence": convergence,
                "xfr": xfr,
                "security": security,
                "connectivity": connectivity
            }
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/targets", json=body, headers=headers)
                r.raise_for_status()
                return {"success": True, "message": f"Target '{name}' ({host}) added to {agent_id}", "target": body}
            except Exception as e:
                logger.error(f"Failed to add fabric target to {agent_id}: {e}")
                return {"error": str(e)}

    async def remove_fabric_target(self, agent_id: str, target_name_or_host: str) -> Dict[str, Any]:
        """Remove a Stigix fabric target by name or host from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r_get = await client.get(f"{base}/api/targets", headers=headers)
                r_get.raise_for_status()
                data = r_get.json()
                targets = data if isinstance(data, list) else data.get("targets", [])

                key = target_name_or_host.lower()
                match = next(
                    (t for t in targets if
                     t.get("name", "").lower() == key or
                     t.get("host", "") == target_name_or_host or
                     t.get("id", "").startswith(target_name_or_host)),
                    None
                )
                if not match:
                    available = [(t.get("name"), t.get("host")) for t in targets]
                    return {"error": f"Target '{target_name_or_host}' not found. Available: {available}"}

                full_id = match.get("id")
                r = await client.delete(f"{base}/api/targets/{full_id}", headers=headers)
                r.raise_for_status()
                return {"success": True, "message": f"Target '{match.get('name')}' ({match.get('host')}) removed from {agent_id}"}
            except Exception as e:
                logger.error(f"Failed to remove fabric target from {agent_id}: {e}")
                return {"error": str(e)}

    async def set_fabric_target_enabled(self, agent_id: str, target_name_or_host: str, enabled: bool) -> Dict[str, Any]:
        """Enable or disable a Stigix fabric target on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r_get = await client.get(f"{base}/api/targets", headers=headers)
                r_get.raise_for_status()
                data = r_get.json()
                targets = data if isinstance(data, list) else data.get("targets", [])

                key = target_name_or_host.lower()
                match = next(
                    (t for t in targets if
                     t.get("name", "").lower() == key or
                     t.get("host", "") == target_name_or_host or
                     t.get("id", "").startswith(target_name_or_host)),
                    None
                )
                if not match:
                    available = [(t.get("name"), t.get("host")) for t in targets]
                    return {"error": f"Target '{target_name_or_host}' not found. Available: {available}"}

                full_id = match.get("id")
                r = await client.put(f"{base}/api/targets/{full_id}", json={"enabled": enabled}, headers=headers)
                r.raise_for_status()
                state = "enabled" if enabled else "disabled"
                return {"success": True, "message": f"Target '{match.get('name')}' {state} on {agent_id}"}
            except Exception as e:
                logger.error(f"Failed to set target status on {agent_id}: {e}")
                return {"error": str(e)}

    async def set_traffic_client_count(self, agent_id: str, client_count: int) -> Dict[str, Any]:
        """Set the number of parallel traffic worker clients on a node (1-20)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        if not (1 <= client_count <= 20):
            return {"error": "client_count must be between 1 and 20."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(
                    f"{agent.api_base_url}/api/traffic/rate",
                    json={"client_count": client_count},
                    headers=headers
                )
                r.raise_for_status()
                return {"success": True, "message": f"Traffic density set to {client_count} parallel clients on {agent_id}"}
            except Exception as e:
                logger.error(f"Failed to set client count on {agent_id}: {e}")
                return {"error": str(e)}

    # -------------------------------------------------------------------------
    # Phase 3 Additions
    # -------------------------------------------------------------------------

    async def run_full_security_audit(self, agent_id: str) -> Dict[str, Any]:
        """
        Run the full security suite on a node: URL batch + DNS batch + EICAR threat test.
        Mirrors the CLI 'security suite' command. Returns aggregated results from all 3 tests.
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        audit: Dict[str, Any] = {"agent_id": agent_id, "phases": {}}

        # --- Phase 1: URL batch ---
        logger.info(f"[{agent_id}] Full audit: starting URL batch")
        url_result = await self.run_security_url_batch(agent_id)
        audit["phases"]["url_filtering"] = url_result

        # --- Phase 2: DNS batch ---
        logger.info(f"[{agent_id}] Full audit: starting DNS batch")
        dns_result = await self.run_security_dns_batch(agent_id)
        audit["phases"]["dns_security"] = dns_result

        # --- Phase 3: EICAR threat test (cloud URL) ---
        logger.info(f"[{agent_id}] Full audit: starting EICAR threat test")
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                # Try to get the cloud EICAR URL from the node itself
                cloud_r = await client.get(f"{base}/api/security/cloud-eicar-url", headers=headers)
                if cloud_r.status_code == 200:
                    eicar_url = cloud_r.json().get("url", "https://secure.eicar.org/eicar.com.txt")
                else:
                    eicar_url = "https://secure.eicar.org/eicar.com.txt"

                threat_r = await client.post(
                    f"{base}/api/security/threat-test",
                    json={"endpoint": eicar_url},
                    headers=headers
                )
                threat_r.raise_for_status()
                threat_data = threat_r.json()
                results = threat_data.get("results", [threat_data])
                blocked = sum(1 for r in results if r.get("status", "").lower() in ["blocked", "denied"])
                audit["phases"]["threat_prevention"] = {
                    "eicar_url": eicar_url,
                    "total": len(results),
                    "blocked": blocked,
                    "results": results
                }
            except Exception as e:
                logger.error(f"EICAR test failed for {agent_id}: {e}")
                audit["phases"]["threat_prevention"] = {"error": str(e)}

        # --- Global summary ---
        url_blocked = url_result.get("blocked", 0) if "error" not in url_result else 0
        url_total = url_result.get("total", 0) if "error" not in url_result else 0
        dns_blocked = dns_result.get("blocked", 0) if "error" not in dns_result else 0
        dns_total = dns_result.get("total", 0) if "error" not in dns_result else 0
        threat_phase = audit["phases"].get("threat_prevention", {})
        eicar_blocked = threat_phase.get("blocked", 0)
        eicar_total = threat_phase.get("total", 0)

        audit["summary"] = {
            "url_filtering": f"{url_blocked}/{url_total} blocked",
            "dns_security": f"{dns_blocked}/{dns_total} blocked",
            "threat_prevention": f"{eicar_blocked}/{eicar_total} blocked",
            "overall_score": f"{url_blocked + dns_blocked + eicar_blocked}/{url_total + dns_total + eicar_total} tests blocked"
        }
        return audit

    async def run_eicar_test(self, agent_id: str, custom_url: Optional[str] = None) -> Dict[str, Any]:
        """Run an EICAR threat prevention test. Uses cloud EICAR URL by default."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url

        async with httpx.AsyncClient(timeout=35.0) as client:
            try:
                # Resolve EICAR URL
                if custom_url:
                    eicar_url = custom_url
                else:
                    cloud_r = await client.get(f"{base}/api/security/cloud-eicar-url", headers=headers)
                    if cloud_r.status_code == 200:
                        eicar_url = cloud_r.json().get("url", "https://secure.eicar.org/eicar.com.txt")
                    else:
                        eicar_url = "https://secure.eicar.org/eicar.com.txt"

                logger.info(f"Running EICAR test on {agent_id} with URL: {eicar_url}")
                r = await client.post(
                    f"{base}/api/security/threat-test",
                    json={"endpoint": eicar_url},
                    headers=headers
                )
                r.raise_for_status()
                data = r.json()
                # Wrap non-dict responses for safety
                if not isinstance(data, dict):
                    data = {"results": data}
                data["eicar_url"] = eicar_url
                return data
            except Exception as e:
                logger.error(f"EICAR test failed on {agent_id}: {e}")
                return {"error": str(e)}

    async def get_public_ip(self, agent_id: str) -> Dict[str, Any]:
        """Fetch the public (WAN) exit IP address of a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/connectivity/public-ip", headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    return {"agent_id": agent_id, "public_ip": data.get("ip") or data.get("public_ip") or data}
                return {"agent_id": agent_id, "error": f"HTTP {r.status_code}"}
            except Exception as e:
                logger.error(f"Failed to get public IP for {agent_id}: {e}")
                return {"error": str(e)}

    async def list_apps(self, agent_id: str) -> Dict[str, Any]:
        """List the applications currently configured in the traffic simulation profile of a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/config/apps", headers=headers)
                r.raise_for_status()
                data = r.json()
                apps = data if isinstance(data, list) else data.get("apps", data.get("applications", []))
                return {"agent_id": agent_id, "count": len(apps) if isinstance(apps, list) else None, "apps": apps}
            except Exception as e:
                logger.error(f"Failed to list apps for {agent_id}: {e}")
                return {"error": str(e)}

    async def export_app_config(self, agent_id: str) -> Dict[str, Any]:
        """Export the full application traffic configuration from a node as JSON."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.get(
                    f"{agent.api_base_url}/api/config/applications/export?format=json",
                    headers=headers
                )
                r.raise_for_status()
                return {"agent_id": agent_id, "config": r.json()}
            except Exception as e:
                logger.error(f"Failed to export app config from {agent_id}: {e}")
                return {"error": str(e)}

    async def import_app_config(self, agent_id: str, config: Any) -> Dict[str, Any]:
        """Import an application traffic configuration to a node (overwrites current config)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        import json as _json
        content = _json.dumps(config) if not isinstance(config, str) else config

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.post(
                    f"{agent.api_base_url}/api/config/applications/import",
                    json={"content": content},
                    headers=headers
                )
                r.raise_for_status()
                return {"success": True, "agent_id": agent_id, "message": "Application config imported successfully"}
            except Exception as e:
                logger.error(f"Failed to import app config to {agent_id}: {e}")
                return {"error": str(e)}

    # -------------------------------------------------------------------------
    # Node Config Clone
    # -------------------------------------------------------------------------

    async def clone_node_config(
        self, source_id: str, target_id: str,
        scope: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Clone configuration from one Stigix node to another.

        Copies selected configuration components from source_id to target_id.
        Each component is cloned independently — partial success is possible.

        Scope options (default: all):
        - 'apps'             : Application traffic simulation profile
        - 'dem_probes'       : DEM / custom connectivity probes
        - 'security_profile' : Vendor security test profile (URL/DNS categories)
        - 'vyos_scenarios'   : VyOS failover scenarios/sequences

        Args:
            source_id: ID of the source node (e.g., 'BR8-Ubuntu')
            target_id: ID of the target node (e.g., 'ubuntubr5')
            scope: List of components to clone. Defaults to all components.
        """
        ALL_SCOPES = ["apps", "dem_probes", "security_profile", "vyos_scenarios"]
        if scope is None:
            scope = ALL_SCOPES

        unknown = [s for s in scope if s not in ALL_SCOPES]
        if unknown:
            return {"error": f"Unknown scope(s): {unknown}. Valid: {ALL_SCOPES}"}

        source = await self.registry.get_endpoint(source_id)
        if not source:
            return {"error": f"Source node '{source_id}' not found."}
        target = await self.registry.get_endpoint(target_id)
        if not target:
            return {"error": f"Target node '{target_id}' not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        results: Dict[str, Any] = {"source": source_id, "target": target_id, "components": {}}

        async with httpx.AsyncClient(timeout=20.0) as client:

            # --- Apps ---
            if "apps" in scope:
                try:
                    r = await client.get(
                        f"{source.api_base_url}/api/config/applications/export?format=json",
                        headers=headers
                    )
                    r.raise_for_status()
                    config_data = r.json()
                    import json as _json
                    content = _json.dumps(config_data) if not isinstance(config_data, str) else config_data
                    r2 = await client.post(
                        f"{target.api_base_url}/api/config/applications/import",
                        json={"content": content},
                        headers=headers
                    )
                    r2.raise_for_status()
                    results["components"]["apps"] = {"status": "ok", "message": "Application config cloned."}
                except Exception as e:
                    results["components"]["apps"] = {"status": "error", "error": str(e)}

            # --- DEM Probes ---
            if "dem_probes" in scope:
                try:
                    r = await client.get(f"{source.api_base_url}/api/connectivity/custom", headers=headers)
                    r.raise_for_status()
                    data = r.json()
                    probes = data if isinstance(data, list) else data.get("targets", [])
                    r2 = await client.post(
                        f"{target.api_base_url}/api/connectivity/custom",
                        json={"endpoints": probes},
                        headers=headers
                    )
                    r2.raise_for_status()
                    results["components"]["dem_probes"] = {"status": "ok", "count": len(probes), "message": f"{len(probes)} DEM probe(s) cloned."}
                except Exception as e:
                    results["components"]["dem_probes"] = {"status": "error", "error": str(e)}

            # --- Security Profile ---
            if "security_profile" in scope:
                try:
                    r = await client.get(f"{source.api_base_url}/api/security/profile", headers=headers)
                    r.raise_for_status()
                    profile = r.json()
                    r2 = await client.post(
                        f"{target.api_base_url}/api/security/profile",
                        json=profile,
                        headers=headers
                    )
                    r2.raise_for_status()
                    url_count = len(profile.get("url_filtering", {}).get("items", []))
                    dns_count = len(profile.get("dns_security", {}).get("items", []))
                    results["components"]["security_profile"] = {
                        "status": "ok",
                        "vendor": profile.get("vendor", "unknown"),
                        "url_categories": url_count,
                        "dns_domains": dns_count,
                        "message": f"Security profile ({profile.get('vendor', '?')}) cloned: {url_count} URL categories, {dns_count} DNS domains."
                    }
                except Exception as e:
                    results["components"]["security_profile"] = {"status": "error", "error": str(e)}

            # --- VyOS Scenarios ---
            if "vyos_scenarios" in scope:
                try:
                    r = await client.get(f"{source.api_base_url}/api/vyos/sequences", headers=headers)
                    r.raise_for_status()
                    data = r.json()
                    sequences = data if isinstance(data, list) else data.get("sequences", [])
                    cloned = 0
                    errors = []
                    for seq in sequences:
                        try:
                            r2 = await client.post(
                                f"{target.api_base_url}/api/vyos/sequences",
                                json=seq,
                                headers=headers
                            )
                            if r2.status_code in [200, 201]:
                                cloned += 1
                            else:
                                errors.append(seq.get("name", "?"))
                        except Exception as ex:
                            errors.append(f"{seq.get('name', '?')}: {ex}")
                    results["components"]["vyos_scenarios"] = {
                        "status": "ok" if not errors else "partial",
                        "cloned": cloned,
                        "errors": errors,
                        "message": f"{cloned}/{len(sequences)} VyOS scenarios cloned."
                    }
                except Exception as e:
                    results["components"]["vyos_scenarios"] = {"status": "error", "error": str(e)}

        # Summary
        statuses = [v.get("status") for v in results["components"].values()]
        if all(s == "ok" for s in statuses):
            results["summary"] = "✅ All components cloned successfully."
        elif any(s == "ok" for s in statuses):
            results["summary"] = "⚠️ Partial clone — some components failed."
        else:
            results["summary"] = "❌ Clone failed for all components."

        return results

    # -------------------------------------------------------------------------
    # Phase 4 Additions
    # -------------------------------------------------------------------------


    async def get_convergence_history(self, agent_id: str, limit: int = 10) -> Dict[str, Any]:
        """Fetch the convergence/failover test history for a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/convergence/history", headers=headers)
                r.raise_for_status()
                data = r.json()
                rows = data if isinstance(data, list) else data.get("results", [])
                rows = rows[:limit]

                # Enrich each row with a human-readable verdict
                def verdict(max_bo: Any) -> str:
                    if max_bo is None:
                        return "UNKNOWN"
                    try:
                        mb = float(max_bo)
                    except Exception:
                        return "UNKNOWN"
                    if mb == 0:
                        return "PERFECT"
                    if mb < 1000:
                        return "GOOD"
                    if mb < 5000:
                        return "DEGRADED"
                    if mb < 10000:
                        return "BAD"
                    return "CRITICAL"

                for row in rows:
                    max_bo = None
                    for key in ("max_blackout_ms", "maxBlackout", "blackout"):
                        if key in row:
                            max_bo = row[key]
                            break
                    row["verdict"] = verdict(max_bo)
                    row["max_blackout_ms"] = max_bo

                return {"agent_id": agent_id, "count": len(rows), "history": rows}
            except Exception as e:
                logger.error(f"Failed to fetch convergence history for {agent_id}: {e}")
                return {"error": str(e)}

    async def list_security_results(self, agent_id: str, limit: int = 20) -> Dict[str, Any]:
        """Fetch the last N individual security test results from a node (all types)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(
                    f"{agent.api_base_url}/api/security/results?limit={limit}",
                    headers=headers
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results", data if isinstance(data, list) else [])
                return {"agent_id": agent_id, "count": len(results), "results": results}
            except Exception as e:
                logger.error(f"Failed to list security results for {agent_id}: {e}")
                return {"error": str(e)}

    async def compare_nodes(self, agent_id_a: str, agent_id_b: str) -> Dict[str, Any]:
        """
        Compare two Stigix nodes side-by-side across key dimensions:
        health, traffic, DEM probe health, security score, and fabric peers.
        """
        # Fetch both nodes in parallel
        results = await asyncio.gather(
            self._fetch_node_snapshot(agent_id_a),
            self._fetch_node_snapshot(agent_id_b),
            return_exceptions=True
        )

        snap_a = results[0] if not isinstance(results[0], Exception) else {"error": str(results[0])}
        snap_b = results[1] if not isinstance(results[1], Exception) else {"error": str(results[1])}

        comparison: Dict[str, Any] = {
            "nodes": [agent_id_a, agent_id_b],
            agent_id_a: snap_a,
            agent_id_b: snap_b,
            "diff": {}
        }

        # Build a human-readable diff summary
        if "error" not in snap_a and "error" not in snap_b:
            diff = {}

            # Traffic running?
            ta = snap_a.get("traffic_running")
            tb = snap_b.get("traffic_running")
            if ta != tb:
                diff["traffic_running"] = {agent_id_a: ta, agent_id_b: tb}

            # Version match?
            va = snap_a.get("version")
            vb = snap_b.get("version")
            if va != vb:
                diff["version"] = {agent_id_a: va, agent_id_b: vb}

            # DEM global health
            dha = snap_a.get("dem_global_health")
            dhb = snap_b.get("dem_global_health")
            if dha != dhb:
                diff["dem_global_health"] = {agent_id_a: dha, agent_id_b: dhb}

            # Security stats
            sec_a = snap_a.get("security_blocked_pct")
            sec_b = snap_b.get("security_blocked_pct")
            if sec_a != sec_b:
                diff["security_blocked_pct"] = {agent_id_a: sec_a, agent_id_b: sec_b}

            # Peer count
            pc_a = snap_a.get("fabric_peer_count")
            pc_b = snap_b.get("fabric_peer_count")
            if pc_a != pc_b:
                diff["fabric_peer_count"] = {agent_id_a: pc_a, agent_id_b: pc_b}

            comparison["diff"] = diff
            comparison["identical"] = len(diff) == 0

        return comparison

    async def _fetch_node_snapshot(self, agent_id: str) -> Dict[str, Any]:
        """Internal helper: fetch a compact snapshot of one node for comparison."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        snapshot: Dict[str, Any] = {"agent_id": agent_id}

        async with httpx.AsyncClient(timeout=12.0) as client:
            # Health + version
            for path, key in [
                ("/api/system/health", "health"),
                ("/api/version", "version"),
            ]:
                try:
                    r = await client.get(f"{base}{path}", headers=headers)
                    if r.status_code == 200:
                        raw = r.json()
                        snapshot[key] = raw
                        if key == "version":
                            # Flatten version string for easy comparison
                            snapshot["version"] = raw.get("version") or raw.get("tag")
                except Exception:
                    pass

            # Traffic status
            try:
                r = await client.get(f"{base}/api/traffic/status", headers=headers)
                if r.status_code == 200:
                    d = r.json()
                    snapshot["traffic_running"] = d.get("running") or d.get("active") or d.get("status") == "running"
            except Exception:
                pass

            # DEM global health score
            try:
                r = await client.get(f"{base}/api/connectivity/stats?range=1h", headers=headers)
                if r.status_code == 200:
                    d = r.json()
                    snapshot["dem_global_health"] = d.get("global_health") or d.get("score")
            except Exception:
                pass

            # Security blocked %
            try:
                r = await client.get(f"{base}/api/security/results/stats", headers=headers)
                if r.status_code == 200:
                    d = r.json()
                    total = d.get("total", 0)
                    blocked = d.get("blocked", 0)
                    snapshot["security_blocked_pct"] = round(blocked / total * 100, 1) if total else None
                    snapshot["security_stats"] = d
            except Exception:
                pass

            # Fabric peer count
            try:
                r = await client.get(f"{base}/api/targets", headers=headers)
                if r.status_code == 200:
                    d = r.json()
                    targets = d if isinstance(d, list) else d.get("targets", [])
                    snapshot["fabric_peer_count"] = len(targets)
            except Exception:
                pass

        return snapshot

    async def generate_report(self, agent_ids: Optional[list] = None) -> Dict[str, Any]:
        """
        Generate a fabric-wide summary report across all (or specified) nodes.
        Returns per-node status, aggregate health, security posture, and traffic overview.
        """
        # Resolve agent list
        if not agent_ids:
            all_agents = await self.registry.list_endpoints()
            agent_ids = [a.meta.get("site_name") or a.id for a in all_agents] if all_agents else []

        if not agent_ids:
            return {"error": "No agents registered in the registry."}

        # Fetch snapshots in parallel
        tasks = [self._fetch_node_snapshot(aid) for aid in agent_ids]
        snapshots = await asyncio.gather(*tasks, return_exceptions=True)

        nodes = []
        healthy_count = 0
        traffic_running_count = 0
        total_peers = 0

        for i, snap in enumerate(snapshots):
            if isinstance(snap, Exception):
                nodes.append({"agent_id": agent_ids[i], "error": str(snap)})
                continue
            nodes.append(snap)

            # Aggregate metrics
            health = snap.get("health", {})
            is_healthy = isinstance(health, dict) and health.get("status") in ("ok", "healthy", "ready")
            if is_healthy:
                healthy_count += 1
            if snap.get("traffic_running"):
                traffic_running_count += 1
            total_peers += snap.get("fabric_peer_count", 0)

        report = {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "node_count": len(agent_ids),
            "summary": {
                "healthy_nodes": healthy_count,
                "unhealthy_nodes": len(agent_ids) - healthy_count,
                "traffic_running": traffic_running_count,
                "total_fabric_peers": total_peers,
            },
            "nodes": nodes
        }
        return report

    async def query_prisma_flows(self, agent_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """
        Query the Prisma SD-WAN Flow Browser via the Stigix node's local API.
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                r = await client.post(
                    f"{agent.api_base_url}/api/prisma/flows",
                    json=body,
                    headers=headers
                )
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Prisma flow query on {agent_id}", e)

    # -------------------------------------------------------------------------
    # System Health Matrix & Diagnostics (Phase 1)
    # -------------------------------------------------------------------------

    async def get_health_matrix(self, agent_id: str) -> Dict[str, Any]:
        """Fetch the 360-degree system health matrix across all 9 subsystems."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/system/health-matrix", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Health matrix fetch on {agent_id}", e)

    async def run_system_diagnostics(self, agent_id: str) -> Dict[str, Any]:
        """Run live round-trip latency diagnostics across all subsystems."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/system/health-matrix/diagnostics", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"System diagnostics on {agent_id}", e)

    # -------------------------------------------------------------------------
    # Voice / VoIP Analytics & Ingress (Phase 1)
    # -------------------------------------------------------------------------

    async def get_voice_stats(self, agent_id: str) -> Dict[str, Any]:
        """Fetch outbound voice simulation metrics (MOS score, jitter, loss %, RTT)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/voice/stats", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Voice stats on {agent_id}", e)

    async def get_voice_ingress(self, agent_id: str) -> Dict[str, Any]:
        """Fetch inbound VoIP calls received on port 6100 with identified site tags and MOS."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/voice/ingress", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Voice ingress fetch on {agent_id}", e)

    # -------------------------------------------------------------------------
    # Custom TCP Applications (Phase 2)
    # -------------------------------------------------------------------------

    async def list_custom_tcp_apps(self, agent_id: str) -> Dict[str, Any]:
        """List configured Custom TCP Applications and their operational status."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/summary/all", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"List Custom TCP Apps on {agent_id}", e)

    async def start_tcp_app_listener(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Start the local host TCP listener for a custom TCP application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/start-listener", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Start TCP listener {app_id} on {agent_id}", e)

    async def stop_tcp_app_listener(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Stop the local host TCP listener for a custom TCP application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/stop-listener", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Stop TCP listener {app_id} on {agent_id}", e)

    async def start_tcp_app_workload(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Start client workload generator for a custom TCP application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/start-client", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Start TCP client {app_id} on {agent_id}", e)

    async def stop_tcp_app_workload(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Stop client workload generator for a custom TCP application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/stop-client", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Stop TCP client {app_id} on {agent_id}", e)

    async def test_tcp_app_handshake(self, agent_id: str, app_id: str, peer_id: Optional[str] = None) -> Dict[str, Any]:
        """Run an instant TCP 3-way handshake latency test to a target peer."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        body = {"peerId": peer_id} if peer_id else {}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/test", json=body, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Test TCP app {app_id} on {agent_id}", e)

    async def get_tcp_app_sessions(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """List active incoming and outgoing TCP sessions for an application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/sessions", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Get TCP sessions for {app_id} on {agent_id}", e)

    async def reset_tcp_app_metrics(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Reset operational latency and bandwidth counters for a TCP application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/reset", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Reset metrics for {app_id} on {agent_id}", e)

    # -------------------------------------------------------------------------
    # Target Controller & Mesh Leader (Phase 2)
    # -------------------------------------------------------------------------

    async def get_controller_status(self, agent_id: str) -> Dict[str, Any]:
        """Fetch Target Controller role, site name, leader IP, and peer count."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/registry/status", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Controller status on {agent_id}", e)

    async def list_controller_peers(self, agent_id: str) -> Dict[str, Any]:
        """List all remote branch nodes registered with the Leader."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/registry/status", headers=headers)
                r.raise_for_status()
                data = r.json()
                peers = data.get("peers", [])
                return {
                    "is_leader": data.get("is_leader", False),
                    "site_name": data.get("site_name"),
                    "peer_count": len(peers),
                    "peers": peers
                }
            except Exception as e:
                return self._handle_exception(f"List controller peers on {agent_id}", e)

    async def set_controller_leader(self, agent_id: str, leader_url: Optional[str] = None) -> Dict[str, Any]:
        """Set a static central leader IP/URL or revert to dynamic autodiscovery."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                if leader_url:
                    r = await client.post(f"{agent.api_base_url}/api/registry/static-leader", json={"url": leader_url}, headers=headers)
                else:
                    r = await client.post(f"{agent.api_base_url}/api/registry/autodiscover", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Set controller leader on {agent_id}", e)

    async def generate_peer_onboard_command(self, agent_id: str) -> Dict[str, Any]:
        """Generate a curl one-liner onboarding command to connect a new branch node to the mesh."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/registry/onboard-command", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Generate onboard command on {agent_id}", e)

    # -------------------------------------------------------------------------
    # Global Configuration Provisioning (Phase 2)
    # -------------------------------------------------------------------------

    async def get_provisioning_status(self, agent_id: str) -> Dict[str, Any]:
        """Fetch Global Provisioning pull mode status, active bundle revisions, and pending changes."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/provisioning/config", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Provisioning status on {agent_id}", e)

    async def set_provisioning_mode(self, agent_id: str, enabled: bool) -> Dict[str, Any]:
        """Enable or disable Global Provisioning pull daemon on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/provisioning/config", json={"enabled": enabled}, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Set provisioning mode on {agent_id}", e)

    async def publish_configuration_bundle(self, agent_id: str, bundle_type: str = "all") -> Dict[str, Any]:
        """Publish local configuration bundle(s) across the entire SD-WAN mesh."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/provisioning/publish", json={"type": bundle_type}, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Publish bundle {bundle_type} on {agent_id}", e)

    async def rollback_configuration_bundle(self, agent_id: str, bundle_type: str, revision: str) -> Dict[str, Any]:
        """Rollback a specific configuration bundle to a prior revision hash."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/provisioning/rollback", json={"type": bundle_type, "revision": revision}, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Rollback bundle {bundle_type} to rev {revision} on {agent_id}", e)

    async def get_provisioning_history(self, agent_id: str, limit: int = 15) -> Dict[str, Any]:
        """Fetch the audit trail of published configuration bundles and rollbacks."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/provisioning/history?limit={limit}", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Provisioning history on {agent_id}", e)
