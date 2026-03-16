import logging
import uuid
import httpx
import jwt
import os
from datetime import datetime, timedelta
from typing import Dict, Optional
from .registry import RegistryClient
from ..types import TestRun, TestStatus, StigixEndpoint

logger = logging.getLogger(__name__)

class TestOrchestrator:
    """
    Orchestrates tests between Stigix endpoints.
    v2: Real implementation sending commands to source agents.
    """
    
    def __init__(self):
        # Store for mapping global_test_id -> {source_base_url, local_id}
        self._test_mappings: Dict[str, Dict] = {}
        self.jwt_secret = os.getenv("JWT_SECRET", "your-secure-secret-here")
        self.registry = RegistryClient()

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
                    payload = {
                        "target": target_ip,
                        "port": 6100, # Convergence probe port
                        # Use pps directly if provided, else fallback to bitrate or 50
                        "rate": pps if pps is not None else (int(bitrate.replace('M', '')) if bitrate and 'M' in bitrate else 50),
                        "label": label # None defaults to native ID in backend
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
                    # We might want to continue for other targets
        
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

    async def trigger_security_test(self, agent_id: str, test_type: str, target: str) -> Dict[str, Any]:
        """Trigger a security test (DNS, URL, or Threat)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        
        # Route mapping
        if test_type == "dns":
            url = f"{agent.api_base_url}/api/security/dns-test"
            # Label: domain (MCP) to show target in history
            payload = {"domain": target, "testName": f"{target} (MCP)"}
        elif test_type == "url":
            url = f"{agent.api_base_url}/api/security/url-test"
            # Label: target (MCP) to show target in history
            payload = {"url": target, "category": f"{target} (MCP)"}
        elif test_type == "threat":
            url = f"{agent.api_base_url}/api/security/threat-test"
            if target.startswith("STIGIX-"): # Scenario ID
                payload = {"scenarioId": target}
            else:
                payload = {"endpoint": target}
        else:
            return {"error": f"Unsupported security test type: {test_type}"}
            
        logger.info(f"Triggering {test_type} security probe for agent {agent_id} on target: {target}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                # Enrich with target info for MCP visibility
                if isinstance(data, dict):
                    data["mcp_target"] = target
                    data["mcp_api_url"] = url
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

    async def get_dem_stats(self, agent_id: str) -> Dict[str, Any]:
        """Fetch Digital Experience Monitoring (DEM) stats from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        url = f"{agent.api_base_url}/api/admin/system/dashboard-data"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                return data.get("dem", {})
            except Exception as e:
                logger.error(f"Failed to fetch DEM stats for {agent_id}: {e}")
                return {"error": str(e)}

    async def get_probe_performance(self, agent_id: str, probe_name: str) -> Dict[str, Any]:
        """Fetch detailed performance metrics for a specific probe."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        # In a real scenario, we might have a dedicated endpoint for rich details,
        # but for now we'll fetch recently logged results and find the match.
        url = f"{agent.api_base_url}/api/admin/system/dashboard-data"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                dem = data.get("dem", {})
                last_results = dem.get("lastResults", [])
                
                # Try exact match or fuzzy match by name/IP
                probe_lower = probe_name.lower()
                match = next((r for r in last_results if probe_lower in r.get("name", "").lower() or probe_lower in r.get("id", "").lower()), None)
                
                if not match:
                    return {"error": f"Probe '{probe_name}' not found in recent results. Available: {[r.get('name') for r in last_results[:10]]}"}
                
                return match
            except Exception as e:
                logger.error(f"Failed to fetch probe details for {agent_id}: {e}")
                return {"error": str(e)}
