#!/usr/bin/env python3
"""
import_prisma_devices.py

Converts a Prisma Access / IoT Security CSV export (Device Security module)
into a Stigix IoT emulator JSON config file compatible with iot_emulator.py.

Usage:
  python import_prisma_devices.py --input "iot device bad sources.csv" --output devices.json
  python import_prisma_devices.py --input "iot device bad sources.csv" --output devices.json --base-ip 192.168.207 --start-ip 50
  python import_prisma_devices.py --input "iot device bad sources.csv" --output devices.json --only-iot
  python import_prisma_devices.py --input "iot device bad sources.csv" --output devices.json --enable-security
"""

import csv
import json
import argparse
import random
import ipaddress
import re
import sys
from pathlib import Path


# ─── Protocol mapping ────────────────────────────────────────────────────────
# Maps Prisma "display_apps" protocol IDs to Stigix protocol names

APP_TO_PROTOCOL = {
    "dhcp": "dhcp",
    "dns": "dns",
    "dns-base": "dns",
    "ntp-base": "ntp",
    "rtsp": "rtsp",
    "http": "http",
    "http-proxy": "http",
    "https": "http",
    "ssl": "http",
    "web-browsing": "http",
    "mqtt": "mqtt",
    "snmp-base": "http",
    "mdns": "mdns",
    "ssdp": "mdns",
    "upnp": "mdns",
    "onvif": "http",
    "lldp": "lldp",
    "arp": "arp",
}

# Prisma "category" -> protocols defaults (fallback when no apps data)
CATEGORY_PROTOCOLS = {
    "Camera":                   ["dhcp", "arp", "lldp", "http", "rtsp", "dns", "ntp"],
    "Infusion System":          ["dhcp", "arp", "http", "dns"],
    "SCADA Server":             ["dhcp", "arp", "lldp", "http", "dns"],
    "Industrial Controller":    ["dhcp", "arp", "lldp", "http", "dns"],
    "Digital Signage":          ["dhcp", "arp", "http", "dns", "ntp"],
    "Network Equipment":        ["dhcp", "arp", "lldp", "http", "dns"],
    "Smartphone or Tablet":     ["dhcp", "arp", "http", "dns", "ntp"],
    "Personal Computer":        ["dhcp", "arp", "http", "dns", "ntp"],
    "Virtual Machine":          ["dhcp", "arp", "http", "dns"],
    "Control System Engineering Workstation": ["dhcp", "arp", "http", "dns"],
    "Manufacturing Zone":       ["dhcp", "arp", "lldp", "http", "dns"],
    "default":                  ["dhcp", "arp", "http", "dns"],
}

# Prisma profile_vertical / category -> Stigix device "type"
VERTICAL_TO_TYPE = {
    "Office":       "Security Camera",
    "Medical":      "Medical Device",
    "Industrial":   "Industrial IoT",
    "Traditional IT": "Workstation",
    "Network Devices": "Network Equipment",
}

# Risk level -> bad behavior
RISK_TO_BAD_BEHAVIOR = {"Critical", "High"}

# DHCP fingerprints per vendor keyword
VENDOR_DHCP_FINGERPRINTS = {
    "Hikvision": {
        "vendor_class_id": "HIKVISION",
        "param_req_list": [1, 3, 6, 12, 15, 28, 42, 51, 54, 58, 59],
    },
    "Axis": {
        "vendor_class_id": "AXIS Network Camera",
        "param_req_list": [1, 3, 6, 12, 15, 28, 42, 43, 51, 54, 58, 59, 119],
    },
    "Dahua": {
        "vendor_class_id": "Dahua IP Camera",
        "param_req_list": [1, 3, 6, 12, 15, 28, 42, 51, 54, 58, 59],
    },
    "Apple": {
        "vendor_class_id": "Apple iOS Device",
        "param_req_list": [1, 3, 6, 15, 119, 252, 95, 44, 46],
    },
    "Rockwell": {
        "vendor_class_id": "Rockwell Automation",
        "param_req_list": [1, 3, 6, 12, 15, 28, 51, 54],
    },
    "OSIsoft": {
        "vendor_class_id": "OSIsoft PI Server",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59],
    },
    "CareFusion": {
        "vendor_class_id": "CareFusion Alaris",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59],
    },
    "F5": {
        "vendor_class_id": "F5 Networks",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59],
    },
    "BrightSign": {
        "vendor_class_id": "BrightSign",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59, 119],
    },
    "Samsung": {
        "vendor_class_id": "Samsung SmartThings",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59, 119],
    },
    "VMware": {
        "vendor_class_id": "VMware Virtual Platform",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59],
    },
    "default": {
        "vendor_class_id": "Generic IoT Device",
        "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59],
    },
}


# ─── Helper functions ─────────────────────────────────────────────────────────

