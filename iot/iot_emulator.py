#!/usr/bin/env python3
"""
IoT Device Emulator for Palo Alto SD-WAN/IoT Security Lab
Generates ARP, DHCP, MQTT, HTTP, RTSP, LLDP traffic and cloud heartbeats
WITH OPTIONAL BAD BEHAVIOR FOR ALERT TESTING (MULTI-BEHAVIOR + PAN TEST DOMAINS)
"""

import json
import sys
import time
import threading
import logging
import argparse
import random
import warnings
from datetime import datetime
from pathlib import Path
import os

# Suppress Scapy import errors by redirecting stderr temporarily
_original_stderr = sys.stderr
sys.stderr = open(os.devnull, 'w')

try:
    from scapy.all import (
        Ether, IP, UDP, TCP, DHCP, ARP, DNS, DNSQR, Raw, BOOTP,
        sendp, send, conf, sniff, get_if_hwaddr
    )
    from scapy.contrib.lldp import (
        LLDPDUChassisID, LLDPDUPortID, LLDPDUTimeToLive,
        LLDPDUSystemName, LLDPDUSystemDescription, LLDPDUEndOfLLDPDU,
        LLDP_NEAREST_BRIDGE_MAC
    )
finally:
    # Always restore stderr, even if import fails
    sys.stderr.close()
    sys.stderr = _original_stderr

