# 🤖 Generate IoT Device Profiles with LLM

## Overview

Instead of manually creating IoT device configurations, use an LLM (ChatGPT, Claude, or Gemini) to generate realistic, context-aware device profiles for your SD-WAN Traffic Generator demos and labs.

This approach allows you to quickly create industry-specific device topologies with proper DHCP fingerprints, vendor diversity, and realistic traffic patterns.

---

## Quick Start Guide

### Step 1: Copy the Prompt Template

Copy the prompt template below and paste it into your preferred LLM:

I need you to generate an iot-devices.json file for my SD-WAN Traffic Generator app.

Context:

Client: [CLIENT_NAME - e.g., Suez, Schneider Electric, Hospital XYZ]

Industry: [INDUSTRY - e.g., Water/Energy Utilities, Healthcare, Manufacturing]

Use case: [USE_CASE - e.g., Palo Alto IoT Security demo, Prisma Access validation]

Number of devices: [NUMBER - e.g., 50-100 devices]

Requirements:

Generate a diverse mix of IoT device types relevant to this industry

Include realistic vendor names (Hikvision, Axis, Philips, Sonoff, TP-Link, Xiaomi, etc.)

Each device must have a unique MAC address following vendor OUI patterns

Include DHCP fingerprints for accurate device identification by Prisma IoT Security

Assign appropriate protocols per device type:

Cameras → dhcp, arp, lldp, http, rtsp, cloud, dns, ntp

Sensors → dhcp, arp, mqtt, cloud, dns

Smart Lighting → dhcp, arp, lldp, http, cloud, dns

Printers → dhcp, arp, lldp, http, mdns, dns

Thermostats → dhcp, arp, http, cloud, dns, ntp

Use realistic hostnames and vendor_class_id values per vendor

Vary traffic_interval between 60-300 seconds for realism

Use IP addresses in the 192.168.207.X range starting from .50

Output format: Return ONLY valid JSON matching this exact schema:

{
"network": {
"gateway": "192.168.207.1"
},
"devices": [
{
"id": "vendor_devicetype_01",
"name": "Device Model Name",
"vendor": "Vendor Name",
"type": "Device Category",
"mac": "aa:bb:cc:dd:ee:ff",
"ip_start": "192.168.207.50",
"protocols": ["dhcp", "arp", "lldp", "http", "cloud", "dns"],
"enabled": true,
"traffic_interval": 180,
"description": "Vendor Device Model Name - Device Category",
"fingerprint": {
"dhcp": {
"hostname": "device-hostname",
"vendor_class_id": "Vendor Device Model",
"client_id_type": 1,
"param_req_list":
​
}
}
}
]
}

Reference example (copy this structure exactly):

{
"id": "hikvis_security_cameras_01",
"name": "Hikvision DS-2CD2385FWD-I",
"vendor": "Hikvision",
"type": "Security Camera",
"mac": "00:12:34:14:00:14",
"ip_start": "192.168.207.70",
"protocols": ["dhcp", "arp", "lldp", "http", "rtsp", "cloud", "dns", "ntp"],
"enabled": true,
"traffic_interval": 242,
"description": "Hikvision DS-2CD2385FWD-I - Security Cameras",
"fingerprint": {
"dhcp": {
"hostname": "DS-2CD2385FWD-I",
"vendor_class_id": "HIKVISION",
"client_id_type": 1,
"param_req_list":

}
}
}

Important DHCP fingerprint guidelines per device type:

Cameras (Hikvision, Axis, Dahua): param_req_list should include (with NTP option 42)

Smart Lighting (Philips Hue, LIFX, TP-Link): param_req_list or with NTP
​

Sensors (Xiaomi, Aqara, Samsung): param_req_list
​

Thermostats (Nest, Ecobee, Honeywell): param_req_list (with MTU option 26)
​

Printers (HP, Canon): param_req_list (with domain search option 119)
​

Smart Speakers (Amazon Echo, Google Home): param_req_list (Echo) or (Google)
​

MAC OUI prefixes to use:

Philips: ec:b5:fa

Hikvision: 00:12:34

TP-Link: 50:c7:bf

Xiaomi: 4c:65:a8