def safe(row, key, default=""):
    """Get CSV value safely."""
    return (row.get(key) or "").strip()


def extract_vendor(row):
    """
    Extract vendor from various Prisma CSV columns.
    Priority: display_vendor in baseline JSON > profile column > hostname
    """
    # Try parsing vendor from the baseline JSON-in-a-field
    baseline = safe(row, "baseline")
    if baseline:
        m = re.search(r'"display_vendor"\s*:\s*"([^"]+)"', baseline)
        if m:
            return m.group(1).strip()

    # Try profile column (e.g. "Hikvision Camera" -> "Hikvision")
    profile = safe(row, "profile")
    if profile:
        parts = profile.split()
        if parts:
            return parts[0]

    return "Unknown"


def extract_model(row):
    """Extract device model from baseline mismatch or profile."""
    baseline = safe(row, "baseline")
    if baseline:
        m = re.search(r'"display_model"\s*:\s*"([^"]+)"', baseline)
        if m and m.group(1):
            return m.group(1).strip()
    # fallback to profile
    return safe(row, "profile") or "Unknown Model"


def extract_protocols_from_apps(apps_str):
    """
    Convert Prisma display_apps string (comma-separated) to Stigix protocol list.
    Always includes dhcp, arp.
    """
    protocols = {"dhcp", "arp"}
    if not apps_str:
        return list(protocols)
    for app in apps_str.split(","):
        app = app.strip().lower()
        if app in APP_TO_PROTOCOL:
            protocols.add(APP_TO_PROTOCOL[app])
    # Ensure dns is always present
    protocols.add("dns")
    return sorted(protocols)


def get_dhcp_fingerprint(vendor, hostname, model):
    """Generate DHCP fingerprint for a device."""
    fp_template = VENDOR_DHCP_FINGERPRINTS.get("default", {})

    # Match vendor keyword
    for key, fp in VENDOR_DHCP_FINGERPRINTS.items():
        if key.lower() in vendor.lower():
            fp_template = fp
            break

    return {
        "hostname": hostname or f"{vendor}-device",
        "vendor_class_id": fp_template.get("vendor_class_id", f"{vendor} IoT Device"),
        "client_id_type": 1,
        "param_req_list": fp_template.get("param_req_list", [1, 3, 6, 15, 28, 51, 58, 59]),
    }


def extract_gateway(subnet_str):
    """Derive gateway (.1) from subnet CIDR like '192.168.1.0/24'."""
    if not subnet_str:
        return "192.168.207.1"
    # Take the first subnet if comma-separated
    subnet = subnet_str.split(",")[0].strip()
    try:
        net = ipaddress.IPv4Network(subnet, strict=False)
        return str(net.network_address + 1)
    except Exception:
        return "192.168.207.1"


def is_iot_device(row):
    """
    Return True if this device is an actual IoT device (not a plain PC/server).
    Prisma sets profile_vertical to "IoT" for IoT, "Non_IoT" for IT.
    """
    vertical = safe(row, "profile_vertical").lower()
    return vertical == "iot"


def make_device_id(vendor, category, counter):
    """Generate a slug device ID."""
    v = re.sub(r"[^a-zA-Z0-9]", "", vendor.lower())[:8]
    c = re.sub(r"[^a-zA-Z0-9]", "_", category.lower())[:12]
    return f"{v}_{c}_{counter:03d}"


# ─── Main conversion ──────────────────────────────────────────────────────────

