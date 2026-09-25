> **Last Updated:** 2026-05-12 | **Created:** 2026-02-15 (v1.2.1-patch.26)

# 🐍 IoT Device Generator - Python Script

## Overview

`generate_iot_devices.py` is a Python script that generates realistic IoT device configurations with DHCP fingerprints for the SD-WAN Traffic Generator and Palo Alto IoT Security labs.

Unlike the LLM-based generation approach, this script provides:
- **Deterministic output** - Same configuration every time for a given preset
- **Offline generation** - No API calls or internet connection required
- **Fast execution** - Generates 100+ devices in milliseconds
- **Pre-validated** - Built-in vendor/model database ensures correctness

---

## Features

✅ **DHCP Fingerprinting** - Automatic generation of realistic DHCP fingerprints per vendor  
✅ **13 Device Categories** - Smart lighting, cameras, sensors, HVAC, appliances, and more  
✅ **50+ Vendors** - Hikvision, Philips, TP-Link, Samsung, Siemens, and many others  
✅ **200+ Device Models** - Real product names and specifications  
✅ **Vendor OUI Prefixes** - Correct MAC address prefixes per manufacturer  
✅ **Protocol Assignment** - Automatic protocol selection based on device type  
✅ **Presets** - Small (30), Medium (65), Large (110), Enterprise (170) device configs  
✅ **Custom Mix** - Specify exact device counts per category  

---

## Installation

### Requirements

- Python 3.7+
- No external dependencies required (uses only standard library)

### Download

```bash
# Clone the repository
git clone https://github.com/jsuzanne/stigix.git
cd stigix/iot

# Make executable
chmod +x generate_iot_devices.py
```

---

## Quick Start

### 1. List Available Categories

```bash
python generate_iot_devices.py --list-categories
```

**Output:**

```text
Available categories:

 1. Smart Lighting
    Vendors: LIFX, Philips, TP-Link, Yeelight
    Models:  17

 2. Smart Plugs & Switches
    Vendors: Meross, Shelly, Sonoff, TP-Link
    Models:  13

 3. Security Cameras
    Vendors: Arlo, Axis, Dahua, Hikvision, Ring
    Models:  11
...
```

### 2. Generate with Preset

```bash
# Small lab (30 devices)
python generate_iot_devices.py --preset small

# Medium lab (65 devices)
python generate_iot_devices.py --preset medium

# Large lab (110 devices)
python generate_iot_devices.py --preset large

# Enterprise lab (170 devices)
python generate_iot_devices.py --preset enterprise
```

### 3. Custom Configuration

```bash
# Specify exact device counts per category
python generate_iot_devices.py --custom "Security Cameras:10,Sensors:20,Smart Lighting:15"
```

### 4. Specify Output File

```bash
python generate_iot_devices.py --preset medium --output my-lab.json
```

---

## Usage

### Command Line Options

```text
usage: generate_iot_devices.py [OPTIONS]

Options:
  --preset {small,medium,large,enterprise}
                        Predefined configuration
  
  --custom "Category:N,..."
                        Custom device counts per category
  
  --output FILE, -o FILE
                        Output JSON file name (default: iot-devices-{preset}.json)
  
  --base-ip IP          First 3 octets of IP (default: 192.168.207)
  
  --start-ip N          Starting last octet (default: 50)
  
  --list-categories     Show all available categories and exit
  
  --add-network         Add network section to JSON (default: True)

  --enable-security     Enable security testing (bad behavior) for ALL devices

  --security-percentage N
                        Enable security testing for N%% of devices (0-100)

  -h, --help            Show this help message and exit
```

---

## Presets

### Small Lab (30 devices)

**Use case:** Personal testing, proof-of-concept demos

```bash
python generate_iot_devices.py --preset small
```

**Device Mix:**
- 5× Smart Lighting
- 5× Smart Plugs & Switches
- 3× Security Cameras
- 3× Smart Speakers & Displays
- 5× Sensors
- 2× Thermostats & HVAC
- 2× Smart TVs & Streaming
- 2× Printers & Office
- 2× Hubs & Bridges

**Total:** ~30 devices

### Medium Lab (65 devices)

**Use case:** Standard customer demos, partner training

