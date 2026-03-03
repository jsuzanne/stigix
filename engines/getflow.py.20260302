#!/usr/bin/env python3
"""
Prisma SD-WAN Flow Browser Query Script using Official Prisma SASE SDK
Collects flow data filtered by UDP source port, source IP, and destination IP
Resolves path IDs to full path names (source to destination)

Enhancement:
- For LAN/DC LAN listings, keep interface_name AND (if present) interface_description.
- Add interface_label = "name (description)" when description exists, else "name".
"""

import json
import argparse
from datetime import datetime, timedelta
import sys
import socket
import ipaddress
import os
from typing import Optional, Dict, Any

from prisma_sase import API, jd


def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description='Query Prisma SD-WAN flow browser with filters',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:

# Auto-detect site and query flows
%(prog)s --auto-detect --udp-src-port 30030 --minutes 5 --json

# Just test auto-detection
%(prog)s --auto-detect

# List all sites
%(prog)s --list-sites

# List all branch LAN interfaces
%(prog)s --list-lan-interfaces --json

# List all DC (HUB) LAN interfaces
%(prog)s --list-dc-lan-interfaces --json

# Query flows with UDP source port filter (fast)
%(prog)s --site-name BR8 --udp-src-port 30030 --minutes 5 --json
"""
    )

    parser.add_argument(
        '--credentials',
        default='credentials.json',
        help='Path to credentials JSON file (default: credentials.json)'
    )

    parser.add_argument(
        '--list-sites',
        action='store_true',
        help='List all sites and exit'
    )

    parser.add_argument(
        '--list-lan-interfaces',
        action='store_true',
        help='List all branch LAN interfaces (used_for=lan) with static IPv4 on all sites and exit'
    )

    parser.add_argument(
        '--list-dc-lan-interfaces',
        action='store_true',
        help='List all Data Center (HUB) LAN interfaces (used_for=private) with static IPv4 and exit'
    )

    parser.add_argument(
        '--auto-detect',
        action='store_true',
        help='Auto-detect site by matching local IP with ION LAN subnets'
    )

    parser.add_argument(
        '--site-id',
        help='Site ID to query flows for'
    )

    parser.add_argument(
        '--site-name',
        help='Site name to query flows for (alternative to --site-id)'
    )

    parser.add_argument(
        '--udp-src-port',
        type=int,
        help='UDP source port to filter'
    )

    parser.add_argument(
        '--src-ip',
        help='Source IP address to filter'
    )

    parser.add_argument(
        '--dst-ip',
        help='Destination IP address to filter'
    )

    parser.add_argument(
        '--protocol',
        type=int,
        help='Protocol number (17=UDP, 6=TCP, 1=ICMP, etc.)'
    )

    parser.add_argument(
        '--hours',
        type=int,
        default=1,
        help='Number of hours to query back (default: 1)'
    )

    parser.add_argument(
        '--minutes',
        type=int,
        help='Number of minutes to query back (overrides --hours if set)'
    )

    parser.add_argument(
        '--output',
        help='Output JSON filename (default: auto-generated)'
    )

    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug output'
    )

    parser.add_argument(
        '--page-size',
        type=int,
        default=1,
        help='Number of flows per page (default: 1 for speed)'
    )

    parser.add_argument(
        '--region',
        default='de',
        help='PANW region (default: de). Use "de" for Europe, "us" for Americas'
    )

    parser.add_argument(
        '--fast',
        action='store_true',
        help='Fast mode: skip path name resolution to speed up query'
    )

    parser.add_argument(
        '--json',
        action='store_true',
        help='Output results as JSON to stdout (for integration with Node.js/React)'
    )

    return parser.parse_args()


def log_output(message, json_mode=False, is_error=False):
    """Output message only if not in JSON mode"""
    if not json_mode:
        if is_error:
            print(message, file=sys.stderr)
        else:
            print(message)


def load_credentials(args, json_mode=False):
    """Load Prisma SASE credentials from env vars first, then fall back to a JSON file.

    Env vars (recommended for Docker Compose):
      - PRISMA_SDWAN_CLIENT_ID
      - PRISMA_SDWAN_CLIENT_SECRET
      - PRISMA_SDWAN_TSG_ID

    File fallback (legacy): --credentials (default: credentials.json)
      {"client_id": "...", "client_secret": "...", "tsg_id": "..."}

    Returns a dict with keys client_id, client_secret, tsg_id, source.
    """

    env_client_id = os.getenv("PRISMA_SDWAN_CLIENT_ID")
    env_client_secret = os.getenv("PRISMA_SDWAN_CLIENT_SECRET")
    env_tsg_id = os.getenv("PRISMA_SDWAN_TSG_ID") or os.getenv("PRISMA_SDWAN_TSGID")

    if env_client_id and env_client_secret and env_tsg_id:
        return {
            "client_id": env_client_id,
            "client_secret": env_client_secret,
            "tsg_id": env_tsg_id,
            "source": "env"
        }

    # Fall back to credentials file
    try:
        with open(args.credentials, 'r') as f:
            creds = json.load(f)
    except FileNotFoundError:
        error_msg = {
            "error": f"Credentials file '{args.credentials}' not found and env vars not set",
            "required_env": [
                "PRISMA_SDWAN_CLIENT_ID",
                "PRISMA_SDWAN_CLIENT_SECRET",
                "PRISMA_SDWAN_TSG_ID"
            ],
            "expected_file_format": {
                "client_id": "your-client-id@tsgid.iam.panserviceaccount.com",
                "client_secret": "your-client-secret",
                "tsg_id": "your-tsg-id"
            }
        }
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(error_msg["error"], json_mode, is_error=True)
        sys.exit(1)

    required = ("client_id", "client_secret", "tsg_id")
    if not all(k in creds for k in required):
        error_msg = {
            "error": "Invalid credentials format",
            "required_fields": ["client_id", "client_secret", "tsg_id"]
        }
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output("Error: Invalid credentials format", json_mode, is_error=True)
        sys.exit(1)

    creds["source"] = "file"
    return creds


def get_local_ip():
    """Get the local IP address of this machine"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return None


