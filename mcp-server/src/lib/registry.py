import logging
import json
import os
import httpx
import jwt # PyJWT
from datetime import datetime, timedelta
from typing import List, Optional
from ..types import StigixEndpoint

logger = logging.getLogger(__name__)

class RegistryClient:
    """
    Client for interacting with the Stigix Registry.
    v2: Real implementation connecting to Target Controller.
    """
    
    def __init__(self):
        self.controller_url = self._discover_controller()
        self.jwt_secret = os.getenv("JWT_SECRET", "your-secure-secret-here")
        self._mock_endpoints = [
            StigixEndpoint(
                id="branch-paris-1",
                kind="fabric",
                role="both",
                capabilities=["xfr-source", "xfr-target", "voice", "iot"],
                test_ip="192.168.10.10",
                api_base_url="http://192.168.10.10:8080",
                meta={"site_name": "FALLBACK-MOCK-OR-AUTH-ERROR", "region": "EMEA"}
            )
        ]

    def _discover_controller(self) -> Optional[str]:
        """Reads static-leader.json to find the Target Controller."""
        config_path = "/Users/jsuzanne/Github/stigix/config/static-leader.json"
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    data = json.load(f)
                    url = data.get("url")
                    if url:
                        logger.info(f"Discovered Controller URL: {url}")
                        return url
        except Exception as e:
            logger.error(f"Failed to read controller config: {e}")
        return None

    def _generate_token(self) -> str:
        """Generates a JWT for authenticateToken middleware."""
        import time
        payload = {
            "id": "mcp-orchestrator",
            "username": "mcp-worker",
            "role": "admin",
            "exp": int(time.time()) + 3600
        }
        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")

    async def list_endpoints(self, kind: Optional[str] = None) -> List[StigixEndpoint]:
        """Fetches and merges endpoints from all available sources (local aggregation is preferred)."""
        sources = []
        # Local dashboard is the primary aggregator
        sources.append("http://localhost:8080/api/targets")
        if self.controller_url:
            base_remote = self.controller_url.split("/api/registry")[0]
            if f"{base_remote}/api/targets" not in sources:
                sources.append(f"{base_remote}/api/targets")

        merged_endpoints = {} # host -> StigixEndpoint

        for targets_api in sources:
            try:
                logger.info(f"Discovery Polling: {targets_api}")
                headers = {"Authorization": f"Bearer {self._generate_token()}"}
                
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(targets_api, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    
                    for t in data:
                        host = t.get("host")
                        if not host:
                            continue
                            
                        # If duplicate IP, prefer 'managed' source over 'synthesized'
                        is_new = host not in merged_endpoints
                        is_upgrade = not is_new and merged_endpoints[host].meta.get("source") == "synthesized" and t.get("source") == "managed"
                        
                        if is_new or is_upgrade:
                            # Extract capabilities
                            caps_obj = t.get("capabilities", {})
                            caps_list = t.get("capabilities_list", [])
                            if not caps_list and isinstance(caps_obj, dict):
                                caps_list = [k for k, v in caps_obj.items() if v]
                            
                            # Expand generic xfr to source/target
                            if "xfr" in caps_list:
                                if "xfr-source" not in caps_list: caps_list.append("xfr-source")
                                if "xfr-target" not in caps_list: caps_list.append("xfr-target")
                            
                            endpoint = StigixEndpoint(
                                id=t.get("id", t.get("name")),
                                kind=t.get("kind", "fabric"),
                                role=t.get("role", "both"),
                                capabilities=caps_list,
                                test_ip=host,
                                public_ip=t.get("public_ip") or t.get("meta", {}).get("ip_public"),
                                api_base_url=f"http://{host}:8080",
                                meta={
                                    **t.get("meta", {}),
                                    "site_name": t.get("name") or t.get("id"),
                                    "source": t.get("source")
                                }
                            )
                            merged_endpoints[host] = endpoint
            except Exception as e:
                logger.warning(f"Discovery failed for {targets_api}: {e}")

        endpoints = list(merged_endpoints.values())
        if not endpoints:
            logger.error("All discovery sources failed. Using fallback.")
            return self._mock_endpoints
        
        if kind:
            endpoints = [e for e in endpoints if e.kind == kind]
            
        logger.info(f"Discovery complete. Managed {len(endpoints)} endpoints.")
        return endpoints

    async def get_endpoint(self, identifier: str) -> Optional[StigixEndpoint]:
        """Tries to find an endpoint by ID, Name or IP address."""
        endpoints = await self.list_endpoints()
        for e in endpoints:
            # Check ID, Site Name (in meta), or Test IP
            if (e.id == identifier or 
                e.meta.get("site_name") == identifier or 
                e.test_ip == identifier or 
                e.public_ip == identifier):
                return e
        return None
