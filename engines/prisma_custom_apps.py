#!/usr/bin/env python3
"""
Prisma SD-WAN Custom Application Manager for Stigix
Uses the official Prisma SASE SDK (prisma_sase) to create, list, sync,
and delete Custom TCP/UDP Application Definitions (appdefs) in Prisma SD-WAN.

This allows Prisma SD-WAN Flow Browser, bandwidth analytics, and policy rules
to automatically classify and display Stigix custom traffic under the exact application name.

Author: Stigix Platform / PAN-DEV Integration
"""

import json
import argparse
import sys
import os
import re
from typing import Optional, Dict, Any, List

from prisma_sase import API, jd

try:
    from stigix_telemetry import init_telemetry
    init_telemetry("prisma_custom_apps.py")
except Exception:
    pass


def parse_arguments():
    """Parse CLI arguments for Custom Application management"""
    parser = argparse.ArgumentParser(
        description='Manage Prisma SD-WAN Custom Application Definitions (appdefs) for Stigix',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all custom applications on the Prisma SD-WAN tenant
  python3 prisma_custom_apps.py --list --json

  # Create or update a custom TCP application
  python3 prisma_custom_apps.py --create --name SAP-ERP --port 3200 --json

  # Delete a specific custom application by name or ID
  python3 prisma_custom_apps.py --delete --name STX_SAP-ERP --json
  python3 prisma_custom_apps.py --delete --app-id 1712345678901234567 --json

  # Sync all Custom TCP applications from Stigix config
  python3 prisma_custom_apps.py --sync-all --config-file /data/stigix/custom-tcp-applications.json --json

  # Clean all Stigix-managed custom applications from tenant
  python3 prisma_custom_apps.py --clean-all --json
"""
    )

    parser.add_argument(
        '--credentials',
        default='credentials.json',
        help='Path to credentials JSON file (default: credentials.json)'
    )

    parser.add_argument(
        '--list',
        action='store_true',
        help='List all custom application definitions on the tenant'
    )

    parser.add_argument(
        '--create',
        action='store_true',
        help='Create or update a custom application definition'
    )

    parser.add_argument(
        '--delete',
        action='store_true',
        help='Delete a custom application definition by --name or --app-id'
    )

    parser.add_argument(
        '--sync-all',
        action='store_true',
        help='Sync all active Stigix custom TCP applications to Prisma SD-WAN'
    )

    parser.add_argument(
        '--sync-multicast',
        action='store_true',
        help='Sync all Stigix Multicast application profiles to Prisma SD-WAN (UDP + Group IP/32)'
    )

    parser.add_argument(
        '--clean-all',
        action='store_true',
        help='Delete all Stigix-created custom applications (tagged "stigix" or prefixed "STX_")'
    )

    parser.add_argument(
        '--purge-orphans',
        action='store_true',
        help='Delete Stigix custom applications from tenant that no longer exist in local Stigix config'
    )

    parser.add_argument(
        '--name',
        help='Application name (e.g. "SAP-ERP" or "STX_SAP-ERP")'
    )

    parser.add_argument(
        '--display-name',
        help='Human-readable display name (e.g. "Stigix SAP ERP")'
    )

    parser.add_argument(
        '--app-id',
        help='Prisma SD-WAN appdef ID to inspect or delete'
    )

    parser.add_argument(
        '--port',
        type=int,
        help='TCP or UDP port number (1-65535)'
    )

    parser.add_argument(
        '--protocol',
        choices=['tcp', 'udp', 'both'],
        default='tcp',
        help='L4 protocol for the custom application (default: tcp)'
    )

    parser.add_argument(
        '--server-prefix',
        help='Optional destination IPv4 prefix (e.g. "239.1.1.100/32" for multicast group classification)'
    )

    parser.add_argument(
        '--category',
        default='business-systems',
        help='Application category (default: business-systems)'
    )

    parser.add_argument(
        '--sub-category',
        default='general',
        help='Application sub-category (default: general)'
    )

    parser.add_argument(
        '--description',
        help='Custom application description'
    )

    parser.add_argument(
        '--config-file',
        help='Path to Stigix custom-tcp-applications.json file for --sync-all'
    )

    parser.add_argument(
        '--json-data',
        help='Raw JSON string containing application definitions for --sync-all'
    )

    parser.add_argument(
        '--api-version',
        default='v2.6',
        help='Prisma SD-WAN API version (default: v2.6)'
    )

    parser.add_argument(
        '--json',
        action='store_true',
        help='Output structured JSON to stdout'
    )

    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable verbose debug output'
    )

    return parser.parse_args()


def log_output(message: str, json_mode: bool = False, is_error: bool = False):
    """Output message to stdout or stderr depending on mode"""
    if not json_mode:
        if is_error:
            print(message, file=sys.stderr)
        else:
            print(message)


def load_credentials(args, json_mode: bool = False) -> Dict[str, str]:
    """Load Prisma SASE credentials from config files first (UI source of truth), then environment variables"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_paths = [
        getattr(args, 'credentials', None),
        os.path.join(os.getcwd(), 'config', 'prisma-config.json'),
        os.path.join(os.getcwd(), 'prisma-config.json'),
        os.path.join(os.getcwd(), 'config', 'credentials.json'),
        os.path.join(os.getcwd(), 'credentials.json'),
        os.path.join(script_dir, '..', 'config', 'prisma-config.json'),
        os.path.join(script_dir, '..', 'config', 'credentials.json'),
        '/data/stigix/config/prisma-config.json',
        '/data/stigix/prisma-config.json',
        '/data/stigix/config/credentials.json',
        '/data/stigix/credentials.json',
        '/app/config/prisma-config.json',
        '/app/config/credentials.json',
        '/app/prisma-config.json',
        '/app/credentials.json',
        '/opt/sdwan-traffic-gen/config/prisma-config.json',
        '/opt/sdwan-traffic-gen/config/credentials.json'
    ]

    for path in candidate_paths:
        if path and os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    creds = json.load(f)
                client_id = str(creds.get("client_id") or creds.get("clientId") or creds.get("CLIENT_ID") or "").strip()
                client_secret = str(creds.get("client_secret") or creds.get("clientSecret") or creds.get("CLIENT_SECRET") or "").strip()
                tsg_id = str(creds.get("tsg_id") or creds.get("tsgid") or creds.get("tsgId") or creds.get("TSG_ID") or creds.get("TSGID") or "").strip()
                if client_id and client_secret and tsg_id:
                    creds_out = {
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "tsg_id": tsg_id,
                        "source": f"file:{path}"
                    }
                    if creds.get("region"):
                        creds_out["region"] = creds["region"]
                    return creds_out
            except Exception:
                pass

    env_client_id = (os.getenv("PRISMA_SDWAN_CLIENT_ID") or os.getenv("PRISMA_CLIENT_ID") or "").strip()
    env_client_secret = (os.getenv("PRISMA_SDWAN_CLIENT_SECRET") or os.getenv("PRISMA_CLIENT_SECRET") or "").strip()
    env_tsg_id = (os.getenv("PRISMA_SDWAN_TSG_ID") or os.getenv("PRISMA_SDWAN_TSGID") or os.getenv("PRISMA_TSG_ID") or "").strip()

    if env_client_id and env_client_secret and env_tsg_id:
        return {
            "client_id": env_client_id,
            "client_secret": env_client_secret,
            "tsg_id": env_tsg_id,
            "source": "env"
        }

    error_msg = {
        "success": False,
        "error": "Prisma SD-WAN credentials not found in environment variables or config files (prisma-config.json / credentials.json)",
        "required_env": [
            "PRISMA_SDWAN_CLIENT_ID",
            "PRISMA_SDWAN_CLIENT_SECRET",
            "PRISMA_SDWAN_TSG_ID"
        ]
    }
    if json_mode:
        print(json.dumps(error_msg, indent=2))
    else:
        log_output(f"❌ {error_msg['error']}", json_mode, is_error=True)
    sys.exit(1)