def get_site_roles(sdk, debug=False):
    """
    Build a map of site_id -> element_cluster_role (SPOKE, HUB, etc.).
    """
    roles = {}
    try:
        resp = sdk.get.sites()
        if not resp.cgx_status:
            return roles

        sites = resp.cgx_content.get('items', [])
        for s in sites:
            sid = s.get('id')
            role = s.get('element_cluster_role')
            if sid:
                roles[sid] = role

        if debug:
            print(f" Site roles: {roles}", file=sys.stderr)

    except Exception as e:
        if debug:
            print(f" Error getting site roles: {e}", file=sys.stderr)

    return roles


def get_interface_description(interface: Dict[str, Any]) -> Optional[str]:
    """
    Try to extract an interface description/comment field.
    The exact key can vary by API/payload, so we try a few common ones.
    """
    desc = (
        interface.get("description")
        or interface.get("desc")
        or interface.get("comment")
        or interface.get("comments")
        or interface.get("notes")
    )

    if isinstance(desc, str):
        desc = desc.strip()
        return desc or None

    return None


def format_interface_label(name: str, desc: Optional[str]) -> str:
    return f"{name} ({desc})" if desc else name


def get_all_lan_interfaces(sdk, sites, debug=False):
    """
    Branch LAN interfaces:
    - used_for == 'lan'
    - ipv4_config.type == 'static'

    Enhancement:
    - store interface_name + interface_description + interface_label
    """
    site_lan_map = {}

    try:
        if debug:
            print(" Fetching all elements...", file=sys.stderr)

        elements_resp = sdk.get.elements()
        if not elements_resp.cgx_status:
            if debug:
                print(f" Could not get elements: {elements_resp.status_code}", file=sys.stderr)
            return {}

        all_elements = elements_resp.cgx_content.get('items', [])
        if debug:
            print(f" Found {len(all_elements)} total elements", file=sys.stderr)

    except Exception as e:
        if debug:
            print(f" Error getting elements: {e}", file=sys.stderr)
        return {}

    site_id_to_name = {site.get('id'): site.get('name') for site in sites}

    for element in all_elements:
        element_site_id = element.get('site_id')
        element_name = element.get('name', 'Unknown')

        if not element_site_id or element_site_id not in site_id_to_name:
            continue

        site_name = site_id_to_name[element_site_id]

        if debug:
            print(f" Checking element: {element_name} at site {site_name}", file=sys.stderr)

        try:
            intf_resp = sdk.get.interfaces(site_id=element_site_id, element_id=element.get('id'))
            if not intf_resp.cgx_status:
                if debug:
                    print(f" Could not get interfaces: {intf_resp.status_code}", file=sys.stderr)
                continue

            interfaces = intf_resp.cgx_content.get('items', [])
            if debug:
                print(f" Found {len(interfaces)} interfaces", file=sys.stderr)

            for interface in interfaces:
                intf_name = interface.get('name', 'Unknown')
                intf_desc = get_interface_description(interface)
                intf_label = format_interface_label(intf_name, intf_desc)

                used_for = (interface.get('used_for') or "").lower()
                if used_for != "lan":
                    continue

                ipv4_config = interface.get('ipv4_config') or {}
                if ipv4_config.get('type') != 'static':
                    continue

                static_config = ipv4_config.get('static_config') or {}
                ip_address_raw = static_config.get('address')
                if not ip_address_raw:
                    continue

                try:
                    if '/' in ip_address_raw:
                        iface = ipaddress.IPv4Interface(ip_address_raw)
                    else:
                        netmask = static_config.get('netmask')
                        if netmask:
                            iface = ipaddress.IPv4Interface(f"{ip_address_raw}/{netmask}")
                        else:
                            continue

                    ip_address = str(iface.ip)
                    network = iface.network

                    if element_site_id not in site_lan_map:
                        site_lan_map[element_site_id] = {
                            'site_name': site_name,
                            'networks': []
                        }

                    site_lan_map[element_site_id]['networks'].append({
                        'network': network,
                        'interface_name': intf_name,
                        'interface_description': intf_desc,
                        'interface_label': intf_label,
                        'ip': ip_address
                    })

                    if debug:
                        print(
                            f" ✓ LAN interface: {site_name} / {element_name} / "
                            f"{intf_label} (name={intf_name}) used_for=lan -> {ip_address} ({network})",
                            file=sys.stderr
                        )

                except Exception as e:
                    if debug:
                        print(f" Error parsing network {ip_address_raw}: {e}", file=sys.stderr)

        except Exception as e:
            if debug:
                print(f" Error getting interfaces: {e}", file=sys.stderr)
            continue

    return site_lan_map