# Suppress Scapy warnings
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)
warnings.filterwarnings("ignore")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('iot_emulator.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global flag for JSON output and DEBUG mode
JSON_OUTPUT = False
DEBUG_MODE = os.getenv('DEBUG', 'false').lower() == 'true'
ENABLE_BAD_BEHAVIOR = False  # Global flag set by CLI

def emit_json(msg_type, **kwargs):
    """Utility to print JSON to stdout for Node.js IPC"""
    if JSON_OUTPUT:
        msg = {
            "type": msg_type,
            "timestamp": datetime.now().isoformat(),
            **kwargs
        }
        print(json.dumps(msg), flush=True)


class IoTDevice:
    """Base class for IoT device simulation"""
    
    # Cloud destinations per vendor (real public IPs)
    CLOUD_DESTINATIONS = {
        "Hikvision": {
            "servers": ["47.88.59.64", "39.107.142.200"],
            "domains": ["hik-connect.com", "hikvision.com"]
        },
        "Dahua": {
            "servers": ["47.90.123.45"],
            "domains": ["dahuasecurity.com", "p2p.dahuasecurity.com"]
        },
        "Philips": {
            "servers": ["192.229.211.108"],
            "domains": ["api.meethue.com", "firmware.meethue.com"]
        },
        "Xiaomi": {
            "servers": ["47.88.62.181", "120.92.65.244"],
            "domains": ["iot.mi.com", "api.io.mi.com"]
        },
        "Amazon": {
            "servers": ["52.94.236.248", "54.239.31.128"],
            "domains": ["alexa.amazon.com", "device-metrics-us.amazon.com"]
        },
        "Google": {
            "servers": ["216.58.213.206", "172.217.168.46"],
            "domains": ["home.nest.com", "googlehomeservices-pa.googleapis.com"]
        },
        "Sonoff": {
            "servers": ["18.185.104.23", "52.28.132.157"],
            "domains": ["eu-api.coolkit.cc", "eu-disp.coolkit.cc"]
        },
        "TP-Link": {
            "servers": ["52.41.56.200", "54.148.220.147"],
            "domains": ["wap.tplinkcloud.com", "use1-api.tplinkra.com"]
        },
        "Meross": {
            "servers": ["13.36.125.34"],
            "domains": ["iot.meross.com", "mqtt.meross.com"]
        },
        "Samsung": {
            "servers": ["52.85.83.228", "13.124.199.10"],
            "domains": ["api.smartthings.com", "graph.api.smartthings.com"]
        }
    }
    
    # Common public services
    PUBLIC_SERVICES = {
        "ntp": ["129.6.15.28", "216.239.35.0"],
        "dns": ["8.8.8.8", "1.1.1.1"],
    }
    
    # Suspicious domains for bad behavior testing
    SUSPICIOUS_DOMAINS = [
        "update.windows.com",
        "api.github.com",
        "docker.io",
        "gitlab.com",
        "vpn.corporate.example",
        "admin.suspicious-iot.ru",
        "c2.malware-test.org",
        "random-dga-12345.com",
        "torrent-tracker.net",
        "bitcoin-pool.mining.cc",
        "malware-download.xyz",
        "phishing-site.bad",
        "cryptominer.evil"
    ]
    
    # Palo Alto Networks official test domains for guaranteed detection
    PAN_DNS_TEST_DOMAINS = [
        "test-malware.testpanw.com",
        "test-phishing.testpanw.com",
        "test-dnstun.testpanw.com",
        "test-ransomware.testpanw.com",
        "test-proxy.testpanw.com",
        "test-grayware.testpanw.com",
        "test-fastflux.testpanw.com",
        "test-nrd.testpanw.com",
        "test-ddns.testpanw.com",
        "test-parked.testpanw.com",
        "test-malicious-nrd.testpanw.com",
        "test-nxns.testpanw.com",
        "test-dangling-domain.testpanw.com",
        "test-dns-rebinding.testpanw.com",
        "test-dns-infiltration.testpanw.com",
        "test-wildcard-abuse.testpanw.com",
        "test-strategically-aged.testpanw.com",
        "test-compromised-dns.testpanw.com",
        "test-adtracking.testpanw.com",
        "test-cname-cloaking.testpanw.com",
        "test-stockpile-domain.testpanw.com",
        "test-squatting.testpanw.com",
        "test-subdomain-reputation.testpanw.com",
        "test-fake-software.testpanw.com"
    ]
    
    PAN_URL_TEST_TARGETS = [
        ("urlfiltering.paloaltonetworks.com", "/test-malware"),
        ("urlfiltering.paloaltonetworks.com", "/test-phishing"),
        ("urlfiltering.paloaltonetworks.com", "/test-command-and-control"),
        ("urlfiltering.paloaltonetworks.com", "/test-hacking"),
        ("urlfiltering.paloaltonetworks.com", "/test-weapons"),
        ("urlfiltering.paloaltonetworks.com", "/test-adult"),
        ("urlfiltering.paloaltonetworks.com", "/test-gambling"),
        ("urlfiltering.paloaltonetworks.com", "/test-abused-drugs")
    ]
    
    def __init__(self, device_config, interface="eth0", dhcp_mode="auto"):
        self.id = device_config.get("id")
        self.name = device_config.get("name")
        self.vendor = device_config.get("vendor")
        self.device_type = device_config.get("type")
        self.mac = device_config.get("mac")
        self.ip_static = device_config.get("ip_start")
        self.ip = self.ip_static
        self.protocols = device_config.get("protocols", [])
        self.enabled = device_config.get("enabled", True)
        self.traffic_interval = device_config.get("traffic_interval", 60)
        self.mqtt_topic = device_config.get("mqtt_topic")
        self.interface = interface
        self.gateway = device_config.get("gateway", None)  # Will be set from DHCP ACK
        self.running = False
        self.dhcp_xid = random.randint(1, 0xFFFFFFFF)
        self.dhcp_offered_ip = None
        self.dhcp_server_ip = None
        self.dhcp_mode = dhcp_mode
        self.start_time = None

        # Optional fingerprint config (from JSON, generated by LLM or manual)
        self.fingerprint = device_config.get("fingerprint", {})
        self.dhcp_fingerprint = self.fingerprint.get("dhcp", {})
        self.http_fingerprint = self.fingerprint.get("http", {})
        
        # Security / Bad Behavior config - SUPPORT MULTI-BEHAVIORS
        self.security_config = device_config.get("security", {})
        self.bad_behavior = self.security_config.get("bad_behavior", False)
        
        # Support both single string and list of behavior types
        behavior_cfg = self.security_config.get("behavior_type", "random")
        if isinstance(behavior_cfg, list):
            self.behavior_types = behavior_cfg  # Multiple behaviors
        else:
            self.behavior_types = [behavior_cfg]  # Single behavior -> list with 1 element
        
        # Stats tracking
        self.stats = {
            "packets_sent": 0,
            "bytes_sent": 0,
            "protocols": {p: 0 for p in self.protocols},
            "bad_behavior_active": False
        }
    
    def log(self, level, message, **kwargs):
        """Unified logging that supports JSON output"""
        if JSON_OUTPUT:
            emit_json("log", device_id=self.id, level=level, message=message, **kwargs)
        else:
            log_func = getattr(logger, level.lower(), logger.info)
            log_func(f"{self.id}: {message}")

    def emit_stats(self):
        """Emit current stats in JSON format"""
        if JSON_OUTPUT:
            uptime = int(time.time() - self.start_time) if self.start_time else 0
            emit_json("stats", device_id=self.id, stats={
                "packets_sent": self.stats["packets_sent"],
                "bytes_sent": self.stats["bytes_sent"],
                "current_ip": self.ip,
                "uptime_seconds": uptime,
                "protocols": self.stats["protocols"],
                "bad_behavior_active": self.stats["bad_behavior_active"]
            })

    def _send(self, pkt, protocol=None, **kwargs):
        """Wrapper for scapy.send with stats tracking"""
        try:
            send(pkt, **kwargs)
            self.stats["packets_sent"] += 1
            self.stats["bytes_sent"] += len(pkt)
            if protocol:
                self.stats["protocols"][protocol] = self.stats["protocols"].get(protocol, 0) + 1
        except Exception as e:
            self.log("error", f"Send error: {e}")

    def _sendp(self, pkt, protocol=None, **kwargs):
        """Wrapper for scapy.sendp with stats tracking"""
        try:
            sendp(pkt, **kwargs)
            self.stats["packets_sent"] += 1
            self.stats["bytes_sent"] += len(pkt)
            if protocol:
                self.stats["protocols"][protocol] = self.stats["protocols"].get(protocol, 0) + 1
        except Exception as e:
            self.log("error", f"Sendp error: {e}")
        
    def __repr__(self):
        return f"[{self.vendor}] {self.name} ({self.ip})"
    
    def start(self):
        """Start device emulation threads"""
        if not self.enabled:
            self.log("warning", "Device is disabled, skipping")
            return
        
        self.running = True
        self.start_time = time.time()
        
        # Standard Interface Diagnostic
        if self.id != "orchestrator":
            self.log("info", f"📡 [IOT] System Interface: {self.interface} (Source: CLI/Auto)")
            self.log("info", f"🚀 Starting device simulation: {self.name} ({self.id}) [DHCP: {self.dhcp_mode}]")
        
        self.log("info", f"🆔 MAC addr: {self.mac}")
        if self.ip_static:
            self.log("info", f"📌 Fallback/Static IP: {self.ip_static}")
        
        # Bad behavior indicator
        if ENABLE_BAD_BEHAVIOR and self.bad_behavior:
            self.stats["bad_behavior_active"] = True
            self.log("warning", f"⚠️  BAD BEHAVIOR ENABLED (types: {', '.join(self.behavior_types)})")
            if JSON_OUTPUT:
                emit_json("bad_behavior_enabled", device_id=self.id, behavior_types=self.behavior_types)
        
        self.log("info", "============================================================")
        
        if JSON_OUTPUT:
            emit_json("started", device_id=self.id)
        
        # Start stats reporter thread if in JSON mode
        if JSON_OUTPUT:
            threading.Thread(target=self._stats_reporter_loop, daemon=True).start()

        # Start with DHCP to get IP (if dhcp in protocols)
        if "dhcp" in self.protocols:
            threading.Thread(target=self.do_dhcp_sequence, daemon=True).start()
            time.sleep(2)
        
        # Start protocol-specific threads
        for protocol in self.protocols:
            if protocol == "snmp":
                self.log("warning", "⚠️ SNMP protocol is deprecated and will be ignored (incompatible with host mode)")
                continue
                
            if protocol != "dhcp":
                thread = threading.Thread(
                    target=self._protocol_handler,
                    args=(protocol,),
                    daemon=True
                )
                thread.start()
        
        # DHCP renewal thread (periodic)
        if "dhcp" in self.protocols:
            thread = threading.Thread(target=self.dhcp_renewal_loop, daemon=True)
            thread.start()
        
        # Start BAD BEHAVIOR threads if enabled (one thread per behavior type)
        if ENABLE_BAD_BEHAVIOR and self.bad_behavior:
            thread = threading.Thread(target=self._bad_behavior_handler, daemon=True)
            thread.start()
    
    def stop(self):
        """Stop device emulation"""
        self.running = False
        self.log("info", "⏹️ Simulation stopped")
        if JSON_OUTPUT:
            self.emit_stats() # Final stats
            emit_json("stopped", device_id=self.id)
    
    def _stats_reporter_loop(self):
        """Periodically report stats in JSON mode"""
        while self.running:
            time.sleep(5)
            if self.running:
                self.emit_stats()
    
    def _protocol_handler(self, protocol):
        """Route to protocol handler"""
        handlers = {
            "arp": self.send_arp,
            "lldp": self.send_lldp,
            "http": self.send_http,
            "mqtt": self.send_mqtt,
            "rtsp": self.send_rtsp,
            "mdns": self.send_mdns,
            "cloud": self.send_cloud_traffic,
            "dns": self.send_dns,
            "ntp": self.send_ntp,
        }
        
        handler = handlers.get(protocol)
        if handler:
            handler()
        else:
            logger.warning(f"{self.id}: Unknown protocol: {protocol}")
    
    # ========================================================================
    # BAD BEHAVIOR HANDLERS - MULTI-BEHAVIOR SUPPORT + PAN TEST DOMAINS
    # ========================================================================
    
    def _bad_behavior_handler(self):
        """Main bad behavior dispatcher - lance tous les behavior_types en parallèle"""
        self.log("warning", f"💀 BAD BEHAVIOR thread started (types: {', '.join(self.behavior_types)})")
        
        # Wait for IP assignment
        wait_count = 0
        while (not self.ip or self.ip == "0.0.0.0") and wait_count < 30:
            time.sleep(0.5)
            wait_count += 1
        
        if not self.ip or self.ip == "0.0.0.0":
            self.log("error", "❌ Cannot start bad behavior without IP")
            return

        # Also wait for gateway from DHCP (up to 15s extra)
        wait_count = 0
        while not self.gateway and wait_count < 30:
            time.sleep(0.5)
            wait_count += 1

        if not self.gateway:
            self.log("warning", "⚠️ No gateway from DHCP, bad behavior will skip gateway-targeted traffic")
        
        # Map behavior types to handler functions
        behavior_handlers = {
            "dns_flood": self._bad_dns_flood,
            "port_scan": self._bad_port_scan,
            "beacon": self._bad_beacon,
            "data_exfil": self._bad_data_exfil,
            "random": self._bad_random_mix,
            "pan_test_domains": self._bad_pan_test_domains  # NEW: PAN official test domains
        }
        
        # Start a thread for each behavior type
        for behavior_type in self.behavior_types:
            handler = behavior_handlers.get(behavior_type)
            if handler:
                self.log("warning", f"💀 Starting behavior thread: {behavior_type}")
                thread = threading.Thread(
                    target=handler, 
                    daemon=True, 
                    name=f"bad_{behavior_type}_{self.id}"
                )
                thread.start()
                time.sleep(0.2)  # Small delay between thread starts
            else:
                self.log("error", f"❌ Unknown behavior type: {behavior_type}")
    
    def _bad_dns_flood(self):
        """Flood DNS with suspicious/random domains"""
        self.log("warning", "💀 DNS FLOOD behavior started")
        dns_servers = self.PUBLIC_SERVICES["dns"]
        if self.gateway:
            dns_servers = dns_servers + [self.gateway]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                for _ in range(10):  # Burst of 10 queries
                    domain = random.choice(self.SUSPICIOUS_DOMAINS)
                    dns_server = random.choice(dns_servers)
                    
                    pkt = IP(src=self.ip, dst=dns_server) / \
                          UDP(sport=random.randint(50000, 60000), dport=53) / \
                          DNS(rd=1, qd=DNSQR(qname=domain, qtype="A"))
                    
                    self._send(pkt, protocol="bad_dns", verbose=0)
                    self.log("warning", f"💀 [dns_flood] Query: {domain} → {dns_server}")
                    
                    time.sleep(0.5)
                
            except Exception as e:
                self.log("error", f"❌ Bad DNS flood error: {e}")
            
            time.sleep(15)  # Repeat every 15s
    
    def _bad_port_scan(self):
        """Simulate port scanning behavior"""
        self.log("warning", "💀 PORT SCAN behavior started")
        
        # Scan gateway + random internal IPs
        targets = []
        if self.gateway:
            targets.append(self.gateway)
            base_ip = ".".join(self.gateway.split(".")[0:3])
            for _ in range(5):
                targets.append(f"{base_ip}.{random.randint(1, 254)}")
        if not targets:
            self.log("warning", "⚠️ No gateway available, skipping port scan")
            return
        
        common_ports = [21, 22, 23, 80, 443, 445, 3389, 8080, 8443, 10000]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                target = random.choice(targets)
                
                for port in common_ports:
                    pkt = IP(src=self.ip, dst=target) / \
                          TCP(sport=random.randint(1024, 65535), dport=port, flags="S")
                    
                    self._send(pkt, protocol="bad_scan", verbose=0)
                    self.log("warning", f"💀 [port_scan] Scan: {target}:{port}")
                    
                    time.sleep(0.1)
                
            except Exception as e:
                self.log("error", f"❌ Bad port scan error: {e}")
            
            time.sleep(30)  # Repeat every 30s
    
    def _bad_beacon(self):
        """Simulate C2 beacon behavior (regular DNS/HTTP to same suspicious domain)"""
        self.log("warning", "💀 BEACON behavior started")
        
        beacon_domain = "c2.malware-test.org"
        beacon_ip = "198.51.100.66"  # TEST-NET-2 (won't respond but that's OK)
        dns_server = self.PUBLIC_SERVICES["dns"][0]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                # DNS beacon
                pkt_dns = IP(src=self.ip, dst=dns_server) / \
                          UDP(sport=53000, dport=53) / \
                          DNS(rd=1, qd=DNSQR(qname=beacon_domain, qtype="A"))
                
                self._send(pkt_dns, protocol="bad_beacon", verbose=0)
                self.log("warning", f"💀 [beacon] DNS: {beacon_domain}")
                
                time.sleep(1)
                
                # HTTP beacon (SYN to fake C2)
                pkt_http = IP(src=self.ip, dst=beacon_ip) / \
                           TCP(sport=random.randint(1024, 65535), dport=8443, flags="S")
                
                self._send(pkt_http, protocol="bad_beacon", verbose=0)
                self.log("warning", f"💀 [beacon] HTTP: {beacon_ip}:8443")
                
            except Exception as e:
                self.log("error", f"❌ Bad beacon error: {e}")
            
            time.sleep(10)  # Every 10s (classic beacon interval)
    
    def _bad_data_exfil(self):
        """Simulate data exfiltration (large uploads to external IPs)"""
        self.log("warning", "💀 DATA EXFIL behavior started")
        
        exfil_targets = [
            ("198.51.100.88", 443),  # Fake HTTPS upload
            ("203.0.113.50", 8080),  # Fake HTTP proxy
        ]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                target_ip, target_port = random.choice(exfil_targets)
                
                # Send multiple large TCP packets
                for _ in range(5):
                    payload = Raw(b"X" * 1400)  # Large payload
                    pkt = IP(src=self.ip, dst=target_ip) / \
                          TCP(sport=random.randint(1024, 65535), dport=target_port, flags="PA") / \
                          payload
                    
                    self._send(pkt, protocol="bad_exfil", verbose=0)
                    self.log("warning", f"💀 [data_exfil] Upload: {target_ip}:{target_port} ({len(payload)} bytes)")
                    
                    time.sleep(0.5)
                
            except Exception as e:
                self.log("error", f"❌ Bad exfil error: {e}")
            
            time.sleep(20)  # Every 20s
    
    def _bad_pan_test_domains(self):
        """Test with official Palo Alto Networks test domains for GUARANTEED detection"""
        self.log("warning", "💀 PAN TEST DOMAINS behavior started (DNS Security + URL Filtering)")
        dns_servers = self.PUBLIC_SERVICES["dns"]
        if self.gateway:
            dns_servers = dns_servers + [self.gateway]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                # DNS Security tests - cycle through PAN test domains
                for _ in range(5):  # Burst of 5 DNS queries
                    domain = random.choice(self.PAN_DNS_TEST_DOMAINS)
                    dns_server = random.choice(dns_servers)
                    
                    pkt = IP(src=self.ip, dst=dns_server) / \
                          UDP(sport=random.randint(50000, 60000), dport=53) / \
                          DNS(rd=1, qd=DNSQR(qname=domain, qtype="A"))
                    
                    self._send(pkt, protocol="bad_pan_dns", verbose=0)
                    self.log("warning", f"💀 [pan_test] DNS Security: {domain} → {dns_server}")
                    
                    time.sleep(1)
                
                time.sleep(5)
                
                # URL Filtering tests (HTTP/HTTPS SYN to trigger detection)
                for _ in range(3):
                    host, path = random.choice(self.PAN_URL_TEST_TARGETS)
                    
                    # urlfiltering.paloaltonetworks.com IP (one of their test IPs)
                    pan_url_ip = "35.223.6.162"
                    
                    # HTTPS (443) - will trigger SNI-based detection if SSL inspection enabled
                    pkt_https = IP(src=self.ip, dst=pan_url_ip) / \
                               TCP(sport=random.randint(1024, 65535), dport=443, flags="S")
                    
                    self._send(pkt_https, protocol="bad_pan_url", verbose=0)
                    self.log("warning", f"💀 [pan_test] URL Filter HTTPS: {host}{path} → {pan_url_ip}:443")
                    
                    time.sleep(2)
                    
                    # HTTP (80)
                    pkt_http = IP(src=self.ip, dst=pan_url_ip) / \
                              TCP(sport=random.randint(1024, 65535), dport=80, flags="S")
                    
                    self._send(pkt_http, protocol="bad_pan_url", verbose=0)
                    self.log("warning", f"💀 [pan_test] URL Filter HTTP: {host}{path} → {pan_url_ip}:80")
                    
                    time.sleep(2)
                
            except Exception as e:
                self.log("error", f"❌ PAN test domains error: {e}")
            
            time.sleep(20)  # Repeat every 20s
    
    def _bad_random_mix(self):
        """Random mix of all bad behaviors"""
        self.log("warning", "💀 RANDOM MIX behavior started")
        
        behaviors = [
            self._bad_dns_suspicious_single,
            self._bad_port_scan_single,
            self._bad_beacon_single,
        ]
        
        while self.running and (ENABLE_BAD_BEHAVIOR and self.stats.get("bad_behavior_active")):
            try:
                behavior = random.choice(behaviors)
                behavior()
                
            except Exception as e:
                self.log("error", f"❌ Bad random behavior error: {e}")
            
            time.sleep(random.randint(5, 15))
    
    def _bad_dns_suspicious_single(self):
        """Send one suspicious DNS query"""
        domain = random.choice(self.SUSPICIOUS_DOMAINS)
        dns_server = random.choice(self.PUBLIC_SERVICES["dns"])
        
        pkt = IP(src=self.ip, dst=dns_server) / \
              UDP(sport=random.randint(50000, 60000), dport=53) / \
              DNS(rd=1, qd=DNSQR(qname=domain, qtype="A"))
        
        self._send(pkt, protocol="bad_dns", verbose=0)
        self.log("warning", f"💀 [random] DNS: {domain}")
    
    def _bad_port_scan_single(self):
        """Send one port scan probe"""
        target = self.gateway
        if not target:
            self.log("warning", "⚠️ No gateway, skipping beacon HTTP")
            return
        port = random.choice([22, 23, 445, 3389, 8080])
        
        pkt = IP(src=self.ip, dst=target) / \
              TCP(sport=random.randint(1024, 65535), dport=port, flags="S")
        
        self._send(pkt, protocol="bad_scan", verbose=0)
        self.log("warning", f"💀 [random] Scan: {target}:{port}")
    
    def _bad_beacon_single(self):
        """Send one C2 beacon"""
        beacon_domain = "c2.malware-test.org"
        dns_server = self.PUBLIC_SERVICES["dns"][0]
        
        pkt = IP(src=self.ip, dst=dns_server) / \
              UDP(sport=53000, dport=53) / \
              DNS(rd=1, qd=DNSQR(qname=beacon_domain, qtype="A"))
        
        self._send(pkt, protocol="bad_beacon", verbose=0)
        self.log("warning", f"💀 [random] Beacon: {beacon_domain}")
    
    # ========================================================================
    # DHCP / NORMAL PROTOCOL HANDLERS (unchanged)
    # ========================================================================
    
    def parse_dhcp_options(self, packet):
        """Parse DHCP options and return as dict"""
        options = {}
        if DHCP in packet:
            for opt in packet[DHCP].options:
                if isinstance(opt, tuple) and len(opt) == 2:
                    options[opt[0]] = opt[1]
        return options

    def build_dhcp_options(self, msg_type="discover"):
        """Build DHCP options with optional fingerprint from JSON."""
        fp = self.dhcp_fingerprint or {}
        hostname = fp.get("hostname", self.name or self.id or "iot-device")
        default_vendor_class = f"{self.vendor} {self.device_type}".strip() if (self.vendor or self.device_type) else "Generic IoT Device"
        vendor_class_id = fp.get("vendor_class_id", default_vendor_class)
        param_req_list = fp.get("param_req_list", [1, 3, 6, 15, 28, 51, 54])
        client_id_type = fp.get("client_id_type", 1)

        if fp:
            self.log("info", f"🔐 Using DHCP fingerprint: hostname='{hostname}', vendor_class='{vendor_class_id}', param_req_list={param_req_list}")
        else:
            self.log("info", f"⚠️ No fingerprint provided, using defaults: hostname='{hostname}', vendor_class='{vendor_class_id}', param_req_list={param_req_list}")

        try:
            client_id = bytes([client_id_type]) + bytes.fromhex(self.mac.replace(":", ""))
        except Exception:
            client_id = b"\x01\x00\x00\x00\x00\x00\x00"

        # Clean hostname to ASCII
        try:
            hostname_bytes = hostname.encode("ascii", errors="replace")
        except Exception:
            hostname_bytes = b"iot-device"

        options = [
            ("message-type", msg_type),
            ("max_dhcp_size", 1500),          # Option 57 — realistic stack fingerprint
            ("hostname", hostname_bytes),
            ("client_id", client_id),
            ("vendor_class_id", vendor_class_id.encode("ascii", errors="replace")),
            ("param_req_list", param_req_list),  # Order is preserved — key Prisma fingerprint
            ("end"),
        ]
        return options
    
    DHCP_MAX_RETRIES = 3
    DHCP_TIMEOUT = 4  # seconds per sniff

    def do_dhcp_sequence(self):
        """Perform DHCP sequence with retries: Discover → Offer → Request → ACK"""
        for attempt in range(1, self.DHCP_MAX_RETRIES + 1):
            success = self._dhcp_attempt(attempt)
            if success:
                return
            if attempt < self.DHCP_MAX_RETRIES:
                wait = 2 * attempt  # 2s, 4s
                self.log("warning", f"⏳ DHCP retry {attempt}/{self.DHCP_MAX_RETRIES} in {wait}s...")
                time.sleep(wait)
        self.log("error", f"❌ DHCP failed after {self.DHCP_MAX_RETRIES} attempts — device will have no IP until renewal")

    def _dhcp_attempt(self, attempt: int = 1) -> bool:
        """Single DHCP Discover→Offer→Request→ACK attempt. Returns True on success."""
        try:
            self.log("info", f"🔄 DHCP attempt {attempt} (mode: {self.dhcp_mode})...")

            self.dhcp_xid = random.randint(1, 0xFFFFFFFF)
            # Reset offer state for this attempt
            self.dhcp_offered_ip = None
            self.dhcp_server_ip = None

            discover_options = self.build_dhcp_options("discover")

            def dhcp_filter(pkt):
                return DHCP in pkt and BOOTP in pkt and pkt[BOOTP].xid == self.dhcp_xid

            # BOOTP broadcast flag (0x8000) = receive reply as broadcast before having an IP
            # htype=1 (Ethernet), hlen=6 (MAC length) — explicit for credibility
            discover = Ether(dst="ff:ff:ff:ff:ff:ff", src=self.mac) / \
                       IP(src="0.0.0.0", dst="255.255.255.255") / \
                       UDP(sport=68, dport=67) / \
                       BOOTP(chaddr=bytes.fromhex(self.mac.replace(':', '')),
                             xid=self.dhcp_xid, flags=0x8000, htype=1, hlen=6) / \
                       DHCP(options=discover_options)

            self.log("info", f"📤 DHCP DISCOVER (xid: {hex(self.dhcp_xid)}, MAC: {self.mac})")
            if JSON_OUTPUT:
                emit_json("dhcp_discover", device_id=self.id, xid=hex(self.dhcp_xid), mac=self.mac, attempt=attempt)
            sendp(discover, iface=self.interface, verbose=0)

            # ── Wait for OFFER ────────────────────────────────────────────────
            self.log("info", f"⏳ Waiting for DHCP OFFER (timeout: {self.DHCP_TIMEOUT}s)...")
            try:
                packets = sniff(iface=self.interface, lfilter=dhcp_filter,
                                timeout=self.DHCP_TIMEOUT, count=1, store=1)
                if packets:
                    offer_pkt = packets[0]
                    opts = self.parse_dhcp_options(offer_pkt)
                    if opts.get('message-type') == 2:
                        self.dhcp_offered_ip = offer_pkt[BOOTP].yiaddr
                        self.dhcp_server_ip = offer_pkt[BOOTP].siaddr or offer_pkt[IP].src
                        self.log("info", f"✅ DHCP OFFER from {self.dhcp_server_ip} (offered: {self.dhcp_offered_ip})")
                        if JSON_OUTPUT:
                            emit_json("dhcp_offer", device_id=self.id,
                                      server_id=self.dhcp_server_ip, offered_ip=self.dhcp_offered_ip)
                    else:
                        self.log("warning", f"⚠️ Got DHCP packet type {opts.get('message-type')} (not OFFER)")
                        return False
                else:
                    self.log("warning", f"⚠️ No DHCP OFFER received (timeout {self.DHCP_TIMEOUT}s)")
                    return False
            except Exception as e:
                self.log("warning", f"⚠️ OFFER capture error: {e}")
                return False

            time.sleep(0.3)

            # ── Send REQUEST ─────────────────────────────────────────────────
            dhcp_options = self.build_dhcp_options("request")
            if dhcp_options and dhcp_options[-1] == ("end"):
                dhcp_options = dhcp_options[:-1]

            if self.dhcp_mode == "static" and self.ip_static:
                dhcp_options.append(("requested_addr", self.ip_static))
                self.log("info", f"📤 DHCP REQUEST for static IP {self.ip_static}")
            else:
                dhcp_options.append(("requested_addr", self.dhcp_offered_ip))
                self.ip = self.dhcp_offered_ip
                self.log("info", f"📤 DHCP REQUEST for offered IP {self.dhcp_offered_ip}")

            if self.dhcp_server_ip:
                dhcp_options.append(("server_id", self.dhcp_server_ip))
            dhcp_options.append(("end"))

            request = Ether(dst="ff:ff:ff:ff:ff:ff", src=self.mac) / \
                      IP(src="0.0.0.0", dst="255.255.255.255") / \
                      UDP(sport=68, dport=67) / \
                      BOOTP(chaddr=bytes.fromhex(self.mac.replace(':', '')),
                            xid=self.dhcp_xid, flags=0x8000, htype=1, hlen=6) / \
                      DHCP(options=dhcp_options)
            sendp(request, iface=self.interface, verbose=0)

            # ── Wait for ACK ──────────────────────────────────────────────────
            self.log("info", f"⏳ Waiting for DHCP ACK (timeout: {self.DHCP_TIMEOUT}s)...")
            try:
                packets = sniff(iface=self.interface, lfilter=dhcp_filter,
                                timeout=self.DHCP_TIMEOUT, count=1, store=1)
                if packets:
                    ack_pkt = packets[0]
                    opts = self.parse_dhcp_options(ack_pkt)
                    msg_type = opts.get('message-type')

                    if msg_type == 5:  # ACK
                        assigned_ip = ack_pkt[BOOTP].yiaddr
                        self.ip = assigned_ip
                        router = opts.get('router')
                        if router:
                            self.gateway = router[0] if isinstance(router, list) else router
                            self.log("info", f"🌐 Gateway from DHCP: {self.gateway}")
                        else:
                            self.log("warning", "⚠️ No router option in DHCP ACK")

                        self.log("info", f"✅ DHCP ACK: {assigned_ip} from {ack_pkt[IP].src}")
                        if JSON_OUTPUT:
                            emit_json("dhcp_ack", device_id=self.id, assigned_ip=assigned_ip,
                                      server_id=ack_pkt[IP].src, gateway=self.gateway)

                        # ── Gratuitous ARP ────────────────────────────────────
                        try:
                            time.sleep(0.1)
                            garp = Ether(dst="ff:ff:ff:ff:ff:ff", src=self.mac) / \
                                   ARP(op="is-at", hwsrc=self.mac, psrc=assigned_ip,
                                       hwdst="ff:ff:ff:ff:ff:ff", pdst=assigned_ip)
                            sendp(garp, iface=self.interface, verbose=0)
                            self.log("info", f"📣 Gratuitous ARP: {assigned_ip} is-at {self.mac}")
                        except Exception as ge:
                            self.log("warning", f"⚠️ Gratuitous ARP failed: {ge}")

                        self.log("info", f"✅ DHCP complete (IP: {self.ip}, GW: {self.gateway})")
                        return True

                    elif msg_type == 6:  # NAK
                        self.log("error", "❌ DHCP NAK received")
                        return False
                    else:
                        self.log("warning", f"⚠️ Unexpected DHCP type {msg_type} (expected ACK)")
                        return False
                else:
                    self.log("warning", f"⚠️ No DHCP ACK received (timeout {self.DHCP_TIMEOUT}s)")
                    return False
            except Exception as e:
                self.log("warning", f"⚠️ ACK capture error: {e}")
                return False

        except Exception as e:
            self.log("error", f"❌ DHCP attempt {attempt} error: {e}")
            return False

    
    def dhcp_renewal_loop(self):
        """Periodic DHCP renewal"""
        self.log("debug", "DHCP renewal thread started")
        time.sleep(self.traffic_interval * 5)
        
        while self.running:
            try:
                logger.info(f"🔄 {self.id}: Performing DHCP renewal...")
                self.do_dhcp_sequence()
            except Exception as e:
                self.log("error", f"❌ DHCP renewal error: {e}")
            time.sleep(self.traffic_interval * 5)
    
    def send_lldp(self):
        """Send LLDP advertisements periodically"""
        self.log("info", "📡 LLDP thread started")
        
        while self.running:
            try:
                if "dhcp" in self.protocols:
                    wait_count = 0
                    while (not self.ip or self.ip == "0.0.0.0") and wait_count < 20:
                        time.sleep(0.5)
                        wait_count += 1
                
                lldp_frame = Ether(dst=LLDP_NEAREST_BRIDGE_MAC, src=self.mac) / \
                             LLDPDUChassisID(subtype=4, id=self.mac.encode()) / \
                             LLDPDUPortID(subtype=3, id=self.mac.encode()) / \
                             LLDPDUTimeToLive(ttl=120) / \
                             LLDPDUSystemName(system_name=self.name.encode()) / \
                             LLDPDUSystemDescription(
                                 description=f"{self.vendor} {self.device_type}".encode()
                             ) / \
                             LLDPDUEndOfLLDPDU()
                
                self._sendp(lldp_frame, protocol="lldp", iface=self.interface, verbose=0)
                self.log("info", f"📡 LLDP advertisement sent to switch")
                
            except Exception as e:
                self.log("error", f"❌ LLDP error: {e}")
            
            time.sleep(30)
    
    def send_arp(self):
        """Send ARP requests (who-has gateway) — key for Prisma IoT MAC fingerprinting"""
        self.log("debug", "🔍 ARP thread started")

        # Wait for IP and gateway from DHCP before sending ARP
        wait = 0
        while (not self.ip or not self.gateway) and wait < 30:
            time.sleep(0.5)
            wait += 1

        if not self.ip or not self.gateway:
            self.log("warning", "⚠️ ARP skipped — no IP or gateway available")
            return
        
        while self.running:
            try:
                pkt = Ether(dst="ff:ff:ff:ff:ff:ff", src=self.mac) / \
                      ARP(op="who-has", 
                          pdst=self.gateway, 
                          hwsrc=self.mac, 
                          psrc=self.ip)
                
                self._sendp(pkt, protocol="arp", iface=self.interface, verbose=0)
                self.log("debug", f"📤 ARP request sent for gateway {self.gateway}")
                
            except Exception as e:
                self.log("error", f"❌ ARP error: {e}")
            
            time.sleep(self.traffic_interval)
    
    def send_http(self):
        """Send HTTP requests"""
        self.log("debug", "🌐 HTTP thread started")
        
        while self.running:
            try:
                pkt = IP(src=self.ip, dst=self.gateway) / \
                      TCP(dport=80, flags="S")
                
                self._send(pkt, protocol="http", verbose=0)
                self.log("debug", f"📤 HTTP SYN sent to {self.gateway}:80")
                
            except Exception as e:
                self.log("error", f"❌ HTTP error: {e}")
            
            time.sleep(self.traffic_interval)
    
    def send_mqtt(self):
        """Send MQTT publish packets"""
        self.log("debug", "💬 MQTT thread started")
        mqtt_broker = "192.168.207.150"
        
        while self.running:
            try:
                pkt = IP(src=self.ip, dst=mqtt_broker) / \
                      TCP(dport=1883, flags="S")
                
                self._send(pkt, protocol="mqtt", verbose=0)
                self.log("debug", f"📤 MQTT Connect sent to {mqtt_broker}:1883")
                time.sleep(5)
                
            except Exception as e:
                self.log("error", f"❌ MQTT error: {e}")
            
            time.sleep(self.traffic_interval)
    
    def send_rtsp(self):
        """Send RTSP requests"""
        self.log("debug", "🎥 RTSP thread started")
        
        while self.running:
            try:
                pkt = IP(src=self.ip, dst=self.gateway) / \
                      TCP(dport=554, flags="S")
                
                self._send(pkt, protocol="rtsp", verbose=0)
                self.log("debug", f"📤 RTSP SYN sent to {self.gateway}:554")
                
            except Exception as e:
                self.log("error", f"❌ RTSP error: {e}")
            
            time.sleep(self.traffic_interval)
    
    def send_mdns(self):
        """Send mDNS requests"""
        self.log("debug", "🔎 mDNS thread started")
        
        while self.running:
            try:
                pkt = IP(src=self.ip, dst="224.0.0.251") / \
                      UDP(sport=5353, dport=5353)
                
                self._send(pkt, protocol="mdns", verbose=0)
                self.log("debug", "📤 mDNS query sent")
                
            except Exception as e:
                self.log("error", f"❌ mDNS error: {e}")
            
            time.sleep(self.traffic_interval * 3)
    
    def send_cloud_traffic(self):
        """Send HTTPS traffic to vendor cloud servers"""
        self.log("debug", "☁️  Cloud traffic thread started")
        
        cloud_config = self.CLOUD_DESTINATIONS.get(self.vendor, {
            "servers": ["8.8.8.8"],
            "domains": []
        })
        
        servers = cloud_config.get("servers", [])
        
        while self.running:
            try:
                for server in servers:
                    pkt = IP(src=self.ip, dst=server) / \
                          TCP(dport=443, flags="S")
                    
                    self._send(pkt, protocol="cloud", verbose=0)
                    self.log("info", f"☁️ Cloud HTTPS sent to {server}:443")
                    time.sleep(2)
                    
                    pkt_http = IP(src=self.ip, dst=server) / \
                               TCP(dport=80, flags="S")
                    
                    self._send(pkt_http, protocol="cloud", verbose=0)
                    self.log("info", f"☁️ Cloud HTTP sent to {server}:80")
                    time.sleep(3)
                
            except Exception as e:
                self.log("error", f"❌ Cloud traffic error: {e}")
            
            time.sleep(self.traffic_interval * 2)
    
    def send_dns(self):
        """Send DNS queries to public resolvers"""
        self.log("debug", "🌐 DNS thread started")
        
        cloud_config = self.CLOUD_DESTINATIONS.get(self.vendor, {"domains": []})
        domains = cloud_config.get("domains", ["www.google.com"])
        dns_servers = self.PUBLIC_SERVICES["dns"]
        
        while self.running:
            try:
                for domain in domains:
                    for dns_server in dns_servers:
                        pkt = IP(src=self.ip, dst=dns_server) / \
                              UDP(sport=53000, dport=53) / \
                              DNS(rd=1, qd=DNSQR(qname=domain))
                        
                        self._send(pkt, protocol="dns", verbose=0)
                        self.log("info", f"🌐 DNS query sent: {domain} → {dns_server}")
                        time.sleep(1)
                
            except Exception as e:
                self.log("error", f"❌ DNS error: {e}")
            
            time.sleep(self.traffic_interval * 3)
    
    def send_ntp(self):
        """Send NTP time sync requests"""
        self.log("debug", "🕐 NTP thread started")
        ntp_servers = self.PUBLIC_SERVICES["ntp"]
        
        while self.running:
            try:
                for ntp_server in ntp_servers:
                    pkt = IP(src=self.ip, dst=ntp_server) / \
                          UDP(sport=123, dport=123)
                    
                    self._send(pkt, protocol="ntp", verbose=0)
                    self.log("info", f"🕐 NTP request sent to {ntp_server}")
                    time.sleep(2)
                
            except Exception as e:
                self.log("error", f"❌ NTP error: {e}")
            
            time.sleep(self.traffic_interval * 5)


class IoTEmulator:
    """Main emulator controller"""
    
    def __init__(self, config_file, interface="eth0", dhcp_mode="auto"):
        self.config_file = Path(config_file)
        self.interface_cli = interface
        self.interface = interface
        self.dhcp_mode = dhcp_mode
        self.devices = []
        self.threads = []
        
        if os.getuid() != 0:
            if sys.platform == 'darwin':
                logger.error("❌ Scapy requires root/sudo permissions on macOS to access /dev/bpf*")
                logger.error("💡 Try running: sudo chmod 666 /dev/bpf* OR run with sudo")
            else:
                logger.error("❌ Scapy requires root/sudo permissions! Run with sudo.")
            sys.exit(1)
            
        if conf.route is None:
            logger.error("⚠️  Scapy routing table is empty. Are you running as root?")
            sys.exit(1)
        
        logger.info("=" * 60)
        logger.info("🚀 IoT Emulator for Palo Alto SD-WAN/IoT Security Lab")
        logger.info(f"   DHCP Mode: {dhcp_mode.upper()}")
        if ENABLE_BAD_BEHAVIOR:
            logger.warning("⚠️  BAD BEHAVIOR MODE ENABLED (alert testing)")
        logger.info(f"   Features: DHCP Fingerprint, ARP, LLDP, HTTP, MQTT, RTSP, Cloud")
        logger.info(f"   Multi-Behavior + PAN Test Domains Support")
        logger.info("=" * 60)
    
    def load_config(self):
        """Load device configuration from JSON"""
        try:
            with open(self.config_file, 'r') as f:
                config = json.load(f)
            
            logger.info(f"✅ Loaded config from {self.config_file}")
            
            if self.interface:
                logger.info(f"📡 Current Interface: {self.interface}")
            
            network = config.get("network", {})
            self.gateway = network.get("gateway", None)  # None = will be set by DHCP
            
            if "interface" in network:
                logger.info(f"💡 Note: interface '{network.get('interface')}' was defined in JSON but is ignored in favor of CLI/Auto-detection.")
            
            for device_config in config.get("devices", []):
                device_config.setdefault("gateway", self.gateway)
                device = IoTDevice(device_config, interface=self.interface, dhcp_mode=self.dhcp_mode)
                self.devices.append(device)
            
            logger.info(f"✅ Loaded {len(self.devices)} devices")
            for device in self.devices:
                status = "✅ enabled" if device.enabled else "⏸️  disabled"
                protocols_str = ", ".join(device.protocols)
                bad_marker = ""
                if ENABLE_BAD_BEHAVIOR and device.bad_behavior:
                    bad_marker = f" 💀 BAD[{', '.join(device.behavior_types)}]"
                logger.info(f"   {device} - {status} [{protocols_str}]{bad_marker}")
            
        except FileNotFoundError:
            logger.error(f"❌ Config file not found: {self.config_file}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            logger.error(f"❌ Invalid JSON in config: {e}")
            sys.exit(1)
    
    def start_all(self):
        """Start all enabled devices"""
        logger.info("🚀 Starting all devices...")
        
        for device in self.devices:
            if device.enabled:
                device.start()
                time.sleep(0.5)
        
        logger.info(f"✅ All {len([d for d in self.devices if d.enabled])} devices started")
    
    def stop_all(self):
        """Stop all devices"""
        logger.info("⏹️  Stopping all devices...")
        
        for device in self.devices:
            device.stop()
        
        logger.info("✅ All devices stopped")
    
    def print_status(self):
        """Print current status"""
        print("\n" + "=" * 60)
        print(f"📊 IoT Emulator Status - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"   DHCP Mode: {self.dhcp_mode.upper()}")
        if ENABLE_BAD_BEHAVIOR:
            print("   ⚠️  BAD BEHAVIOR ENABLED")
        print("=" * 60)
        
        for device in self.devices:
            status = "🟢 RUNNING" if device.running else "🔴 STOPPED"
            protocols = ", ".join(device.protocols)
            bad_marker = ""
            if device.bad_behavior and device.stats.get("bad_behavior_active"):
                bad_marker = f" 💀[{', '.join(device.behavior_types)}]"
            print(f"{status} | {str(device):45} | {protocols}{bad_marker}")
        
        print("=" * 60 + "\n")
    
    def run(self, duration=None):
        """Run emulator"""
        try:
            self.load_config()
            self.start_all()
            
            if duration:
                logger.info(f"⏱️  Running for {duration} seconds...")
                time.sleep(duration)
                self.stop_all()
            else:
                logger.info("✅ Emulator running (Ctrl+C to stop)...")
                
                try:
                    while True:
                        time.sleep(60)
                        if DEBUG_MODE:
                            self.print_status()
                except KeyboardInterrupt:
                    logger.info("\n🛑 Interrupt received, stopping...")
                    self.stop_all()
        
        except KeyboardInterrupt:
            logger.info("\n🛑 Interrupt received, stopping...")
            self.stop_all()
        except Exception as e:
            logger.error(f"❌ Fatal error: {e}", exc_info=True)
            sys.exit(1)


def daemon_loop(interface: str, dhcp_mode: str = "auto"):
    """
    Daemon mode: read JSON commands from stdin, manage IoTDevice threads in-process.
    This is the single-process architecture used by Node.js iot-manager.ts.

    Commands (one JSON object per line on stdin):
      { "cmd": "start",    "device": { ...IoTDeviceConfig... } }
      { "cmd": "stop",     "device_id": "..." }
      { "cmd": "stop_all" }
      { "cmd": "status" }
    """
    import signal

    devices: dict = {}  # id -> IoTDevice

    def handle_sigterm(signum, frame):
        for dev in devices.values():
            dev.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sigterm)

    # Signal ready
    emit_json("daemon_ready", interface=interface, dhcp_mode=dhcp_mode)
    logger.info(f"📡 Daemon ready — interface={interface}, dhcp_mode={dhcp_mode}")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            emit_json("daemon_error", error=f"Invalid JSON command: {e}")
            continue

        action = cmd.get("cmd")

        if action == "start":
            cfg = cmd.get("device", {})
            device_id = cfg.get("id")
            if not device_id:
                emit_json("daemon_error", error="start command missing device.id")
                continue
            if device_id in devices:
                emit_json("daemon_error", device_id=device_id, error="Device already running")
                continue
            try:
                dev = IoTDevice(cfg, interface=interface, dhcp_mode=dhcp_mode)
                devices[device_id] = dev
                threading.Thread(target=dev.start, daemon=True, name=f"dev-{device_id}").start()
                logger.info(f"✅ Daemon started device: {device_id}")
            except Exception as e:
                emit_json("device:error", device_id=device_id, error=str(e))

        elif action == "stop":
            device_id = cmd.get("device_id")
            dev = devices.pop(device_id, None)
            if dev:
                dev.stop()
                logger.info(f"⏹️  Daemon stopped device: {device_id}")
            else:
                emit_json("daemon_error", device_id=device_id, error="Device not found")

        elif action == "stop_all":
            for dev in list(devices.values()):
                dev.stop()
            devices.clear()
            emit_json("daemon_stopped_all")
            logger.info("⏹️  Daemon stopped all devices")

        elif action == "status":
            status = {
                did: {
                    "running": d.running,
                    "ip": d.ip,
                    "gateway": d.gateway,
                    "mac": d.mac
                }
                for did, d in devices.items()
            }
            emit_json("daemon_status", devices=status)

        elif action == "enable_bad_behavior":
            global ENABLE_BAD_BEHAVIOR
            ENABLE_BAD_BEHAVIOR = True
            count = 0
            for dev in devices.values():
                if dev.bad_behavior and not dev.stats.get("bad_behavior_active"):
                    dev.stats["bad_behavior_active"] = True
                    threading.Thread(target=dev._bad_behavior_handler, daemon=True).start()
                    count += 1
            emit_json("bad_behavior_enabled", activated_count=count)
            logger.info(f"⚠️  Bad behavior ENABLED globally ({count} devices activated)")

        elif action == "disable_bad_behavior":
            ENABLE_BAD_BEHAVIOR = False
            for dev in devices.values():
                dev.stats["bad_behavior_active"] = False
                # bad behavior threads check self.stats["bad_behavior_active"] or ENABLE_BAD_BEHAVIOR
                # They will stop on next iteration naturally
            emit_json("bad_behavior_disabled")
            logger.info("✅ Bad behavior DISABLED globally")

        else:
            emit_json("daemon_error", error=f"Unknown command: {action}")


def main():
    parser = argparse.ArgumentParser(
        description="IoT Device Emulator for Palo Alto SD-WAN/IoT Security Lab",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
DHCP Modes:
  auto   - Accept any IP assigned by DHCP server (recommended)
  static - Request specific IP from JSON config (ip_start field)

Bad Behavior Mode (Multi-Behavior + PAN Test Domains Support):
  --enable-bad-behavior   Activate bad behavior for devices marked with "security": {"bad_behavior": true}
  
  Behavior types (set in JSON "behavior_type" - can be string or array):
    - dns_flood: Flood DNS with suspicious/random domains
    - port_scan: Scan common ports on gateway + internal IPs
    - beacon: Simulate C2 beacon (regular DNS/HTTP to same suspicious domain)
    - data_exfil: Simulate data exfiltration (large uploads to external IPs)
    - pan_test_domains: Use official PAN test domains (DNS Security + URL Filtering) - GUARANTEED DETECTION
    - random: Mix of all above (default)
    
  Multi-behavior example in JSON:
    "security": {
      "bad_behavior": true,
      "behavior_type": ["pan_test_domains", "beacon", "port_scan"]
    }

Examples:
  # Normal mode
  sudo python3 iot_emulator.py -i eth0 --dhcp-mode auto
  
  # PAN official test domains (guaranteed detection)
  sudo python3 iot_emulator.py -c pan_test.json -i eth0 --enable-bad-behavior
  
  # Single device with multiple bad behaviors including PAN tests
  sudo python3 iot_emulator.py --device-id pantest --mac 00:11:22:33:99:99 \\
    --protocols dhcp,dns -i eth0 --enable-bad-behavior \\
    --security '{"bad_behavior":true,"behavior_type":["pan_test_domains","beacon"]}'
        """
    )
    parser.add_argument(
        "-c", "--config",
        default="iot_devices.json",
        help="Path to device configuration file (default: iot_devices.json)"
    )
    parser.add_argument(
        "-i", "--interface",
        default="eth0",
        help="Network interface to use (default: eth0)"
    )
    parser.add_argument(
        "--dhcp-mode",
        choices=["auto", "static"],
        default="auto",
        help="DHCP mode: 'auto' to accept server-assigned IPs, 'static' to request specific IPs from config (default: auto)"
    )
    parser.add_argument(
        "-d", "--duration",
        type=int,
        help="Run duration in seconds (default: infinite)"
    )
    parser.add_argument(
        "-s", "--status",
        action="store_true",
        help="Print status and exit"
    )
    
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Enable JSON output for Node.js IPC"
    )
    
    parser.add_argument(
        "--enable-bad-behavior",
        action="store_true",
        help="Enable bad behavior for devices marked with security.bad_behavior=true"
    )
    
    # Single device mode arguments
    parser.add_argument("--device-id", help="Run in single device mode with this ID")
    parser.add_argument("--device-name", help="Device name for single device mode")
    parser.add_argument("--vendor", help="Vendor name for single device mode")
    parser.add_argument("--device-type", help="Device type for single device mode")
    parser.add_argument("--mac", help="MAC address for single device mode")
    parser.add_argument("--ip-static", help="Static IP to request in single device mode")
    parser.add_argument("--protocols", help="Comma-separated protocols for single device mode")
    parser.add_argument("--traffic-interval", type=int, default=60, help="Traffic interval in seconds")
    parser.add_argument("--gateway", default=None, help="Gateway IP (default: auto from DHCP)")
    parser.add_argument("--fingerprint", type=str, help="JSON-encoded DHCP fingerprint for single device mode")
    parser.add_argument("--security", type=str, help="JSON-encoded security config for single device mode")

    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run in daemon mode: read JSON commands from stdin, manage all devices in-process (1 process for N devices)"
    )

    args = parser.parse_args()
    
    global JSON_OUTPUT, ENABLE_BAD_BEHAVIOR
    JSON_OUTPUT = args.json_output
    ENABLE_BAD_BEHAVIOR = args.enable_bad_behavior

    if args.daemon:
        # Single-process daemon mode — used by iot-manager.ts
        daemon_loop(interface=args.interface, dhcp_mode=args.dhcp_mode)

    if args.device_id:
        # Single device mode
        config = {
            "id": args.device_id,
            "name": args.device_name or args.device_id,
            "vendor": args.vendor or "Generic",
            "type": args.device_type or "IoT Device",
            "mac": args.mac or "00:00:00:00:00:00",
            "ip_start": args.ip_static,
            "protocols": args.protocols.split(',') if args.protocols else ["dhcp", "arp", "http"],
            "enabled": True,
            "traffic_interval": args.traffic_interval,
            "gateway": args.gateway
        }
        
        if args.fingerprint:
            try:
                config["fingerprint"] = json.loads(args.fingerprint)
                logger.info(f"✅ Loaded fingerprint from CLI for device {args.device_id}")
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Failed to parse --fingerprint JSON: {e}. Continuing without fingerprint.")
        
        if args.security:
            try:
                config["security"] = json.loads(args.security)
                logger.info(f"✅ Loaded security config from CLI for device {args.device_id}")
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Failed to parse --security JSON: {e}. Continuing without security config.")
        
        device = IoTDevice(config, interface=args.interface, dhcp_mode=args.dhcp_mode)
        
        import signal
        def handle_sigterm(signum, frame):
            device.stop()
            sys.exit(0)
        signal.signal(signal.SIGTERM, handle_sigterm)
        
        try:
            device.start()
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            device.stop()
    else:
        # Multi-device mode
        emulator = IoTEmulator(args.config, interface=args.interface, dhcp_mode=args.dhcp_mode)
        
        if args.status:
            emulator.load_config()
            emulator.print_status()
        else:
            emulator.run(duration=args.duration)


if __name__ == "__main__":
    main()