def sanitize_app_name(raw_name: str) -> str:
    """Normalize app name to Prisma SD-WAN valid identifier with STX_ prefix"""
    if not raw_name:
        return "STX_APP"
    cleaned = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(raw_name).strip())
    if not cleaned.upper().startswith("STX_"):
        return f"STX_{cleaned}"
    return cleaned


def is_stigix_app(app_def: Dict[str, Any]) -> bool:
    """Check if an appdef was created by Stigix"""
    if not app_def or not isinstance(app_def, dict):
        return False
    if app_def.get("app_type") == "system":
        return False
    name = str(app_def.get("display_name") or app_def.get("name") or "")
    desc = str(app_def.get("description") or "")
    abbr = str(app_def.get("abbreviation") or "")

    if name.startswith("STX_") or name.startswith("stx_"):
        return True
    if abbr == "STX" or "Stigix" in desc or "stigix" in desc.lower():
        return True
    return False


def format_cgx_error(resp: Any, action_name: str, payload: Optional[Dict[str, Any]] = None) -> str:
    """Format controller error response into a clean, actionable message with full payload details"""
    content = getattr(resp, 'cgx_content', {}) or {}
    status_code = getattr(resp, 'status_code', None) or (content.get('_status_code') if isinstance(content, dict) else None)
    
    error_details = []
    if isinstance(content, dict):
        raw_errors = content.get('_error', [])
        if isinstance(raw_errors, list):
            for err in raw_errors:
                if isinstance(err, dict):
                    msg = err.get('message') or err.get('code')
                    if msg:
                        error_details.append(str(msg))
                elif isinstance(err, str):
                    error_details.append(err)
        elif isinstance(content.get('error'), dict):
            error_details.append(content['error'].get('message', str(content['error'])))
        elif isinstance(content.get('error'), str):
            error_details.append(content['error'])

    detail_str = "; ".join(error_details) if error_details else (json.dumps(content) if isinstance(content, (dict, list)) else str(content))
    payload_str = f" | Payload: {json.dumps(payload)}" if payload else ""
    return f"Failed to {action_name} (HTTP {status_code}): {detail_str}{payload_str}"