```bash
python generate_iot_devices.py --preset medium
```

**Device Mix:**
- 10× Smart Lighting
- 10× Smart Plugs & Switches
- 6× Security Cameras
- 5× Smart Speakers & Displays
- 10× Sensors
- 4× Thermostats & HVAC
- 4× Smart TVs & Streaming
- 3× Smart Locks & Doorbells
- 4× Smart Appliances
- 5× Printers & Office
- 3× Hubs & Bridges

**Total:** ~65 devices

### Large Lab (110 devices)

**Use case:** Enterprise demos, large-scale testing

```bash
python generate_iot_devices.py --preset large
```

**Device Mix:**
- 15× Smart Lighting
- 15× Smart Plugs & Switches
- 10× Security Cameras
- 8× Smart Speakers & Displays
- 20× Sensors
- 6× Thermostats & HVAC
- 6× Smart TVs & Streaming
- 5× Smart Locks & Doorbells
- 8× Smart Appliances
- 8× Printers & Office
- 5× Hubs & Bridges
- 4× Medical Devices

**Total:** ~110 devices

### Enterprise Lab (170 devices)

**Use case:** Critical infrastructure, OT/IT convergence demos

```bash
python generate_iot_devices.py --preset enterprise
```

**Device Mix:**
- 20× Smart Lighting
- 20× Smart Plugs & Switches
- 15× Security Cameras
- 10× Smart Speakers & Displays
- 30× Sensors
- 10× Thermostats & HVAC
- 8× Smart TVs & Streaming
- 8× Smart Locks & Doorbells
- 10× Smart Appliances
- 15× Printers & Office
- 8× Hubs & Bridges
- 5× Medical Devices
- 10× Industrial IoT (PLCs, SCADA)

**Total:** ~170 devices

---

## Advanced Usage

### Custom Network Configuration

```bash
# Use different IP range
python generate_iot_devices.py --preset medium --base-ip 10.10.10 --start-ip 100

# Output: 10.10.10.100 - 10.10.10.164
```

### Custom Device Mix

```bash
# Security-focused lab
python generate_iot_devices.py --custom "Security Cameras:20,Sensors:30,Smart Locks & Doorbells:10" -o security-lab.json

# Healthcare environment
python generate_iot_devices.py --custom "Medical Devices:15,Sensors:25,Printers & Office:10,Security Cameras:8" -o hospital.json

# Industrial/OT environment
python generate_iot_devices.py --custom "Industrial IoT:20,Security Cameras:10,Sensors:15" -o factory.json

# Smart building
python generate_iot_devices.py --custom "Smart Lighting:25,Thermostats & HVAC:15,Sensors:30,Printers & Office:12" -o smart-building.json
```

---

## Device Categories

### 1. Smart Lighting

**Vendors:** Philips, LIFX, TP-Link, Yeelight  
**Models:** Hue bulbs, LIFX strips, Kasa bulbs, Yeelight lights  
**Protocols:** dhcp, arp, lldp, http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Philips:** hostname="Philips-hue", vendor_class_id="Philips hue bridge 2012"
- **TP-Link:** hostname="TP-Link_Smart_Bulb", vendor_class_id="TP-LINK Smart Bulb"

### 2. Smart Plugs & Switches

**Vendors:** TP-Link, Meross, Sonoff, Shelly  
**Models:** Kasa plugs, Sonoff switches, Shelly relays  
**Protocols:** dhcp, arp, lldp, mqtt (Sonoff/Shelly), http, cloud, dns

**DHCP Fingerprint Examples:**
- **Sonoff:** hostname="SONOFF-{model}", vendor_class_id="eWeLink"
- **Shelly:** hostname="shelly-{model}", includes option 12 in param_req_list

### 3. Security Cameras

**Vendors:** Hikvision, Axis, Dahua, Arlo, Ring  
**Models:** IP cameras, PTZ cameras, doorbells  
**Protocols:** dhcp, arp, lldp, http, rtsp, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Hikvision:** vendor_class_id="HIKVISION", includes NTP (option 42)
- **Axis:** vendor_class_id="AXIS {model} Network Camera", longest param_req_list

### 4. Smart Speakers & Displays