def get_all_dc_lan_interfaces(sdk, sites, debug=False):
    """
    DC LAN interfaces:
    - used_for == 'private'
    - ipv4_config.type == 'static'
    - exclude WAN/overlay linked interfaces (site_wan_interface_ids)
    - exclude circuit attached (label_id, circuit_label_id, wan_network_id)

    Enhancement:
    - store interface_name + interface_description + interface_label
    """
    site_lan_map = {}

    try:
        if debug:
            print(" Fetching all elements...", file=sys.stderr)

        elements_resp = sdk.get.elements()
        if not elements_resp.cgx_status:
            if debug:
                print(f" Could not get elements: {elements_resp.status_code}", file=sys.stderr)
            return {}

        all_elements = elements_resp.cgx_content.get('items', [])
        if debug:
            print(f" Found {len(all_elements)} total elements", file=sys.stderr)

    except Exception as e:
        if debug:
            print(f" Error getting elements: {e}", file=sys.stderr)
        return {}

    site_id_to_name = {site.get('id'): site.get('name') for site in sites}

    for element in all_elements:
        element_site_id = element.get('site_id')
        element_name = element.get('name', 'Unknown')

        if not element_site_id or element_site_id not in site_id_to_name:
            continue

        site_name = site_id_to_name[element_site_id]

        if debug:
            print(f" Checking element: {element_name} at site {site_name}", file=sys.stderr)

        try:
            intf_resp = sdk.get.interfaces(site_id=element_site_id, element_id=element.get('id'))
            if not intf_resp.cgx_status:
                if debug:
                    print(f" Could not get interfaces: {intf_resp.status_code}", file=sys.stderr)
                continue

            interfaces = intf_resp.cgx_content.get('items', [])
            if debug:
                print(f" Found {len(interfaces)} interfaces", file=sys.stderr)

            for interface in interfaces:
                intf_name = interface.get('name', 'Unknown')
                intf_desc = get_interface_description(interface)
                intf_label = format_interface_label(intf_name, intf_desc)

                used_for = (interface.get('used_for') or "").lower()

                # Filter 1: private only
                if used_for != "private":
                    continue

                ipv4_config = interface.get('ipv4_config') or {}
                if ipv4_config.get('type') != 'static':
                    continue

                # Filter 2: exclude interfaces linked to a WAN interface (overlay)
                site_wan_interface_ids = interface.get('site_wan_interface_ids')
                if site_wan_interface_ids:
                    if debug:
                        print(
                            f" [SKIP] {site_name}/{element_name}/{intf_label} (name={intf_name}) "
                            f"linked to WAN interface {site_wan_interface_ids}",
                            file=sys.stderr
                        )
                    continue

                # Filter 3: exclude interfaces with circuit attached
                circuit = (
                    interface.get("label_id")
                    or interface.get("circuit_label_id")
                    or interface.get("wan_network_id")
                )

                if circuit:
                    if debug:
                        print(
                            f" [SKIP] {site_name}/{element_name}/{intf_label} (name={intf_name}) has circuit {circuit}",
                            file=sys.stderr
                        )
                    continue

                static_config = ipv4_config.get('static_config') or {}
                ip_address_raw = static_config.get('address')
                if not ip_address_raw:
                    continue

                try:
                    if '/' in ip_address_raw:
                        iface = ipaddress.IPv4Interface(ip_address_raw)
                    else:
                        netmask = static_config.get('netmask')
                        if netmask:
                            iface = ipaddress.IPv4Interface(f"{ip_address_raw}/{netmask}")
                        else:
                            continue

                    ip_address = str(iface.ip)
                    network = iface.network

                    if element_site_id not in site_lan_map:
                        site_lan_map[element_site_id] = {
                            'site_name': site_name,
                            'networks': []
                        }

                    site_lan_map[element_site_id]['networks'].append({
                        'network': network,
                        'interface_name': intf_name,
                        'interface_description': intf_desc,
                        'interface_label': intf_label,
                        'ip': ip_address
                    })

                    if debug:
                        print(
                            f" ✓ DC LAN interface: {site_name} / {element_name} / "
                            f"{intf_label} (name={intf_name}) used_for=private -> {ip_address} ({network})",
                            file=sys.stderr
                        )

                except Exception as e:
                    if debug:
                        print(f" Error parsing network {ip_address_raw}: {e}", file=sys.stderr)

        except Exception as e:
            if debug:
                print(f" Error getting interfaces: {e}", file=sys.stderr)
            continue

    return site_lan_map