def ensure_global_prefix_filter(sdk: API, prefix: str) -> Optional[str]:
    """Find or create a Prisma SD-WAN Global Prefix Filter for an IPv4 CIDR prefix and return its ID"""
    if not prefix:
        return None
    norm = prefix.strip()
    if "/" not in norm:
        norm = f"{norm}/32"
    filter_name = f"STX_MC_{re.sub(r'[^a-zA-Z0-9]', '_', norm.split('/')[0])}"[:32]
    try:
        resp = sdk.get.globalprefixfilters()
        if resp.cgx_status:
            items = resp.cgx_content.get("items", []) or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get("name") == filter_name:
                    return str(item.get("id"))
                for f in item.get("filters") or []:
                    if isinstance(f, dict) and norm in (f.get("ip_prefixes") or []):
                        return str(item.get("id"))
        create_resp = sdk.post.globalprefixfilters(data={
            "name": filter_name,
            "description": f"Auto-provisioned by Stigix for Multicast Group {norm}",
            "filters": [{"type": "ipv4", "ip_prefixes": [norm]}]
        })
        if create_resp.cgx_status and isinstance(create_resp.cgx_content, dict):
            return str(create_resp.cgx_content.get("id"))
    except Exception:
        pass
    return None


def build_appdef_payload(
    name: str,
    port: int,
    protocol: str = 'tcp',
    description: Optional[str] = None,
    server_prefix: Optional[str] = None,
    prefix_tag: str = "STX_",
    prefix_filter_id: Optional[str] = None
) -> Dict[str, Any]:
    """Construct a clean, valid Prisma SD-WAN appdef dictionary payload strictly compliant with controller schema"""
    cleaned = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(name or "APP").strip())
    cleaned = re.sub(r'_+', '_', cleaned).strip('_-')
    if cleaned.upper().startswith("STX_"):
        std_name = cleaned
    else:
        std_name = f"{prefix_tag}{cleaned}"
    std_name = std_name[:32].rstrip('_-')
    desc = description or f"Auto-provisioned by Stigix for {name} on {protocol.upper()}:{port}"

    tcp_rule = {
        "server_filters": [prefix_filter_id] if prefix_filter_id else None,
        "client_filters": None,
        "server_port": {
            "start": str(int(port)),
            "end": str(int(port))
        },
        "client_port": None,
        "dscp": None,
        "server_prefixes": None,
        "server_ipv6_prefixes": None
    }

    udp_rule = {
        "udp_filters": [prefix_filter_id] if prefix_filter_id else None,
        "udp_port": {
            "start": str(int(port)),
            "end": str(int(port))
        },
        "dscp": None,
        "dest_prefixes": None,
        "dest_ipv6_prefixes": None
    }

    tcp_rules = [dict(tcp_rule)] if protocol in ('tcp', 'both') else None
    udp_rules = [dict(udp_rule)] if protocol in ('udp', 'both') else None

    # Exact verified schema for Prisma SD-WAN v2.6 appdefs
    payload = {
        "path_affinity": "none",
        "ingress_traffic_pct": 50,
        "conn_idle_timeout": 3600,
        "display_name": std_name,
        "abbreviation": "STX",
        "domains": None,
        "tcp_rules": tcp_rules,
        "udp_rules": udp_rules,
        "ip_rules": None,
        "transfer_type": "transactional",
        "app_type": "custom",
        "category": None,
        "session_timeout": 0,
        "aggregate_flows": None,
        "order_number": 1,
        "overrides_allowed": None,
        "system_app_overridden": None,
        "tags": None,
        "description": desc,
        "is_deprecated": None,
        "parent_id": None,
        "use_parentapp_network_policy": None,
        "app_unreachability_detection": True,
        "network_scan_application": False,
        "p_category": "saas",
        "p_sub_category": None,
        "supported_engines": None,
        "p_parent_id": None,
        "supported_base_software_version": None
    }

    return payload


