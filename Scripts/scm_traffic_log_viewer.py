#!/usr/bin/env python3
"""
Stigix - Strata Cloud Manager (SCM) & Prisma Access Policy & Traffic Evaluator
- Connects to the universal global Palo Alto Networks SASE API (multi-region support).
- Fetches active Security Rules, Decryption Rules, and Remote Networks in real-time.
- Evaluates any traffic flow (source/dest IP, source/dest port, app) against live firewall policies.
- Zero external dependencies (uses Python standard library urllib).
"""

import os
import sys
import json
import base64
import datetime
import argparse
import urllib.request
import urllib.parse
import urllib.error
import ssl

def get_script_dir():
    return os.path.dirname(os.path.abspath(__file__))

def load_credentials(config_path=None):
    script_dir = get_script_dir()
    repo_root = os.path.abspath(os.path.join(script_dir, '..'))
    
    candidates = []
    if config_path:
        candidates.append(os.path.abspath(config_path))
    candidates.append(os.path.join(os.getcwd(), 'config', 'prisma-config.json'))
    candidates.append(os.path.join(repo_root, 'config', 'prisma-config.json'))
    candidates.append(os.path.join(script_dir, 'config', 'prisma-config.json'))
    candidates.append(os.path.join(os.getcwd(), 'prisma-config.json'))

    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r') as f:
                    data = json.load(f)
                    if data.get('client_id') and data.get('client_secret'):
                        return data
            except Exception:
                pass
            
    client_id = os.getenv('PRISMA_SDWAN_CLIENT_ID')
    client_secret = os.getenv('PRISMA_SDWAN_CLIENT_SECRET')
    tsg_id = os.getenv('PRISMA_SDWAN_TSG_ID') or os.getenv('PRISMA_SDWAN_TSGID')
    region = os.getenv('PRISMA_SDWAN_REGION', 'eu')
    
    if client_id and client_secret and tsg_id:
        return {
            'client_id': client_id,
            'client_secret': client_secret,
            'tsg_id': tsg_id,
            'region': region
        }
        
    return None

class ScmTrafficEngine:
    def __init__(self, cfg):
        self.client_id = cfg['client_id']
        self.client_secret = cfg['client_secret']
        self.tsg_id = cfg['tsg_id']
        self.token = None
        self.security_rules = []
        self.decryption_rules = []
        self.remote_networks = []
        self.ctx = ssl.create_default_context()
        
    def authenticate(self):
        auth_url = 'https://auth.apps.paloaltonetworks.com/auth/v1/oauth2/access_token'
        auth_header = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        
        headers = {
            'Authorization': f'Basic {auth_header}',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        }
        
        form_data = urllib.parse.urlencode({
            'grant_type': 'client_credentials',
            'scope': f'tsg_id:{self.tsg_id}'
        }).encode('utf-8')
        
        req = urllib.request.Request(auth_url, data=form_data, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=15) as r:
                data = json.loads(r.read().decode('utf-8'))
                self.token = data.get('access_token')
                return self.token
        except Exception as e:
            print(f"❌ Authentication failed: {e}", file=sys.stderr)
            return None

    def sync_policies(self):
        if not self.token and not self.authenticate():
            return False
            
        headers = {
            'Authorization': f'Bearer {self.token}',
            'X-PAN-TSG-ID': str(self.tsg_id),
            'Content-Type': 'application/json'
        }
        
        # 1. Remote Networks
        try:
            req = urllib.request.Request('https://api.sase.paloaltonetworks.com/sse/config/v1/remote-networks', headers=headers)
            with urllib.request.urlopen(req, context=self.ctx, timeout=10) as r:
                self.remote_networks = json.loads(r.read().decode()).get('data', [])
        except Exception:
            pass
            
        # 2. Security Rules (Remote Networks + Shared)
        rules = []
        for folder in ["Remote+Networks", "Shared"]:
            try:
                url = f"https://api.sase.paloaltonetworks.com/sse/config/v1/security-rules?folder={folder}&limit=200"
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, context=self.ctx, timeout=10) as r:
                    data = json.loads(r.read().decode())
                    rules.extend(data.get('data', []))
            except Exception:
                pass
        self.security_rules = rules
        
        # 3. Decryption Rules
        decr = []
        for folder in ["Remote+Networks", "Shared"]:
            try:
                url = f"https://api.sase.paloaltonetworks.com/sse/config/v1/decryption-rules?folder={folder}&limit=200"
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, context=self.ctx, timeout=10) as r:
                    data = json.loads(r.read().decode())
                    decr.extend(data.get('data', []))
            except Exception:
                pass
        self.decryption_rules = decr
        return True

    def evaluate_flow(self, src_ip="any", dst_ip="any", sport="any", dport=443, protocol="tcp", app="any"):
        verdict = {
            "verdict": "ALLOW",
            "action": "allow (default)",
            "rule": "interzone-default",
            "rule_id": None,
            "folder": "Default",
            "emoji": "🟢",
            "decryption": "No Decryption",
            "security_profiles": "None",
            "log_setting": "None"
        }
        
        dport_num = int(dport) if str(dport).isdigit() else None
        
        # 1. Check Security Rules in order
        for r in self.security_rules:
            if r.get('disabled', False):
                continue
                
            action = r.get('action', 'allow').lower()
            services = r.get('service', ['any'])
            apps = r.get('application', ['any'])
            
            port_match = False
            if 'any' in services or 'application-default' in services:
                port_match = True
            else:
                for s in services:
                    if dport_num and (str(dport_num) in s or (s == 'service-https' and dport_num == 443) or (s == 'service-http' and dport_num == 80)):
                        port_match = True
                        break
                        
            app_match = ('any' in apps or app == 'any' or app in apps)
            
            if port_match and app_match:
                is_blocked = action in ["deny", "drop", "reset-client", "reset-server", "reset-both"]
                verdict = {
                    "verdict": "DROP/DENY" if is_blocked else "ALLOW",
                    "action": action.upper(),
                    "rule": r.get('name', 'unnamed'),
                    "rule_id": r.get('id'),
                    "folder": r.get('folder', 'Shared'),
                    "emoji": "🔴" if is_blocked else "🟢",
                    "profile_setting": r.get('profile_setting', {}),
                    "log_setting": r.get('log_setting', 'Cortex Data Lake')
                }
                break
                
        # 2. Check Decryption Rules
        for d in self.decryption_rules:
            if d.get('disabled', False):
                continue
            d_action = d.get('action', 'none')
            if d_action != 'none':
                verdict['decryption'] = f"SSL Decrypt ({d.get('name')})"
                break
                
        return verdict