**Vendors:** Amazon, Google, Sonos  
**Models:** Echo devices, Nest Hub, Sonos speakers  
**Protocols:** dhcp, arp, lldp, http, mdns, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Amazon Echo:** param_req_list=[1, 3, 6, 15, 119, 252] (includes WPAD option 252)
- **Google Home:** Longer param_req_list with NTP

### 5. Sensors

**Vendors:** Xiaomi, Aqara, Samsung  
**Models:** Temperature, motion, door/window sensors  
**Protocols:** dhcp, arp, lldp, mqtt, cloud, dns

**DHCP Fingerprint Examples:**
- **Xiaomi/Aqara:** hostname="lumi-{type}", vendor_class_id="LUMI"

### 6. Thermostats & HVAC

**Vendors:** Google Nest, Ecobee, Honeywell  
**Models:** Smart thermostats, temperature sensors  
**Protocols:** dhcp, arp, lldp, http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Nest:** Includes MTU option (26) in param_req_list
- **Ecobee:** Similar to Nest with NTP support

### 7. Smart TVs & Streaming

**Vendors:** Samsung, LG, Roku, Apple  
**Models:** Smart TVs, streaming devices  
**Protocols:** dhcp, arp, lldp, http, mdns, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Apple TV:** Unique param_req_list [1, 3, 6, 15, 119, 252, 95, 44, 46]
- **Roku:** Standard param_req_list with domain search (119)

### 8. Smart Locks & Doorbells

**Vendors:** Ring, August, Yale  
**Models:** Smart locks, video doorbells  
**Protocols:** dhcp, arp, http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Ring:** Similar to Ring cameras
- **August/Yale:** Simpler param_req_list without NTP

### 9. Smart Appliances

**Vendors:** Samsung, LG, iRobot  
**Models:** Smart fridges, washers, robot vacuums  
**Protocols:** dhcp, arp, lldp (Samsung/LG), http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Samsung:** vendor_class_id="Samsung SmartThings"
- **iRobot:** hostname="Roomba", vendor_class_id="iRobot Roomba"

### 10. Printers & Office

**Vendors:** HP, Epson, Canon  
**Models:** Laser printers, inkjet printers, multifunction devices  
**Protocols:** dhcp, arp, lldp, http, mdns, dns

**DHCP Fingerprint Examples:**
- **HP:** Includes domain search (119) in param_req_list
- **All printers:** Include SNMP server ID (option 54)

### 11. Hubs & Bridges

**Vendors:** Philips, Samsung, Hubitat  
**Models:** Smart home hubs, bridges  
**Protocols:** dhcp, arp, lldp, http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Philips Hue Bridge:** Same as Philips lights
- **SmartThings Hub:** Samsung SmartThings fingerprint

### 12. Medical Devices

**Vendors:** Fitbit, Withings  
**Models:** Fitness trackers, smart scales  
**Protocols:** dhcp, arp, http, cloud, dns, ntp

**DHCP Fingerprint Examples:**
- **Fitbit:** Simple param_req_list
- **Withings:** Includes NTP (option 42)

### 13. Industrial IoT

**Vendors:** Siemens, Schneider Electric, Rockwell Automation  
**Models:** PLCs, SCADA systems, industrial controllers  
**Protocols:** dhcp, arp, lldp, http, dns

**DHCP Fingerprint Examples:**
- **Siemens:** hostname="SIMATIC-{model}", vendor_class_id="Siemens SIMATIC"
- **Schneider:** hostname="Modicon-{model}", industrial param_req_list

---

## Output Format

### JSON Structure