def extract_app_ports(app_def: Dict[str, Any]) -> Dict[str, Any]:
    """Extract TCP and UDP server ports and prefixes defined in an appdef"""
    tcp_ports = []
    udp_ports = []
    server_prefixes = []

    for rule in app_def.get("tcp_rules") or []:
        sp = rule.get("server_port")
        if isinstance(sp, dict) and sp.get("start"):
            try:
                tcp_ports.append(int(sp["start"]))
            except (ValueError, TypeError):
                pass
        elif isinstance(rule.get("server_ports"), list):
            for p in rule["server_ports"]:
                try:
                    tcp_ports.append(int(p))
                except (ValueError, TypeError):
                    pass

    for rule in app_def.get("udp_rules") or []:
        up = rule.get("udp_port") or rule.get("server_port")
        if isinstance(up, dict) and up.get("start"):
            try:
                udp_ports.append(int(up["start"]))
            except (ValueError, TypeError):
                pass
        elif isinstance(rule.get("server_ports"), list):
            for p in rule["server_ports"]:
                try:
                    udp_ports.append(int(p))
                except (ValueError, TypeError):
                    pass
        for key in ("dest_prefixes", "server_prefixes", "udp_filters"):
            if isinstance(rule.get(key), list):
                for pfx in rule[key]:
                    if pfx:
                        server_prefixes.append(str(pfx))

    return {
        "tcp": sorted(list(set(tcp_ports))),
        "udp": sorted(list(set(udp_ports))),
        "server_prefixes": sorted(list(set(server_prefixes)))
    }


def list_custom_apps(sdk: API, api_version: str = 'v2.6') -> List[Dict[str, Any]]:
    """Fetch and normalize all custom applications on the tenant"""
    resp = sdk.get.appdefs(api_version=api_version)
    if not resp.cgx_status:
        err_msg = format_cgx_error(resp, "query appdefs")
        raise RuntimeError(err_msg)

    raw_items = resp.cgx_content.get("items", []) or []
    results = []

    for item in raw_items:
        if not item or not isinstance(item, dict):
            continue
        ports = extract_app_ports(item)
        name_str = str(item.get("display_name") or item.get("name") or "")
        disp_str = name_str
        results.append({
            "id": str(item.get("id") or ""),
            "name": name_str,
            "display_name": disp_str,
            "description": str(item.get("description") or ""),
            "category": str(item.get("p_category") or item.get("category") or "business-systems"),
            "sub_category": str(item.get("p_sub_category") or item.get("sub_category") or "general"),
            "tcp_ports": ports.get("tcp") or [],
            "udp_ports": ports.get("udp") or [],
            "server_prefixes": ports.get("server_prefixes") or [],
            "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
            "is_stigix": is_stigix_app(item),
            "_created_on_utc": item.get("_created_on_utc"),
            "_updated_on_utc": item.get("_updated_on_utc"),
            "_raw": item
        })

    return results


def create_or_update_app(
    sdk: API,
    name: str,
    port: int,
    protocol: str = 'tcp',
    display_name: Optional[str] = None,
    description: Optional[str] = None,
    server_prefix: Optional[str] = None,
    prefix_tag: str = "STX_",
    existing_apps: Optional[List[Dict[str, Any]]] = None,
    api_version: str = 'v2.6'
) -> Dict[str, Any]:
    """Create a new custom application or update existing only if there is a delta"""
    prefix_filter_id = ensure_global_prefix_filter(sdk, server_prefix) if server_prefix else None
    payload = build_appdef_payload(
        name=name,
        port=port,
        protocol=protocol,
        description=description,
        server_prefix=server_prefix,
        prefix_tag=prefix_tag,
        prefix_filter_id=prefix_filter_id
    )

    # Use provided cache of existing apps or query tenant
    if existing_apps is None:
        existing_apps = list_custom_apps(sdk, api_version=api_version)

    match = next((a for a in existing_apps if (a.get("name") or "").lower() == payload["display_name"].lower()), None)

    if match:
        app_id = match["id"]
        # Check if identical (delta check)
        existing_ports = match.get("tcp_ports" if protocol == "tcp" else "udp_ports") or []
        existing_pfxs = match.get("server_prefixes") or []
        pfx_matches = (not prefix_filter_id and not existing_pfxs) or (prefix_filter_id in existing_pfxs)
        if len(existing_ports) == 1 and existing_ports[0] == int(port) and pfx_matches:
            return {
                "action": "unchanged",
                "id": app_id,
                "name": payload["display_name"],
                "display_name": payload["display_name"],
                "port": port,
                "protocol": protocol,
                "server_prefix": server_prefix,
                "app": match
            }

        # Delta detected -> Update existing appdef using full existing object for _etag preservation
        raw_obj = dict(match.get("_raw") or payload)
        raw_obj["tcp_rules"] = payload["tcp_rules"]
        raw_obj["udp_rules"] = payload["udp_rules"]
        raw_obj["description"] = payload["description"]
        
        resp = sdk.put.appdefs(appdef_id=app_id, data=raw_obj, api_version=api_version)
        err_str = format_cgx_error(resp, f"update appdef '{payload['display_name']}' (ID: {app_id})", raw_obj) if not resp.cgx_status else ""
        if not resp.cgx_status and prefix_filter_id and "PREFIX" in err_str.upper():
            fallback_payload = build_appdef_payload(
                name=name, port=port, protocol=protocol, description=description, server_prefix=None, prefix_tag=prefix_tag, prefix_filter_id=None
            )
            raw_obj["udp_rules"] = fallback_payload["udp_rules"]
            resp = sdk.put.appdefs(appdef_id=app_id, data=raw_obj, api_version=api_version)

        if not resp.cgx_status:
            err_msg = format_cgx_error(resp, f"update appdef '{payload['display_name']}' (ID: {app_id})", raw_obj)
            raise RuntimeError(err_msg)
        return {
            "action": "updated",
            "id": app_id,
            "name": payload["display_name"],
            "display_name": payload["display_name"],
            "port": port,
            "protocol": protocol,
            "server_prefix": server_prefix,
            "app": resp.cgx_content
        }
    else:
        # New app -> Create via POST
        resp = sdk.post.appdefs(data=payload, api_version=api_version)
        err_str = format_cgx_error(resp, f"create appdef '{payload['display_name']}'", payload) if not resp.cgx_status else ""
        if not resp.cgx_status and prefix_filter_id and "PREFIX" in err_str.upper():
            fallback_payload = build_appdef_payload(
                name=name, port=port, protocol=protocol, description=description, server_prefix=None, prefix_tag=prefix_tag, prefix_filter_id=None
            )
            resp = sdk.post.appdefs(data=fallback_payload, api_version=api_version)

        if not resp.cgx_status:
            err_msg = format_cgx_error(resp, f"create appdef '{payload['display_name']}'", payload)
            if "OVERLAP" in err_msg.upper():
                return {
                    "action": "unchanged",
                    "id": "",
                    "name": payload["display_name"],
                    "display_name": payload["display_name"],
                    "port": port,
                    "protocol": protocol,
                    "server_prefix": server_prefix,
                    "warning": f"Tuple ({server_prefix or '*'}:{port}/{protocol.upper()}) is already covered by an existing Prisma SD-WAN application."
                }
            raise RuntimeError(err_msg)
        new_id = resp.cgx_content.get("id") if isinstance(resp.cgx_content, dict) else None
        return {
            "action": "created",
            "id": str(new_id or ""),
            "name": payload["display_name"],
            "display_name": payload["display_name"],
            "port": port,
            "protocol": protocol,
            "server_prefix": server_prefix,
            "app": resp.cgx_content
        }