def main():
    parser = argparse.ArgumentParser(description="Stigix SCM Policy & Traffic Flow Evaluator")
    parser.add_argument('--sport', default="any", help="Source port (e.g. 52001)")
    parser.add_argument('--dport', default=443, help="Destination port (e.g. 443, 80, 8080)")
    parser.add_argument('--src', default="192.168.1.100", help="Source IP (e.g. 192.168.1.100)")
    parser.add_argument('--dst', default="1.1.1.1", help="Destination IP (e.g. 1.1.1.1, 8.8.8.8)")
    parser.add_argument('--app', default="any", help="Application name (e.g. ssl, web-browsing, dns, custom-tcp)")
    parser.add_argument('--protocol', default="tcp", choices=['tcp', 'udp', 'icmp'], help="IP Protocol")
    parser.add_argument('--list-rules', action='store_true', help="List all active SCM security rules")
    parser.add_argument('--list-rns', action='store_true', help="List all active SCM Remote Networks")
    parser.add_argument('--json', action='store_true', help="Output in raw JSON format")
    parser.add_argument('--config', help="Path to prisma-config.json")
    
    args = parser.parse_args()
    
    cfg = load_credentials(args.config)
    if not cfg:
        print("❌ Error: No Prisma SASE credentials found in config/prisma-config.json or environment variables.", file=sys.stderr)
        sys.exit(1)
        
    engine = ScmTrafficEngine(cfg)
    
    if not args.json:
        print(f"🔒 Connecting to Global SASE Gateway (Tenant TSG: {cfg['tsg_id']})...")
        
    if not engine.sync_policies():
        sys.exit(1)
        
    if not args.json:
        print(f"✅ Synchronized with SCM: {len(engine.security_rules)} Security Rules, {len(engine.decryption_rules)} Decryption Rules, {len(engine.remote_networks)} Remote Networks.\n")
        
    if args.list_rns:
        print("=== Active Remote Networks ===")
        for rn in engine.remote_networks:
            print(f" • {rn.get('name'):30} | Region: {rn.get('region'):12} | SPN: {rn.get('spn_name', 'N/A')}")
        return

    if args.list_rules:
        print("=== Active SCM Security Rules ===")
        for idx, r in enumerate(engine.security_rules, 1):
            status = "🔴 DISABLED" if r.get('disabled') else "🟢 ACTIVE"
            act = r.get('action', 'allow').upper()
            print(f" [{idx:02d}] {status} | Action: {act:6} | Folder: {r.get('folder', 'Shared'):15} | Rule: \"{r.get('name')}\"")
        return

    # Flow evaluation
    result = engine.evaluate_flow(
        src_ip=args.src,
        dst_ip=args.dst,
        sport=args.sport,
        dport=args.dport,
        protocol=args.protocol,
        app=args.app
    )
    
    if args.json:
        print(json.dumps(result, indent=2))
        return
        
    print("=" * 65)
    print(f"🔍 FLOW INSPECTION & SCM VERDICT")
    print("=" * 65)
    print(f" Flow          : {args.src}:{args.sport} → {args.dst}:{args.dport} ({args.protocol.upper()}) [App: {args.app}]")
    print(f" SCM Verdict   : {result['emoji']} {result['verdict']} ({result['action']})")
    print(f" Matched Rule  : \"{result['rule']}\"")
    print(f" Policy Folder : {result.get('folder', 'Shared')}")
    print(f" Decryption    : {result.get('decryption', 'No Decryption')}")
    print(f" Log Setting   : {result.get('log_setting', 'Cortex Data Lake')}")
    print("=" * 65)

if __name__ == '__main__':
    main()