Samsung: d0:52:a8

Axis: 00:40:8c

Sonoff: 34:94:54

Shelly: c4:5b:be

Arlo: d0:73:d5

Google: 18:b4:30

Amazon: 50:f5:da

Now generate the complete JSON file with [NUMBER] devices.

text

### Step 2: Customize for Your Use Case

Replace the placeholders in the Context section:

- `[CLIENT_NAME]`: Your target customer or demo scenario
- `[INDUSTRY]`: The relevant industry vertical
- `[USE_CASE]`: What you're demonstrating (IoT Security, SD-WAN QoS, etc.)
- `[NUMBER]`: How many devices you need (recommended: 50-100)

### Step 3: Generate the JSON

1. Paste the customized prompt into ChatGPT, Claude, or Gemini
2. Wait for the LLM to generate the complete JSON
3. Copy the generated JSON output

### Step 4: Import into Your App

1. Open your SD-WAN Traffic Generator dashboard
2. Navigate to "Configuration" or "Import"
3. Paste the JSON into the import field
4. Click "Validate" to check syntax
5. Click "Import" to load the devices
6. Click "Deploy" to start traffic generation

---

## Example Prompts by Industry

### 🚰 Water Utility Company (Suez)

**Prompt:**
Context:

Client: Suez

Industry: Water/Wastewater Utilities

Use case: Palo Alto IoT Security demo showing OT device visibility and segmentation

Number of devices: 70

Generate a realistic mix including:

Smart water meters (various vendors)

Flow sensors and pressure sensors

SCADA controllers (Schneider Electric, Siemens)

IP cameras for facility surveillance (Hikvision, Axis)

Industrial PLCs

Environmental monitoring sensors (temperature, humidity, water quality)

Security access control systems

Smart lighting for facilities

Network equipment (routers, switches with management interfaces)

text

**Expected Device Types:**
- SCADA/ICS: Schneider Electric Modicon, Siemens SIMATIC
- Meters: Sensus, Itron, Kamstrup smart water meters
- Cameras: Hikvision, Axis, Dahua IP cameras
- Sensors: Various environmental and pressure sensors
- Controllers: PLCs, RTUs, flow controllers

---

### 🏥 Healthcare / Hospital

**Prompt:**
Context:

Client: Regional Hospital (500 beds)

Industry: Healthcare

Use case: Medical IoT segmentation demo for Prisma Access with device classification

Number of devices: 80

Generate a realistic mix including:

Patient monitors (Philips, GE Healthcare)

Infusion pumps (Baxter, BD)

Medical imaging devices (radiology workstations, ultrasound)

HVAC controllers for operating rooms and ICU

Nurse call systems

IP cameras for security (corridors, parking, ER)

Smart refrigerators (pharmacy/blood storage)

Staff RFID badge readers

Building management sensors

Printers (medical records, labels)

text

**Expected Device Types:**
- Medical: Patient monitors, infusion pumps, imaging equipment
- Building: HVAC, access control, lighting
- Security: IP cameras, badge readers
- Infrastructure: Printers, smart refrigerators

---

### 🏢 Smart Office Building

**Prompt:**
Context:

Client: Enterprise Smart Office (30 floors, 2000 employees)

Industry: Commercial Real Estate / Smart Buildings

Use case: SD-WAN QoS and IoT Security demo showing application visibility

Number of devices: 100

Generate a realistic mix including:

Smart HVAC thermostats (Nest, Ecobee, Honeywell) - multiple per floor

Philips Hue smart lighting systems

IP cameras (lobby, parking garage, hallways, conference rooms)

Access control readers (HID, Salto) at all entry points

Occupancy sensors for lighting and HVAC optimization

Smart displays (conference room booking panels)

Printers (HP, Canon) - multiple per floor

Environmental sensors (air quality, CO2, temperature)

Smart plugs and power strips for energy monitoring

Coffee machines and vending machines with IoT connectivity

text

**Expected Device Types:**
- Smart Building: Thermostats, lighting, occupancy sensors
- Security: Cameras, access control
- Office: Printers, displays, coffee machines
- Environmental: Air quality, CO2 sensors

---