def delete_custom_app(
    sdk: API,
    app_id: Optional[str] = None,
    name: Optional[str] = None,
    api_version: str = 'v2.6'
) -> Dict[str, Any]:
    """Delete a custom application definition by ID or Name"""
    target_id = app_id
    target_name = name

    if not target_id:
        if not target_name:
            raise ValueError("Either --app-id or --name must be provided to delete an application")
        
        target_str = str(target_name).strip()
        if target_str.isdigit():
            target_id = target_str
        else:
            target_norm = target_str.lower()
            std_name = sanitize_app_name(target_str).lower()
            mc_name = sanitize_app_name(f"STX_MC_{target_str}")[:32].lower()
            existing_apps = list_custom_apps(sdk, api_version=api_version)
            match = next(
                (a for a in existing_apps if (
                    str(a.get("id")) == target_str or
                    (a.get("name") or "").lower() in (target_norm, std_name, mc_name) or
                    (a.get("display_name") or "").lower() in (target_norm, std_name, mc_name)
                )),
                None
            )
            if not match:
                return {
                    "success": True,
                    "action": "not_found",
                    "message": f"Application '{target_name}' not found on Prisma SD-WAN tenant"
                }
            target_id = match["id"]
            target_name = match.get("display_name") or match["name"]

    resp = sdk.delete.appdefs(appdef_id=target_id, api_version=api_version)
    if not resp.cgx_status:
        err_msg = format_cgx_error(resp, f"delete appdef (ID {target_id})")
        raise RuntimeError(err_msg)

    return {
        "success": True,
        "action": "deleted",
        "id": target_id,
        "name": target_name
    }