```json
{
  "network": {
    "gateway": "192.168.207.1"
  },
  "devices": [
    {
      "id": "philips_smart_lighting_01",
      "name": "Philips Hue Color E27",
      "vendor": "Philips",
      "type": "Smart Lighting",
      "mac": "ec:b5:fa:00:00:01",
      "ip_start": "192.168.207.50",
      "protocols": ["dhcp", "arp", "lldp", "http", "cloud", "dns"],
      "enabled": true,
      "traffic_interval": 180,
      "description": "Philips Hue Color E27 - Smart Lighting",
      "fingerprint": {
        "dhcp": {
          "hostname": "Philips-hue",
          "vendor_class_id": "Philips hue bridge 2012",
          "client_id_type": 1,
          "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59]
        }
      }
    }
  ]
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique device identifier (vendor_category_NN) |
| `name` | string | Full device model name |
| `vendor` | string | Manufacturer name |
| `type` | string | Device category (singular form) |
| `mac` | string | MAC address with correct vendor OUI prefix |
| `ip_start` | string | Requested/fallback IP address |
| `protocols` | array | List of supported protocols |
| `enabled` | boolean | Device enabled state (always true) |
| `traffic_interval` | integer | Traffic generation interval in seconds (60-300) |
| `description` | string | Human-readable description |
| `fingerprint.dhcp` | object | DHCP fingerprint for device identification |

### DHCP Fingerprint Fields

| Field | Type | Description |
|-------|------|-------------|
| `hostname` | string | DHCP Option 12 - Hostname |
| `vendor_class_id` | string | DHCP Option 60 - Vendor Class Identifier |
| `client_id_type` | integer | DHCP Option 61 type (always 1 = Ethernet) |
| `param_req_list` | array | DHCP Option 55 - Parameter Request List |

### DHCP Parameter Request List Reference

Common DHCP options in param_req_list:

| Option | Name | Used By |
|--------|------|---------|
| 1 | Subnet Mask | All devices |
| 3 | Default Gateway | All devices |
| 6 | DNS Server | All devices |
| 12 | Hostname | Cameras, industrial devices |
| 15 | Domain Name | All devices |
| 26 | MTU | Thermostats, some cameras |
| 28 | Broadcast Address | Most devices |
| 42 | NTP Server | Cameras, streaming devices, some lights |
| 43 | Vendor-Specific | Axis cameras |
| 44 | NetBIOS Name Server | Apple devices |
| 46 | NetBIOS Node Type | Apple devices |
| 51 | IP Address Lease Time | All devices |
| 54 | DHCP Server ID | All devices, printers |
| 58 | Renewal Time (T1) | Most devices |
| 59 | Rebinding Time (T2) | Most devices |
| 95 | LDAP | Apple devices |
| 119 | Domain Search List | Printers, cameras, smart speakers |
| 252 | WPAD | Amazon Echo, some Windows devices |

### Vendor OUI Prefixes

The script uses correct MAC address OUI prefixes per vendor:

| Vendor | OUI Prefix | Example MAC |
|--------|------------|-------------|
| Philips | ec:b5:fa | ec:b5:fa:00:01:23 |
| Hikvision | 00:12:34 | 00:12:34:56:78:9a |
| TP-Link | 50:c7:bf | 50:c7:bf:ab:cd:ef |
| Xiaomi | 4c:65:a8 | 4c:65:a8:12:34:56 |
| Samsung | d0:52:a8 | d0:52:a8:aa:bb:cc |
| Axis | 00:40:8c | 00:40:8c:de:ad:be |
| Sonoff | 34:94:54 | 34:94:54:11:22:33 |
| Shelly | c4:5b:be | c4:5b:be:44:55:66 |
| Google | 18:b4:30 | 18:b4:30:77:88:99 |
| Amazon | 50:f5:da | 50:f5:da:aa:bb:cc |

---

## Integration with Traffic Generator

### Import Generated Config

```bash
# 1. Generate the config
python generate_iot_devices.py --preset medium -o iot-devices.json

# 2. Copy to traffic generator directory
cp iot-devices.json /path/to/stigix/

# 3. Run the emulator
sudo ./iot_emulator.py -i eth0 -c iot-devices.json
```

### Validate Generated Config

```bash
# Check JSON syntax
jq . iot-devices.json

# Count devices
jq '.devices | length' iot-devices.json

# List all vendors
jq -r '.devices[].vendor' iot-devices.json | sort -u

# Check for duplicate MACs
jq -r '.devices[].mac' iot-devices.json | sort | uniq -d

