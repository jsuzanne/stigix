import asyncio
import logging
import uuid
import httpx
import jwt
import os
import re
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
        self.jwt_secret = os.getenv("JWT_SECRET", "super-secret-key-change-this")
        self.registry = RegistryClient()

    def _handle_exception(self, context: str, e: Exception) -> Dict[str, Any]:
        err_msg = str(e) or repr(e) or type(e).__name__
        logger.error(f"{context} failed: {err_msg}")
        if isinstance(e, httpx.HTTPStatusError):
            body_preview = e.response.text[:300] if e.response is not None else ""
            status_code = e.response.status_code if e.response is not None else 500
            url = str(e.request.url) if e.request else ""
            return {
                "success": False,
                "status": "error",
                "error": f"{context} failed with HTTP {status_code}: {err_msg}",
                "status_code": status_code,
                "url": url,
                "body_preview": body_preview
            }
        return {
            "success": False,
            "status": "error",
            "error": f"{context} failed: {err_msg}",
            "status_code": 500,
            "exception_type": type(e).__name__
        }

    def _extract_counter(self, val: Any) -> int:
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, (list, dict)):
            return len(val)
        return 0

    def _normalize_history_entry_counters(self, entry: Dict[str, Any]) -> None:
        summary = entry.get("summary") if isinstance(entry.get("summary"), dict) else {}
        diff = entry.get("diff") if isinstance(entry.get("diff"), dict) else {}

        if "addedCount" not in entry or entry.get("addedCount") == 0:
            added = self._extract_counter(summary.get("added")) or self._extract_counter(diff.get("added"))
            if added > 0:
                entry["addedCount"] = added
        if "modifiedCount" not in entry or entry.get("modifiedCount") == 0:
            mod = self._extract_counter(summary.get("modified")) or self._extract_counter(diff.get("modified"))
            if mod > 0:
                entry["modifiedCount"] = mod
        if "deletedCount" not in entry or entry.get("deletedCount") == 0:
            deleted = self._extract_counter(summary.get("removed")) or self._extract_counter(summary.get("deleted")) or self._extract_counter(diff.get("removed")) or self._extract_counter(diff.get("deleted"))
            if deleted > 0:
                entry["deletedCount"] = deleted

    def _compact_history_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        summary = entry.get("summary") if isinstance(entry.get("summary"), dict) else {}
        diff = entry.get("diff") if isinstance(entry.get("diff"), dict) else {}
        added = self._extract_counter(summary.get("added")) or self._extract_counter(diff.get("added"))
        modified = self._extract_counter(summary.get("modified")) or self._extract_counter(diff.get("modified"))
        deleted = self._extract_counter(summary.get("removed")) or self._extract_counter(summary.get("deleted")) or self._extract_counter(diff.get("removed")) or self._extract_counter(diff.get("deleted"))

        checksum = entry.get("checksum") or (entry.get("bundle", {}).get("checksum") if isinstance(entry.get("bundle"), dict) else None)
        short_chk = f"{checksum[:8]}..." if checksum and isinstance(checksum, str) else None

        return {
            "timestamp": entry.get("timestamp") or entry.get("appliedAt"),
            "action": entry.get("action") or "publish",
            "type": entry.get("type"),
            "revision": entry.get("revision"),
            "checksum": short_chk,
            "itemsCount": entry.get("itemsCount") or entry.get("count") or (len(entry.get("items", [])) if isinstance(entry.get("items"), list) else None),
            "addedCount": added,
            "modifiedCount": modified,
            "deletedCount": deleted,
            "status": entry.get("status") or "applied"
        }
    def _is_json_response(self, r: httpx.Response) -> bool:
        """Check if an HTTP response is valid JSON and not an HTML SPA fallback."""
        ct = r.headers.get("content-type", "")
        if "text/html" in ct:
            return False
        text = r.text.strip()
        if text.startswith("<!doctype") or text.startswith("<!DOCTYPE") or text.startswith("<html"):
            return False
        try:
            r.json()
            return True
        except Exception:
            return False

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
        
        # Determine test type and port routing
        is_convergence_profile = any(k in profile.lower() for k in ["conv", "failover", "path", "probe"])
        is_xfr_profile = any(k in profile.lower() for k in ["xfr", "speedtest", "throughput"])
        is_voice_profile = "voice" in profile.lower()
        is_iot_profile = "iot" in profile.lower()

        if not (is_convergence_profile or is_xfr_profile or is_voice_profile or is_iot_profile):
            raise ValueError(
                f"Unknown test profile '{profile}'. Supported profiles are: "
                f"'conv' / 'failover' (UDP port 6200), 'xfr' / 'speedtest' (Port 9000/5201), "
                f"'voice' (UDP port 6100), 'iot' (Fleet simulation)."
            )

        # Validate capabilities for ALL targets before starting any test
        for target in targets:
            self._validate_target_capabilities(target, profile, is_xfr_profile, is_convergence_profile, is_voice_profile)
        
        # Convert duration (e.g., '10s') to seconds
        duration_sec = 10
        if duration.endswith('s'):
            duration_sec = int(duration[:-1])
        elif duration.endswith('m'):
            duration_sec = int(duration[:-1]) * 60

        # --- XFR: dynamic timeout = test duration + 60s headroom ---
        xfr_timeout = duration_sec + 60 if is_xfr_profile else 10

        test_runs = []
        headers = {"Authorization": f"Bearer {self._generate_token()}"}

        async with httpx.AsyncClient(timeout=float(xfr_timeout)) as client:
            for target in targets:
                target_ip = target.test_ip if target.kind == "fabric" else target.public_ip
                if not target_ip:
                    logger.warning(f"Target {target.id} has no valid IP, skipping.")
                    continue

                if is_xfr_profile:
                    api_url = f"{source.api_base_url}/api/tests/xfr"
                    payload = {
                        "mode": "custom",
                        "target": { "host": target_ip, "port": 9000 }, # XFR multi-stream daemon port (9000)
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
                    # Convergence probe daemon listens strictly on UDP 6200
                    conv_port = 6200
                    payload = {
                        "target": target_ip,
                        "port": conv_port, # Convergence SLA probe port (UDP 6200)
                        # Use pps directly if provided, else fallback to bitrate or 50
                        "rate": pps if pps is not None else (int(bitrate.replace('M', '')) if bitrate and 'M' in bitrate else 50),
                        "label": effective_label
                    }
                elif is_voice_profile:
                    api_url = f"{source.api_base_url}/api/voice/control"
                    payload = {
                        "enabled": True,
                        "target": target_ip,
                        "port": 6100 # VoIP RTP voice echo port (UDP 6100)
                    }
                elif is_iot_profile:
                    api_url = f"{source.api_base_url}/api/iot/control"
                    payload = {
                        "enabled": True
                    }
                else:
                    raise ValueError(f"Unresolved port routing for profile '{profile}'.")

                # Generate local global ID for tracking
                global_id = f"G-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                
                try:
                    logger.info(f"Triggering test on {api_url} with payload {payload}")
                    response = await client.post(api_url, json=payload, headers=headers)
                    response.raise_for_status()
                    result = response.json()
                    
                    # Capture the native reference (sequence_id e.g. XFR-0007 / CONV-0001)
                    local_id = result.get("sequence_id") or result.get("testId") or result.get("id") or "CONV-000"

                    # ── XFR: results are synchronous — extract them now ──────────────
                    # The XFR daemon blocks until the test completes, then returns the
                    # full summary inline. Capture it here so Claude never has to guess.
                    xfr_inline_result: Optional[dict] = None
                    if is_xfr_profile:
                        # The response IS the completed job — extract metrics immediately
                        summary = result.get("summary") or {}
                        if summary or result.get("status") in ("completed", "finished", "success"):
                            throughput = (
                                summary.get("received_mbps") or summary.get("sent_mbps") or
                                summary.get("throughput_mbps") or summary.get("avg_bandwidth_mbps") or 0
                            )
                            xfr_inline_result = {
                                "throughput_mbps": float(throughput),
                                "sent_mbps": float(summary.get("sent_mbps") or 0),
                                "received_mbps": float(summary.get("received_mbps") or 0),
                                "loss_percent": float(summary.get("loss_percent") or 0),
                                "retransmits": int(summary.get("retransmits") or 0),
                                "bytes_total": int(summary.get("bytes_total") or 0),
                                "latency_ms": float(summary.get("rtt_ms_avg") or summary.get("rtt_ms") or 0),
                                "status": result.get("status", "completed"),
                                "started_at": result.get("started_at"),
                                "finished_at": result.get("finished_at"),
                            }
                    
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
                        status="finished" if (is_xfr_profile and xfr_inline_result) else "running",
                        # Carry inline XFR result so the MCP layer can expose it immediately
                        **({"xfr_result": xfr_inline_result} if xfr_inline_result else {})
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
        mapping = None
        if test_id in self._test_mappings:
            mapping = self._test_mappings[test_id]
        else:
            # Check if test_id is a local_id / sequence_id in active mappings
            mapping_key = next((k for k, v in self._test_mappings.items() if str(v.get("local_id", "")).lower() == test_id.lower()), None)
            if mapping_key:
                mapping = self._test_mappings[mapping_key]

        headers = {"Authorization": f"Bearer {self._generate_token()}"}

        # If still not found, search across registered agents
        if not mapping:
            try:
                endpoints = await self.registry.get_endpoints()
                for ep in endpoints:
                    async with httpx.AsyncClient(timeout=3.0) as scan_client:
                        # 1. Try XFR
                        try:
                            xfr_res = await scan_client.get(f"{ep.api_base_url}/api/tests/xfr", headers=headers)
                            if xfr_res.status_code == 200:
                                xfr_data = xfr_res.json()
                                jobs = xfr_data if isinstance(xfr_data, list) else xfr_data.get("jobs", [])
                                matched = next((j for j in jobs if str(j.get("id", "")).lower() == test_id.lower() or str(j.get("sequence_id", "")).lower() == test_id.lower()), None)
                                if matched:
                                    mapping = {
                                        "source_url": ep.api_base_url,
                                        "local_id": matched.get("sequence_id") or matched.get("id"),
                                        "source_id": ep.id,
                                        "target_id": matched.get("params", {}).get("target", {}).get("host") or matched.get("params", {}).get("host", "unknown"),
                                        "is_convergence": False
                                    }
                                    break
                        except Exception:
                            pass

                        # 2. Try Convergence Status / History
                        try:
                            conv_res = await scan_client.get(f"{ep.api_base_url}/api/convergence/status", headers=headers)
                            if conv_res.status_code == 200:
                                conv_data = conv_res.json()
                                c_jobs = conv_data if isinstance(conv_data, list) else []
                                c_matched = next((c for c in c_jobs if str(c.get("testId", "")).lower() == test_id.lower() or str(c.get("test_id", "")).lower() == test_id.lower()), None)
                                if c_matched:
                                    mapping = {
                                        "source_url": ep.api_base_url,
                                        "local_id": c_matched.get("testId") or c_matched.get("test_id"),
                                        "source_id": ep.id,
                                        "target_id": c_matched.get("target", "unknown"),
                                        "is_convergence": True
                                    }
                                    break
                        except Exception:
                            pass
            except Exception as e:
                logger.warning(f"Error scanning endpoints for test {test_id}: {e}")

        if not mapping:
            raise ValueError(f"Test {test_id} not found.")
        
        if mapping.get("is_convergence"):
            api_url = f"{mapping['source_url']}/api/convergence/status"
        else:
            api_url = f"{mapping['source_url']}/api/tests/xfr"
        
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
                                    matching_jobs = [j for j in history if str(j.get("testId", "")).startswith(mapping["local_id"]) or str(j.get("test_id", "")).startswith(mapping["local_id"])]
                                    if matching_jobs:
                                        job = matching_jobs[-1]
                                        job["running"] = False # Mark as finished
                        except Exception as e:
                            logger.warning(f"Failed to fetch history from {mapping['source_url']}: {e}")

                    if not job:
                        logger.warning(f"Job {mapping['local_id']} not found in convergence status or history on {mapping['source_url']}")
                        return TestStatus(test_id=test_id, status="unknown", source_id=mapping["source_id"], target_id=mapping["target_id"])
                    
                    # ── Full convergence metrics from daemon ───────────────────
                    def _bo_verdict(max_bo: Any) -> str:
                        if max_bo is None:
                            return "UNKNOWN"
                        try:
                            mb = float(max_bo)
                        except Exception:
                            return "UNKNOWN"
                        if mb == 0: return "PERFECT"
                        if mb < 1000: return "GOOD"
                        if mb < 5000: return "DEGRADED"
                        if mb < 10000: return "BAD"
                        return "CRITICAL"

                    max_bo = job.get("max_blackout_ms") or job.get("maxBlackout") or job.get("blackout")
                    metrics = {
                        # Packet counts
                        "sent": job.get("sent") or job.get("tx_total") or 0,
                        "received": job.get("received") or job.get("rx_total") or 0,
                        # Overall loss
                        "loss_percent": job.get("loss_pct") or job.get("loss_percent") or 0,
                        # Directional loss
                        "uplink_loss_pct": job.get("uplink_loss_pct") or job.get("uplinkLoss") or 0,
                        "downlink_loss_pct": job.get("downlink_loss_pct") or job.get("downlinkLoss") or 0,
                        # Blackout
                        "max_blackout_ms": max_bo,
                        "blackout_count": job.get("blackout_count") or job.get("blackoutCount") or 0,
                        "total_blackout_ms": job.get("total_blackout_ms") or job.get("totalBlackoutMs") or 0,
                        # RTT
                        "latency_ms": job.get("avg_rtt_ms") or job.get("latency_ms") or 0,
                        "min_latency_ms": job.get("min_rtt_ms") or job.get("minRtt") or 0,
                        "max_latency_ms": job.get("max_rtt_ms") or job.get("maxRtt") or 0,
                        # Jitter
                        "jitter_ms": job.get("jitter_ms") or job.get("avg_jitter_ms") or 0,
                        "min_jitter_ms": job.get("min_jitter_ms") or job.get("minJitter") or 0,
                        "max_jitter_ms": job.get("max_jitter_ms") or job.get("maxJitter") or 0,
                        # Metadata
                        "duration_s": job.get("duration_s") or job.get("durationSec") or 0,
                        "egress_path": job.get("egress_path") or job.get("egressPath") or "",
                        "verdict": _bo_verdict(max_bo),
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
                    # Match by unique string ID or sequence_id
                    job = next((j for j in data if str(j.get("id")) == str(mapping["local_id"]) or str(j.get("sequence_id")) == str(mapping["local_id"])), None)
                
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
                
                throughput = summary.get("received_mbps", 0) or summary.get("sent_mbps", 0) or summary.get("throughput_mbps", 0) or summary.get("avg_bandwidth_mbps", 0)
                
                metrics = {
                    "throughput_mbps": float(throughput),
                    "loss_percent": float(summary.get("loss_percent", 0)),
                    "latency_ms": float(summary.get("rtt_ms_avg", 0) or summary.get("rtt_ms", 0)),
                    "sent_mbps": float(summary.get("sent_mbps", 0)),
                    "received_mbps": float(summary.get("received_mbps", 0)),
                    "retransmits": int(summary.get("retransmits", 0)),
                    "bytes_total": int(summary.get("bytes_total", 0)),
                    "started_at": job.get("started_at"),
                    "finished_at": job.get("finished_at")
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
            try:
                # POST with empty body as per server.ts implementation for start/stop
                response = await client.post(api_url, json={}, headers=headers)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to set traffic status on {source.id}: {e}")
                return {"error": str(e)}

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

                            def _stop_verdict(max_bo: Any) -> str:
                                if max_bo is None: return "UNKNOWN"
                                try:
                                    mb = float(max_bo)
                                except Exception:
                                    return "UNKNOWN"
                                if mb == 0: return "PERFECT"
                                if mb < 1000: return "GOOD"
                                if mb < 5000: return "DEGRADED"
                                if mb < 10000: return "BAD"
                                return "CRITICAL"

                            max_bo = job.get("max_blackout_ms") or job.get("maxBlackout") or job.get("blackout")
                            return {
                                "success": True,
                                "message": "Test stopped and final metrics captured",
                                "metrics": {
                                    # Packet counts
                                    "sent": job.get("sent") or job.get("tx_total") or 0,
                                    "received": job.get("received") or job.get("rx_total") or 0,
                                    # Overall loss
                                    "loss_pct": job.get("loss_pct") or job.get("loss_percent") or 0,
                                    # Directional loss
                                    "uplink_loss_pct": job.get("uplink_loss_pct") or job.get("uplinkLoss") or 0,
                                    "downlink_loss_pct": job.get("downlink_loss_pct") or job.get("downlinkLoss") or 0,
                                    # Blackout
                                    "max_blackout_ms": max_bo,
                                    "blackout_count": job.get("blackout_count") or job.get("blackoutCount") or 0,
                                    "total_blackout_ms": job.get("total_blackout_ms") or job.get("totalBlackoutMs") or 0,
                                    # RTT
                                    "latency_ms": job.get("avg_rtt_ms") or job.get("latency_ms") or 0,
                                    "min_latency_ms": job.get("min_rtt_ms") or job.get("minRtt") or 0,
                                    "max_latency_ms": job.get("max_rtt_ms") or job.get("maxRtt") or 0,
                                    # Jitter
                                    "jitter_ms": job.get("jitter_ms") or job.get("avg_jitter_ms") or 0,
                                    "min_jitter_ms": job.get("min_jitter_ms") or job.get("minJitter") or 0,
                                    "max_jitter_ms": job.get("max_jitter_ms") or job.get("maxJitter") or 0,
                                    # Metadata
                                    "duration_s": job.get("duration_s") or job.get("durationSec") or 0,
                                    "egress_path": job.get("egress_path") or job.get("egressPath") or "",
                                    "verdict": _stop_verdict(max_bo),
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

    async def list_vyos_routers(self, agent_id: str) -> Dict[str, Any]:
        """List VyOS routers managed by a specific Stigix node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        url = f"{agent.api_base_url}/api/vyos/routers"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return {"routers": response.json()}
            except Exception as e:
                logger.error(f"Failed to list VyOS routers on {agent_id}: {e}")
                return {"error": str(e)}

    async def list_vyos_sequences(self, agent_id: str) -> Dict[str, Any]:
        """List available VyOS configuration sequences on a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        url = f"{agent.api_base_url}/api/vyos/sequences"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return {"scenarios": response.json()}
            except Exception as e:
                logger.error(f"Failed to list VyOS sequences on {agent_id}: {e}")
                return {"error": str(e)}

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

    async def get_vyos_history(self, agent_id: str, limit: int = 50) -> Dict[str, Any]:
        """Fetch VyOS action history from a specific node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}
            
        url = f"{agent.api_base_url}/api/vyos/history?limit={limit}"
        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return {"history": response.json()}
            except Exception as e:
                logger.error(f"Failed to fetch VyOS history from {agent_id}: {e}")
                return {"error": str(e)}

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

    async def get_vyos_interfaces(self, agent_id: str, router_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Return VyOS router interfaces with their descriptions.
        Used by Claude to identify which interface to target before executing an action.
        """
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

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
                return {"routers": result}
            except Exception as e:
                logger.error(f"Failed to fetch VyOS interfaces from {agent_id}: {e}")
                return {"error": str(e)}

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
                
                # Match by endpointName, endpointId, name, or id (NEVER by url or target)
                probe_lower = probe_name.strip().lower()
                probe_slug = re.sub(r'\s+', '-', probe_lower)
                match = next((
                    r for r in last_results 
                    if probe_lower == (r.get("endpointName") or r.get("name") or "").strip().lower()
                    or probe_lower == (r.get("endpointId") or r.get("id") or "").strip().lower()
                    or probe_slug == (r.get("endpointId") or r.get("id") or "").strip().lower()
                    or probe_slug == re.sub(r'\s+', '-', (r.get("endpointName") or r.get("name") or "").strip().lower())
                    or probe_lower in (r.get("endpointName") or r.get("name") or "").strip().lower()
                ), None)
                
                if not match:
                    available = [r.get("endpointName") or r.get("name") or r.get("endpointId") for r in last_results[:10]]
                    return {"error": f"Probe '{probe_name}' not found in recent results. Available: {available}"}
                
                return match
            except Exception as e:
                err_msg = str(e) or repr(e) or type(e).__name__
                logger.error(f"Failed to fetch probe details for {agent_id}: {err_msg}")
                return {"error": err_msg or f"Connection failed: {type(e).__name__}"}

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
            try:
                entry = score_r.json()
                scores = entry.get("scores", {})
                result["posture_scores"] = {
                    "url_filter":        scores.get("url"),
                    "dns_security":      scores.get("dns"),
                    "threat_prevention": scores.get("threat"),
                    "_note": "Weighted % of malicious categories correctly blocked/sinkholed (out of 100). Matches the Security dashboard exactly."
                }
            except Exception as e:
                result["posture_scores"] = {"error": f"Invalid response body: {e}"}
        else:
            result["posture_scores"] = {"error": str(score_r)}

        # --- Score trend (last 24 runs, newest first) ---
        if not isinstance(hist_r, Exception) and hist_r.status_code == 200:
            try:
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
            except Exception as e:
                result["score_trend"] = []
                result["score_trend_error"] = f"Invalid response body: {e}"
        else:
            result["score_trend"] = []
            result["score_trend_error"] = str(hist_r)

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
                err_msg = str(e) or repr(e) or type(e).__name__
                logger.error(f"Failed to run probes for {agent_id}: {err_msg}")
                return {"error": err_msg}

    async def get_dem_probe_stats(
        self,
        agent_id: str,
        probe_name_filter: Optional[str] = None,
        window_minutes: Optional[int] = None,
        aggregate: bool = True,
        raw: bool = False
    ) -> Dict[str, Any]:
        """Fetch historical DEM probe stats with optional name filtering and automatic statistical aggregation (median, p95, success rate)."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        time_range = f"{window_minutes}m" if window_minutes else "1h"
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                result: Dict[str, Any] = {"agent_id": agent_id, "time_range": time_range}
                # Global stats: read the exact same source as get_dem_summary
                stats_r = await client.get(f"{base}/api/connectivity/stats?range=1h", headers=headers)
                if stats_r.status_code == 200:
                    result["global_stats"] = stats_r.json()

                # Recent results
                results_r = await client.get(
                    f"{base}/api/connectivity/results?timeRange={time_range}&limit=1000", headers=headers
                )
                raw_results = []
                if results_r.status_code == 200:
                    raw_data = results_r.json()
                    raw_results = raw_data if isinstance(raw_data, list) else raw_data.get("results", [])

                # Probe config for context
                cfg_r = await client.get(f"{base}/api/connectivity/custom", headers=headers)
                probes_cfg = []
                if cfg_r.status_code == 200:
                    data = cfg_r.json()
                    probes_cfg = data if isinstance(data, list) else data.get("targets", [])

                if aggregate:
                    def _slug(text: str) -> str:
                        return re.sub(r'\s+', '-', (text or '').strip().lower())

                    cfg_by_name: Dict[str, Dict[str, Any]] = {}
                    cfg_by_slug: Dict[str, Dict[str, Any]] = {}
                    cfg_by_id: Dict[str, Dict[str, Any]] = {}

                    for p in probes_cfg:
                        if isinstance(p, dict) and p.get("name"):
                            p_name = p.get("name")
                            cfg_by_name[p_name] = p
                            cfg_by_slug[_slug(p_name)] = p
                            if p.get("id"):
                                cfg_by_id[p.get("id").strip().lower()] = p

                    # Group samples strictly by probe name / slug / id (NEVER by url or target)
                    grouped: Dict[str, List[Dict[str, Any]]] = {}
                    for item in raw_results:
                        s_name = (item.get("endpointName") or item.get("name") or item.get("probe_name") or "").strip()
                        s_id = (item.get("endpointId") or item.get("id") or "").strip().lower()
                        s_slug = _slug(s_name)

                        matched_cfg = None
                        if s_name and s_name in cfg_by_name:
                            matched_cfg = cfg_by_name[s_name]
                        elif s_id and s_id in cfg_by_id:
                            matched_cfg = cfg_by_id[s_id]
                        elif s_id and s_id in cfg_by_slug:
                            matched_cfg = cfg_by_slug[s_id]
                        elif s_slug and s_slug in cfg_by_slug:
                            matched_cfg = cfg_by_slug[s_slug]

                        canonical_name = matched_cfg.get("name") if matched_cfg else (s_name or item.get("endpointId") or "unknown")
                        grouped.setdefault(canonical_name, []).append(item)

                    summary_list = []
                    all_probe_names = set(grouped.keys()).union(cfg_by_name.keys())

                    for name in sorted(all_probe_names):
                        if probe_name_filter and probe_name_filter.lower() not in name.lower():
                            continue

                        samples = grouped.get(name, [])
                        cfg = cfg_by_name.get(name, {})
                        rtts: List[float] = []
                        success_count = 0

                        expected_codes = cfg.get("expectedStatusCodes") or [200, 201, 202, 204, 301, 302, 304, 307, 308]

                        for s in samples:
                            code = s.get("httpCode") or s.get("statusCode")
                            is_code_ok = (code in expected_codes) if (code is not None and code > 0) else False
                            is_success = (
                                is_code_ok
                                or (s.get("reachable") is True and (s.get("score") is None or s.get("score", 0) > 0))
                                or s.get("success") is True
                                or s.get("status") == "success"
                            )
                            if is_success:
                                success_count += 1
                            
                            metrics = s.get("metrics")
                            rtt = metrics.get("total_ms") if isinstance(metrics, dict) else (s.get("latency_ms") or s.get("rtt") or s.get("responseTime"))
                            if rtt is not None:
                                try:
                                    rtts.append(float(rtt))
                                except (ValueError, TypeError):
                                    pass

                        sample_count = len(samples)
                        success_rate = round(100.0 * success_count / sample_count, 1) if sample_count > 0 else None

                        sorted_rtts = sorted(rtts)
                        p95_val = None
                        median_val = None
                        min_val = None
                        max_val = None
                        avg_val = None
                        if sorted_rtts:
                            min_val = round(sorted_rtts[0], 2)
                            max_val = round(sorted_rtts[-1], 2)
                            avg_val = round(sum(sorted_rtts) / len(sorted_rtts), 2)
                            median_val = round(sorted_rtts[len(sorted_rtts) // 2], 2)
                            p95_idx = int(len(sorted_rtts) * 0.95)
                            p95_val = round(sorted_rtts[min(p95_idx, len(sorted_rtts) - 1)], 2)

                        last_sample = samples[0] if samples else {}
                        p_type = (cfg.get("type") or last_sample.get("endpointType") or last_sample.get("type") or "HTTP").upper()
                        
                        summary_entry: Dict[str, Any] = {
                            "name": name,
                            "type": p_type,
                            "target": cfg.get("target") or cfg.get("url") or last_sample.get("url") or last_sample.get("target", ""),
                            "samples_count": sample_count,
                            "success_count": success_count,
                            "success_rate_pct": success_rate,
                            "min_rtt_ms": min_val,
                            "max_rtt_ms": max_val,
                            "avg_rtt_ms": avg_val,
                            "median_rtt_ms": median_val,
                            "p95_rtt_ms": p95_val,
                            "last_status_code": last_sample.get("httpCode") or last_sample.get("statusCode"),
                            "last_error": last_sample.get("error") or (last_sample.get("message") if last_sample.get("score") == 0 else None),
                            "last_timestamp": last_sample.get("timestamp")
                        }
                        if p_type in ["HTTP", "HTTPS"]:
                            summary_entry["expected_status_codes"] = cfg.get("expectedStatusCodes") or [200]

                        summary_list.append(summary_entry)

                    result["total_probes_configured"] = len(probes_cfg)
                    result["probes_matched"] = len(summary_list)
                    result["probes_summary"] = summary_list

                if raw:
                    filtered_raw = raw_results
                    if probe_name_filter:
                        flt = probe_name_filter.lower()
                        filtered_raw = [
                            r for r in raw_results 
                            if flt in (r.get("endpointName") or r.get("name") or "").lower()
                            or flt in (r.get("endpointId") or r.get("id") or "").lower()
                        ]
                    result["recent_results"] = filtered_raw
                return result
            except Exception as e:
                err_msg = str(e) or repr(e) or type(e).__name__
                logger.error(f"Failed to fetch DEM probe stats for {agent_id}: {err_msg}")
                return {"error": err_msg}

    async def update_dem_probe(
        self,
        agent_id: str,
        probe_name: str,
        expected_status_codes: Optional[List[int]] = None,
        timeout_ms: Optional[int] = None,
        interval_sec: Optional[int] = None,
        url: Optional[str] = None,
        enabled: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Update settings of an existing DEM probe (e.g. accepted status codes, timeout, interval) without losing historical telemetry."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base = agent.api_base_url
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                cfg_r = await client.get(f"{base}/api/connectivity/custom", headers=headers)
                if cfg_r.status_code != 200:
                    return {"error": f"Failed to fetch probe configuration: HTTP {cfg_r.status_code}"}

                data = cfg_r.json()
                probes = data if isinstance(data, list) else data.get("targets", [])
                target_name = probe_name.strip().lower()
                matched_idx = -1

                for idx, p in enumerate(probes):
                    if isinstance(p, dict) and (p.get("name", "").strip().lower() == target_name or p.get("id", "").strip().lower() == target_name):
                        matched_idx = idx
                        break

                if matched_idx == -1:
                    return {
                        "error": f"Probe '{probe_name}' not found on {agent_id}.",
                        "available_probes": [p.get("name") for p in probes if isinstance(p, dict) and p.get("name")]
                    }

                current = probes[matched_idx]
                if expected_status_codes is not None:
                    current["expectedStatusCodes"] = expected_status_codes
                if timeout_ms is not None:
                    current["timeout"] = timeout_ms
                if interval_sec is not None:
                    current["interval"] = interval_sec
                if url is not None:
                    current["target"] = url
                    current["url"] = url
                if enabled is not None:
                    current["enabled"] = enabled

                probes[matched_idx] = current
                save_r = await client.post(
                    f"{base}/api/connectivity/custom",
                    json={"endpoints": probes},
                    headers=headers
                )
                if save_r.status_code not in [200, 201]:
                    return {"error": f"Failed to save updated probe: HTTP {save_r.status_code} - {save_r.text}"}

                layer = "local_override" if (current.get("_source") == "overridden" or current.get("_wasGlobal") is not None or current.get("_source") == "local") else "global"

                return {
                    "success": True,
                    "agent_id": agent_id,
                    "probe_name": current.get("name"),
                    "layer": layer,
                    "updated_settings": current,
                    "message": f"DEM probe '{probe_name}' successfully updated in {layer} layer on {agent_id}."
                }
            except Exception as e:
                err_msg = str(e) or repr(e) or type(e).__name__
                logger.error(f"Failed to update DEM probe {probe_name} on {agent_id}: {err_msg}")
                return {"error": err_msg}


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
        """Fetch the speedtest (XFR) history from a node, with normalised metrics."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/tests/xfr", headers=headers)
                r.raise_for_status()
                data = r.json()
                raw_jobs = data if isinstance(data, list) else data.get("jobs", [])
                raw_jobs = raw_jobs[:limit]

                normalized = []
                for job in raw_jobs:
                    summary = job.get("summary") or {}
                    throughput = (
                        summary.get("received_mbps") or summary.get("sent_mbps") or
                        summary.get("throughput_mbps") or summary.get("avg_bandwidth_mbps") or 0
                    )
                    raw_status = job.get("status", "unknown").lower()
                    status_str = "finished" if raw_status in ("completed", "finished", "success") else raw_status
                    normalized.append({
                        "sequence_id": job.get("sequence_id") or job.get("id"),
                        "status": status_str,
                        "source": job.get("source") or job.get("source_id") or agent_id,
                        "target": (
                            job.get("target") or
                            (job.get("params") or {}).get("target", {}).get("host") or
                            job.get("target_host") or "?"
                        ),
                        "protocol": (job.get("params") or {}).get("protocol") or job.get("protocol") or "tcp",
                        "direction": (job.get("params") or {}).get("direction") or job.get("direction") or "client-to-server",
                        "duration_s": (job.get("params") or {}).get("duration_sec") or job.get("duration_sec") or 0,
                        "parallel_streams": (job.get("params") or {}).get("parallel_streams") or 4,
                        # ── Normalised throughput metrics ─────────────────────
                        "throughput_mbps": float(throughput),
                        "sent_mbps": float(summary.get("sent_mbps") or 0),
                        "received_mbps": float(summary.get("received_mbps") or 0),
                        "loss_percent": float(summary.get("loss_percent") or 0),
                        "retransmits": int(summary.get("retransmits") or 0),
                        "bytes_total": int(summary.get("bytes_total") or 0),
                        "latency_ms": float(summary.get("rtt_ms_avg") or summary.get("rtt_ms") or 0),
                        # ── Timestamps ────────────────────────────────────────
                        "started_at": job.get("started_at"),
                        "finished_at": job.get("finished_at"),
                    })

                return {"agent_id": agent_id, "count": len(normalized), "jobs": normalized}
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


    async def get_convergence_history(
        self,
        agent_id: str,
        limit: int = 10,
        summary_only: bool = True,
        test_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fetch the convergence/failover test history for a node.

        summary_only=True (default) returns only aggregated KPIs per test — NO raw packet arrays.
        Enforces a 200 KB response guard-rail: if payload is still too large, truncates and sets
        truncated=True. limit is applied before any processing to avoid building huge structures.
        test_id filters to a single record by testId or local id (partial match tolerated).
        """
        import json as _json

        # Heavy keys that exist at the record root level (common names from the convergence daemon)
        _HEAVY_ROOT = frozenset({
            "samples", "raw_samples", "packets", "packet_log",
            "time_series", "telemetry", "metrics_series",
            "packet_sequence", "seq", "rawPackets",
            "pathHistory_raw", "events_raw",
        })
        # Heavy keys nested inside sub-dicts (e.g. stats.samples, result.packets)
        _HEAVY_NESTED_KEYS = frozenset({
            "samples", "packets", "raw", "rawPackets", "data",
        })

        # Compact whitelist when summary_only=True — only these top-level keys are kept
        _SUMMARY_WHITELIST = {
            "testId", "test_id", "id", "label", "target", "targetId",
            "startTime", "endTime", "timestamp", "duration_s", "durationSec",
            "sent", "received", "tx_total", "rx_total",
            "loss_pct", "loss_percent", "uplink_loss_pct", "uplinkLoss",
            "downlink_loss_pct", "downlinkLoss",
            "max_blackout_ms", "maxBlackout", "blackout",
            "blackout_count", "blackoutCount",
            "avg_rtt_ms", "latency_ms", "min_rtt_ms", "max_rtt_ms",
            "jitter_ms", "min_jitter_ms", "max_jitter_ms",
            "egress_path", "egressPath",
            "path_transitions", "pathTransitions",  # lightweight list of {ts, path} only
            "status", "running",
            # enriched fields added by this method
            "verdict", "max_blackout_ms",
        }

        def _verdict(max_bo: Any) -> str:
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

        def _compact_path_transitions(raw: Any) -> Any:
            """Keep only {timestamp, path} from path_transitions to avoid huge objects."""
            if not isinstance(raw, list):
                return raw
            out = []
            for entry in raw:
                if isinstance(entry, dict):
                    out.append({
                        "ts": entry.get("timestamp") or entry.get("ts") or entry.get("time"),
                        "path": entry.get("path") or entry.get("chosen_path") or entry.get("egressPath"),
                    })
            return out

        def _strip_record(row: dict) -> dict:
            """Apply aggressive summary_only stripping to a single history record."""
            item: dict = {}
            for k, v in row.items():
                # Skip any heavy root-level array
                if k in _HEAVY_ROOT:
                    continue
                # Compact path transition objects
                if k in ("path_transitions", "pathTransitions"):
                    item[k] = _compact_path_transitions(v)
                    continue
                # Strip heavy nested sub-dicts (e.g. result.packets, stats.data)
                if isinstance(v, dict):
                    cleaned_sub = {sk: sv for sk, sv in v.items() if sk not in _HEAVY_NESTED_KEYS and not isinstance(sv, list)}
                    item[k] = cleaned_sub
                # Drop unknown large lists not in whitelist
                elif isinstance(v, list) and k not in ("path_transitions", "pathTransitions"):
                    # Keep only if it's a list of scalars / very short
                    if len(v) <= 5 and all(not isinstance(i, (dict, list)) for i in v):
                        item[k] = v
                    # else: drop silently
                else:
                    item[k] = v
            return item

        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/convergence/history", headers=headers)
                r.raise_for_status()
                data = r.json()
                rows: list = data if isinstance(data, list) else data.get("results", [])

                # ── Apply test_id filter BEFORE limit ─────────────────────────
                if test_id:
                    tid_lower = test_id.strip().lower()
                    rows = [
                        row for row in rows
                        if tid_lower in str(row.get("testId", row.get("test_id", row.get("id", "")))).lower()
                    ]

                # ── Apply limit BEFORE building any structures ─────────────────
                rows = rows[:limit]

                cleaned_rows = []
                for row in rows:
                    if summary_only:
                        item = _strip_record(dict(row))
                        # Keep only whitelisted keys
                        item = {k: v for k, v in item.items() if k in _SUMMARY_WHITELIST}
                    else:
                        item = dict(row)
                        # Even in full mode, drop the very heaviest arrays to avoid 1MB overflow
                        for heavy_key in _HEAVY_ROOT:
                            item.pop(heavy_key, None)

                    # Enrich with verdict + normalised blackout field
                    max_bo = None
                    for key in ("max_blackout_ms", "maxBlackout", "blackout"):
                        if key in item:
                            max_bo = item[key]
                            break
                    item["verdict"] = _verdict(max_bo)
                    item["max_blackout_ms"] = max_bo
                    cleaned_rows.append(item)

                result = {"agent_id": agent_id, "count": len(cleaned_rows), "history": cleaned_rows}

                # ── 200 KB guard-rail ─────────────────────────────────────────
                serialized = _json.dumps(result)
                MAX_BYTES = 200_000
                if len(serialized) > MAX_BYTES:
                    # Drop records from the end until we fit, flag truncation
                    while len(cleaned_rows) > 0 and len(_json.dumps(result)) > MAX_BYTES:
                        cleaned_rows.pop()
                        result = {"agent_id": agent_id, "count": len(cleaned_rows), "history": cleaned_rows}
                    result["truncated"] = True
                    result["truncation_hint"] = (
                        f"Response exceeded {MAX_BYTES // 1000} KB. "
                        "Use summary_only=true, reduce limit, or call get_convergence_report(test_id=...) for a specific test."
                    )

                return result
            except Exception as e:
                logger.error(f"Failed to fetch convergence history for {agent_id}: {e}")
                return {"error": str(e)}

    async def get_convergence_report(
        self,
        agent_id: str,
        test_id: str,
    ) -> Dict[str, Any]:
        """
        Fetch a specific convergence test record and generate an SVG chart
        reproducing the RTT, Jitter, Packet Loss curves and 100-packet sequence bar.
        Returns the SVG as a base64 string suitable for embedding in reports or markdown.
        """
        import base64, math

        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/convergence/history", headers=headers)
                r.raise_for_status()
                rows = r.json()
                if not isinstance(rows, list):
                    rows = rows.get("results", [])
            except Exception as e:
                return {"error": f"Failed to fetch history: {e}"}

        # Find the matching record (by testId, partial match tolerated)
        record = None
        tid_lower = test_id.strip().lower()
        for row in rows:
            rid = str(row.get("testId", row.get("id", ""))).lower()
            if tid_lower in rid or rid in tid_lower:
                record = row
                break

        if record is None:
            available = [str(r.get("testId", r.get("id", "?"))) for r in rows[:20]]
            return {
                "error": f"Test '{test_id}' not found in history.",
                "available_test_ids": available
            }

        # Extract time-series data
        series = record.get("metrics_series") or record.get("time_series") or []

        # ── Compute summary stats ──────────────────────────────────────────────
        def _vals(key: str) -> list:
            return [float(p[key]) for p in series if key in p and p[key] is not None]

        rtt_vals   = _vals("rtt_ms")
        jitter_vals = _vals("jitter_ms")
        loss_vals  = _vals("loss_percent")
        # Packet sequence data (0=ok, 1=lost)
        pkt_seq    = [p.get("lost", 0) for p in series] if series else []

        avg_rtt    = sum(rtt_vals)    / len(rtt_vals)    if rtt_vals    else 0
        avg_jitter = sum(jitter_vals) / len(jitter_vals) if jitter_vals else 0
        peak_loss  = max(loss_vals)                       if loss_vals   else 0

        max_blackout_ms = record.get("max_blackout_ms") or record.get("maxBlackout") or 0
        verdict         = record.get("verdict", "UNKNOWN")
        label           = record.get("label", record.get("testId", test_id))
        target          = record.get("target", "")
        start_time      = record.get("startTime", record.get("timestamp", ""))
        duration_s      = record.get("duration_s", record.get("durationSec", 0))
        uplink_loss     = record.get("uplink_loss_pct", record.get("uplinkLoss", 0)) or 0
        downlink_loss   = record.get("downlink_loss_pct", record.get("downlinkLoss", 0)) or 0
        egress_path     = record.get("egress_path", record.get("egressPath", ""))
        tx_total        = record.get("tx_total", record.get("txTotal", 0)) or 0
        rx_total        = record.get("rx_total", record.get("rxTotal", 0)) or 0

        # ── SVG generation ─────────────────────────────────────────────────────
        W, H = 1100, 580
        CHART_H = 110      # height of each mini-chart
        CHART_X = 20
        CHART_W = W - 40
        PAD_TOP = 130      # space for header

        VERDICT_COLOR = {
            "PERFECT": "#22c55e", "GOOD": "#4ade80", "DEGRADED": "#f59e0b",
            "BAD": "#ef4444", "CRITICAL": "#dc2626", "UNKNOWN": "#94a3b8"
        }
        v_color = VERDICT_COLOR.get(verdict, "#94a3b8")

        def _sparkline(vals: list, color: str, y_off: int, show_zero_line: bool = True) -> str:
            if not vals:
                return f'<text x="{CHART_X + CHART_W//2}" y="{y_off + CHART_H//2}" fill="#64748b" font-size="11" text-anchor="middle">No data</text>'
            mn, mx = min(vals), max(vals)
            span = mx - mn if mx != mn else 1.0
            pts = []
            n = len(vals)
            for i, v in enumerate(vals):
                x = CHART_X + int(i / (n - 1) * CHART_W) if n > 1 else CHART_X
                y = y_off + CHART_H - 8 - int((v - mn) / span * (CHART_H - 16))
                pts.append(f"{x},{y}")
            path_d = "M " + " L ".join(pts)
            # Fill area under curve
            fill_pts = f"{CHART_X},{y_off+CHART_H-8} " + " ".join(pts) + f" {CHART_X+CHART_W},{y_off+CHART_H-8}"
            svg = (
                f'<polygon points="{fill_pts}" fill="{color}" fill-opacity="0.12"/>'
                f'<path d="{path_d}" stroke="{color}" stroke-width="1.8" fill="none"/>'
            )
            # Zero-loss reference line
            if show_zero_line and mn == 0:
                zero_y = y_off + CHART_H - 8
                svg += f'<line x1="{CHART_X}" y1="{zero_y}" x2="{CHART_X+CHART_W}" y2="{zero_y}" stroke="#334155" stroke-width="0.5" stroke-dasharray="3,3"/>'
            return svg

        def _seq_bar(seq: list, y_off: int) -> str:
            if not seq:
                return f'<rect x="{CHART_X}" y="{y_off}" width="{CHART_W}" height="22" fill="#1e293b" rx="3"/>'
            n = len(seq)
            bw = max(1, CHART_W // n)
            rects = [f'<rect x="{CHART_X}" y="{y_off}" width="{CHART_W}" height="22" fill="#1e293b" rx="3"/>']
            for i, lost in enumerate(seq):
                x = CHART_X + int(i / n * CHART_W)
                w = max(1, int((i+1)/n * CHART_W) - int(i/n * CHART_W))
                fill = "#ef4444" if lost else "#3b82f6"
                rects.append(f'<rect x="{x}" y="{y_off}" width="{w}" height="22" fill="{fill}"/>')
            return "".join(rects)

        # Y offsets for each panel
        Y_RTT    = PAD_TOP
        Y_JIT    = PAD_TOP + CHART_H + 36
        Y_LOSS   = PAD_TOP + (CHART_H + 36) * 2
        Y_SEQ    = PAD_TOP + (CHART_H + 36) * 3
        Y_FOOTER = Y_SEQ + 40

        svg_lines = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{Y_FOOTER + 90}" viewBox="0 0 {W} {Y_FOOTER + 90}" style="font-family:Inter,Segoe UI,sans-serif;background:#0f172a;">',
            # ── Header ──
            f'<rect x="0" y="0" width="{W}" height="{PAD_TOP - 6}" fill="#1e293b" rx="0"/>',
            f'<text x="20" y="28" fill="#94a3b8" font-size="11">Date / ID / Label</text>',
            f'<text x="20" y="50" fill="#38bdf8" font-size="13" font-weight="600">{record.get("testId", test_id)}</text>',
            f'<text x="20" y="68" fill="#cbd5e1" font-size="12">{label}</text>',
            f'<text x="20" y="86" fill="#64748b" font-size="10">{start_time}  ·  Target: {target}  ·  Duration: {duration_s}s</text>',
            # Verdict badge
            f'<rect x="{W - 130}" y="16" width="110" height="28" rx="6" fill="{v_color}" fill-opacity="0.2" stroke="{v_color}" stroke-width="1.5"/>',
            f'<text x="{W - 75}" y="35" fill="{v_color}" font-size="13" font-weight="700" text-anchor="middle">{verdict}</text>',
            # Max blackout
            f'<text x="{W//2}" y="40" fill="{v_color}" font-size="20" font-weight="700" text-anchor="middle">{(max_blackout_ms/1000):.2f}s MAX BLACKOUT</text>',
            f'<text x="{W//2}" y="58" fill="#94a3b8" font-size="10" text-anchor="middle">Failover Duration: {duration_s}s</text>',
            # ── RTT panel ──
            f'<text x="{CHART_X}" y="{Y_RTT - 8}" fill="#4ade80" font-size="11">↗ RTT LATENCY</text>',
            f'<text x="{CHART_X + CHART_W}" y="{Y_RTT - 8}" fill="#4ade80" font-size="11" text-anchor="end">Avg: {avg_rtt:.2f}ms</text>',
            f'<rect x="{CHART_X}" y="{Y_RTT}" width="{CHART_W}" height="{CHART_H}" fill="#0f172a" rx="4"/>',
            _sparkline(rtt_vals, "#4ade80", Y_RTT),
            # ── Jitter panel ──
            f'<text x="{CHART_X}" y="{Y_JIT - 8}" fill="#f59e0b" font-size="11">≈ JITTER</text>',
            f'<text x="{CHART_X + CHART_W}" y="{Y_JIT - 8}" fill="#f59e0b" font-size="11" text-anchor="end">Avg: {avg_jitter:.2f}ms</text>',
            f'<rect x="{CHART_X}" y="{Y_JIT}" width="{CHART_W}" height="{CHART_H}" fill="#0f172a" rx="4"/>',
            _sparkline(jitter_vals, "#f59e0b", Y_JIT),
            # ── Packet Loss panel ──
            f'<text x="{CHART_X}" y="{Y_LOSS - 8}" fill="#ef4444" font-size="11">⚡ PACKET LOSS SPIKE</text>',
            f'<text x="{CHART_X + CHART_W}" y="{Y_LOSS - 8}" fill="#ef4444" font-size="11" text-anchor="end">Peak: {peak_loss:.0f}%</text>',
            f'<rect x="{CHART_X}" y="{Y_LOSS}" width="{CHART_W}" height="{CHART_H}" fill="#0f172a" rx="4"/>',
            _sparkline(loss_vals, "#ef4444", Y_LOSS, show_zero_line=False),
            # ── 100-Packet sequence bar ──
            f'<text x="{CHART_X}" y="{Y_SEQ - 6}" fill="#94a3b8" font-size="10">100-PACKET SEQUENCE / OUTAGE DETECTION</text>',
            f'<text x="{CHART_X + CHART_W}" y="{Y_SEQ - 6}" fill="#94a3b8" font-size="10" text-anchor="end">{rx_total}/{tx_total} PACKETS ({uplink_loss:.1f}% TX LOSS)</text>',
            _seq_bar(pkt_seq, Y_SEQ),
            # ── Footer KPIs ──
            f'<rect x="0" y="{Y_FOOTER}" width="{W}" height="80" fill="#1e293b"/>',
            f'<text x="60"  y="{Y_FOOTER+22}" fill="#94a3b8" font-size="10">UPLINK LOSS</text>',
            f'<text x="60"  y="{Y_FOOTER+42}" fill="#ef4444" font-size="16" font-weight="700">↑ {uplink_loss:.1f}%</text>',
            f'<text x="220" y="{Y_FOOTER+22}" fill="#94a3b8" font-size="10">DOWNLINK LOSS</text>',
            f'<text x="220" y="{Y_FOOTER+42}" fill="#ef4444" font-size="16" font-weight="700">↓ {downlink_loss:.1f}%</text>',
            f'<text x="400" y="{Y_FOOTER+22}" fill="#94a3b8" font-size="10">AVG LATENCY</text>',
            f'<text x="400" y="{Y_FOOTER+42}" fill="#e2e8f0" font-size="16" font-weight="700">{avg_rtt:.2f}ms</text>',
            f'<text x="560" y="{Y_FOOTER+22}" fill="#94a3b8" font-size="10">JITTER (MS)</text>',
            f'<text x="560" y="{Y_FOOTER+42}" fill="#e2e8f0" font-size="16" font-weight="700">{avg_jitter:.2f}ms</text>',
            f'<text x="750" y="{Y_FOOTER+22}" fill="#94a3b8" font-size="10">☰ EGRESS PATH</text>',
            f'<text x="750" y="{Y_FOOTER+42}" fill="#38bdf8" font-size="13" font-weight="600">{egress_path}</text>',
            '</svg>'
        ]

        svg_str = "\n".join(svg_lines)
        svg_b64 = base64.b64encode(svg_str.encode("utf-8")).decode("ascii")

        return {
            "agent_id": agent_id,
            "test_id": record.get("testId", test_id),
            "label": label,
            "verdict": verdict,
            "max_blackout_s": round(max_blackout_ms / 1000, 3) if max_blackout_ms else 0,
            "avg_rtt_ms": round(avg_rtt, 2),
            "avg_jitter_ms": round(avg_jitter, 2),
            "peak_loss_pct": round(peak_loss, 1),
            "uplink_loss_pct": uplink_loss,
            "downlink_loss_pct": downlink_loss,
            "egress_path": egress_path,
            "duration_s": duration_s,
            "data_points": len(series),
            "chart_svg_base64": svg_b64,
            "chart_embed_html": (
                '<img src="data:image/svg+xml;base64,' + svg_b64 + '" '
                'style="width:100%;max-width:1100px;" '
                'alt="Convergence Report ' + str(record.get("testId", test_id)) + '"/>'
            ),
            "chart_markdown": (
                "![Convergence Report " + str(record.get("testId", test_id)) + "]"
                "(data:image/svg+xml;base64," + svg_b64 + ")"
            ),
            "usage_hint": (
                "chart_svg_base64: save as .svg file or decode. "
                "chart_embed_html: paste in HTML report. "
                "chart_markdown: paste in Markdown/Notion."
            )
        }

    async def run_path_trace(
        self,
        agent_id: str,
        target: str,
        max_hops: int = 15,
        method: str = "udp",
        port: int = 443,
        timeout_sec: int = 10
    ) -> Dict[str, Any]:
        """Execute a live traceroute / path hop inspection from a specific Stigix node to identify where latency or packet drops occur."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        base_url = agent.api_base_url
        node_build = getattr(agent, "build", None) or getattr(agent, "version", None) or agent.meta.get("build") or agent.meta.get("version") or "unknown"

        async with httpx.AsyncClient(timeout=float(timeout_sec + 25)) as client:
            try:
                r = await client.get(
                    f"{base_url}/api/network/traceroute",
                    params={"target": target, "max_hops": max_hops, "method": method, "port": port},
                    headers=headers
                )
                if r.status_code == 200 and self._is_json_response(r):
                    return r.json()
                elif r.status_code == 404 or not self._is_json_response(r):
                    return {
                        "success": False,
                        "status": "unsupported",
                        "error": f"Feature 'path_trace' is not supported on node '{agent_id}' (HTTP {r.status_code}: /api/network/traceroute not available). Please update the node container image to v2.0+.",
                        "node": agent_id,
                        "node_build": node_build,
                        "url": str(r.url)
                    }
                else:
                    return {
                        "success": False,
                        "status": "error",
                        "error": f"Traceroute returned HTTP {r.status_code}",
                        "status_code": r.status_code,
                        "node_build": node_build,
                        "details": r.text[:300]
                    }
            except Exception as e:
                return self._handle_exception(f"Path trace to {target} on {agent_id}", e)

    async def list_active_impairments(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Audit and list all active network impairments (injected latency, loss, throttling, disabled interfaces) across VyOS routers."""
        agents_to_check = []
        if agent_id:
            agent = await self.registry.get_endpoint(agent_id)
            if agent:
                agents_to_check.append(agent)
        else:
            agents_to_check = await self.registry.list_endpoints()

        active_impairments = []
        headers = {"Authorization": f"Bearer {self._generate_token()}"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            for ag in agents_to_check:
                try:
                    # 1. Get configured VyOS routers for this node
                    r_routers = await client.get(f"{ag.api_base_url}/api/vyos/routers", headers=headers)
                    if r_routers.status_code != 200:
                        continue
                    routers_data = r_routers.json()
                    routers = routers_data if isinstance(routers_data, list) else routers_data.get("routers", [])

                    for router in routers:
                        r_id = router.get("id") or router.get("name")
                        if not r_id:
                            continue
                        # Query live state
                        r_state = await client.get(f"{ag.api_base_url}/api/vyos/routers/{r_id}/state", headers=headers)
                        if r_state.status_code != 200:
                            continue
                        state_data = r_state.json()
                        interfaces = state_data.get("interfaces", {})
                        
                        if isinstance(interfaces, dict):
                            if_items = interfaces.items()
                        elif isinstance(interfaces, list):
                            if_items = [(item.get("name", f"iface-{i}"), item) for i, item in enumerate(interfaces)]
                        else:
                            if_items = []

                        for if_name, if_info in if_items:
                            if not isinstance(if_info, dict):
                                continue
                            
                            # Check disabled / link down
                            admin_status = str(if_info.get("admin_status") or if_info.get("status") or "").lower()
                            oper_status = str(if_info.get("oper_status") or if_info.get("link") or "").lower()
                            is_down = admin_status in ["down", "disable", "disabled", "shutdown"] or oper_status in ["down", "lowerlayerdown"]
                            if is_down:
                                active_impairments.append({
                                    "agent_id": ag.id,
                                    "agent_name": ag.site_name or ag.id,
                                    "router_id": r_id,
                                    "interface": if_name,
                                    "type": "interface_down",
                                    "severity": "CRITICAL",
                                    "details": f"Interface {if_name} is administratively down / shut.",
                                    "state": if_info
                                })

                            # Check QoS / Netem (latency, loss, corrupt, rate)
                            qos = if_info.get("qos") or if_info.get("impairment") or if_info.get("traffic_control") or {}
                            lat = qos.get("latency") or if_info.get("latency_ms") or if_info.get("latency")
                            loss = qos.get("loss") or if_info.get("loss_pct") or if_info.get("loss")
                            rate = qos.get("rate") or if_info.get("bandwidth_limit")
                            
                            has_lat = False
                            if lat is not None:
                                try:
                                    has_lat = float(lat) > 0
                                except Exception:
                                    pass
                            has_loss = False
                            if loss is not None:
                                try:
                                    has_loss = float(loss) > 0
                                except Exception:
                                    pass
                            has_rate = rate and str(rate).lower() not in ["0", "none", "unlimited", ""]
                            
                            if has_lat or has_loss or has_rate:
                                details_parts = []
                                if has_lat:
                                    details_parts.append(f"+{lat}ms latency")
                                if has_loss:
                                    details_parts.append(f"{loss}% loss")
                                if has_rate:
                                    details_parts.append(f"rate {rate}")
                                active_impairments.append({
                                    "agent_id": ag.id,
                                    "agent_name": ag.site_name or ag.id,
                                    "router_id": r_id,
                                    "interface": if_name,
                                    "type": "traffic_impairment",
                                    "severity": "WARNING",
                                    "details": f"Interface {if_name} has active shaping: {', '.join(details_parts)}",
                                    "parameters": {
                                        "latency_ms": lat,
                                        "loss_pct": loss,
                                        "rate": rate
                                    }
                                })
                except Exception as e:
                    logger.debug(f"Error checking impairments for agent {ag.id}: {e}")

        summary = (
            f"Found {len(active_impairments)} active impairment(s) across the fabric."
            if active_impairments
            else "Clean state: No active network impairments or disabled interfaces detected on any VyOS router."
        )

        return {
            "total_impairments": len(active_impairments),
            "has_active_impairments": len(active_impairments) > 0,
            "summary": summary,
            "impairments": active_impairments
        }


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

        PATH NAME CACHE (bug-fix):
        When fast=False (default), the backend resolves path IDs to human-readable names
        (e.g. "BR8-INET1 to DC1-INET"). This method stores the resulting path_id→name
        mapping in an in-process cache keyed by (agent_id, site_id) with a 5-minute TTL.
        When fast=True, the cache is consulted first so already-resolved names are preserved.
        If the cache is cold, fast=True silently falls back to "Path ID: <id>" only for
        unknown IDs — already-seen IDs are always resolved.

        SINGLE-PACKET FLOWS NOTE (informational):
        For a convergence test on UDP 6200, the Flow Browser typically shows:
        - Dozens of 1-packet flows with ephemeral source ports — these are probe-echo
          reply bursts or retransmit artefacts captured by the SD-WAN telemetry engine.
          Each appears as a distinct flow because the source port randomises per burst.
        - One (or a few) long-lived flows carrying the actual sustained probe stream
          (e.g. src_port=30246). This is the flow of interest for path analysis.
        The aggregate_path_timeline option merges all matching flows into one timeline.
        """
        import time as _time

        # ── In-process path name cache ─────────────────────────────────────────
        # Structure: { (agent_id, site_id): {"expires": float, "names": {str: str}} }
        if not hasattr(self, "_path_name_cache"):
            self._path_name_cache: Dict[tuple, Dict] = {}
        _CACHE_TTL = 300  # 5 minutes

        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        fast: bool = body.get("fast", False)
        aggregate: bool = body.get("aggregate_path_timeline", False)
        # Remove our extra param before forwarding — backend doesn't know it
        forward_body = {k: v for k, v in body.items() if k != "aggregate_path_timeline"}

        # Determine cache key (site-level)
        site_id_key = body.get("site_id") or body.get("site_name") or "default"
        cache_key = (agent_id, site_id_key)

        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                r = await client.post(
                    f"{agent.api_base_url}/api/prisma/flows",
                    json=forward_body,
                    headers=headers
                )
                r.raise_for_status()
                result = r.json()

                # ── Populate / use path name cache ────────────────────────────
                entry = self._path_name_cache.get(cache_key)
                if entry and _time.time() < entry["expires"]:
                    cached_names: Dict[str, str] = entry["names"]
                else:
                    cached_names = {}

                # Harvest newly resolved names from this response (present when fast=False)
                def _harvest_names(flows_data: Any) -> None:
                    flows = flows_data if isinstance(flows_data, list) else (
                        flows_data.get("flows") or flows_data.get("records") or []
                    )
                    for flow in flows:
                        for field in ("egress_path", "egressPath", "path_name", "pathName"):
                            val = flow.get(field, "")
                            if val and not val.startswith("Path ID:"):
                                # Also look for the raw path_id that may live alongside
                                pid = flow.get("path_id") or flow.get("pathId") or flow.get("vpn_path_id")
                                if pid:
                                    cached_names[str(pid)] = val
                        for ph in flow.get("path_history", flow.get("pathHistory", [])):
                            path_val = (
                                ph.get("path") or ph.get("chosen_path") or
                                ph.get("chosenPath") or ph.get("egressPath") or ""
                            )
                            pid = ph.get("path_id") or ph.get("pathId")
                            if pid and path_val and not path_val.startswith("Path ID:"):
                                cached_names[str(pid)] = path_val

                _harvest_names(result)

                # Persist updated cache
                if cached_names:
                    self._path_name_cache[cache_key] = {
                        "expires": _time.time() + _CACHE_TTL,
                        "names": cached_names,
                    }

                # ── Resolve path ID placeholders using cache (fast=True fix) ──
                def _resolve_name(val: str) -> str:
                    if not val:
                        return val
                    if val.startswith("Path ID:"):
                        pid = val.split("Path ID:")[-1].strip()
                        return cached_names.get(pid, val)
                    return val

                def _fix_flow(flow: dict) -> dict:
                    for field in ("egress_path", "egressPath", "path_name", "pathName"):
                        if field in flow:
                            flow[field] = _resolve_name(flow[field])
                    for ph in flow.get("path_history", flow.get("pathHistory", [])):
                        for pf in ("path", "chosen_path", "chosenPath", "preferred_path",
                                   "preferredPath", "egressPath"):
                            if pf in ph:
                                ph[pf] = _resolve_name(ph[pf])
                    return flow

                # Apply resolution to all flows in the result
                if isinstance(result, list):
                    result = [_fix_flow(f) for f in result]
                elif isinstance(result, dict):
                    for key in ("flows", "records", "items"):
                        if key in result and isinstance(result[key], list):
                            result[key] = [_fix_flow(f) for f in result[key]]

                # ── Aggregate path timeline across all matched flows ───────────
                if aggregate:
                    flows_list = (
                        result if isinstance(result, list) else
                        result.get("flows") or result.get("records") or []
                    )
                    merged: list = []
                    seen_keys: set = set()
                    for flow in flows_list:
                        for ph in flow.get("path_history", flow.get("pathHistory", [])):
                            ts = ph.get("timestamp") or ph.get("ts") or ph.get("time") or ""
                            path = (
                                ph.get("path") or ph.get("chosen_path") or
                                ph.get("chosenPath") or ph.get("egressPath") or ""
                            )
                            preferred = ph.get("preferred_path") or ph.get("preferredPath") or ""
                            key = (ts, path)
                            if key not in seen_keys:
                                seen_keys.add(key)
                                merged.append({
                                    "ts": ts,
                                    "path": _resolve_name(path),
                                    "preferred_path": _resolve_name(preferred),
                                })
                    # Sort chronologically and keep only entries where path actually changed
                    merged.sort(key=lambda x: x["ts"])
                    timeline: list = []
                    last_path = None
                    for e in merged:
                        if e["path"] != last_path:
                            timeline.append(e)
                            last_path = e["path"]

                    if isinstance(result, dict):
                        result["aggregate_path_timeline"] = timeline
                    else:
                        result = {"flows": result, "aggregate_path_timeline": timeline}

                return result
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

    async def _resolve_tcp_app_id(self, client: httpx.AsyncClient, base_url: str, headers: dict, app_id: str) -> str:
        """Resolve a friendly app name (e.g. 'app-erp-tx') to its internal UUID."""
        try:
            r_list = await client.get(f"{base_url}/api/custom-tcp-apps", headers=headers)
            if r_list.status_code == 200:
                config = r_list.json()
                apps = config.get("applications", []) if isinstance(config, dict) else (config if isinstance(config, list) else [])
                matched = next((a for a in apps if a.get("id") == app_id or a.get("name", "").lower() == app_id.lower()), None)
                if matched:
                    return matched.get("id", app_id)
        except Exception:
            pass
        return app_id

    async def create_custom_tcp_app(
        self, agent_id: str, name: str, port: int,
        description: str = "",
        protocol: str = "stigix_tcp",
        server_behavior: str = "echo",
        client_mode: str = "transactional",
        payload_bytes: int = 1024,
        interval_ms: int = 1000,
        connections_per_peer: int = 2,
        peers: Optional[List[Dict[str, Any]]] = None,
        target_peers: Optional[str] = "all",
        auto_start_listener: bool = True,
        auto_start_workload: bool = True
    ) -> Dict[str, Any]:
        """Create and configure a new Custom TCP Application on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        # Automatically populate peers if not explicitly provided
        resolved_peers = list(peers) if peers else []
        if not resolved_peers and target_peers and target_peers.lower() != "none":
            try:
                endpoints = await self.registry.list_endpoints()
                if target_peers.lower() in ("all", "auto", "*"):
                    for ep in endpoints:
                        host = ep.test_ip or (ep.api_base_url.split("://")[1].split(":")[0] if "://" in ep.api_base_url else ep.api_base_url)
                        if not host:
                            continue
                        site_name = ep.meta.get("site_name") or ep.id
                        p_id = f"peer-{ep.id}".lower().replace(" ", "-")
                        resolved_peers.append({
                            "id": p_id,
                            "name": site_name,
                            "siteName": site_name,
                            "host": host,
                            "port": port,
                            "enabled": True,
                            "role": ep.role or "branch"
                        })
                else:
                    targets = [t.strip().lower() for t in target_peers.split(",") if t.strip()]
                    for t in targets:
                        matched = next((ep for ep in endpoints if ep.id.lower() == t or (ep.meta.get("site_name") or "").lower() == t or ep.test_ip == t), None)
                        if matched:
                            host = matched.test_ip or (matched.api_base_url.split("://")[1].split(":")[0] if "://" in matched.api_base_url else matched.api_base_url)
                            site_name = matched.meta.get("site_name") or matched.id
                            resolved_peers.append({
                                "id": f"peer-{matched.id}".lower().replace(" ", "-"),
                                "name": site_name,
                                "siteName": site_name,
                                "host": host,
                                "port": port,
                                "enabled": True,
                                "role": matched.role or "branch"
                            })
                        else:
                            resolved_peers.append({
                                "id": f"peer-{t}".replace(" ", "-"),
                                "name": t,
                                "siteName": t,
                                "host": t,
                                "port": port,
                                "enabled": True,
                                "role": "branch"
                            })
            except Exception as e:
                logger.warning(f"Could not auto-populate peers for TCP app '{name}': {e}")

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        app_payload = {
            "name": name,
            "description": description or f"Custom TCP App {name}",
            "enabled": True,
            "protocol": protocol,
            "listener": {
                "bindAddress": "0.0.0.0",
                "port": port,
                "maxConnections": 100,
                "idleTimeoutMs": 60000,
                "maxPayloadBytes": 1048576,
                "tcpKeepalive": True,
                "allowCidrs": [],
                "auth": {"enabled": False}
            },
            "serverBehavior": {
                "mode": server_behavior,
                "fixedDelayMs": 0,
                "randomDelayMinMs": 0,
                "randomDelayMaxMs": 0,
                "loopingNormalSec": 10,
                "loopingSlowSec": 5,
                "loopingSlowDelayMs": 200,
                "dropProbability": 0,
                "errorProbability": 0
            },
            "clientDefaults": {
                "mode": client_mode,
                "connectionsPerPeer": connections_per_peer,
                "intervalMs": interval_ms,
                "payloadBytes": payload_bytes,
                "requestTimeoutMs": 5000,
                "connectTimeoutMs": 5000,
                "autoReconnect": True,
                "reconnectInitialMs": 1000,
                "reconnectMaxMs": 30000,
                "tcpKeepalive": True,
                "sourceInterface": "auto"
            },
            "peers": resolved_peers,
            "startup": {
                "startListener": auto_start_listener,
                "startClientWorkload": auto_start_workload
            }
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps", json=app_payload, headers=headers)
                r.raise_for_status()
                data = r.json()
                app_id = data.get("application", {}).get("id") or name
                if auto_start_listener and app_id:
                    try:
                        await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/listener/start", headers=headers)
                    except Exception:
                        pass
                if auto_start_workload and app_id:
                    try:
                        await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{app_id}/client/start", headers=headers)
                    except Exception:
                        pass
                return data
            except Exception as e:
                return self._handle_exception(f"Create Custom TCP App '{name}' on {agent_id}", e)

    async def add_tcp_app_peer(
        self, agent_id: str, app_id: str,
        peer_name_or_host: str,
        port: Optional[int] = None,
        site_name: Optional[str] = None,
        role: str = "branch",
        enabled: bool = True
    ) -> Dict[str, Any]:
        """Add or attach a peer target to an existing Custom TCP Application."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        target_host = peer_name_or_host
        target_name = site_name or peer_name_or_host
        try:
            endpoints = await self.registry.list_endpoints()
            matched_ep = next((ep for ep in endpoints if ep.id.lower() == peer_name_or_host.lower() or (ep.meta.get("site_name") or "").lower() == peer_name_or_host.lower() or ep.test_ip == peer_name_or_host), None)
            if matched_ep:
                target_host = matched_ep.test_ip or (matched_ep.api_base_url.split("://")[1].split(":")[0] if "://" in matched_ep.api_base_url else matched_ep.api_base_url)
                target_name = matched_ep.meta.get("site_name") or matched_ep.id
        except Exception:
            pass

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                target_port = port
                if not target_port:
                    try:
                        r_app = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}", headers=headers)
                        if r_app.status_code == 200:
                            app_data = r_app.json().get("application", {})
                            target_port = app_data.get("listener", {}).get("port") or 8100
                    except Exception:
                        target_port = 8100

                peer_payload = {
                    "name": target_name,
                    "siteName": target_name,
                    "host": target_host,
                    "port": target_port or 8100,
                    "enabled": enabled,
                    "role": role
                }

                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/peers", json=peer_payload, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Add TCP peer '{peer_name_or_host}' to '{app_id}' on {agent_id}", e)

    async def delete_custom_tcp_app(self, agent_id: str, app_id: str) -> Dict[str, Any]:
        """Delete a custom TCP application from a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.delete(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Delete Custom TCP App {app_id} on {agent_id}", e)

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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/listener/start", headers=headers)
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/listener/stop", headers=headers)
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/client/start", headers=headers)
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/client/stop", headers=headers)
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                endpoint_url = f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/peers/{peer_id}/test" if peer_id else f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/test"
                r = await client.post(endpoint_url, json=body, headers=headers)
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/sessions", headers=headers)
                if r.status_code == 200:
                    try:
                        return r.json()
                    except Exception:
                        pass

                # Backward-compatible fallback for older nodes: query incoming and outgoing sub-routes
                r_inc = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/sessions/incoming", headers=headers)
                r_out = await client.get(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/sessions/outgoing", headers=headers)

                incoming = []
                outgoing = []
                if r_inc.status_code == 200:
                    try:
                        incoming = r_inc.json().get("sessions", [])
                    except Exception:
                        pass
                if r_out.status_code == 200:
                    try:
                        outgoing = r_out.json().get("sessions", [])
                    except Exception:
                        pass

                if r_inc.status_code == 200 or r_out.status_code == 200:
                    return {
                        "success": True,
                        "app_id": real_id,
                        "total_incoming": len(incoming),
                        "total_outgoing": len(outgoing),
                        "incoming_sessions": incoming,
                        "outgoing_sessions": outgoing,
                        "sessions": [
                            {**s, "direction": "incoming"} for s in incoming
                        ] + [
                            {**s, "direction": "outgoing"} for s in outgoing
                        ]
                    }

                return {
                    "error": f"HTTP {r.status_code} calling {r.url}",
                    "status_code": r.status_code,
                    "url": str(r.url),
                    "body_preview": r.text[:300]
                }
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
                real_id = await self._resolve_tcp_app_id(client, agent.api_base_url, headers, app_id)
                r = await client.post(f"{agent.api_base_url}/api/custom-tcp-apps/{real_id}/metrics/reset", headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return self._handle_exception(f"Reset metrics for {app_id} on {agent_id}", e)

    # -------------------------------------------------------------------------
    # Target Controller & Mesh Leader (Phase 2)
    # -------------------------------------------------------------------------

    async def get_controller_status(self, agent_id: str, summary_only: bool = True) -> Dict[str, Any]:
        """Fetch Target Controller role, site name, leader IP, and peer count."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{agent.api_base_url}/api/registry/status", headers=headers)
                r.raise_for_status()
                data = r.json()
                if summary_only and isinstance(data, dict):
                    all_endpoints = await self.registry.list_endpoints()
                    local_instances = data.get("local_instances", [])
                    if isinstance(local_instances, list):
                        summarized_instances = []
                        for inst in local_instances:
                            if isinstance(inst, dict):
                                inst_copy = dict(inst)
                                inst_name = (inst.get("node") or inst.get("node_id") or inst.get("name") or "").strip()
                                matched_ep = next((
                                    ep for ep in all_endpoints 
                                    if ep.id == inst_name 
                                    or ep.meta.get("site_name") == inst_name 
                                    or ep.test_ip == inst_name 
                                    or ep.id.lower() == inst_name.lower()
                                ), None)

                                ep_version = (matched_ep.version or matched_ep.meta.get("version")) if matched_ep else None
                                ep_build = (matched_ep.build or matched_ep.meta.get("build")) if matched_ep else None

                                if not inst_copy.get("version") and ep_version:
                                    inst_copy["version"] = ep_version
                                if not inst_copy.get("build") and ep_build:
                                    inst_copy["build"] = ep_build

                                ps = inst.get("provisioning_status")
                                if isinstance(ps, dict):
                                    inst_copy["provisioning_status"] = {
                                        "appliedRevisions": ps.get("appliedRevisions", {}),
                                        "pending": ps.get("pending", False),
                                        "lastReportedAt": ps.get("lastReportedAt"),
                                        "version": ps.get("version") or inst_copy.get("version") or ep_version,
                                        "orphansCount": len(ps.get("orphans", {})) if isinstance(ps.get("orphans"), dict) else 0
                                    }
                                summarized_instances.append(inst_copy)
                            else:
                                summarized_instances.append(inst)
                        data["local_instances"] = summarized_instances
                return data
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

    async def get_provisioning_status(self, agent_id: str, summary_only: bool = True) -> Dict[str, Any]:
        """Fetch Global Provisioning pull mode status, active bundle revisions, and pending changes."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(
                    f"{agent.api_base_url}/api/provisioning/status?summary={str(summary_only).lower()}",
                    headers=headers
                )
                if r.status_code == 200 and self._is_json_response(r):
                    data = r.json()
                    if summary_only and isinstance(data, dict):
                        if "state" in data and isinstance(data["state"], dict) and "history" in data["state"]:
                            del data["state"]["history"]
                    return data

                # Fallback to /api/provisioning/config
                r_cfg = await client.get(f"{agent.api_base_url}/api/provisioning/config", headers=headers)
                if r_cfg.status_code == 200 and self._is_json_response(r_cfg):
                    data = r_cfg.json()
                    if summary_only and isinstance(data, dict):
                        if "state" in data and isinstance(data["state"], dict) and "history" in data["state"]:
                            del data["state"]["history"]
                    return data
                
                return {
                    "success": False,
                    "status": "error",
                    "error": f"HTTP {r.status_code} on provisioning status",
                    "status_code": r.status_code,
                    "url": str(r.url)
                }
            except Exception as e:
                return self._handle_exception(f"Provisioning status on {agent_id}", e)

    async def set_provisioning_mode(self, agent_id: str, enabled: bool) -> Dict[str, Any]:
        """Enable or disable Global Provisioning pull daemon on a node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

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
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        # Guard: check if node is leader
        try:
            ctrl = await self.get_controller_status(agent_id)
            if isinstance(ctrl, dict) and ctrl.get("is_leader") is False:
                leader_ip = ctrl.get("leader_ip") or "mesh leader"
                return {
                    "success": False,
                    "status": "rejected",
                    "error": f"Node '{agent_id}' is a member/branch node. Bundles can only be published from the active mesh Leader ({leader_ip}).",
                    "agent_id": agent_id,
                    "is_leader": False
                }
        except Exception as e:
            logger.warning(f"Could not check leader status for {agent_id}: {e}")

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        valid_types = [
            'applications', 'connectivity-probes', 'convergence-sla',
            'prisma-sase', 'security-config', 'voice-config', 'iot-config',
            'custom-tcp-apps', 'cloud-config'
        ]

        types_to_publish = valid_types if bundle_type.lower() in ["all", "*"] else [bundle_type]

        results = []
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                for b_type in types_to_publish:
                    url = f"{agent.api_base_url}/api/provisioning/publish/{b_type}"
                    r = await client.post(url, headers=headers)
                    if r.status_code in [200, 201] and self._is_json_response(r):
                        results.append(r.json())
                    elif r.status_code == 404:
                        fallback_r = await client.post(f"{agent.api_base_url}/api/provisioning/publish", json={"type": b_type, "bundle_type": b_type}, headers=headers)
                        fallback_r.raise_for_status()
                        results.append(fallback_r.json())
                    else:
                        r.raise_for_status()
                return results[0] if len(results) == 1 else {"success": True, "published_bundles": results}
            except Exception as e:
                return self._handle_exception(f"Publish bundle {bundle_type} on {agent_id}", e)

    async def purge_stale_leader_state(self, agent_id: str, dry_run: bool = True) -> Dict[str, Any]:
        """Purge stale local leader manifests and bundles on a non-leader branch node."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.post(
                    f"{agent.api_base_url}/api/provisioning/purge-stale-leader?dry_run={str(dry_run).lower()}",
                    json={"dry_run": dry_run},
                    headers=headers
                )
                if r.status_code in [200, 201] and self._is_json_response(r):
                    return r.json()
                return {
                    "success": False,
                    "status": "error",
                    "error": f"Purge stale leader returned HTTP {r.status_code}",
                    "details": r.text[:300]
                }
            except Exception as e:
                return self._handle_exception(f"Purge stale leader on {agent_id}", e)

    async def rollback_configuration_bundle(self, agent_id: str, bundle_type: str, revision: str) -> Dict[str, Any]:
        """Rollback a specific configuration bundle to a prior revision hash."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                url = f"{agent.api_base_url}/api/provisioning/rollback/{bundle_type}/{revision}"
                r = await client.post(url, headers=headers)
                if r.status_code in [200, 201]:
                    return r.json()
                elif r.status_code == 404:
                    fallback_r = await client.post(f"{agent.api_base_url}/api/provisioning/rollback", json={"type": bundle_type, "revision": revision}, headers=headers)
                    fallback_r.raise_for_status()
                    return fallback_r.json()
                else:
                    r.raise_for_status()
                    return r.json()
            except Exception as e:
                return self._handle_exception(f"Rollback bundle {bundle_type} to rev {revision} on {agent_id}", e)

    async def get_provisioning_history(self, agent_id: str, limit: int = 15, summary_only: bool = True) -> Dict[str, Any]:
        """Fetch the audit trail of published configuration bundles and rollbacks with compact summary mode and backward fallback."""
        agent = await self.registry.get_endpoint(agent_id)
        if not agent:
            return {"success": False, "status": "error", "error": f"Agent {agent_id} not found."}

        headers = {"Authorization": f"Bearer {self._generate_token()}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                r = await client.get(
                    f"{agent.api_base_url}/api/provisioning/history?limit={limit}&summary={str(summary_only).lower()}",
                    headers=headers
                )
                if r.status_code == 200 and self._is_json_response(r):
                    data = r.json()
                    if isinstance(data, dict) and "history" in data and isinstance(data["history"], list):
                        for entry in data["history"]:
                            if isinstance(entry, dict):
                                self._normalize_history_entry_counters(entry)
                    return data

                # Fallback to /api/provisioning/config if node is running earlier release
                r_cfg = await client.get(f"{agent.api_base_url}/api/provisioning/config", headers=headers)
                if r_cfg.status_code == 200 and self._is_json_response(r_cfg):
                    cfg_data = r_cfg.json()
                    history_raw = cfg_data.get("state", {}).get("history", [])
                    compact_entries = []
                    for entry in history_raw[:limit]:
                        if isinstance(entry, dict):
                            if summary_only:
                                compact_entries.append(self._compact_history_entry(entry))
                            else:
                                compact_entries.append(entry)
                        else:
                            compact_entries.append(entry)

                    return {
                        "success": True,
                        "agent_id": agent_id,
                        "total_records": len(history_raw),
                        "count": len(compact_entries),
                        "history": compact_entries
                    }

                return {
                    "success": False,
                    "status": "error",
                    "error": f"HTTP {r.status_code} calling provisioning history on {agent_id}",
                    "status_code": r.status_code,
                    "url": str(r.url)
                }
            except Exception as e:
                return self._handle_exception(f"Provisioning history on {agent_id}", e)