def sync_all_from_config(
    sdk: API,
    config_file: Optional[str] = None,
    json_data: Optional[str] = None,
    api_version: str = 'v2.6'
) -> Dict[str, Any]:
    """Read Stigix Custom TCP applications and synchronize delta to Prisma SD-WAN in single pass"""
    apps_list = []

    if json_data:
        try:
            parsed = json.loads(json_data)
            apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
        except Exception as e:
            raise ValueError(f"Invalid JSON string in --json-data: {e}")
    elif config_file:
        if not os.path.exists(config_file):
            raise FileNotFoundError(f"Configuration file not found: {config_file}")
        with open(config_file, 'r') as f:
            parsed = json.load(f)
            apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
    else:
        # Default auto-detect paths
        default_paths = [
            '/data/stigix/custom-tcp-applications.json',
            os.path.join(os.getcwd(), 'config', 'custom-tcp-applications.json'),
            os.path.join(os.getcwd(), 'custom-tcp-applications.json')
        ]
        for path in default_paths:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    parsed = json.load(f)
                    apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
                break

    if not apps_list:
        return {
            "success": True,
            "message": "No Custom TCP applications found to sync",
            "synced_count": 0,
            "created_count": 0,
            "updated_count": 0,
            "unchanged_count": 0,
            "results": []
        }

    # Fetch existing apps on tenant ONCE (single pass optimization)
    existing_tenant_apps = list_custom_apps(sdk, api_version=api_version)

    results = []
    created_count = 0
    updated_count = 0
    unchanged_count = 0

    for app in apps_list:
        app_name = app.get("name")
        listener = app.get("listener", {})
        port = listener.get("port")
        if not port:
            # Check peers or root port
            port = app.get("port")
        if not app_name or not port:
            continue

        desc = app.get("description") or f"Stigix Custom TCP App {app_name}"
        res = create_or_update_app(
            sdk=sdk,
            name=app_name,
            port=int(port),
            protocol="tcp",
            display_name=f"Stigix {app_name} (TCP {port})",
            description=desc,
            existing_apps=existing_tenant_apps,
            api_version=api_version
        )
        results.append(res)
        if res["action"] == "created":
            created_count += 1
        elif res["action"] == "updated":
            updated_count += 1
        elif res["action"] == "unchanged":
            unchanged_count += 1

    return {
        "success": True,
        "message": f"Delta Sync complete: {created_count} created, {updated_count} updated, {unchanged_count} already up-to-date",
        "synced_count": len(results),
        "created_count": created_count,
        "updated_count": updated_count,
        "unchanged_count": unchanged_count,
        "results": results
    }


def sync_multicast_from_config(
    sdk: API,
    config_file: Optional[str] = None,
    json_data: Optional[str] = None,
    api_version: str = 'v2.6'
) -> Dict[str, Any]:
    """Read Stigix Multicast profiles and synchronize delta to Prisma SD-WAN (UDP + Group IP/32)"""
    mc_list = []

    if json_data:
        try:
            parsed = json.loads(json_data)
            mc_list = parsed.get("multicastApplications", parsed if isinstance(parsed, list) else [])
        except Exception as e:
            raise ValueError(f"Invalid JSON string in --json-data: {e}")
    elif config_file:
        if not os.path.exists(config_file):
            raise FileNotFoundError(f"Configuration file not found: {config_file}")
        with open(config_file, 'r') as f:
            parsed = json.load(f)
            mc_list = parsed.get("multicastApplications", parsed if isinstance(parsed, list) else [])
    else:
        default_paths = [
            '/data/stigix/custom-tcp-applications.json',
            os.path.join(os.getcwd(), 'config', 'custom-tcp-applications.json'),
            os.path.join(os.getcwd(), 'custom-tcp-applications.json')
        ]
        for path in default_paths:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    parsed = json.load(f)
                    mc_list = parsed.get("multicastApplications", parsed if isinstance(parsed, list) else [])
                break

    if not mc_list:
        return {
            "success": True,
            "message": "No Multicast profiles found to sync",
            "synced_count": 0,
            "created_count": 0,
            "updated_count": 0,
            "unchanged_count": 0,
            "results": []
        }

    existing_tenant_apps = list_custom_apps(sdk, api_version=api_version)

    results = []
    created_count = 0
    updated_count = 0
    unchanged_count = 0

    for app in mc_list:
        app_name = app.get("name")
        port = app.get("port")
        group = (app.get("group") or "").strip()
        mode = (app.get("mode") or "asm").upper()
        if not app_name or not port:
            continue

        desc = app.get("description") or f"Stigix Multicast {app_name} ({group}:{port} {mode})"
        server_prefix = f"{group}/32" if group else None
        res = create_or_update_app(
            sdk=sdk,
            name=app_name,
            port=int(port),
            protocol="udp",
            display_name=f"Stigix MC {app_name} ({group}:{port})",
            description=desc[:250],
            server_prefix=server_prefix,
            prefix_tag="STX_MC_",
            existing_apps=existing_tenant_apps,
            api_version=api_version
        )
        results.append(res)
        if res["action"] == "created":
            created_count += 1
        elif res["action"] == "updated":
            updated_count += 1
        elif res["action"] == "unchanged":
            unchanged_count += 1

    return {
        "success": True,
        "message": f"Multicast Delta Sync complete: {created_count} created, {updated_count} updated, {unchanged_count} already up-to-date",
        "synced_count": len(results),
        "created_count": created_count,
        "updated_count": updated_count,
        "unchanged_count": unchanged_count,
        "results": results
    }