### 🏭 Manufacturing / Factory

**Prompt:**
Context:

Client: Automotive Parts Manufacturing Plant

Industry: Industrial Manufacturing

Use case: OT/IT convergence demo with Prisma Access

Number of devices: 90

Generate a realistic mix including:

Industrial PLCs (Siemens, Allen-Bradley, Mitsubishi)

SCADA HMI workstations

Industrial robots (ABB, KUKA, Fanuc)

Machine vision cameras (Cognex, Keyence)

Barcode scanners and RFID readers

Environmental sensors (temperature, vibration, noise)

Safety systems (emergency stop controllers)

IP cameras for production monitoring

Energy meters and power monitoring devices

Warehouse management devices (conveyor controllers)

text

**Expected Device Types:**
- Industrial: PLCs, HMIs, robots, CNCs
- Vision: Machine vision cameras, barcode scanners
- Monitoring: Energy meters, vibration sensors
- Safety: Emergency systems, access control

---

### 🛒 Retail Store / Smart Retail

**Prompt:**
Context:

Client: Large Retail Chain Store

Industry: Retail

Use case: SD-WAN retail branch demo with IoT visibility

Number of devices: 60

Generate a realistic mix including:

Point-of-Sale (PoS) terminals

Digital signage displays

IP cameras (entrances, aisles, checkout, backroom)

Electronic shelf labels (Pricer, SES-imagotag)

Smart refrigeration controllers

People counting sensors

Wi-Fi access points with analytics

Smart lighting (Philips, TP-Link)

Access control for staff areas

Inventory RFID readers

text

**Expected Device Types:**
- Retail: PoS terminals, digital signage, electronic shelf labels
- Security: Cameras, access control
- Analytics: People counters, occupancy sensors
- Infrastructure: Smart lighting, HVAC

---

## Validation and Testing

After generating your JSON file, validate it before importing:

### 1. JSON Syntax Validation

