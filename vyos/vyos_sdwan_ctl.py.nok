#!/usr/bin/env python3

import argparse
import json
import sys
import textwrap
import requests
import urllib3

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def api_call(host, api_key, operations, verify=False):
    """Call VyOS HTTPS API"""
    url = f"https://{host}/configure"
    data = json.dumps(operations)
    files = {
        "data": (None, data),
        "key": (None, api_key),
    }
    resp = requests.post(url, files=files, verify=verify)
    resp.raise_for_status()
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

def get_router_info(host, api_key, verify=False):
    """Get router version, interfaces, and descriptions"""
    try:
        info = {
            "success": True,
            "version": None,
            "interfaces": [],
            "hostname": None
        }
        
        config = api_retrieve(host, api_key, verify)
        
        # Detect version based on qos vs traffic-policy
        if "qos" in config and config["qos"]:
            info["version"] = "1.5"
        elif "traffic-policy" in config:
            info["version"] = "1.4"
        else:
            info["version"] = "1.4"
        
        if "system" in config and "host-name" in config["system"]:
            info["hostname"] = config["system"]["host-name"]
        
        if "interfaces" in config and "ethernet" in config["interfaces"]:
            ethernet_ifaces = config["interfaces"]["ethernet"]
            for iface_name, iface_data in ethernet_ifaces.items():
                iface_info = {
                    "name": iface_name,
                    "description": iface_data.get("description"),
                    "address": []
                }
                
                addr = iface_data.get("address")
                if addr:
                    if isinstance(addr, str):
                        iface_info["address"] = [addr]
                    elif isinstance(addr, list):
                        iface_info["address"] = addr
                    else:
                        iface_info["address"] = []
                
                info["interfaces"].append(iface_info)
        
        info["interfaces"].sort(key=lambda x: x["name"])
        return info
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "version": None,
            "interfaces": [],
            "hostname": None
        }

def op_set_interface_state(iface, shutdown, version):
    """Shut/no-shut interface (same for 1.4 and 1.5)"""
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

def get_existing_blocks(config, version, iface):
    """Parse config and return list of currently blocked IPs on interface"""
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
    """Find the jump rule for our ruleset in VyOS 1.5 input filter"""
    input_filter = config.get("firewall", {}).get("ipv4", {}).get("input", {}).get("filter", {})
    rules = input_filter.get("rule", {})
    
    for rule_num, rule_data in rules.items():
        if isinstance(rule_data, dict):
            if (rule_data.get("action") == "jump" and 
                rule_data.get("jump-target") == ruleset_name and
                rule_data.get("inbound-interface", {}).get("name") == iface):
                return int(rule_num)
    return None