def purge_orphaned_apps(
    sdk: API,
    config_file: Optional[str] = None,
    json_data: Optional[str] = None,
    api_version: str = 'v2.6'
) -> Dict[str, Any]:
    """Identify and delete Stigix-created custom applications that no longer exist in Stigix config"""
    apps_list = []
    mc_list = []

    if json_data:
        try:
            parsed = json.loads(json_data)
            apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
            mc_list = parsed.get("multicastApplications", [])
        except Exception as e:
            raise ValueError(f"Invalid JSON string in --json-data: {e}")
    elif config_file:
        if not os.path.exists(config_file):
            raise FileNotFoundError(f"Configuration file not found: {config_file}")
        with open(config_file, 'r', encoding='utf-8') as f:
            parsed = json.load(f)
            apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
            mc_list = parsed.get("multicastApplications", [])
    else:
        default_paths = [
            '/data/stigix/custom-tcp-applications.json',
            os.path.join(os.getcwd(), 'config', 'custom-tcp-applications.json'),
            os.path.join(os.getcwd(), 'custom-tcp-applications.json')
        ]
        for path in default_paths:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    parsed = json.load(f)
                    apps_list = parsed.get("applications", parsed if isinstance(parsed, list) else [])
                    mc_list = parsed.get("multicastApplications", [])
                break

    # Build known active identifiers: normalized names, expected STX names, and ports
    known_names = set()
    known_tcp_ports = set()
    known_udp_ports = set()

    for app in apps_list:
        raw_name = str(app.get("name") or app.get("id") or "").strip()
        if raw_name:
            known_names.add(raw_name.lower())
            known_names.add(sanitize_app_name(raw_name).lower())
            clean = re.sub(r'[^a-zA-Z0-9_\-]', '_', raw_name)
            known_names.add(f"stx_{clean.lower()}")

        listener = app.get("listener") or {}
        port = listener.get("port") or app.get("port")
        if not port and app.get("peers") and len(app["peers"]) > 0:
            port = app["peers"][0].get("port")
        if port:
            try:
                known_tcp_ports.add(int(port))
            except (ValueError, TypeError):
                pass

    for mc in mc_list:
        raw_name = str(mc.get("name") or mc.get("id") or "").strip()
        if raw_name:
            known_names.add(raw_name.lower())
            clean = re.sub(r'[^a-zA-Z0-9_\-]', '_', raw_name)
            known_names.add(f"stx_mc_{clean.lower()}"[:32])
        port = mc.get("port")
        if port:
            try:
                known_udp_ports.add(int(port))
            except (ValueError, TypeError):
                pass

    # Query all tenant apps
    existing_apps = list_custom_apps(sdk, api_version=api_version)
    stigix_apps = [a for a in existing_apps if a.get("is_stigix")]

    orphans = []
    for a in stigix_apps:
        app_name = (a.get("name") or "").lower()
        disp_name = (a.get("display_name") or "").lower()
        a_tcp_ports = set(a.get("tcp_ports") or [])
        a_udp_ports = set(a.get("udp_ports") or [])

        # Check if matched by name
        name_match = (
            app_name in known_names or
            disp_name in known_names or
            any(k in app_name or k in disp_name for k in known_names if len(k) > 3)
        )
        # Check if matched by port
        port_match = bool((a_tcp_ports and a_tcp_ports.intersection(known_tcp_ports)) or
                          (a_udp_ports and a_udp_ports.intersection(known_udp_ports)))

        if not name_match and not port_match:
            orphans.append(a)

    purged = []
    errors = []
    for orphan in orphans:
        orphan_id = orphan["id"]
        orphan_name = orphan.get("display_name") or orphan["name"]
        resp = sdk.delete.appdefs(appdef_id=orphan_id, api_version=api_version)
        if resp.cgx_status:
            purged.append({
                "id": orphan_id,
                "name": orphan_name,
                "display_name": orphan.get("display_name"),
                "tcp_ports": orphan.get("tcp_ports", []),
                "udp_ports": orphan.get("udp_ports", [])
            })
        else:
            errors.append({
                "id": orphan_id,
                "name": orphan_name,
                "error": format_cgx_error(resp, f"delete orphan appdef {orphan_name}")
            })

    return {
        "success": True if not errors else (len(purged) > 0),
        "message": f"Successfully purged {len(purged)} orphaned Stigix custom application(s) from Prisma SD-WAN" if not errors else f"Purged {len(purged)} orphaned app(s) with {len(errors)} failure(s)",
        "purged_count": len(purged),
        "orphans_found": len(orphans),
        "purged_apps": purged,
        "errors": errors
    }


def clean_all_stigix_apps(sdk: API, api_version: str = 'v2.6') -> Dict[str, Any]:
    """Remove all Stigix-created apps from the tenant"""
    existing_apps = list_custom_apps(sdk, api_version=api_version)
    stigix_apps = [a for a in existing_apps if a.get("is_stigix")]

    deleted = []
    for app in stigix_apps:
        app_id = app["id"]
        app_name = app["name"]
        resp = sdk.delete.appdefs(appdef_id=app_id, api_version=api_version)
        if resp.cgx_status:
            deleted.append({"id": app_id, "name": app_name})

    return {
        "success": True,
        "message": f"Successfully deleted {len(deleted)} Stigix custom application(s)",
        "deleted_count": len(deleted),
        "deleted_apps": deleted
    }


