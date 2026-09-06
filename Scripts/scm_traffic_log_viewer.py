#!/usr/bin/env python3
"""
Stigix - SCM & Prisma Access Traffic Log Viewer
Queries Strata Cloud Manager / Cortex Data Lake (CDL) Log Viewer APIs in real time.
Allows filtering by time window, source port, destination port, IPs, and verdict (Allow/Deny/Drop).
"""

import os
import sys
import json
import base64
import datetime
import argparse
import requests

def load_credentials(config_path=None):
    # 1. Try specified config file
    if config_path and os.path.exists(config_path):
        with open(config_path, 'r') as f:
            return json.load(f)
            
    # 2. Try default Stigix config
    default_cfg = 'config/prisma-config.json'
    if os.path.exists(default_cfg):
        with open(default_cfg, 'r') as f:
            return json.load(f)
            
    # 3. Try Environment Variables
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

def get_oauth_token(client_id, client_secret, tsg_id):
    auth_url = 'https://auth.apps.paloaltonetworks.com/auth/v1/oauth2/access_token'
    auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    
    try:
        resp = requests.post(
            auth_url,
            headers={
                'Authorization': f'Basic {auth_header}',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            data={
                'grant_type': 'client_credentials',
                'scope': f'tsg_id:{tsg_id}'
            },
            timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get('access_token')
        else:
            print(f"❌ OAuth Authentication failed (HTTP {resp.status_code}): {resp.text}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"❌ Authentication exception: {e}", file=sys.stderr)
        return None

def query_scm_logs(token, tsg_id, sport=None, dport=None, src_ip=None, dst_ip=None, action=None, minutes=5, log_type="cdlFirewallTraffic", limit=50):
    now = datetime.datetime.now(datetime.timezone.utc)
    start = now - datetime.timedelta(minutes=minutes)
    
    start_str = start.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_str = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    
    # Build filter conditions
    children = []
    
    if dport:
        children.append({
            "type": "CONDITION",
            "field": "dport",
            "operator": "EQUALS",
            "value": str(dport)
        })
    if sport:
        children.append({
            "type": "CONDITION",
            "field": "sport",
            "operator": "EQUALS",
            "value": str(sport)
        })
    if src_ip:
        children.append({
            "type": "CONDITION",
            "field": "src",
            "operator": "EQUALS",
            "value": str(src_ip)
        })
    if dst_ip:
        children.append({
            "type": "CONDITION",
            "field": "dst",
            "operator": "EQUALS",
            "value": str(dst_ip)
        })
    if action:
        # e.g., 'deny', 'drop', 'allow'
        children.append({
            "type": "CONDITION",
            "field": "action",
            "operator": "EQUALS",
            "value": str(action).lower()
        })
        
    where_clause = {}
    if len(children) == 1:
        where_clause = {"children": children}
    elif len(children) > 1:
        where_clause = {"type": "AND", "children": children}
        
    payload = {
        "resource_meta": {
            "CDL_TENANT_ID": str(tsg_id),
            "START_TIME": start_str,
            "END_TIME": end_str,
            "TIME_ZONE": "UTC"
        },
        "query": {
            "WHERE_CLAUSE": where_clause
        } if where_clause else {}
    }
    
    url = f"https://api.prod.reporting.paloaltonetworks.com/reporting/queryFast/v1/{log_type}"
    
    headers = {
        'Authorization': f'Bearer {token}',
        'X-Tenant-Id': str(tsg_id),
        'x-tsg-id': str(tsg_id),
        'Content-Type': 'application/json'
    }
    
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        return resp.status_code, resp.text, payload
    except Exception as e:
        return 0, str(e), payload

def main():
    parser = argparse.ArgumentParser(description="Query SCM & Prisma Access Traffic Logs via Log Viewer API")
    parser.add_argument('--sport', help="Filter by source port (e.g. 52001)")
    parser.add_argument('--dport', help="Filter by destination port (e.g. 443)")
    parser.add_argument('--src', help="Filter by source IP")
    parser.add_argument('--dst', help="Filter by destination IP")
    parser.add_argument('--action', choices=['allow', 'deny', 'drop', 'reset-server', 'reset-client'], help="Filter by firewall action")
    parser.add_argument('--minutes', type=int, default=5, help="Time window in minutes (default: 5)")
    parser.add_argument('--type', choices=['traffic', 'threat', 'decryption'], default='traffic', help="Log type")
    parser.add_argument('--config', help="Path to prisma-config.json")
    parser.add_argument('--json', action='store_true', help="Output raw JSON response")
    
    args = parser.parse_args()
    
    log_type_map = {
        'traffic': 'cdlFirewallTraffic',
        'threat': 'cdlFirewallThreat',
        'decryption': 'cdlFirewallDecryption'
    }
    log_type_endpoint = log_type_map.get(args.type, 'cdlFirewallTraffic')
    
    cfg = load_credentials(args.config)
    if not cfg:
        print("❌ Error: No Prisma SASE credentials found in config/prisma-config.json or environment variables.", file=sys.stderr)
        sys.exit(1)
        
    print(f"🔒 Authenticating for Tenant TSG ID: {cfg['tsg_id']}...")
    token = get_oauth_token(cfg['client_id'], cfg['client_secret'], cfg['tsg_id'])
    if not token:
        sys.exit(1)
        
    filters_desc = []
    if args.sport: filters_desc.append(f"sport={args.sport}")
    if args.dport: filters_desc.append(f"dport={args.dport}")
    if args.src: filters_desc.append(f"src={args.src}")
    if args.dst: filters_desc.append(f"dst={args.dst}")
    if args.action: filters_desc.append(f"action={args.action}")
    filters_str = ", ".join(filters_desc) if filters_desc else "All traffic"
    
    print(f"🔍 Querying {log_type_endpoint} for past {args.minutes} minutes [{filters_str}]...")
    
    status_code, body, payload = query_scm_logs(
        token, 
        cfg['tsg_id'],
        sport=args.sport,
        dport=args.dport,
        src_ip=args.src,
        dst_ip=args.dst,
        action=args.action,
        minutes=args.minutes,
        log_type=log_type_endpoint
    )
    
    if args.json:
        print(body)
        return
        
    if status_code == 200:
        try:
            data = json.loads(body)
            rows = data.get('data', []) or data.get('rows', []) or data.get('items', [])
            print(f"\n✅ Query successful! Found {len(rows)} matching log record(s).\n")
            
            if not rows:
                print("ℹ️  No traffic matching the filters in this time window.")
                return
                
            for idx, r in enumerate(rows, 1):
                timestamp = r.get('receive_time') or r.get('time_generated') or r.get('start_time') or 'N/A'
                src = f"{r.get('src')}:{r.get('sport')}"
                dst = f"{r.get('dst')}:{r.get('dport')}"
                app = r.get('app') or r.get('application') or 'unknown'
                act = r.get('action') or 'unknown'
                rule = r.get('rule') or r.get('rule_uuid') or 'unknown'
                
                status_emoji = "🟢" if act.lower() == "allow" else "🔴"
                print(f"{status_emoji} [{idx:02d}] {timestamp} | {src:21} → {dst:21} | App: {app:12} | Action: {act.upper():6} | Rule: {rule}")
        except Exception:
            print("Response:", body)
    elif status_code == 401 and "logging_service" in body:
        print(f"\n⚠️  API Endpoint Connected (HTTP {status_code}), but missing Logging Service Role in SCM:")
        print(f"   {body}")
        print("\n💡 To enable Log Viewer querying:")
        print(f"   1. Log in to Strata Cloud Manager (SCM) -> Settings -> Service Accounts")
        print(f"   2. Edit Service Account '{cfg['client_id']}'")
        print(f"   3. Under Roles, ensure 'Strata Logging Service' / 'Log Viewer' / 'Prisma Access Log Viewer' role is assigned.")
    else:
        print(f"\n❌ API Response HTTP {status_code}:")
        print(f"   {body}")

if __name__ == '__main__':
    main()