```bash
# Install jq if not already installed
# macOS: brew install jq
# Linux: apt-get install jq

# Validate JSON syntax
jq . iot-devices.json
2. Check for Duplicate MAC Addresses
bash
# List all MACs and find duplicates
jq -r '.devices[].mac' iot-devices.json | sort | uniq -d

# If output is empty, no duplicates ✅
3. Verify All Devices Have Fingerprints
bash
# List devices missing DHCP fingerprints
jq -r '.devices[] | select(.fingerprint.dhcp == null) | .id' iot-devices.json

# If output is empty, all devices have fingerprints ✅
4. Check IP Address Range
bash
# List all IPs to verify they're in correct range
jq -r '.devices[].ip_start' iot-devices.json | sort -V

# Should be sequential from 192.168.207.50 onwards
5. Verify Protocol Assignments
bash
# List devices by type and their protocols
jq -r '.devices[] | "\(.type): \(.protocols | join(", "))"' iot-devices.json | sort -u
Tips for Best Results
1. Be Specific About Industry Context
The more details you provide, the better the LLM can select appropriate devices:

❌ Too vague: "Generate 50 devices"

✅ Better: "Generate 50 devices for a water utility company including SCADA, meters, and sensors"

2. Request Vendor Diversity
Mix premium and budget brands for realism:

text
Include a mix of:
- Premium vendors (Axis cameras, Philips lighting, GE Healthcare)
- Mid-range vendors (TP-Link, Ubiquiti, Dahua)
- Budget IoT (Sonoff, Xiaomi, Shelly)
3. Specify Realistic Quantities
Per device type, suggest realistic counts:

text
- 3-5 Hikvision cameras for parking/lobby
- 10-15 Philips Hue lights across floors
- 20-30 Xiaomi sensors (doors, motion, temperature)
- 2-3 HP printers per floor
4. Use OUI Patterns
The prompt includes correct MAC OUI prefixes, but you can emphasize:

text
Ensure MAC addresses use correct vendor OUI prefixes:
- Philips devices must start with ec:b5:fa
- Hikvision must start with 00:12:34
- TP-Link must start with 50:c7:bf
5. Iterate and Refine
If the first generation isn't perfect:

text
The output looks good, but please:
- Replace all Xiaomi sensors with Aqara (same OUI: 54:ef:44)
- Add 5 more Axis cameras (OUI: 00:40:8c)
- Reduce TP-Link bulbs from 15 to 8
Common Issues and Solutions
Issue: Duplicate MAC Addresses
Solution: Ask the LLM to regenerate with:

text
Please ensure all MAC addresses are unique. Use sequential addresses within each vendor's OUI range.
Issue: Unrealistic Device Mix
Solution: Provide more specific counts:

text
Generate exactly:
- 10 cameras
- 20 sensors
- 15 smart lights
- 10 smart plugs
- 5 thermostats
Issue: Missing Fingerprints
Solution: Emphasize in prompt:

text
CRITICAL: Every device MUST include a complete fingerprint.dhcp object with hostname, vendor_class_id, and param_req_list.
Issue: Wrong Protocols
Solution: Specify protocols per type:

text
Cameras MUST have: dhcp, arp, lldp, http, rtsp, cloud, dns, ntp
Sensors MUST have: dhcp, arp, mqtt, cloud, dns
Do not add protocols that are not supported (snmp, https).
Pre-Built Example Files
For quick testing, use these pre-generated configurations:

File	Industry	Devices	Description
examples/utilities-water.json	Water Utilities	70	SCADA, meters, industrial sensors
examples/healthcare-hospital.json	Healthcare	80	Medical devices, building systems
examples/smart-building.json	Commercial	100	Office IoT, HVAC, security
examples/manufacturing-factory.json	Industrial	90	PLCs, robots, safety systems
examples/retail-store.json	Retail	60	PoS, signage, cameras
Download from: https://github.com/[YOUR_ORG]/stigix/tree/main/examples

Advanced: Custom Device Catalogs
Create Industry Templates
Build reusable templates for common verticals:

json
{
  "template_name": "Water Utility Base",
  "device_categories": [
    {
      "type": "Smart Water Meter",
      "vendors": ["Sensus", "Itron", "Kamstrup"],
      "count_range": "10-20",
      "protocols": ["dhcp", "arp", "mqtt", "cloud", "dns"]
    },
    {
      "type": "SCADA Controller",
      "vendors": ["Schneider Electric", "Siemens"],
      "count_range": "3-5",
      "protocols": ["dhcp", "arp", "lldp", "http", "dns"]
    }
  ]
}
Share with Community
Contribute your best-performing prompts and configs:

Fork the repo

Add your config to examples/community/

Submit a pull request

LLM Provider Comparison
Provider	Best For	Strengths	Weaknesses
ChatGPT (GPT-4)	General use	Fast, reliable JSON output	Can occasionally miss fingerprint details
Claude (Sonnet)	Complex configs	Excellent at following detailed instructions	Slower for large configs
Gemini	Quick iterations	Good for rapid prototyping	May need more guidance on fingerprints
Recommendation: Start with ChatGPT GPT-4 or Claude Sonnet 3.5.

Integration with Dashboard
Option 1: External Generation (Current)
text
User → LLM (ChatGPT/Claude) → Copy JSON → Import to Dashboard
Pros: Simple, no API costs, works today
Cons: Manual copy/paste step

Option 2: Future API Integration
typescript
// Future enhancement: direct LLM integration
const generateConfig = async (prompt: string) => {
  const response = await fetch('/api/generate-devices', {
    method: 'POST',
    body: JSON.stringify({ prompt })
  });
  return response.json();
};
Pros: Seamless UX
Cons: Requires API keys, costs per generation

Support and Contributions
Need Help?
📖 Full documentation: GitHub README

💬 Discussions: GitHub Discussions

🐛 Issues: GitHub Issues

Contribute Your Prompts
Share successful prompts and configurations:

Test your generated config

Add to examples/community/[industry]-[company].json

Document in examples/community/README.md

Submit PR with description

Changelog
v1.0.0 (2026-02-15)

Initial release with DHCP fingerprinting support

Example prompts for 5 industries

Validation scripts

Pre-built example configs

License
This documentation and associated examples are released under MIT License.

Generated configurations should be used for testing and demonstration purposes only. Ensure compliance with your organization's security policies before deploying in production networks.