# Verify all have fingerprints
jq -r '.devices[] | select(.fingerprint.dhcp == null) | .id' iot-devices.json
```

---

---

## 📥 Prisma / IoT Security CSV Import

### Overview

`import_prisma_devices.py` converts a **Palo Alto IoT Security** or **Prisma Access Device Security** CSV export into a fully-featured Stigix IoT emulator JSON config.

This is the **most realistic** approach because the source data comes from devices actually observed on a customer network — real MAC addresses, real vendor profiles, real application telemetry, and real risk scores.

> 💡 **When to use this method:** Your customer or prospect already has Palo Alto IoT Security or Prisma Access deployed. Export their device inventory and replay it on a Stigix lab node. The simulated devices will have the exact DHCP fingerprints and protocol behaviors that IoT Security originally classified.

---

### How to Export the CSV from Palo Alto IoT Security

1. Log into **Prisma Access** → **IoT Security** → **Devices**
2. Apply filters if desired (e.g., Risk = Critical, Vertical = IoT)
3. Click **Export** → **CSV**
4. Save the file locally (e.g., `iot device bad sources.csv`)

The CSV includes columns such as: `hostname`, `ip address`, `mac address`, `category`, `profile`, `profile_vertical`, `ml_risk_level`, `display_apps`, `subnets`, `baseline`.

---

### Installation

```bash
# No external dependencies required
python3 --version   # 3.7+
cd stigix/iot
```

---

### Quick Start

```bash
# Basic import — all devices
python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json

# IoT devices only (exclude PCs, VMs, tablets)
python import_prisma_devices.py -i "iot device bad sources.csv" -o iot-only.json --only-iot

# Top 30 riskiest devices (Critical > High > Medium)
python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --max-devices 30

# Top 30 IoT only + bad behavior auto-enabled for Critical/High
python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --only-iot --max-devices 30

# Force bad behavior for ALL devices
python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --enable-security

# Enable bad behavior for 30% of devices (random selection)
python import_prisma_devices.py -i "iot device bad sources.csv" -o devices.json --security-percentage 30
```

### Real-World Example Output

Running against a real Prisma IoT Security export from a customer environment:

```text
$ python import_prisma_devices.py -i "iot device bad sources.csv" --max-devices 100 -o iotv2.json

📂 Read 163 rows from CSV
🔢 Limiting to top 100 devices by risk level
✅ Exported 100 devices → iotv2.json
   Bad-behavior devices: 64
```

**What this tells us:**
- The customer had **163 devices** detected by Prisma IoT Security
- After filtering to the **top 100 by risk**, 64% were classified as `Critical` or `High`
- Those 64 devices will automatically emit DNS flood, C2 beacon, and randomized attack traffic
- The remaining 36 devices simulate normal IoT behavior

> This kind of real-world data is far more impactful for a demo than a synthetic dataset — the customer recognizes their own devices and sees exactly which ones are being flagged.

---

### Command Line Options

```text
usage: import_prisma_devices.py [OPTIONS]

Required:
  -i, --input FILE          Prisma CSV export file
  -o, --output FILE         Output JSON file

Optional:
  --only-iot                Only export IoT devices (exclude PCs, VMs, tablets)
                            Filters on profile_vertical == "IoT"

  --enable-security         Enable bad_behavior for ALL devices

  --security-percentage N   Enable bad_behavior for N% of devices (random)

  --max-devices N           Limit to top N devices, sorted Critical > High > Medium > Low

  --gateway IP              Override gateway IP (default: derived from CSV subnet CIDR)

  -h, --help                Show help
