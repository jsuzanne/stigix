#!/usr/bin/env python3

import argparse
import json
import sys
import textwrap
import requests
import urllib3
import ipaddress

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def resolve_input(ip_input):
    """
    Takes an IP, CIDR, or FQDN.
    Returns a tuple (original_input, list_of_prefixes, is_fqdn)
    For IPs/CIDRs, list_of_prefixes has 1 element.
    For FQDNs, list_of_prefixes has all resolved IPv4 addresses as /32.
    """
    try:
        # If already has a mask, it must be a valid CIDR
        if '/' in ip_input:
            network = ipaddress.ip_network(ip_input, strict=False)
            return (ip_input, [str(network)], False)
        else:
            # Try parsing as a single IP
            try:
                ip = ipaddress.ip_address(ip_input)
                return (ip_input, [f"{ip}/32"], False)
            except ValueError:
                # Not an IP, assume FQDN
                import socket
                # AF_INET guarantees we only get IPv4 addresses
                addr_info = socket.getaddrinfo(ip_input, None, socket.AF_INET)
                # addr_info returns list of tuples: (family, type, proto, canonname, sockaddr)
                # sockaddr for IPv4 is (address, port)
                ips = list(set([item[4][0] for item in addr_info]))
                if not ips:
                    raise ValueError(f"Could not resolve any IPv4 addresses for {ip_input}")
                
                return (ip_input, [f"{ip}/32" for ip in ips], True)
    except Exception as e:
        raise ValueError(f"Invalid IP address, prefix, or FQDN: {ip_input} ({e})")

def api_call(host, api_key, operations, verify=False):
    """Call VyOS HTTPS API"""
    url = f"https://{host}/configure"
    data = json.dumps(operations)
    files = {
        "data": (None, data),
        "key": (None, api_key),
    }
    resp = requests.post(url, files=files, verify=verify)
    if not resp.ok:
        # Show the actual VyOS error body to help diagnose 400/500 issues
        try:
            body = resp.text.strip()
        except Exception:
            body = "<unreadable response>"
        raise RuntimeError(f"{resp.status_code} {resp.reason} — {url}\nVyOS response: {body}")
    r = resp.json()
    if not r.get("success", False):
        raise RuntimeError(f"VyOS API error: {r.get('error')}")
    return r

def api_retrieve(host, api_key, verify=False):
    """Retrieve full configuration using /retrieve endpoint"""
    url = f"https://{host}/retrieve"
    files = {
        "data": (None, json.dumps({"op": "showConfig", "path": []})),
        "key": (None, api_key),
    }
    resp = requests.post(url, files=files, verify=False)
    resp.raise_for_status()
    r = resp.json()
    if not r.get("success", False):
        raise RuntimeError(f"VyOS API error: {r.get('error')}")
    return r.get("data", {})

def get_router_info(host, apikey, verify=False):
    """Get router version, interfaces, and descriptions"""
    try:
        info = {'success': True, 'version': None, 'interfaces': [], 'hostname': None}
        
        # Get full config
        config = api_retrieve(host, apikey, verify)
        
        # Detect version based on config structure
        if 'traffic-policy' in config:
            info['version'] = '1.4'
        elif 'firewall' in config:
            fw = config['firewall']
            # VyOS 1.5+ has ipv4/ipv6 under firewall
            if 'ipv4' in fw or 'ipv6' in fw:
                info['version'] = '1.5'
            else:
                info['version'] = '1.4'
        elif 'qos' in config and config['qos']:
            info['version'] = '1.5'
        else:
            info['version'] = '1.5'  # Default to modern
        
        # Get hostname
        if 'system' in config and 'host-name' in config['system']:
            info['hostname'] = config['system']['host-name']
        
        # QoS lookup tables
        if info['version'] == '1.4':
            ne_policies = config.get('traffic-policy', {}).get('network-emulator', {})
        else:
            ne_policies = config.get('qos', {}).get('policy', {}).get('network-emulator', {})

        def _extract_qos(policy_name):
            if not policy_name or policy_name not in ne_policies:
                return None
            p = ne_policies[policy_name]
            if not isinstance(p, dict):
                return None
            params = {}
            if 'network-delay' in p:
                d_str = str(p['network-delay']).replace('ms', '')
                try: params['latency'] = int(float(d_str))
                except: pass
            if 'delay' in p:
                d_str = str(p['delay']).replace('ms', '')
                try: params['latency'] = int(float(d_str))
                except: pass
            if 'packet-loss' in p:
                l_str = str(p['packet-loss']).replace('%', '')
                try: params['loss'] = int(float(l_str))
                except: pass
            if 'loss' in p:
                l_str = str(p['loss']).replace('%', '')
                try: params['loss'] = int(float(l_str))
                except: pass
            return params if params else None

        # Get ethernet interfaces
        if 'interfaces' in config and 'ethernet' in config['interfaces']:
            ethernet_ifaces = config['interfaces']['ethernet']
            for iface_name, iface_data in ethernet_ifaces.items():
                iface_info = {
                    'name': iface_name,
                    'description': iface_data.get('description'),
                    'address': [],
                    'status': 'down' if 'disable' in iface_data else 'up'
                }
                
                # Detect attached QoS policy
                attached_policy = None
                if info['version'] == '1.4':
                    attached_policy = iface_data.get('traffic-policy', {}).get('out')
                else:
                    qos_iface = config.get('qos', {}).get('interface', {}).get(iface_name, {})
                    egress = qos_iface.get('egress')
                    if isinstance(egress, dict):
                        attached_policy = next(iter(egress), None)
                    elif isinstance(egress, str):
                        attached_policy = egress
                
                qos_data = _extract_qos(attached_policy)
                if qos_data:
                    iface_info['qos'] = qos_data

                addr = iface_data.get('address')
                if addr:
                    if isinstance(addr, str):
                        iface_info['address'] = [addr]
                    elif isinstance(addr, list):
                        iface_info['address'] = addr
                    else:
                        iface_info['address'] = []
                info['interfaces'].append(iface_info)
            
            info['interfaces'].sort(key=lambda x: x['name'])
        
        return info
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'version': None,
            'interfaces': [],
            'hostname': None
        }