def main():
    args = parse_arguments()
    json_mode = args.json

    # 1. Load Credentials
    creds = load_credentials(args, json_mode=json_mode)

    # 2. Instantiate and Authenticate via Prisma SASE SDK
    sdk = API(update_check=False)
    log_output(f"🔐 Authenticating with Prisma SASE SDK (TSG: {creds['tsg_id']})...", json_mode)

    try:
        login_success = sdk.interactive.login_secret(
            client_id=creds['client_id'],
            client_secret=creds['client_secret'],
            tsg_id=creds['tsg_id']
        )
        if not login_success:
            raise ValueError("API login_secret returned False. Check credentials and TSG ID.")
        log_output("✓ Authenticated successfully to Prisma SD-WAN", json_mode)
    except Exception as e:
        error_msg = {
            "success": False,
            "error": f"Authentication failed: {e}"
        }
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(f"❌ Authentication failed: {e}", json_mode, is_error=True)
        sys.exit(1)

    # 3. Route Command
    try:
        if args.list:
            apps = list_custom_apps(sdk, api_version=args.api_version)
            if json_mode:
                print(json.dumps({
                    "success": True,
                    "tenant_id": sdk.tenant_id,
                    "total_apps": len(apps),
                    "stigix_apps_count": sum(1 for a in apps if a.get("is_stigix")),
                    "apps": apps
                }, indent=2))
            else:
                print(f"\n📋 Custom Applications on Tenant ({len(apps)} found):")
                print(f"{'NAME':<28} {'PORT':<12} {'IS STIGIX':<12} {'ID':<22} {'DISPLAY NAME'}")
                print("-" * 95)
                for a in apps:
                    tcp_p = ",".join(map(str, a.get("tcp_ports", []))) or "-"
                    is_stx = "✅ YES" if a.get("is_stigix") else "⬜ NO"
                    print(f"{a['name']:<28} {tcp_p:<12} {is_stx:<12} {str(a['id']):<22} {a.get('display_name') or ''}")

        elif args.create:
            if not args.name or not args.port:
                raise ValueError("Both --name and --port are required to create a custom application")

            prefix_tag = "STX_MC_" if (args.protocol == 'udp' and args.server_prefix) else "STX_"
            res = create_or_update_app(
                sdk=sdk,
                name=args.name,
                port=args.port,
                protocol=args.protocol,
                display_name=args.display_name,
                description=args.description,
                server_prefix=args.server_prefix,
                prefix_tag=prefix_tag,
                api_version=args.api_version
            )
            output = {
                "success": True,
                **res
            }
            if json_mode:
                print(json.dumps(output, indent=2))
            else:
                print(f"✅ Application '{res['name']}' {res['action']} successfully! (Port: {args.port}, ID: {res['id']})")

        elif args.delete:
            res = delete_custom_app(
                sdk=sdk,
                app_id=args.app_id,
                name=args.name,
                api_version=args.api_version
            )
            if json_mode:
                print(json.dumps(res, indent=2))
            else:
                if res.get("action") == "deleted":
                    print(f"🗑️ Application '{res.get('name')}' (ID: {res.get('id')}) deleted successfully")
                else:
                    print(f"⚠️ {res.get('message')}")

        elif args.sync_all:
            res = sync_all_from_config(
                sdk=sdk,
                config_file=args.config_file,
                json_data=args.json_data,
                api_version=args.api_version
            )
            if json_mode:
                print(json.dumps(res, indent=2))
            else:
                print(f"🔄 {res.get('message')}")

        elif args.sync_multicast:
            res = sync_multicast_from_config(
                sdk=sdk,
                config_file=args.config_file,
                json_data=args.json_data,
                api_version=args.api_version
            )
            if json_mode:
                print(json.dumps(res, indent=2))
            else:
                print(f"🔄 {res.get('message')}")

        elif args.clean_all:
            res = clean_all_stigix_apps(sdk, api_version=args.api_version)
            if json_mode:
                print(json.dumps(res, indent=2))
            else:
                print(f"🧹 {res.get('message')}")

        elif args.purge_orphans:
            res = purge_orphaned_apps(
                sdk=sdk,
                config_file=args.config_file,
                json_data=args.json_data,
                api_version=args.api_version
            )
            if json_mode:
                print(json.dumps(res, indent=2))
            else:
                print(f"🧹 {res.get('message')}")

        else:
            # Default to list if no action flag provided
            apps = list_custom_apps(sdk, api_version=args.api_version)
            if json_mode:
                print(json.dumps({"success": True, "apps": apps}, indent=2))
            else:
                print(f"Found {len(apps)} custom applications. Run with --help for available options.")

    except Exception as e:
        error_msg = {
            "success": False,
            "error": str(e)
        }
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(f"❌ Error: {e}", json_mode, is_error=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