def op_simple_block(host, api_key, version, iface, ip, force=False, verify=False):
    """Block an IP on interface with auto-setup"""
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
        blocks = get_existing_blocks(config, version, iface)
        
        # Check if IP already blocked
        for block in blocks:
            if block["ip"] == ip:
                return {
                    "success": True,
                    "data": {
                        "action": "block",
                        "interface": iface,
                        "ip": ip,
                        "rule_number": block["rule"],
                        "ruleset": ruleset_name,
                        "message": "IP already blocked (no change)",
                        "blocks": blocks
                    }
                }
        
        # Determine next rule number (1.4: 1-9999, 1.5: any)
        if blocks:
            next_rule = max(b["rule"] for b in blocks) + 1
        else:
            if version == "1.4":
                next_rule = 100  # Start at 100 for VyOS 1.4 (range 1-9999)
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
                # VyOS 1.4: default-action must be accept or drop (not return)
                ops_ruleset.append({"op": "set", "path": base_path + ["default-action", "accept"]})
            else:
                # VyOS 1.5: can use return for custom chains
                ops_ruleset.append({"op": "set", "path": base_path + ["default-action", "return"]})
            ops_ruleset.append({"op": "set", "path": base_path + ["description", "SDWAN auto-block"]})
            api_call(host, api_key, ops_ruleset, verify)
            
            # Step 2: Attach (different for 1.4 vs 1.5)
            if version == "1.4":
                # VyOS 1.4: must include "name" in path
                ops_attach = [{"op": "set", "path": ["interfaces", "ethernet", iface, "firewall", "in", "name", ruleset_name]}]
                api_call(host, api_key, ops_attach, verify)
            else:
                # VyOS 1.5: Jump rule in input filter with inbound-interface
                input_filter = config.get("firewall", {}).get("ipv4", {}).get("input", {}).get("filter", {})
                existing_rules = input_filter.get("rule", {}).keys() if input_filter else []
                jump_rule_num = 9000
                while str(jump_rule_num) in existing_rules:
                    jump_rule_num += 1
                
                ops_jump = []
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "input", "filter", "rule", str(jump_rule_num), "action", "jump"]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "input", "filter", "rule", str(jump_rule_num), "jump-target", ruleset_name]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "input", "filter", "rule", str(jump_rule_num), "inbound-interface", "name", iface]})
                ops_jump.append({"op": "set", "path": ["firewall", "ipv4", "input", "filter", "rule", str(jump_rule_num), "description", f"SDWAN jump to {ruleset_name}"]})
                api_call(host, api_key, ops_jump, verify)
        
        # Step 3: Add block rule
        ops_rule = []
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "action", "drop"]})
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "source", "address", ip]})
        ops_rule.append({"op": "set", "path": base_path + ["rule", str(next_rule), "description", "sdwan-block"]})
        api_call(host, api_key, ops_rule, verify)
        
        # Fetch updated blocks
        config_after = api_retrieve(host, api_key, verify)
        updated_blocks = get_existing_blocks(config_after, version, iface)
        
        return {
            "success": True,
            "data": {
                "action": "block",
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

def op_simple_unblock(host, api_key, version, iface, ip, verify=False):
    """Unblock an IP from interface with auto-cleanup"""
    ruleset_name = f"SDWAN_BLOCK_{iface}"
    
    try:
        # Fetch current config
        config = api_retrieve(host, api_key, verify)
        
        # Get existing blocks
        blocks = get_existing_blocks(config, version, iface)
        
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
        
        # If last rule, cleanup completely (IMPORTANT: detach BEFORE deleting rules in VyOS 1.4)
        cleanup = False
        if len(blocks) == 1:
            # Step 1: Detach from interface FIRST
            if version == "1.4":
                ops_detach = [{"op": "delete", "path": ["interfaces", "ethernet", iface, "firewall", "in"]}]
                api_call(host, api_key, ops_detach, verify)
            else:
                # VyOS 1.5: Delete jump rule from input filter
                jump_rule_num = find_jump_rule_15(config, iface, ruleset_name)
                if jump_rule_num:
                    ops_jump = [{"op": "delete", "path": ["firewall", "ipv4", "input", "filter", "rule", str(jump_rule_num)]}]
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
            updated_blocks = get_existing_blocks(config_after, version, iface)
        else:
            updated_blocks = []
        
        return {
            "success": True,
            "data": {
                "action": "unblock",
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

def op_get_blocks(host, api_key, version, iface, verify=False):
    """List all blocked IPs on interface"""
    try:
        config = api_retrieve(host, api_key, verify)
        blocks = get_existing_blocks(config, version, iface)
        
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
        description="Control VyOS interface state, network emulation, and firewall via HTTPS API (supports 1.4 and 1.5)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Examples:
          # Get router info (auto-detect version)
          vyos_sdwan_ctl.py --host 192.168.122.64 --key SUPERSECRET get-info

          # QoS/Network emulation
          vyos_sdwan_ctl.py --host 192.168.122.64 --key SUPERSECRET --version 1.4 set-latency --iface eth0 --ms 100
          vyos_sdwan_ctl.py --host 192.168.122.13 --key SUPERSECRET --version 1.5 set-qos --iface eth0 --ms 50 --loss 3

          # Simple IP blocking (zero config, auto-setup)
          vyos_sdwan_ctl.py --host 192.168.122.64 --key SUPERSECRET --version 1.4 simple-block --iface eth0 --ip 8.8.8.8/32
          vyos_sdwan_ctl.py --host 192.168.122.13 --key SUPERSECRET --version 1.5 simple-block --iface eth0 --ip 10.0.0.0/24
          
          # List and unblock
          vyos_sdwan_ctl.py --host 192.168.122.64 --key SUPERSECRET --version 1.4 get-blocks --iface eth0
          vyos_sdwan_ctl.py --host 192.168.122.64 --key SUPERSECRET --version 1.4 simple-unblock --iface eth0 --ip 8.8.8.8/32
        """),
    )
    
    parser.add_argument("--host", required=True, help="VyOS IP or hostname")
    parser.add_argument("--key", required=True, help="VyOS HTTPS API key")
    parser.add_argument("--version", choices=["1.4", "1.5"], help="VyOS version (auto-detect if not specified for get-info/get-blocks)")
    parser.add_argument("--secure", action="store_true", help="Enable TLS verification (default: disabled)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show API operations")
    
    sub = parser.add_subparsers(dest="cmd", required=True)
    
    # get-info
    sub.add_parser("get-info", help="Get router version, interfaces, and descriptions")
    
    # shut / no-shut
    for cmd in ("shut", "no-shut"):
        p = sub.add_parser(cmd, help=f"{cmd} an interface")
        p.add_argument("--iface", required=True, help="Interface name")
    
    # latency
    p_lat = sub.add_parser("set-latency", help="Add latency")
    p_lat.add_argument("--iface", required=True)
    p_lat.add_argument("--ms", type=int, required=True)
    
    p_clat = sub.add_parser("clear-latency", help="Remove latency")
    p_clat.add_argument("--iface", required=True)
    
    # loss
    p_loss = sub.add_parser("set-loss", help="Add packet loss")
    p_loss.add_argument("--iface", required=True)
    p_loss.add_argument("--percent", type=float, required=True)
    
    p_closs = sub.add_parser("clear-loss", help="Remove loss")
    p_closs.add_argument("--iface", required=True)
    
    # corruption
    p_corrupt = sub.add_parser("set-corruption", help="Add corruption")
    p_corrupt.add_argument("--iface", required=True)
    p_corrupt.add_argument("--percent", type=float, required=True)
    
    p_ccorrupt = sub.add_parser("clear-corruption", help="Remove corruption")
    p_ccorrupt.add_argument("--iface", required=True)
    
    # reorder
    p_reorder = sub.add_parser("set-reorder", help="Add reordering")
    p_reorder.add_argument("--iface", required=True)
    p_reorder.add_argument("--percent", type=float, required=True)
    p_reorder.add_argument("--gap", type=int, help="Correlation gap")
    
    p_creorder = sub.add_parser("clear-reorder", help="Remove reordering")
    p_creorder.add_argument("--iface", required=True)
    
    # rate
    p_rate = sub.add_parser("set-rate", help="Add rate limit")
    p_rate.add_argument("--iface", required=True)
    p_rate.add_argument("--rate", required=True)
    
    p_crate = sub.add_parser("clear-rate", help="Remove rate limit")
    p_crate.add_argument("--iface", required=True)
    
    # combined QoS
    p_qos = sub.add_parser("set-qos", help="Set multiple QoS params")
    p_qos.add_argument("--iface", required=True)
    p_qos.add_argument("--ms", type=int)
    p_qos.add_argument("--loss", type=float)
    p_qos.add_argument("--corruption", type=float)
    p_qos.add_argument("--reorder", type=float)
    p_qos.add_argument("--reorder-gap", type=int)
    p_qos.add_argument("--rate")
    
    p_cqos = sub.add_parser("clear-qos", help="Remove all QoS")
    p_cqos.add_argument("--iface", required=True)
    
    # Simple IP blocking
    p_sblock = sub.add_parser("simple-block", help="Block IP/subnet on interface (auto-setup, zero config)")
    p_sblock.add_argument("--iface", required=True, help="Interface name (e.g., eth0)")
    p_sblock.add_argument("--ip", required=True, help="IP or subnet in CIDR notation (e.g., 1.2.3.4/32 or 10.0.0.0/24)")
    p_sblock.add_argument("--force", action="store_true", help="Override existing firewall config on interface")
    
    p_sunblock = sub.add_parser("simple-unblock", help="Unblock IP/subnet from interface (auto-cleanup)")
    p_sunblock.add_argument("--iface", required=True, help="Interface name (e.g., eth0)")
    p_sunblock.add_argument("--ip", required=True, help="IP or subnet to unblock")
    
    p_getblocks = sub.add_parser("get-blocks", help="List all blocked IPs on interface")
    p_getblocks.add_argument("--iface", required=True, help="Interface name (e.g., eth0)")
    
    args = parser.parse_args()
    
    # Handle get-info command
    if args.cmd == "get-info":
        info = get_router_info(args.host, args.key, args.secure)
        print(json.dumps(info, indent=2))
        sys.exit(0 if info["success"] else 1)
    
    # Handle get-blocks (can auto-detect version)
    if args.cmd == "get-blocks":
        if not args.version:
            info = get_router_info(args.host, args.key, args.secure)
            if not info["success"]:
                print(json.dumps({"success": False, "error": "Failed to detect router version"}))
                sys.exit(1)
            version = info["version"]
        else:
            version = args.version
        
        result = op_get_blocks(args.host, args.key, version, args.iface, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    # For other commands, version is required
    if not args.version:
        print(json.dumps({"success": False, "error": "--version is required for this command"}))
        sys.exit(1)
    
    version = args.version
    
    # Handle simple-block and simple-unblock
    if args.cmd == "simple-block":
        result = op_simple_block(args.host, args.key, version, args.iface, args.ip, args.force, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    if args.cmd == "simple-unblock":
        result = op_simple_unblock(args.host, args.key, version, args.iface, args.ip, args.secure)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
    
    # Handle existing QoS commands
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
        ops = op_set_combined_qos(args.iface, version, None, None, None, None, None, None)
    
    if args.verbose:
        print(f"API Operations:\n{json.dumps(ops, indent=2)}", file=sys.stderr)
    
    try:
        res = api_call(args.host, args.key, ops, verify=args.secure)
        print(json.dumps(res, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