def flatten_lan_map(site_lan_map):
    """
    Flatten the site_lan_map into a list of dicts
    """
    flat = []
    for site_id, info in site_lan_map.items():
        site_name = info.get('site_name')
        for net_info in info.get('networks', []):
            flat.append({
                "site_name": site_name,
                "site_id": site_id,

                # Keep the original field name "interface_name" for compatibility
                "interface_name": net_info.get('interface_name'),

                # New optional fields
                "interface_description": net_info.get('interface_description'),
                "interface_label": net_info.get('interface_label'),

                "ip": net_info.get('ip'),
                "network": str(net_info.get('network'))
            })
    return flat


def find_site_by_ip(local_ip, site_lan_map, debug=False):
    """
    Find which site the local IP belongs to
    Returns (site_name, site_id, matched_network)
    """
    try:
        local_ip_obj = ipaddress.IPv4Address(local_ip)

        if debug:
            print(f"\n Matching local IP {local_ip} against site LANs...", file=sys.stderr)

        for site_id, site_info in site_lan_map.items():
            for net_info in site_info['networks']:
                network = net_info['network']
                if local_ip_obj in network:
                    if debug:
                        print(f" ✓ Match found: {site_info['site_name']} - {network}", file=sys.stderr)
                    return site_info['site_name'], site_id, str(network)

        if debug:
            print(f" ✗ No match found for {local_ip}", file=sys.stderr)

        return None, None, None

    except Exception as e:
        if debug:
            print(f" Error matching IP: {e}", file=sys.stderr)
        return None, None, None


def get_all_sites_map(sdk, debug=False):
    """
    Get all sites and create a lookup map
    Returns dict mapping site_id to site_name
    """
    try:
        response = sdk.get.sites()
        if not response.cgx_status:
            return {}
        sites = response.cgx_content.get('items', [])
        return {site.get('id'): site.get('name', 'Unknown') for site in sites}
    except Exception as e:
        if debug:
            print(f" Error fetching sites: {e}", file=sys.stderr)
        return {}


def get_wan_interfaces_all_sites(sdk, site_ids, debug=False):
    """
    Get WAN interfaces for multiple sites
    Returns dict mapping waninterface_id to info
    """
    wan_if_lookup = {}

    for site_id, site_name in site_ids.items():
        try:
            response = sdk.get.waninterfaces(site_id=site_id)
            if not response.cgx_status:
                continue

            wan_interfaces = response.cgx_content.get('items', [])
            for wan_if in wan_interfaces:
                wan_if_id = wan_if.get('id')
                wan_if_name = wan_if.get('name', 'Unknown')
                circuit_name = wan_if.get('label') or wan_if.get('name', 'Unknown')
                clean_if_name = wan_if_name.replace(f"{site_name}-", "")

                wan_if_lookup[wan_if_id] = {
                    'site_name': site_name,
                    'interface_name': wan_if_name,
                    'circuit_name': circuit_name,
                    'full_name': f"{site_name}-{clean_if_name}"
                }

        except Exception:
            continue

    if debug:
        print(f" Retrieved {len(wan_if_lookup)} WAN interfaces across all sites", file=sys.stderr)

    return wan_if_lookup