def convert(
    input_path,
    output_path,
    base_ip=None,
    start_ip=50,
    only_iot=False,
    enable_security=False,
    security_percentage=None,
    gateway=None,
):
    devices = []
    counters = {}  # vendor -> count (for unique IDs)
    ip_counter = start_ip

    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"📂 Read {len(rows)} rows from CSV")

    skipped = 0
    for row in rows:
        # Optionally filter only IoT devices
        if only_iot and not is_iot_device(row):
            skipped += 1
            continue

        hostname = safe(row, "hostname")
        ip_raw   = safe(row, "ip address") or safe(row, "ip")
        mac      = safe(row, "mac address").lower()
        subnet   = safe(row, "subnets")
        category = safe(row, "category") or "Unknown"
        risk_level = safe(row, "ml_risk_level")
        apps_str = safe(row, "display_apps")
        profile  = safe(row, "profile")
        vertical = safe(row, "profile_vertical")

        vendor = extract_vendor(row)
        model  = extract_model(row)

        # MAC fallback
        if not mac or mac == "00:00:00:00:00:00":
            mac = ":".join(f"{random.randint(0, 255):02x}" for _ in range(6))

        # IP: use override base_ip if provided, else real IP from CSV
        if base_ip:
            ip = f"{base_ip}.{ip_counter}"
        else:
            ip = ip_raw or f"192.168.207.{ip_counter}"

        # Gateway
        gw = gateway or extract_gateway(subnet)

        # Protocols: use apps_str if rich, else fall back to category defaults
        protocols = extract_protocols_from_apps(apps_str)
        # If only arp/dhcp/dns came through, apps_str was probably empty — use category defaults
        if len(set(protocols) - {"arp", "dhcp", "dns"}) == 0:
            cat_defaults = CATEGORY_PROTOCOLS.get(category, CATEGORY_PROTOCOLS["default"])
            protocols = list(set(protocols) | set(cat_defaults))

        # Add lldp for known wired camera/industrial types
        if any(k in category.lower() for k in ["camera", "industrial", "scada", "plc", "controller"]):
            if "lldp" not in protocols:
                protocols.append("lldp")

        # DHCP fingerprint
        dhcp_fp = get_dhcp_fingerprint(vendor, hostname, model)

        # Unique counter per vendor
        counters[vendor] = counters.get(vendor, 0) + 1
        device_id = make_device_id(vendor, category, counters[vendor])

        device = {
            "id": device_id,
            "name": f"{vendor} {model}" if model and model != "Unknown Model" else hostname or device_id,
            "vendor": vendor,
            "type": category,
            "mac": mac,
            "ip_start": ip,
            "protocols": sorted(set(protocols)),
            "enabled": True,
            "traffic_interval": random.randint(60, 300),
            "description": f"{profile} — {vertical} — Risk: {risk_level or 'N/A'}",
            "fingerprint": {
                "dhcp": dhcp_fp
            },
        }

        # MQTT topic for devices that use MQTT
        if "mqtt" in protocols:
            slug = re.sub(r"[^a-z0-9]", "_", category.lower())
            device["mqtt_topic"] = f"iot/{slug}/{device_id}"

        # Security / bad behavior
        is_bad = False
        if security_percentage is not None:
            is_bad = random.randint(1, 100) <= security_percentage
        elif enable_security:
            is_bad = True
        elif risk_level in RISK_TO_BAD_BEHAVIOR:
            # Auto-enable bad behavior for Critical/High risk devices
            is_bad = True

        if is_bad:
            device["security"] = {
                "bad_behavior": True,
                "behavior_type": ["random", "dns_flood", "beacon"]
            }

        devices.append(device)
        ip_counter += 1

    if skipped:
        print(f"⚠️  Skipped {skipped} non-IoT devices (use --all to include them)")

    # Build output — match Stigix format: just { devices: [...] }, no network wrapper
    output = {
        "devices": devices
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✅ Exported {len(devices)} devices → {output_path}")
    print(f"   Bad-behavior devices: {sum(1 for d in devices if d.get('security', {}).get('bad_behavior'))}")
    return devices


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Convert Prisma Device Security CSV export to Stigix IoT emulator JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:

  # Basic conversion (keeps original IPs from CSV)
  python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json

  # Override to a custom IP subnet
  python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json \\
      --base-ip 192.168.207 --start-ip 50

  # Only keep IoT devices (filter out PCs, VMs, tablets)
  python import_prisma_devices.py -i "iot device bad sources.csv" -o iot-only.json --only-iot

  # Enable bad behavior for all Critical/High risk devices (automatic from CSV)
  python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json

  # Force bad behavior for ALL devices
  python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --enable-security

  # Bad behavior for 30%% of devices
  python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --security-percentage 30
        """,
    )
    parser.add_argument("-i", "--input",  required=True, help="Prisma CSV export file")
    parser.add_argument("-o", "--output", required=True, help="Output JSON file")
    parser.add_argument("--base-ip",  default=None,
                        help="Override IP subnet (first 3 octets, e.g. 192.168.207). "
                             "If not set, uses real IPs from CSV.")
    parser.add_argument("--start-ip", type=int, default=50,
                        help="Starting last octet when --base-ip is set (default: 50)")
    parser.add_argument("--gateway",  default=None,
                        help="Force a specific gateway IP (default: derived from CSV subnet)")
    parser.add_argument("--only-iot", action="store_true",
                        help="Only export devices classified as IoT (exclude PCs, VMs, tablets)")
    parser.add_argument("--enable-security", action="store_true",
                        help="Enable bad behavior for ALL devices")
    parser.add_argument("--security-percentage", type=int, default=None,
                        help="Enable bad behavior for N%% of devices (0-100)")
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"❌ File not found: {args.input}")
        sys.exit(1)

    convert(
        input_path=args.input,
        output_path=args.output,
        base_ip=args.base_ip,
        start_ip=args.start_ip,
        only_iot=args.only_iot,
        enable_security=args.enable_security,
        security_percentage=args.security_percentage,
        gateway=args.gateway,
    )


if __name__ == "__main__":
    main()