def ops_to_vyos_cli(operations):
    """Convert a list of API operations to the equivalent VyOS CLI commands.
    
    Useful for debugging: you can paste the output directly in 'configure' mode.
    """
    lines = []
    for op in operations:
        # Strip trailing empty strings (presence nodes have no value in CLI)
        path_parts = [p for p in op.get("path", []) if p != ""]
        cmd = f"{op['op']} {' '.join(path_parts)}"
        lines.append(cmd)
    return lines

def op_set_interface_state(iface, shutdown, version):
    """Shut/no-shut interface (same for 1.4 and 1.5)

    'disable' is a presence node in VyOS YANG (no value, just exists or not).
    The REST API accepts the path without a trailing value for this case.
    """
    if shutdown:
        return [{"op": "set", "path": ["interfaces", "ethernet", iface, "disable"]}]
    else:
        return [{"op": "delete", "path": ["interfaces", "ethernet", iface, "disable"]}]

def op_set_latency(iface, ms, version):
    """Set latency (delay) on interface"""
    pol = f"LAB_LAT_{iface}"
    ops = []
    
    if version == "1.4":
        if ms is None:
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "network-delay", str(ms)]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
    else:
        if ms is None:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "delay", str(ms)]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

def op_set_loss(iface, percent, version):
    """Set packet loss on interface"""
    pol = f"LAB_LOSS_{iface}"
    ops = []
    
    if version == "1.4":
        if percent is None:
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "packet-loss", str(int(percent))]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
    else:
        if percent is None:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "loss", str(int(percent))]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

def op_set_corruption(iface, percent, version):
    """Set packet corruption on interface"""
    pol = f"LAB_CORRUPT_{iface}"
    ops = []
    
    if version == "1.4":
        if percent is None:
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "packet-corruption", str(int(percent))]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
    else:
        if percent is None:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "corruption", str(int(percent))]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

def op_set_reorder(iface, percent, gap, version):
    """Set packet reordering on interface"""
    pol = f"LAB_REORDER_{iface}"
    ops = []
    
    if version == "1.4":
        if percent is None:
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "packet-reordering", str(int(percent))]})
            if gap is not None:
                ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "packet-reordering-correlation", str(gap)]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
    else:
        if percent is None:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "reordering", str(int(percent))]})
            if gap is not None:
                ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "reordering-gap", str(gap)]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