def get_topology(sdk, site_id, debug=False):
    """
    Get VPN path topology for a specific site
    """
    try:
        if debug:
            print(f" Fetching VPN topology for site {site_id}...", file=sys.stderr)

        url = "https://api.sase.paloaltonetworks.com/sdwan/v3.6/api/topology"
        payload = {"type": "basenet", "nodes": [site_id]}

        resp = sdk._session.post(url, json=payload, timeout=30)

        if resp.status_code != 200:
            if debug:
                print(f" Warning: Could not fetch topology: {resp.status_code}", file=sys.stderr)
                print(f" Response: {resp.text}", file=sys.stderr)
            return {}

        topology_data = resp.json()
        links = topology_data.get('links', [])

        if debug:
            print(f" Found {len(links)} links in topology", file=sys.stderr)
            if links:
                print(f" First link keys: {list(links[0].keys())}", file=sys.stderr)

        path_lookup = {}
        for link in links:
            path_id = link.get('path_id')
            if path_id:
                path_lookup[path_id] = {
                    'source_wan_if_id': link.get('source_wan_if_id'),
                    'target_wan_if_id': link.get('target_wan_if_id'),
                    'source_site_id': link.get('source_node_id'),
                    'target_site_id': link.get('target_node_id'),
                    'status': link.get('status'),
                    'type': link.get('type'),
                    'sub_type': link.get('sub_type')
                }

        return path_lookup

    except Exception as e:
        if debug:
            print(f" Error fetching topology: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
        return {}


def format_path_name(flow, topology, wan_if_lookup, debug=False):
    """
    Format the path name based on path type
    """
    path_type = flow.get('path_type', 'Unknown')
    path_id = flow.get('path_id')
    waninterface_id = flow.get('waninterface_id')

    if debug:
        print(f" Formatting path: type={path_type}, path_id={path_id}, waninterface_id={waninterface_id}", file=sys.stderr)

    if path_type == 'DirectInternet':
        if waninterface_id and waninterface_id in wan_if_lookup:
            return wan_if_lookup[waninterface_id].get('circuit_name', 'Unknown')
        return f"WAN Interface ID: {waninterface_id}"

    if path_type == 'ServiceLink':
        if waninterface_id and waninterface_id in wan_if_lookup:
            circuit_name = wan_if_lookup[waninterface_id].get('circuit_name', 'Unknown')
            return f"{circuit_name} to Standard VPN"
        return f"WAN Interface ID: {waninterface_id} to Standard VPN"

    if path_type == 'VPN':
        if path_id and topology:
            path_info = topology.get(path_id, {})
            source_info = wan_if_lookup.get(path_info.get('source_wan_if_id'), {})
            target_info = wan_if_lookup.get(path_info.get('target_wan_if_id'), {})
            return f"{source_info.get('full_name', 'Unknown')} to {target_info.get('full_name', 'Unknown')}"
        return f"Path ID: {path_id}"

    return f"{path_type} (Path ID: {path_id})"


def main():
    args = parse_arguments()
    json_mode = args.json

    log_output("=" * 60, json_mode)
    log_output("Prisma SD-WAN Flow Browser Query (Official SDK)", json_mode)
    log_output("=" * 60, json_mode)

    # Load credentials (env-first, file fallback)
    creds = load_credentials(args, json_mode=json_mode)

    sdk = API(update_check=False)

    log_output("\n🔐 Authenticating...", json_mode)
    try:
        sdk.interactive.login_secret(
            client_id=creds['client_id'],
            client_secret=creds['client_secret'],
            tsg_id=creds['tsg_id']
        )
        log_output("✓ Authenticated successfully", json_mode)
    except Exception as e:
        error_msg = {"error": f"Authentication failed: {e}"}
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(f"❌ Authentication failed: {e}", json_mode, is_error=True)
        sys.exit(1)

    # Get sites
    log_output("\n📍 Retrieving sites...", json_mode)
    try:
        response = sdk.get.sites()
        if not response.cgx_status:
            error_msg = {"error": f"Error getting sites: {response.status_code}"}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output(f"❌ Error getting sites: {response.status_code}", json_mode, is_error=True)
            sys.exit(1)

        sites = response.cgx_content.get('items', [])
        if not sites:
            error_msg = {"error": "No sites found"}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output("No sites found", json_mode, is_error=True)
            sys.exit(1)

        log_output(f"✓ Found {len(sites)} sites", json_mode)

        if args.list_sites or args.debug:
            for idx, site in enumerate(sites, 1):
                site_name = site.get('name', 'Unknown')
                site_id = site.get('id', 'Unknown')
                site_location = site.get('address', {}).get('city', 'N/A') if site.get('address') else 'N/A'
                log_output(f" {idx}. {site_name} (ID: {site_id}) - {site_location}", json_mode)

    except Exception as e:
        error_msg = {"error": f"Error retrieving sites: {e}"}
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(f"❌ Error retrieving sites: {e}", json_mode, is_error=True)
        sys.exit(1)

    # List sites only
    if args.list_sites:
        if json_mode:
            sites_list = [{
                "name": s.get('name'),
                "id": s.get('id'),
                "city": s.get('address', {}).get('city', 'N/A') if s.get('address') else 'N/A'
            } for s in sites]

            print(json.dumps({"sites": sites_list}, indent=2))

        log_output("\n" + "=" * 60, json_mode)
        sys.exit(0)

    # List branch LAN interfaces
    if args.list_lan_interfaces:
        log_output("\n🧩 Collecting branch LAN interfaces (used_for=lan)...", json_mode)
        site_lan_map = get_all_lan_interfaces(sdk, sites, debug=args.debug)
        flat = flatten_lan_map(site_lan_map)

        if args.json:
            print(json.dumps({"lan_interfaces": flat}, indent=2))
        else:
            if not flat:
                log_output("No LAN interfaces with static IPv4 found.", json_mode)
            else:
                log_output("\nSite\tSite ID\tInterface\tIP\tNetwork", json_mode)
                for item in flat:
                    iface_disp = item.get("interface_label") or item.get("interface_name")
                    log_output(
                        f"{item['site_name']}\t{item['site_id']}\t"
                        f"{iface_disp}\t{item['ip']}\t{item['network']}",
                        json_mode
                    )
                log_output(f"\nTotal LAN interfaces: {len(flat)}", json_mode)

        log_output("\n" + "=" * 60, json_mode)
        sys.exit(0)

    # List DC LAN interfaces
    if args.list_dc_lan_interfaces:
        log_output("\n🧩 Collecting Data Center (HUB) LAN interfaces (used_for=private)...", json_mode)
        site_lan_map = get_all_dc_lan_interfaces(sdk, sites, debug=args.debug)
        flat = flatten_lan_map(site_lan_map)

        if args.json:
            print(json.dumps({"dc_lan_interfaces": flat}, indent=2))
        else:
            if not flat:
                log_output("No DC LAN interfaces with static IPv4 found.", json_mode)
            else:
                log_output("\nSite\tSite ID\tInterface\tIP\tNetwork", json_mode)
                for item in flat:
                    iface_disp = item.get("interface_label") or item.get("interface_name")
                    log_output(
                        f"{item['site_name']}\t{item['site_id']}\t"
                        f"{iface_disp}\t{item['ip']}\t{item['network']}",
                        json_mode
                    )
                log_output(f"\nTotal DC LAN interfaces: {len(flat)}", json_mode)

        log_output("\n" + "=" * 60, json_mode)
        sys.exit(0)

    # Auto-detect site if requested
    target_site_id = None
    target_site_name = None

    if args.auto_detect:
        log_output("\n🔍 Auto-detecting site...", json_mode)
        local_ip = get_local_ip()

        if not local_ip:
            error_msg = {"error": "Could not determine local IP address"}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output("❌ Could not determine local IP address", json_mode, is_error=True)
            sys.exit(1)

        log_output(f" Local IP: {local_ip}", json_mode)
        log_output(" Scanning LAN interfaces across all sites...", json_mode)

        site_lan_map = get_all_lan_interfaces(sdk, sites, debug=args.debug)
        if not site_lan_map:
            error_msg = {"error": "Could not retrieve LAN interfaces from any site"}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output("❌ Could not retrieve LAN interfaces", json_mode, is_error=True)
            sys.exit(1)

        target_site_name, target_site_id, matched_network = find_site_by_ip(local_ip, site_lan_map, debug=args.debug)

        if not target_site_id:
            error_msg = {
                "error": f"Could not find site matching local IP {local_ip}",
                "local_ip": local_ip,
                "suggestion": "Ensure this machine is on a LAN subnet managed by an ION device"
            }
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output(f"❌ Could not find site matching local IP {local_ip}", json_mode, is_error=True)
            sys.exit(1)

        log_output(f"✓ Detected site: {target_site_name} (matched network: {matched_network})", json_mode)

        if not args.udp_src_port and not args.src_ip and not args.dst_ip:
            result = {
                "success": True,
                "local_ip": local_ip,
                "detected_site_name": target_site_name,
                "detected_site_id": target_site_id,
                "matched_network": matched_network
            }
            if json_mode:
                print(json.dumps(result, indent=2))
            log_output("\n" + "=" * 60, json_mode)
            sys.exit(0)

    # Determine site ID to query
    if not target_site_id:
        if args.site_id:
            target_site_id = args.site_id
            for site in sites:
                if site.get('id') == args.site_id:
                    target_site_name = site.get('name', 'Unknown')
                    break

            if not target_site_name:
                error_msg = {"error": f"Site ID '{args.site_id}' not found"}
                if json_mode:
                    print(json.dumps(error_msg, indent=2))
                else:
                    log_output(f"\n❌ Site ID '{args.site_id}' not found", json_mode, is_error=True)
                sys.exit(1)

        elif args.site_name:
            for site in sites:
                if site.get('name') == args.site_name:
                    target_site_id = site.get('id')
                    target_site_name = site.get('name')
                    break

            if not target_site_id:
                error_msg = {"error": f"Site '{args.site_name}' not found"}
                if json_mode:
                    print(json.dumps(error_msg, indent=2))
                else:
                    log_output(f"\n❌ Site '{args.site_name}' not found", json_mode, is_error=True)
                sys.exit(1)

        else:
            target_site = sites[0]
            target_site_id = target_site.get('id')
            target_site_name = target_site.get('name', 'Unknown')
            log_output(f"\n⚠️ No site specified, using first site: {target_site_name}", json_mode)

    site_map = {site.get('id'): site.get('name') for site in sites}
    topology = {}
    wan_if_lookup = {}

    if not args.fast:
        log_output("\n🌐 Retrieving VPN topology...", json_mode)
        topology = get_topology(sdk, target_site_id, debug=args.debug)

        log_output(" Retrieving WAN interfaces...", json_mode)
        wan_if_lookup = get_wan_interfaces_all_sites(sdk, site_map, debug=args.debug)

        if topology:
            log_output(f"✓ Retrieved {len(topology)} VPN paths", json_mode)
        else:
            log_output("⚠️ Could not retrieve VPN topology (will show IDs only)", json_mode)
    else:
        if args.debug:
            log_output("\n⚡ Fast mode enabled - skipping topology lookup", json_mode)

    end_time = datetime.utcnow()

    if args.minutes:
        start_time = end_time - timedelta(minutes=args.minutes)
        time_desc = f"Last {args.minutes} minute(s)"
    else:
        start_time = end_time - timedelta(hours=args.hours)
        time_desc = f"Last {args.hours} hour(s)"

    log_output(f"\n🔍 Querying flows for site: {target_site_name} ({target_site_id})", json_mode)
    log_output(" Filters:", json_mode)

    if args.protocol:
        protocol_names = {1: 'ICMP', 6: 'TCP', 17: 'UDP'}
        proto_name = protocol_names.get(args.protocol, f'Protocol {args.protocol}')
        log_output(f" - Protocol: {proto_name}", json_mode)
    elif args.udp_src_port:
        log_output(" - Protocol: UDP", json_mode)

    if args.udp_src_port:
        log_output(f" - Source Port: {args.udp_src_port}", json_mode)

    if args.src_ip:
        log_output(f" - Source IP: {args.src_ip}", json_mode)

    if args.dst_ip:
        log_output(f" - Destination IP: {args.dst_ip}", json_mode)

    log_output(f" - Time Range: {time_desc}", json_mode)
    log_output(f" - Page Size: {args.page_size}", json_mode)
    log_output(f" - Region: {args.region}", json_mode)

    if args.fast:
        log_output(" - Mode: Fast (no path resolution)", json_mode)

    query_payload = {
        "start_time": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_time": end_time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "filter": {
            "site": [target_site_id],
            "flow": {}
        },
        "debug_level": "all",
        "page_size": args.page_size,
        "dest_page": 1,
        "view": {"summary": False}
    }

    if args.protocol:
        query_payload["filter"]["flow"]["protocol"] = args.protocol
    elif args.udp_src_port:
        query_payload["filter"]["flow"]["protocol"] = 17

    if args.udp_src_port:
        query_payload["filter"]["flow"]["source_port"] = [args.udp_src_port]

    if args.src_ip:
        query_payload["filter"]["flow"]["source_ip"] = [args.src_ip]

    if args.dst_ip:
        query_payload["filter"]["flow"]["destination_ip"] = [args.dst_ip]

    if args.debug:
        log_output(f"\n Query payload: {json.dumps(query_payload, indent=4)}", json_mode)

    try:
        sdk._session.headers['x-panw-region'] = args.region
        if args.debug:
            log_output(f" Set x-panw-region header to: {args.region}", json_mode)

        url = "https://api.sase.paloaltonetworks.com/sdwan/monitor/v3.11/api/monitor/flows"

        if args.debug:
            log_output(f" Making request to: {url}", json_mode)

        resp = sdk._session.post(url, json=query_payload, timeout=30)

        if resp.status_code != 200:
            error_msg = {"error": f"Error querying flows: {resp.status_code}", "response": resp.text}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output(f"\n❌ Error querying flows: {resp.status_code}", json_mode, is_error=True)
                log_output(f"Response: {resp.text}", json_mode, is_error=True)
            sys.exit(1)

        flows_data = resp.json()

        if flows_data and 'flows' in flows_data:
            flows = flows_data['flows']

            result = {
                "success": True,
                "site_name": target_site_name,
                "site_id": target_site_id,
                "query_time": datetime.utcnow().isoformat() + "Z",
                "flows": []
            }

            if not json_mode and args.output:
                with open(args.output, 'w') as f:
                    json.dump(flows_data, f, indent=2)

                log_output("\n✓ Flow query completed", json_mode)
                log_output(f" Results saved to: {args.output}", json_mode)

            if 'items' in flows:
                flow_count = len(flows['items'])

                if not json_mode:
                    log_output("\n✓ Flow query completed", json_mode)
                    log_output(f" Total flows found: {flow_count}", json_mode)

                if flow_count > 0:
                    for flow in flows['items']:
                        if not args.fast:
                            egress_path = format_path_name(flow, topology, wan_if_lookup, debug=args.debug)
                        else:
                            path_id = flow.get('path_id')
                            path_type = flow.get('path_type')
                            egress_path = f"{path_type} (Path ID: {path_id})"

                        flow_info = {
                            "source_ip": flow.get('source_ip'),
                            "source_port": flow.get('source_port'),
                            "destination_ip": flow.get('destination_ip'),
                            "destination_port": flow.get('destination_port'),
                            "protocol": flow.get('protocol'),
                            "bytes_c2s": flow.get('bytes_c2s'),
                            "bytes_s2c": flow.get('bytes_s2c'),
                            "packets_c2s": flow.get('packets_c2s'),
                            "packets_s2c": flow.get('packets_s2c'),
                            "path_type": flow.get('path_type'),
                            "egress_path": egress_path,
                            "app_id": flow.get('app_id'),
                            "flow_id": flow.get('flow_id'),
                            "flow_start_time_ms": flow.get('flow_start_time_ms'),
                            "flow_end_time_ms": flow.get('flow_end_time_ms')
                        }

                        result["flows"].append(flow_info)

                    if json_mode:
                        print(json.dumps(result, indent=2))
                    else:
                        first_flow_info = result["flows"][0]
                        log_output("\n Sample flow:", json_mode)
                        log_output(f" Source: {first_flow_info['source_ip']}:{first_flow_info['source_port']}", json_mode)
                        log_output(f" Destination: {first_flow_info['destination_ip']}:{first_flow_info['destination_port']}", json_mode)
                        log_output(f" Protocol: {first_flow_info['protocol']}", json_mode)
                        log_output(f" Bytes C2S: {first_flow_info['bytes_c2s']}", json_mode)
                        log_output(f" Bytes S2C: {first_flow_info['bytes_s2c']}", json_mode)
                        log_output(f" Path Type: {first_flow_info['path_type']}", json_mode)
                        log_output(f" Egress Path: {first_flow_info['egress_path']}", json_mode)
                        log_output(f" App ID: {first_flow_info['app_id']}", json_mode)

                        if args.debug:
                            log_output("\n Full flow details:", json_mode)
                            jd(flows['items'][0])

                else:
                    result["flows"] = []
                    if json_mode:
                        print(json.dumps(result, indent=2))
                    else:
                        log_output(" No flows found matching the criteria", json_mode)

            else:
                result["flows"] = []
                if json_mode:
                    print(json.dumps(result, indent=2))
                else:
                    log_output(" No flows found matching the criteria", json_mode)

        else:
            error_msg = {"error": "No flows found or unexpected response format"}
            if json_mode:
                print(json.dumps(error_msg, indent=2))
            else:
                log_output("\n No flows found or unexpected response format", json_mode)

            if args.debug:
                log_output("\n Full response:", json_mode)
                jd(flows_data)

    except Exception as e:
        error_msg = {"error": f"Error querying flows: {str(e)}"}
        if json_mode:
            print(json.dumps(error_msg, indent=2))
        else:
            log_output(f"\n❌ Error querying flows: {e}", json_mode, is_error=True)
            if args.debug:
                import traceback
                traceback.print_exc()
        sys.exit(1)

    if not json_mode:
        log_output("\n" + "=" * 60, json_mode)


if __name__ == "__main__":
    main()