```

---

### Bad Behavior Logic

The importer applies bad behavior **automatically** based on the risk level in the CSV:

| CSV `ml_risk_level` | Behavior |
|---------------------|----------|
| `Critical` | `bad_behavior: true` automatically |
| `High` | `bad_behavior: true` automatically |
| `Medium` | No bad behavior (unless `--enable-security` or `--security-percentage`) |
| `Low` | No bad behavior |
| `Informational` | No bad behavior |

When bad behavior is enabled, the device emits:
```json
"security": {
  "bad_behavior": true,
  "behavior_type": ["random", "dns_flood", "beacon"]
}
```

---

### Protocol Mapping

Protocols are extracted from the `display_apps` column of the CSV (the actual applications observed by Prisma). If the field is empty or only generic traffic was seen, a category-based default is applied.

| Prisma App ID | Stigix Protocol |
|---------------|-----------------|
| `dhcp` | `dhcp` |
| `dns`, `dns-base` | `dns` |
| `ntp-base` | `ntp` |
| `http`, `https`, `ssl`, `web-browsing` | `http` |
| `rtsp` | `rtsp` |
| `mqtt` | `mqtt` |
| `mdns`, `ssdp`, `upnp` | `mdns` |
| `lldp` | `lldp` |
| `arp` | `arp` |

`dhcp`, `arp`, and `dns` are always included regardless.

`lldp` is automatically added for cameras, industrial devices, SCADA, and PLCs.

---

### DHCP Fingerprint Generation

The importer generates realistic DHCP fingerprints per vendor using built-in templates:

| Vendor | `vendor_class_id` | Notes |
|--------|-------------------|-------|
| Hikvision | `HIKVISION` | Includes NTP (opt 42) |
| Axis | `AXIS Network Camera` | Longest param list, opt 43 (vendor-specific) |
| Dahua | `Dahua IP Camera` | Similar to Hikvision |
| Apple | `Apple iOS Device` | Unique: opts 95, 44, 46 (NetBIOS, LDAP) |
| Rockwell | `Rockwell Automation` | Industrial: shorter list, no NTP |
| OSIsoft | `OSIsoft PI Server` | OT data historian |
| CareFusion | `CareFusion Alaris` | Medical infusion pump |
| F5 | `F5 Networks` | Network load balancer |
| BrightSign | `BrightSign` | Digital signage, includes domain search |
| Samsung | `Samsung SmartThings` | Consumer IoT |
| VMware | `VMware Virtual Platform` | VMs / workstations |
| Default | `Generic IoT Device` | Fallback for unknown vendors |

The hostname is taken directly from the CSV `hostname` column, so it matches exactly what Prisma observed on the wire.

---

### Output JSON Format

The importer produces `{ "devices": [...] }` (no `network` wrapper, unlike `generate_iot_devices.py`).

```json
{
  "devices": [
    {
      "id": "hikvisi_camera_001",
      "name": "Hikvision DS-2CD2042FWD",
      "vendor": "Hikvision",
      "type": "Camera",
      "mac": "00:12:34:56:78:01",
      "protocols": ["arp", "dhcp", "dns", "http", "lldp", "ntp", "rtsp"],
      "enabled": true,
      "traffic_interval": 147,
      "description": "Hikvision Camera — IoT — Risk: Critical",
      "fingerprint": {
        "dhcp": {
          "hostname": "DS-2CD2042FWD",
          "vendor_class_id": "HIKVISION",
          "client_id_type": 1,
          "param_req_list": [1, 3, 6, 12, 15, 28, 42, 51, 54, 58, 59]
        }
      },
      "security": {
        "bad_behavior": true,
        "behavior_type": ["random", "dns_flood", "beacon"]
      }
    }
  ]
}
```

**Notable differences vs `generate_iot_devices.py` output:**

| Field | `generate_iot_devices.py` | `import_prisma_devices.py` |
|-------|---------------------------|-----------------------------|
| `ip_start` | ✅ Present (static IP assigned) | ❌ Absent (device uses DHCP) |
| `network.gateway` | ✅ Present | ❌ Absent |
| `type` | Stigix category (e.g. `Security Cameras`) | Prisma category (e.g. `Camera`) |
| `description` | Model + category | Prisma profile + vertical + risk |
| `mac` | Generated from vendor OUI | Real MAC from CSV |
| Bad behavior | Manual flag only | Auto from `ml_risk_level` |

---

### Full Workflow Example

```text
1. Prisma IoT Security Dashboard
   └── Devices → Export CSV
           │
           ▼
2. iot device bad sources.csv
   └── python import_prisma_devices.py -i ".../iot device bad sources.csv" \
                                          -o devices.json \
                                          --only-iot \
                                          --max-devices 30
           │
           ▼
3. devices.json (30 riskiest IoT devices, bad_behavior on Critical/High)
   └── Dashboard → IoT Tab → Import → Paste JSON
           │
           ▼
4. Stigix emulates real customer devices on the wire
   └── Palo Alto IoT Security sees familiar MAC + DHCP fingerprints
   └── Threat detection validated against Critical/High risk device traffic