def op_set_rate(iface, rate, version):
    """Set bandwidth rate limit"""
    pol = f"LAB_RATE_{iface}"
    ops = []
    
    if version == "1.4":
        if rate is None:
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["traffic-policy", "network-emulator", pol, "bandwidth", rate]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
    else:
        if rate is None:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
        else:
            ops.append({"op": "set", "path": ["qos", "policy", "network-emulator", pol, "rate", rate]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

def op_set_combined_qos(iface, version, delay=None, loss=None, corruption=None, reorder=None, reorder_gap=None, rate=None):
    """Set multiple QoS parameters in a single policy"""
    pol = f"LAB_COMBINED_{iface}"
    ops = []
    
    if all(v is None for v in [delay, loss, corruption, reorder, rate]):
        if version == "1.4":
            ops.append({"op": "delete", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out"]})
            ops.append({"op": "delete", "path": ["traffic-policy", "network-emulator", pol]})
        else:
            ops.append({"op": "delete", "path": ["qos", "interface", iface, "egress"]})
            ops.append({"op": "delete", "path": ["qos", "policy", "network-emulator", pol]})
    else:
        if version == "1.4":
            base_path = ["traffic-policy", "network-emulator", pol]
            if delay is not None:
                ops.append({"op": "set", "path": base_path + ["network-delay", str(delay)]})
            if loss is not None:
                ops.append({"op": "set", "path": base_path + ["packet-loss", str(int(loss))]})
            if corruption is not None:
                ops.append({"op": "set", "path": base_path + ["packet-corruption", str(int(corruption))]})
            if reorder is not None:
                ops.append({"op": "set", "path": base_path + ["packet-reordering", str(int(reorder))]})
                if reorder_gap is not None:
                    ops.append({"op": "set", "path": base_path + ["packet-reordering-correlation", str(reorder_gap)]})
            if rate is not None:
                ops.append({"op": "set", "path": base_path + ["bandwidth", rate]})
            ops.append({"op": "set", "path": ["interfaces", "ethernet", iface, "traffic-policy", "out", pol]})
        else:
            base_path = ["qos", "policy", "network-emulator", pol]
            if delay is not None:
                ops.append({"op": "set", "path": base_path + ["delay", str(delay)]})
            if loss is not None:
                ops.append({"op": "set", "path": base_path + ["loss", str(int(loss))]})
            if corruption is not None:
                ops.append({"op": "set", "path": base_path + ["corruption", str(int(corruption))]})
            if reorder is not None:
                ops.append({"op": "set", "path": base_path + ["reordering", str(int(reorder))]})
                if reorder_gap is not None:
                    ops.append({"op": "set", "path": base_path + ["reordering-gap", str(reorder_gap)]})
            if rate is not None:
                ops.append({"op": "set", "path": base_path + ["rate", rate]})
            ops.append({"op": "set", "path": ["qos", "interface", iface, "egress", pol]})
    
    return ops

# NEW: Blackhole route functions (simple-block/simple-unblock)
def get_blackhole_routes(config):
    """Parse config and return list of dicts with tag 999: [{'prefix': '...', 'description': '...'}]"""
    routes = []
    static_routes = config.get("protocols", {}).get("static", {}).get("route", {})
    
    for prefix, route_data in static_routes.items():
        if isinstance(route_data, dict):
            # Check if blackhole exists
            if "blackhole" in route_data:
                bh_data = route_data.get("blackhole", {})
                # Check for tag 999 (it could be a sibling of blackhole, or a child of blackhole)
                if str(route_data.get("tag")) == "999" or (isinstance(bh_data, dict) and str(bh_data.get("tag")) == "999"):
                    desc = route_data.get("description", "")
                    routes.append({"prefix": prefix, "description": desc})
    
    routes.sort(key=lambda x: x["prefix"])
    return routes

def op_simple_block(host, api_key, version, ip_input, verify=False):
    """Block a prefix or FQDN using blackhole route with tag 999 and description tracking"""
    try:
        # Resolve IP/prefix/FQDN
        original_input, prefixes, is_fqdn = resolve_input(ip_input)
        
        if is_fqdn and version == "1.4":
            raise ValueError("FQDN blocking is only supported on VyOS 1.5+")
            
        # Check existing
        config = api_retrieve(host, api_key, verify)
        existing_dicts = get_blackhole_routes(config)
        existing_prefixes = [r["prefix"] for r in existing_dicts]
        
        # We need to add operations for any prefix not already blocked
        prefixes_to_add = [p for p in prefixes if p not in existing_prefixes]
        
        if not prefixes_to_add:
            return {
                "success": True,
                "data": {
                    "action": "simple-block",
                    "input": original_input,
                    "prefixes": prefixes,
                    "message": "All resolved prefixes already blocked (no change)",
                    "blocked_routes": existing_dicts
                }
            }
        
        # Add blackhole route with tag 999 (and description for 1.5)
        ops_modern = []
        for prefix in prefixes_to_add:
            ops_modern.extend([
                {"op": "set", "path": ["protocols", "static", "route", prefix, "blackhole"]},
                {"op": "set", "path": ["protocols", "static", "route", prefix, "blackhole", "tag", "999"]}
            ])
            if version == "1.5":
                desc = f"block {original_input} {prefix}"
                ops_modern.append({"op": "set", "path": ["protocols", "static", "route", prefix, "description", desc]})
            
        try:
            api_call(host, api_key, ops_modern, verify)
        except RuntimeError as e:
            # Fallback to legacy syntax if modern fails
            ops_legacy = []
            for prefix in prefixes_to_add:
                ops_legacy.extend([
                    {"op": "set", "path": ["protocols", "static", "route", prefix, "blackhole"]},
                    {"op": "set", "path": ["protocols", "static", "route", prefix, "tag", "999"]}
                ])
                if version == "1.5":
                    desc = f"block {original_input} {prefix}"
                    ops_legacy.append({"op": "set", "path": ["protocols", "static", "route", prefix, "description", desc]})
            api_call(host, api_key, ops_legacy, verify)
        
        # Fetch updated list
        config_after = api_retrieve(host, api_key, verify)
        updated = get_blackhole_routes(config_after)
        
        return {
            "success": True,
            "data": {
                "action": "simple-block",
                "input": original_input,
                "added_prefixes": prefixes_to_add,
                "blocked_routes": updated
            }
        }
        
    except ValueError as e:
        return {
            "success": False,
            "error": str(e)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def op_simple_unblock(host, api_key, version, ip_input, verify=False):
    """Unblock by matching exact prefix (and FQDN description for 1.5)"""
    try:
        try:
            original_input, resolved_prefixes, is_fqdn = resolve_input(ip_input)
            if is_fqdn and version == "1.4":
                raise ValueError("FQDN blocking is only supported on VyOS 1.5+")
        except ValueError as e:
            # If resolution fails during unblock, fallback to string match
            # But if it's a version error, we still want to raise it
            if "FQDN blocking is only supported" in str(e):
                raise
            original_input = ip_input
            resolved_prefixes = [ip_input]
            
        config = api_retrieve(host, api_key, verify)
        existing_dicts = get_blackhole_routes(config)
        
        prefixes_to_remove = set()
        
        for r in existing_dicts:
            p = r["prefix"]
            d = r.get("description", "")
            
            # Match 1: exact prefix matches any of the resolved prefixes
            if p in resolved_prefixes:
                prefixes_to_remove.add(p)
                continue
                
            # Match 2: exact IP if user passed IP without /32
            if '/' not in original_input and p == f"{original_input}/32":
                prefixes_to_remove.add(p)
                continue
                
            # Match 3: FQDN description matching (for 1.5)
            if version == "1.5" and d.startswith(f"block {original_input} "):
                prefixes_to_remove.add(p)
                continue
        
        if not prefixes_to_remove:
            return {
                "success": False,
                "error": f"Prefix or FQDN '{original_input}' is not blocked (no exact prefix or matching description found)",
                "data": {"blocked_routes": existing_dicts}
            }
        
        # Delete the routes
        ops = []
        for p in prefixes_to_remove:
            ops.append({"op": "delete", "path": ["protocols", "static", "route", p]})
        
        api_call(host, api_key, ops, verify)
        
        # Fetch updated list
        config_after = api_retrieve(host, api_key, verify)
        updated = get_blackhole_routes(config_after)
        
        return {
            "success": True,
            "data": {
                "action": "simple-unblock",
                "input": original_input,
                "removed_prefixes": list(prefixes_to_remove),
                "blocked_routes": updated
            }
        }
        
    except ValueError as e:
        return {
            "success": False,
            "error": str(e)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def op_get_blocks(host, api_key, verify=False):
    """List all blackhole routes with tag 999 (for simple-block)"""
    try:
        config = api_retrieve(host, api_key, verify)
        blocked = get_blackhole_routes(config)
        
        return {
            "success": True,
            "data": {
                "blocked_routes": blocked,
                "count": len(blocked)
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def op_clear_blocks(host, api_key, verify=False):
    """Remove ALL blackhole routes with tag 999"""
    try:
        config = api_retrieve(host, api_key, verify)
        blocked = get_blackhole_routes(config)
        
        if not blocked:
            return {
                "success": True,
                "data": {
                    "action": "clear-blocks",
                    "message": "No blackhole routes with tag 999 found",
                    "removed_count": 0,
                    "removed_routes": []
                }
            }
        
        # Build delete operations for all routes
        ops = []
        for r in blocked:
            ops.append({"op": "delete", "path": ["protocols", "static", "route", r["prefix"]]})
        
        # Execute all deletes in one API call
        api_call(host, api_key, ops, verify)
        
        return {
            "success": True,
            "data": {
                "action": "clear-blocks",
                "removed_count": len(blocked),
                "removed_routes": blocked
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def op_get_state(host, api_key, verify=False):
    """
    Read-only full state audit for a VyOS router.

    Returns in one call:
      - Per-interface: admin state (up/down), active QoS params, description
      - Blackhole IP blocks (tag 999)

    Firewall-based blocks (SDWAN_BLOCK_*) are NOT returned as that feature
    is no longer used — only blackhole/simple-block is supported.
    """
    try:
        config = api_retrieve(host, api_key, verify)

        # ── Detect VyOS version (same logic as get_router_info) ──────────────
        if 'traffic-policy' in config:
            version = '1.4'
        elif 'firewall' in config:
            fw = config['firewall']
            version = '1.5' if ('ipv4' in fw or 'ipv6' in fw) else '1.4'
        elif 'qos' in config and config['qos']:
            version = '1.5'
        else:
            version = '1.5'

        hostname = config.get('system', {}).get('host-name')

        # ── QoS lookup tables ─────────────────────────────────────────────────
        if version == '1.4':
            ne_policies = config.get('traffic-policy', {}).get('network-emulator', {})
        else:
            ne_policies = config.get('qos', {}).get('policy', {}).get('network-emulator', {})

        def _qos_params(policy_name):
            """Extract delay/loss/rate/corruption from a network-emulator policy dict."""
            if not policy_name or policy_name not in ne_policies:
                return None
            p = ne_policies[policy_name]
            if not isinstance(p, dict):
                return None
            params = {}
            # VyOS 1.4 key names
            if 'network-delay' in p:
                params['delay_ms'] = p['network-delay']
            if 'delay' in p:
                params['delay_ms'] = p['delay']
            if 'packet-loss' in p:
                params['loss_pct'] = p['packet-loss']
            if 'loss' in p:
                params['loss_pct'] = p['loss']
            if 'bandwidth' in p:
                params['rate'] = p['bandwidth']
            if 'rate' in p:
                params['rate'] = p['rate']
            if 'packet-corruption' in p or 'corruption' in p:
                params['corruption_pct'] = p.get('packet-corruption') or p.get('corruption')
            params['policy'] = policy_name
            return params if len(params) > 1 else None  # >1 because policy key always present

        # ── Interface enumeration ──────────────────────────────────────────────
        interfaces = []
        for iface_name, iface_data in config.get('interfaces', {}).get('ethernet', {}).items():
            if not isinstance(iface_data, dict):
                continue

            admin_state = 'down' if 'disable' in iface_data else 'up'
            description = iface_data.get('description')

            # Detect attached QoS policy
            attached_policy = None
            if version == '1.4':
                attached_policy = iface_data.get('traffic-policy', {}).get('out')
            else:
                # VyOS 1.5: qos/interface/<iface>/egress/<policy_name>
                qos_iface = config.get('qos', {}).get('interface', {}).get(iface_name, {})
                egress = qos_iface.get('egress')
                if isinstance(egress, dict):
                    # egress is {policy_name: {}}
                    attached_policy = next(iter(egress), None)
                elif isinstance(egress, str):
                    attached_policy = egress

            addr = iface_data.get('address', [])
            if isinstance(addr, str):
                addr = [addr]

            iface_entry = {
                'name': iface_name,
                'description': description,
                'addresses': addr,
                'admin_state': admin_state,
                'qos_active': _qos_params(attached_policy)
            }
            interfaces.append(iface_entry)

        interfaces.sort(key=lambda x: x['name'])

        # ── Blackhole IP blocks (tag 999) ─────────────────────────────────────
        blackhole_blocks = get_blackhole_routes(config)  # existing function

        return {
            'success': True,
            'version': version,
            'hostname': hostname,
            'interfaces': interfaces,
            'blackhole_blocks': blackhole_blocks,
            'blackhole_count': len(blackhole_blocks)
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


# RENAMED: Firewall-based block functions (fw-block/fw-unblock)
def get_existing_fw_blocks(config, version, iface):
    """Parse config and return list of currently blocked IPs on interface (firewall)"""
    ruleset_name = f"SDWAN_BLOCK_{iface}"
    blocks = []
    
    # Navigate to firewall rulesets
    if version == "1.4":
        rulesets = config.get("firewall", {}).get("name", {})
    else:  # 1.5
        rulesets = config.get("firewall", {}).get("ipv4", {}).get("name", {})
    
    ruleset = rulesets.get(ruleset_name, {})
    if not ruleset:
        return blocks
    
    # Parse rules
    rules = ruleset.get("rule", {})
    for rule_num, rule_data in rules.items():
        if isinstance(rule_data, dict):
            action = rule_data.get("action")
            if action == "drop":
                src_addr = rule_data.get("source", {}).get("address")
                if src_addr:
                    blocks.append({
                        "ip": src_addr,
                        "rule": int(rule_num),
                        "description": rule_data.get("description", "")
                    })
    
    blocks.sort(key=lambda x: x["rule"])
    return blocks

def check_existing_firewall_14(config, iface):
    """Check if interface has existing firewall in VyOS 1.4"""
    iface_config = config.get("interfaces", {}).get("ethernet", {}).get(iface, {})
    fw_config = iface_config.get("firewall", {})
    existing_in = fw_config.get("in", {}).get("name") if isinstance(fw_config.get("in"), dict) else fw_config.get("in")
    return existing_in

def find_jump_rule_15(config, iface, ruleset_name):
    """Find the jump rule for our ruleset in VyOS 1.5 forward filter"""
    forward_filter = config.get("firewall", {}).get("ipv4", {}).get("forward", {}).get("filter", {})
    rules = forward_filter.get("rule", {})
    
    for rule_num, rule_data in rules.items():
        if isinstance(rule_data, dict):
            if (rule_data.get("action") == "jump" and
                rule_data.get("jump-target") == ruleset_name and
                rule_data.get("inbound-interface", {}).get("name") == iface):
                return int(rule_num)
    
    return None

def op_fw_block(host, api_key, version, iface, ip, force=False, verify=False):
    """Block an IP on interface with auto-setup (RENAMED firewall-based fw-block)"""
    ruleset_name = f"SDWAN_BLOCK_{iface}"
    
    try:
        # Fetch current config
        config = api_retrieve(host, api_key, verify)
        
        # Check existing firewall (different for 1.4 vs 1.5)
        if version == "1.4":
            existing_fw = check_existing_firewall_14(config, iface)
            if existing_fw and existing_fw != ruleset_name:
                if not force:
                    return {
                        "success": False,
                        "error": f"Interface {iface} already has firewall 'in' configured (ruleset: {existing_fw}). Use --force to override.",
                        "data": {"existing_ruleset": existing_fw, "interface": iface}
                    }
                # Force: detach existing
                ops_detach = [{"op": "delete", "path": ["interfaces", "ethernet", iface, "firewall", "in"]}]
                api_call(host, api_key, ops_detach, verify)
        
        # Get existing blocks
        blocks = get_existing_fw_blocks(config, version, iface)
        
        # Check if IP already blocked
        for block in blocks:
            if block["ip"] == ip:
                return {
                    "success": True,
                    "data": {
                        "action": "fw-block",
                        "interface": iface,
                        "ip": ip,
                        "rule_number": block["rule"],
                        "ruleset": ruleset_name,
                        "message": "IP already blocked (no change)",
                        "blocks": blocks
                    }
                }
        
        # Determine next rule number
        if blocks:
            next_rule = max(b["rule"] for b in blocks) + 1
        else:
            if version == "1.4":
                next_rule = 100  # Start at 100 for VyOS 1.4
            else:
                next_rule = 10000  # Start at 10000 for VyOS 1.5
        
        if version == "1.4":
            base_path = ["firewall", "name", ruleset_name]
        else:  # 1.5
            base_path = ["firewall", "ipv4", "name", ruleset_name]
        
        # Create ruleset if first block
        if not blocks:
            # Step 1: Create custom chain
            ops_ruleset = []
            if version == "1.4":
                ops_ruleset.append({"op": "set", "path": base_path + ["default-action", "accept"]})
            else:
                ops_ruleset.append({"op": "set", "path": base_path + ["default-action", "return"]})
            ops_ruleset.append({"op": "set", "path": base_path + ["description", "SDWAN auto-block"]})
            api_call(host, api_key, ops_ruleset, verify)
            
            # Step 2: Attach (different for 1.4 vs 1.5)
            if version == "1.4":
                ops_attach = [{"op": "set", "path": ["interfaces", "ethernet", iface, "firewall", "in", "name", ruleset_name]}]
                api_call(host, api_key, ops_attach, verify)
            else:
                # VyOS 1.5: Create jump rule in FORWARD filter
                forward_filter = config.get("firewall", {}).get("ipv4", {}).get("forward", {}).get("filter", {})
                existing_rules = forward_filter.get("rule", {}).keys() if forward_filter else []
                jump_rule_num = 9000
                while str(jump_rule_num) in existing_rules:
                    jump_rule_num += 1
                
                ops_jump = []
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "forward", "filter", "rule", str(jump_rule_num), "action", "jump"]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "forward", "filter", "rule", str(jump_rule_num), "jump-target", ruleset_name]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "forward", "filter", "rule", str(jump_rule_num), "inbound-interface", "name", iface]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "forward", "filter", "rule", str(jump_rule_num), "description", f"SDWAN jump to {ruleset_name}"]})
                api_call(host, api_key, ops_jump, verify)
        
        # Step 3: Add block rule
        ops_rule = []
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "action", "drop"]})
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "source", "address", ip]})
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "description", "sdwan-block"]})
        api_call(host, api_key, ops_rule, verify)
        
        # Fetch updated blocks
        config_after = api_retrieve(host, api_key, verify)
        updated_blocks = get_existing_fw_blocks(config_after, version, iface)
        
        return {
            "success": True,
            "data": {
                "action": "fw-block",
                "interface": iface,
                "ip": ip,
                "rule_number": next_rule,
                "ruleset": ruleset_name,
                "blocks": updated_blocks
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def op_fw_unblock(host, api_key, version, iface, ip, verify=False):
    """Unblock an IP from interface with auto-cleanup (RENAMED firewall-based fw-unblock)"""
    ruleset_name = f"SDWAN_BLOCK_{iface}"
    
    try:
        # Fetch current config
        config = api_retrieve(host, api_key, verify)
        
        # Get existing blocks
        blocks = get_existing_fw_blocks(config, version, iface)
        
        if not blocks:
            return {
                "success": False,
                "error": f"No blocks configured on {iface}"
            }
        
        # Find the IP
        rule_to_delete = None
        for block in blocks:
            if block["ip"] == ip:
                rule_to_delete = block["rule"]
                break
        
        if rule_to_delete is None:
            return {
                "success": False,
                "error": f"IP {ip} is not blocked on {iface}",
                "data": {"blocks": blocks}
            }
        
        if version == "1.4":
            base_path = ["firewall", "name", ruleset_name]
        else:  # 1.5
            base_path = ["firewall", "ipv4", "name", ruleset_name]
        
        # If last rule, cleanup completely
        cleanup = False
        if len(blocks) == 1:
            # Step 1: Detach from interface FIRST
            if version == "1.4":
                ops_detach = [{"op": "delete", "path": ["interfaces", "ethernet", iface, "firewall", "in"]}]
                api_call(host, api_key, ops_detach, verify)
            else:
                # VyOS 1.5: Delete jump rule from forward filter
                jump_rule_num = find_jump_rule_15(config, iface, ruleset_name)
                if jump_rule_num:
                    ops_jump = [{"op": "delete", "path": ["firewall", "ipv4", "forward", "filter", "rule", str(jump_rule_num)]}]
                    api_call(host, api_key, ops_jump, verify)
            
            # Step 2: Delete the rule
            ops_rule = [{"op": "delete", "path": base_path + ["rule", str(rule_to_delete)]}]
            api_call(host, api_key, ops_rule, verify)
            
            # Step 3: Delete the custom chain
            ops_chain = [{"op": "delete", "path": base_path}]
            api_call(host, api_key, ops_chain, verify)
            
            cleanup = True
        else:
            # Not last rule, just delete it
            ops_rule = [{"op": "delete", "path": base_path + ["rule", str(rule_to_delete)]}]
            api_call(host, api_key, ops_rule, verify)
        
        # Fetch updated blocks
        if not cleanup:
            config_after = api_retrieve(host, api_key, verify)
            updated_blocks = get_existing_fw_blocks(config_after, version, iface)
        else:
            updated_blocks = []
        
        return {
            "success": True,
            "data": {
                "action": "fw-unblock",
                "interface": iface,
                "ip": ip,
                "cleanup_performed": cleanup,
                "blocks": updated_blocks
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def op_get_fw_blocks(host, api_key, version, iface, verify=False):
    """List all blocked IPs on interface (firewall-based, for fw-block)"""
    try:
        config = api_retrieve(host, api_key, verify)
        blocks = get_existing_fw_blocks(config, version, iface)
        
        return {
            "success": True,
            "data": {
                "interface": iface,
                "blocks": blocks,
                "count": len(blocks)
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    parser = argparse.ArgumentParser(
        description="Control VyOS via HTTPS API (supports 1.4 and 1.5)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Examples:
          # Get router info
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET get-info
          
          # Block IP/prefix with blackhole route (simple, no interface, tag 999)
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET simple-block --ip 192.168.203.100
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET simple-block --ip 192.168.203.0/24
          
          # List simple blocks
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET get-blocks
          
          # Clear ALL blocks (remove all blackhole routes with tag 999)
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET clear-blocks
          
          # Unblock single prefix
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET simple-unblock --ip 192.168.203.100
          
          # Firewall-based block (requires interface and version)
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET --version 1.5 fw-block --iface eth0 --ip 192.168.203.100/32
          
          # List firewall blocks
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET --version 1.5 get-fw-blocks --iface eth0
          
          # Firewall unblock
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET --version 1.5 fw-unblock --iface eth0 --ip 192.168.203.100/32
          
          # QoS
          vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET --version 1.5 set-qos --iface eth0 --ms 50 --loss 3
        """),
    )
    
    parser.add_argument("--host", required=True, help="VyOS IP or hostname")
    parser.add_argument("--key", required=True, help="VyOS API key")
    parser.add_argument("--version", choices=["1.4", "1.5"], help="VyOS version (auto-detect for get-info)")
    parser.add_argument("--secure", action="store_true", help="Enable TLS verification")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show API operations")
    
    sub = parser.add_subparsers(dest="cmd", required=True)
    
    # Info
    sub.add_parser("get-info", help="Get router info")
    sub.add_parser("get-state", help="Full state audit: interface status, active QoS, IP blocks (read-only)")
    
    # NEW: simple-block/simple-unblock (blackhole routes, no interface)
    p_simple_block = sub.add_parser("simple-block", help="Block IP/prefix with blackhole route (tag 999, no interface needed)")
    p_simple_block.add_argument("--ip", required=True, help="IP or prefix (e.g. 192.168.203.100 or 192.168.203.0/24)")
    
    p_simple_unblock = sub.add_parser("simple-unblock", help="Unblock IP/prefix (remove blackhole route)")
    p_simple_unblock.add_argument("--ip", required=True, help="IP or prefix to unblock")
    
    sub.add_parser("get-blocks", help="List all blackhole routes with tag 999")
    
    # NEW: clear all blocks
    sub.add_parser("clear-blocks", help="Remove ALL blackhole routes with tag 999")
    
    # RENAMED: fw-block/fw-unblock (firewall-based, requires interface + version)
    p_fw_block = sub.add_parser("fw-block", help="Block IP/subnet on interface (firewall-based, auto-setup)")
    p_fw_block.add_argument("--iface", required=True)
    p_fw_block.add_argument("--ip", required=True)
    p_fw_block.add_argument("--force", action="store_true")
    
    p_fw_unblock = sub.add_parser("fw-unblock", help="Unblock IP/subnet from interface (firewall-based)")
    p_fw_unblock.add_argument("--iface", required=True)
    p_fw_unblock.add_argument("--ip", required=True)
    
    p_get_fw_blocks = sub.add_parser("get-fw-blocks", help="List blocked IPs on interface (firewall-based)")
    p_get_fw_blocks.add_argument("--iface", required=True)
    
    # Interface state
    for cmd in ("shut", "no-shut"):
        p = sub.add_parser(cmd)
        p.add_argument("--iface", required=True)
    
    # QoS individual
    p_lat = sub.add_parser("set-latency")
    p_lat.add_argument("--iface", required=True)
    p_lat.add_argument("--ms", type=int, required=True)
    
    p_clat = sub.add_parser("clear-latency")
    p_clat.add_argument("--iface", required=True)
    
    p_loss = sub.add_parser("set-loss")
    p_loss.add_argument("--iface", required=True)
    p_loss.add_argument("--percent", type=float, required=True)
    
    p_closs = sub.add_parser("clear-loss")
    p_closs.add_argument("--iface", required=True)
    
    p_corrupt = sub.add_parser("set-corruption")
    p_corrupt.add_argument("--iface", required=True)
    p_corrupt.add_argument("--percent", type=float, required=True)
    
    p_ccorrupt = sub.add_parser("clear-corruption")
    p_ccorrupt.add_argument("--iface", required=True)
    
    p_reorder = sub.add_parser("set-reorder")
    p_reorder.add_argument("--iface", required=True)
    p_reorder.add_argument("--percent", type=float, required=True)
    p_reorder.add_argument("--gap", type=int)
    
    p_creorder = sub.add_parser("clear-reorder")
    p_creorder.add_argument("--iface", required=True)
    
    p_rate = sub.add_parser("set-rate")
    p_rate.add_argument("--iface", required=True)
    p_rate.add_argument("--rate", required=True)
    
    p_crate = sub.add_parser("clear-rate")
    p_crate.add_argument("--iface", required=True)
    
    # QoS combined
    p_qos = sub.add_parser("set-qos")
    p_qos.add_argument("--iface", required=True)
    p_qos.add_argument("--ms", type=int)
    p_qos.add_argument("--loss", type=float)
    p_qos.add_argument("--corruption", type=float)
    p_qos.add_argument("--reorder", type=float)
    p_qos.add_argument("--reorder-gap", type=int)
    p_qos.add_argument("--rate")
    
    p_cqos = sub.add_parser("clear-qos")
    p_cqos.add_argument("--iface", required=True)
    
    args = parser.parse_args()
    
    # Commands that don't need version
    if args.cmd == "get-info":
        info = get_router_info(args.host, args.key, args.secure)
        print(json.dumps(info, indent=2))
        sys.exit(0 if info["success"] else 1)

    if args.cmd == "get-state":
        state = op_get_state(args.host, args.key, args.secure)
        print(json.dumps(state, indent=2))
        sys.exit(0 if state["success"] else 1)
    
    # Handle simple-block and simple-unblock
    if args.cmd == "simple-block":
        # Determine version for simple blocks if not provided, default to 1.5 if missing
        version = args.version if args.version else "1.5"
        result = op_simple_block(args.host, args.key, version, args.ip, verify=args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    if args.cmd == "simple-unblock":
        # Determine version for simple blocks if not provided, default to 1.5 if missing
        version = args.version if args.version else "1.5"
        result = op_simple_unblock(args.host, args.key, version, args.ip, verify=args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    if args.cmd == "get-blocks":
        result = op_get_blocks(args.host, args.key, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    if args.cmd == "clear-blocks":
        result = op_clear_blocks(args.host, args.key, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    # Firewall commands need version
    if args.cmd == "get-fw-blocks":
        if not args.version:
            info = get_router_info(args.host, args.key, args.secure)
            if not info["success"]:
                print(json.dumps({"success": False, "error": "Failed to detect version"}))
                sys.exit(1)
            version = info["version"]
        else:
            version = args.version
        
        result = op_get_fw_blocks(args.host, args.key, version, args.iface, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    # All other commands need version
    if not args.version:
        print(json.dumps({"success": False, "error": "--version required"}))
        sys.exit(1)
    
    version = args.version
    
    if args.cmd == "fw-block":
        result = op_fw_block(args.host, args.key, version, args.iface, args.ip, args.force, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    if args.cmd == "fw-unblock":
        result = op_fw_unblock(args.host, args.key, version, args.iface, args.ip, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    # Build ops for other commands
    ops = []
    
    if args.cmd == "shut":
        ops = op_set_interface_state(args.iface, True, version)
    elif args.cmd == "no-shut":
        ops = op_set_interface_state(args.iface, False, version)
    elif args.cmd == "set-latency":
        ops = op_set_latency(args.iface, args.ms, version)
    elif args.cmd == "clear-latency":
        ops = op_set_latency(args.iface, None, version)
    elif args.cmd == "set-loss":
        ops = op_set_loss(args.iface, args.percent, version)
    elif args.cmd == "clear-loss":
        ops = op_set_loss(args.iface, None, version)
    elif args.cmd == "set-corruption":
        ops = op_set_corruption(args.iface, args.percent, version)
    elif args.cmd == "clear-corruption":
        ops = op_set_corruption(args.iface, None, version)
    elif args.cmd == "set-reorder":
        ops = op_set_reorder(args.iface, args.percent, getattr(args, 'gap', None), version)
    elif args.cmd == "clear-reorder":
        ops = op_set_reorder(args.iface, None, None, version)
    elif args.cmd == "set-rate":
        ops = op_set_rate(args.iface, args.rate, version)
    elif args.cmd == "clear-rate":
        ops = op_set_rate(args.iface, None, version)
    elif args.cmd == "set-qos":
        ops = op_set_combined_qos(
            args.iface, version, args.ms, args.loss, args.corruption,
            getattr(args, 'reorder', None), getattr(args, 'reorder_gap', None),
            getattr(args, 'rate', None)
        )
    elif args.cmd == "clear-qos":
        ops = op_set_combined_qos(args.iface, version)
    
    if args.verbose:
        print("API Operations:", file=sys.stderr)
        print(json.dumps(ops, indent=2), file=sys.stderr)
        cli_lines = ops_to_vyos_cli(ops)
        print("\nVyOS CLI equivalent:", file=sys.stderr)
        print("  configure", file=sys.stderr)
        for line in cli_lines:
            print(f"  {line}", file=sys.stderr)
        print("  commit", file=sys.stderr)
        print("  exit", file=sys.stderr)
        print("", file=sys.stderr)
    
    try:
        res = api_call(args.host, args.key, ops, verify=args.secure)
        print(json.dumps(res, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