```

---

## Comparison: All Three Methods

| Feature | `generate_iot_devices.py` | LLM Generation | `import_prisma_devices.py` |
|---------|--------------------------|----------------|----------------------------|
| Speed | Instant | 30-60 seconds | Instant |
| Data source | Built-in database | AI-generated | Real customer network |
| MAC addresses | Vendor OUI prefix | AI-generated | Real device MACs |
| DHCP fingerprints | Per-vendor templates | AI-generated | Per-vendor templates |
| Protocols | Category defaults | AI-generated | Observed telemetry |
| Bad behavior | Manual flag | Manual flag | Auto from risk level |
| Risk-based filtering | ❌ | ❌ | ✅ (`--max-devices`) |
| IoT-only filter | ❌ | ❌ | ✅ (`--only-iot`) |
| Internet required | No | Yes | No |
| Realism | High | High | Highest |
| Use case | Lab testing | Custom scenarios | Customer demo, real data |

**Recommendation:**
- **`generate_iot_devices.py`:** Quick lab setup, offline, reproducible
- **LLM Generation:** Narrative-driven, industry-specific, fully flexible
- **`import_prisma_devices.py`:** Real customer data, highest fidelity, automatic risk mapping

---

## Troubleshooting

### Issue: "Unknown category"

**Solution:** Check spelling and use exact category names:

```bash
python generate_iot_devices.py --list-categories
```

### Issue: Generated MAC addresses conflict

**Solution:** MACs are generated sequentially per OUI prefix. If you need more than 65,535 devices per vendor, the script will wrap around. For realistic scenarios, this is not an issue.

### Issue: Need different protocols

**Solution:** Edit the IOT_DATABASE dictionary in the script and add/remove protocols per vendor template.

### Issue: Want additional vendors

**Solution:** Add new vendor entries to both IOT_DATABASE and DHCP_FINGERPRINTS dictionaries.

---

## Examples

### Example 1: Security-Focused Lab

```bash
python generate_iot_devices.py \
  --custom "Security Cameras:15,Sensors:20,Smart Locks & Doorbells:5" \
  --output security-demo.json \
  --base-ip 10.20.30
```

**Result:** 40 security-related devices on 10.20.30.50-89

### Example 2: Healthcare Environment

```bash
python generate_iot_devices.py \
  --custom "Medical Devices:10,Sensors:25,Printers & Office:8,Security Cameras:5" \
  --output hospital-lab.json
```

**Result:** 48 healthcare-relevant devices

### Example 3: Smart Building

```bash
python generate_iot_devices.py --preset large --output smart-building.json
```

**Result:** 110 devices suitable for smart building demo

### Example 4: Industrial/OT

```bash
python generate_iot_devices.py \
  --custom "Industrial IoT:15,Security Cameras:10,Sensors:20" \
  --output factory-scada.json \
  --base-ip 192.168.100
```

**Result:** 45 industrial/OT devices on 192.168.100.x

---

## Contributing

### Adding New Vendors

**1. Add vendor to IOT_DATABASE category:**

```python
{
    "vendor": "NewVendor",
    "models": ["Model A", "Model B"],
    "mac_prefix": "aa:bb:cc",
    "protocols": ["dhcp", "arp", "http", "dns"],
}
```

**2. Add DHCP fingerprint to DHCP_FINGERPRINTS category:**

```python
"NewVendor": {
    "hostname_pattern": "NewVendor-{model}",
    "vendor_class_id": "NewVendor IoT Device",
    "param_req_list": [1, 3, 6, 15, 28, 51, 58, 59]
}
```

**3. Test generation:**

```bash
python generate_iot_devices.py --custom "YourCategory:5" -o test.json
jq '.devices[] | select(.vendor=="NewVendor")' test.json
```

---

## License

MIT License - See main repository LICENSE file

---

## Support

📖 **Main Documentation:** [GitHub README](https://github.com/jsuzanne/stigix)  
💬 **Discussions:** [GitHub Discussions](https://github.com/jsuzanne/stigix/discussions)  
🐛 **Issues:** [GitHub Issues](https://github.com/jsuzanne/stigix/issues)

---

## See Also

- [LLM Generation Guide](IOT_LLM_GENERATION.md) - Generate configs using ChatGPT/Claude
- [IoT Emulator Documentation](IOT_SIMULATION.md) - Main emulator documentation
