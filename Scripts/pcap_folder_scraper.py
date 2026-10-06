#!/usr/bin/env python3
"""
Stigix PCAP Folder Scraper & Extraction Diagnostic Engine
Recursively scans a local directory for .pcap, .pcapng, and .zip files,
analyzes L7 replay suitability, flags extraction anomalies/edge-cases,
and generates structured diagnostic packages to improve the parser.

Usage:
  # Standard scan & diagnostic summary
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps

  # Full diagnostic mode with edge-case detection & telemetry dump
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps --diagnose --diag-out ./pcap-diagnostics

  # Automatically generate .stx-replay profiles for clean captures
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps --generate --out-dir ./profiles --scrub
"""

import sys
import os
import argparse
import json
import zipfile
import tempfile
import shutil
import re
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Common well-known ports to default App-ID hints
WELL_KNOWN_APPS = {
    80: "web-browsing",
    443: "ssl",
    21: "ftp",
    22: "ssh",
    23: "telnet",
    25: "smtp",
    53: "dns",
    110: "pop3",
    143: "imap",
    389: "ldap",
    636: "ldaps",
    502: "modbus",
    104: "dicom",
    3306: "mysql",
    5432: "postgresql",
    1433: "ms-sql-db",
    1521: "oracle",
    3200: "sap",
    3300: "sap",
    3600: "sap",
    8080: "web-browsing",
    8443: "ssl",
    1883: "mqtt",
    8883: "mqtt-over-ssl",
    47808: "bacnet",
}


def _load_engine():
    """Dynamically load pcap_parser functions."""
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    engines_dir = project_root / "engines"
    if str(engines_dir) not in sys.path:
        sys.path.insert(0, str(engines_dir))

    try:
        import pcap_parser
        return pcap_parser
    except ImportError as e:
        print(f"Error: Required dependency missing ({e}).", file=sys.stderr)
        print("Please ensure scapy is installed: pip3 install scapy", file=sys.stderr)
        sys.exit(1)


import base64

def guess_app_id(flows: List[Dict[str, Any]], primary_flow_id: Optional[int] = None) -> str:
    """
    Guess App-ID based on L7 payload signatures first (HTTP, TLS, SSH, etc.),
    falling back to server port heuristics.
    """
    if not flows:
        return "custom-app"

    # Prioritize primary candidate flow if provided
    ordered_flows = flows
    if primary_flow_id is not None:
        target = [f for f in flows if f.get("flow_id") == primary_flow_id]
        others = [f for f in flows if f.get("flow_id") != primary_flow_id]
        ordered_flows = target + others

    # 1. First pass: Inspect actual L7 payload signatures across turns
    for f in ordered_flows:
        if f.get("is_noise"):
            continue
        turns = f.get("turns") or f.get("_turns") or []
        for t in turns:
            p_b64 = t.get("payload_b64")
            if not p_b64:
                continue
            try:
                raw = base64.b64decode(p_b64)[:64]
                # HTTP signatures (web-browsing)
                if any(raw.startswith(verb) for verb in [b"GET ", b"POST ", b"HEAD ", b"PUT ", b"DELETE ", b"OPTIONS ", b"HTTP/1.", b"HTTP/2."]):
                    return "web-browsing"
                # TLS / SSL ClientHello / ServerHello handshake
                if len(raw) >= 3 and raw[0] == 0x16 and raw[1] == 0x03 and raw[2] in (0x00, 0x01, 0x02, 0x03):
                    return "ssl"
                # SSH handshake
                if raw.startswith(b"SSH-"):
                    return "ssh"
                # SMTP / FTP / Telnet greeting
                if raw.startswith(b"220 ") or raw.startswith(b"HELO ") or raw.startswith(b"EHLO "):
                    port = f.get("server_port")
                    return "smtp" if port == 25 else "ftp" if port == 21 else "web-browsing"
            except Exception:
                pass

    # 2. Second pass: Fallback to well-known port mapping
    for f in ordered_flows:
        if f.get("is_noise"):
            continue
        port = f.get("server_port")
        if port in WELL_KNOWN_APPS:
            return WELL_KNOWN_APPS[port]

    return "custom-app"


def detect_flow_anomalies(flow: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    Analyzes a flow for extraction edge-cases, gaps, and potential replay hurdles.
    Returns a list of structured anomaly objects with suggested improvements.
    """
    anomalies = []
    turns = flow.get("turns", []) or flow.get("_turns", [])
    turns_count = flow.get("turns_count", len(turns))
    payload_bytes = flow.get("payload_bytes", 0)
    server_port = flow.get("server_port")

    # 1. Incomplete Handshake / Mid-stream capture
    if not flow.get("syn_seen", True):
        anomalies.append({
            "type": "MID_STREAM_START",
            "severity": "MEDIUM",
            "detail": "Capture started mid-session (No initial TCP SYN observed). Direction of client/server inferred from first packet.",
            "recommendation": "Check if first turn sender was properly identified or if roles need manual inversion."
        })

    # 2. Unidirectional Traffic (Half-duplex / Missing Responses)
    if turns_count == 1:
        anomalies.append({
            "type": "UNIDIRECTIONAL_FLOW",
            "severity": "LOW",
            "detail": f"Flow only contains 1 turn ({payload_bytes} bytes). Missing response or one-way beacon.",
            "recommendation": "Verify if server response was dropped by capture filter or if client is push-only UDP/syslog."
        })

    # 3. High Turn Count (Potential conversational chatty protocol)
    if turns_count > 30:
        anomalies.append({
            "type": "CHATTY_PROTOCOL",
            "severity": "INFO",
            "detail": f"Flow contains {turns_count} distinct turns. Long interactive session (e.g. database cursor or terminal).",
            "recommendation": "Review turn timing delays to avoid replay timeouts."
        })

    # 4. Zero Payload / Pure Control probes
    if payload_bytes == 0:
        anomalies.append({
            "type": "ZERO_L7_PAYLOAD",
            "severity": "HIGH",
            "detail": "TCP connection completed 3-way handshake but exchanged 0 bytes of L7 application data.",
            "recommendation": "Exclude from L7 replay profiles (pure port-scan or health-check probe)."
        })

    # 5. Large initial delay
    if turns and len(turns) > 1:
        max_delay = max((t.get("delay_ms", 0) for t in turns), default=0)
        if max_delay > 10000:
            anomalies.append({
                "type": "LONG_TURN_PAUSE",
                "severity": "MEDIUM",
                "detail": f"Contains an inter-turn delay of {max_delay / 1000.0:.1f}s.",
                "recommendation": "Cap max turn delay during replay to prevent test timeouts."
            })

    # 6. Hardcoded IP Detection in Payload
    # Inspect raw previews for embedded IPv4 addresses (like FTP PORT commands or SIP headers)
    for t in turns:
        prev = str(t.get("preview", ""))
        ips_found = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', prev)
        if ips_found:
            anomalies.append({
                "type": "HARDCODED_IP_IN_PAYLOAD",
                "severity": "HIGH",
                "detail": f"Payload turn #{t.get('seq')} contains embedded IP address: {', '.join(set(ips_found))}",
                "recommendation": "Target server may reject replay if IP does not match the test interface IP."
            })
            break

    return anomalies


def evaluate_replay_suitability(inspection: Dict[str, Any]) -> Tuple[str, str, List[int], List[Dict[str, Any]]]:
    """
    Evaluates whether a capture is suitable for stateful L7 replay,
    and aggregates extraction anomalies across all flows.
    """
    flows = inspection.get("flows", [])
    if not flows:
        return "UNSUITABLE", "No TCP/UDP flows detected", [], []

    unicast_flows = [f for f in flows if not f.get("is_noise")]
    if not unicast_flows:
        return "UNSUITABLE", "All flows are broadcast/multicast background noise", [], []

    valid_candidate_flows = []
    total_turns = 0
    total_payload = 0
    all_anomalies = []

    for f in unicast_flows:
        turns = f.get("turns_count", 0)
        payload = f.get("payload_bytes", 0)
        flow_anomalies = detect_flow_anomalies(f)
        if flow_anomalies:
            all_anomalies.append({
                "flow_id": f["flow_id"],
                "protocol": f.get("transport", "tcp"),
                "endpoints": f"{f.get('client_ip')}:{f.get('client_port')} -> {f.get('server_ip')}:{f.get('server_port')}",
                "anomalies": flow_anomalies
            })

        if turns > 0 and payload > 0:
            valid_candidate_flows.append(f["flow_id"])
            total_turns += turns
            total_payload += payload

    if not valid_candidate_flows:
        return "UNSUITABLE", "No L7 application payload in unicast flows", [], all_anomalies

    has_bidirectional = any(f.get("turns_count", 0) >= 2 for f in unicast_flows if f["flow_id"] in valid_candidate_flows)
    
    if has_bidirectional and total_payload > 100:
        return "EXCELLENT", f"Clean bidirectional L7 ({len(valid_candidate_flows)} flow(s), {total_turns} turns, {total_payload:,} B)", valid_candidate_flows, all_anomalies
    elif len(valid_candidate_flows) > 0 and total_payload > 0:
        return "GOOD", f"Valid L7 replay flow ({len(valid_candidate_flows)} flow(s), {total_turns} turns, {total_payload:,} B)", valid_candidate_flows, all_anomalies

    return "PARTIAL", "Unidirectional or minimal payload", valid_candidate_flows, all_anomalies


def scan_directory(dir_path: str, recursive: bool = True) -> List[Path]:
    """Find all .pcap, .pcapng, .cap, and .zip files in the directory."""
    supported_exts = {".pcap", ".pcapng", ".cap", ".dmp", ".zip"}
    base = Path(dir_path)
    if not base.exists():
        raise FileNotFoundError(f"Directory not found: {dir_path}")

    files = []
    pattern = "**/*" if recursive else "*"
    for p in base.glob(pattern):
        if p.is_file() and p.suffix.lower() in supported_exts:
            files.append(p)
    return sorted(files)


def process_single_file(engine, file_path: Path, scrub: bool = False, password: Optional[str] = None) -> Dict[str, Any]:
    """Run inspection and return evaluation results with deep extraction telemetry."""
    res: Dict[str, Any] = {
        "path": str(file_path),
        "name": file_path.name,
        "size_bytes": file_path.stat().st_size,
        "is_zip": file_path.suffix.lower() == ".zip",
        "status": "pending",
        "suitability": "UNKNOWN",
        "reason": "",
        "candidate_flow_ids": [],
        "flows_count": 0,
        "unicast_flows": 0,
        "suggested_app_id": "custom",
        "suggested_port": None,
        "sensitive_warnings": [],
        "anomalies": [],
        "inspection": None,
    }
    MAX_PCAP_SIZE = 100 * 1024 * 1024  # 100 MB Limit
    if res["size_bytes"] > MAX_PCAP_SIZE:
        res["status"] = "error"
        res["suitability"] = "TOO_LARGE"
        res["error"] = f"File size ({res['size_bytes'] / (1024*1024):.1f} MB) exceeds 100MB maximum limit."
        res["reason"] = "Exceeds 100MB safety limit"
        res["anomalies"] = [{
            "flow_id": 0,
            "protocol": "ALL",
            "endpoints": "N/A",
            "anomalies": [{
                "type": "OVERSIZED_CAPTURE",
                "severity": "HIGH",
                "detail": f"File size is {res['size_bytes'] / (1024*1024):.1f} MB. Captures over 100MB risk memory exhaustion and network transfer timeouts.",
                "recommendation": "Filter out bulky streams (e.g. video, downloads) or truncate packet payload length in Wireshark."
            }]
        }]
        return res

    try:
        inspection = engine.inspect_pcap(str(file_path), scrub=scrub, password=password)
        res["inspection"] = inspection
        res["flows_count"] = inspection.get("total_active_flows", 0)
        res["unicast_flows"] = inspection.get("unicast_flows_count", 0)
        
        rating, reason, candidate_flow_ids, anomalies = evaluate_replay_suitability(inspection)
        res["suitability"] = rating
        res["reason"] = reason
        res["candidate_flow_ids"] = candidate_flow_ids
        res["anomalies"] = anomalies
        primary_flow_id = candidate_flow_ids[0] if candidate_flow_ids else None
        res["suggested_app_id"] = guess_app_id(inspection.get("flows", []), primary_flow_id=primary_flow_id)
        
        for f in inspection.get("flows", []):
            if f["flow_id"] in candidate_flow_ids and f.get("server_port"):
                res["suggested_port"] = f["server_port"]
                break

        warnings = []
        for f in inspection.get("flows", []):
            if f.get("warnings"):
                warnings.extend(f["warnings"])
        res["sensitive_warnings"] = list(set(warnings))
        res["status"] = "success"

    except Exception as e:
        res["status"] = "error"
        res["suitability"] = "ERROR"
        res["error"] = str(e)

    return res


def print_terminal_summary(results: List[Dict[str, Any]], base_dir: str, show_anomalies: bool = False):
    """Print a rich terminal summary table with optional anomaly drilldown."""
    print("=" * 120)
    print(f"📁 STIGIX PCAP FOLDER & EXTRACTION DIAGNOSTIC: {base_dir}")
    print(f"📦 Total Files Scanned: {len(results)}")
    print("=" * 120)

    suitability_badges = {
        "EXCELLENT": "🟢 EXCELLENT",
        "GOOD": "🔵 GOOD     ",
        "PARTIAL": "🟡 PARTIAL  ",
        "UNSUITABLE": "🔴 NO REPLAY",
        "TOO_LARGE": "⛔ > 100 MB   ",
        "ERROR": "❌ ERROR    "
    }

    print(f"{'#':<3} {'File Name':<30} {'Size':<9} {'Suitability':<13} {'Flows':<7} {'App-ID':<12} {'Port':<6} {'Anomalies':<10} {'Diagnostics'}")
    print("-" * 120)

    ready_count = 0
    total_anomalies = 0

    for idx, r in enumerate(results, 1):
        badge = suitability_badges.get(r["suitability"], r["suitability"])
        size_str = f"{r['size_bytes'] / 1024:.1f} KB" if r['size_bytes'] < 1024 * 1024 else f"{r['size_bytes'] / (1024*1024):.1f} MB"
        flows_str = f"{r['unicast_flows']}/{r['flows_count']}"
        port_str = str(r['suggested_port']) if r.get('suggested_port') else "-"
        app_str = r.get("suggested_app_id", "-")
        diag = r.get("reason", "") if r["status"] == "success" else f"Err: {r.get('error', '')}"
        
        anom_count = len(r.get("anomalies", []))
        total_anomalies += anom_count
        anom_str = f"⚠️  {anom_count}" if anom_count > 0 else "✅ 0"

        if r["suitability"] in ("EXCELLENT", "GOOD"):
            ready_count += 1

        print(f"{idx:<3} {r['name'][:28]:<30} {size_str:<9} {badge:<13} {flows_str:<7} {app_str:<12} {port_str:<6} {anom_str:<10} {diag[:30]}")

    print("-" * 120)
    print(f"🎯 Profiles Ready for Generation: {ready_count} / {len(results)} files | 🔍 Extraction Edge-Cases Detected: {total_anomalies}")
    print("=" * 120)

    # Anomaly drilldown section if requested or in diagnose mode
    if show_anomalies and total_anomalies > 0:
        print("\n" + "=" * 120)
        print("🔍 EXTRACTION EDGE-CASES & PARSER IMPROVEMENT RECOMMENDATIONS")
        print("=" * 120)
        for r in results:
            if not r.get("anomalies"):
                continue
            print(f"\n📦 Capture: {r['name']} ({r['path']})")
            for flow_anom in r["anomalies"]:
                print(f"  ├─ Flow #{flow_anom['flow_id']} ({flow_anom['protocol'].upper()}: {flow_anom['endpoints']}):")
                for a in flow_anom["anomalies"]:
                    sev_icon = "🔴" if a["severity"] == "HIGH" else ("🟡" if a["severity"] == "MEDIUM" else "ℹ️")
                    print(f"  │  {sev_icon} [{a['type']}] {a['detail']}")
                    print(f"  │     👉 Fix / Recommendation: {a['recommendation']}")
        print("=" * 120)


def export_diagnostic_package(results: List[Dict[str, Any]], diag_dir: str):
    """
    Exports clean JSON diagnostic telemetry for each file and an aggregated
    anomalies report. This allows AI assistants and developers to easily inspect
    edge-cases and patch the parser engine.
    """
    out_path = Path(diag_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    telemetry_list = []
    for r in results:
        t = dict(r)
        # Keep clean flows summary for lightness
        if t.get("inspection") and t["inspection"].get("flows"):
            clean_flows = []
            for f in t["inspection"]["flows"]:
                cf = dict(f)
                cf.pop("_turns", None)
                clean_flows.append(cf)
            t["flows_summary"] = clean_flows
        t.pop("inspection", None)
        telemetry_list.append(t)

    report_file = out_path / "extraction_diagnostic_report.json"
    with open(report_file, "w", encoding="utf-8") as fp:
        json.dump({
            "timestamp": str(os.path.getmtime(str(report_file)) if report_file.exists() else ""),
            "total_files": len(results),
            "files_with_anomalies": sum(1 for r in results if r.get("anomalies")),
            "telemetry": telemetry_list
        }, fp, indent=2)

    print(f"\n📊 Detailed Extraction Diagnostic Report saved to: {report_file.resolve()}")


def generate_profiles(engine, results: List[Dict[str, Any]], out_dir: str, scrub: bool = True) -> List[str]:
    """Compile and save .stx-replay profiles for all eligible captures."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    generated_files = []

    print(f"\n🚀 Compiling .stx-replay profiles to: {out_path.resolve()} ...")

    for r in results:
        if r["suitability"] not in ("EXCELLENT", "GOOD") or not r.get("inspection"):
            continue

        base_name = Path(r["name"]).stem
        safe_name = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in base_name)
        profile_filename = f"{safe_name}.stx-replay"
        output_file = out_path / profile_filename

        try:
            profile = engine.compile_stx_profile(
                r["inspection"],
                selected_flow_ids=r["candidate_flow_ids"],
                profile_name=base_name.replace("_", " ").title(),
                category="custom",
                expected_app_id=r.get("suggested_app_id"),
                target_port=r.get("suggested_port")
            )
            out_size, ratio = engine.save_stx_profile(profile, str(output_file))
            print(f"  ✅ {profile_filename:<35} → {out_size:,} B ({ratio:.1f}% ratio) | App: {r.get('suggested_app_id')}")
            generated_files.append(str(output_file))
        except Exception as e:
            print(f"  ❌ Failed compiling {r['name']}: {e}", file=sys.stderr)

    print(f"\n✨ Successfully generated {len(generated_files)} .stx-replay profile(s).\n")
    return generated_files


def main():
    parser = argparse.ArgumentParser(
        description="Stigix PCAP Folder Scraper & Extraction Diagnostic Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan a directory and show replay suitability table
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps

  # Full diagnostic mode: show extraction anomalies & parser recommendations
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps --diagnose

  # Export structured diagnostic telemetry to JSON for parser improvement
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps --diagnose --diag-out ./pcap-diagnostics

  # Compile all eligible captures into .stx-replay files
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps --generate --out-dir ./stigix_profiles --scrub
"""
    )
    parser.add_argument("folder", help="Path to folder containing .pcap, .pcapng, or .zip files")
    parser.add_argument("--diagnose", action="store_true", help="Perform deep extraction edge-case analysis & show fix recommendations")
    parser.add_argument("--diag-out", help="Directory to export structured diagnostic JSON telemetry package")
    parser.add_argument("--generate", action="store_true", help="Automatically generate .stx-replay profiles for eligible PCAPs")
    parser.add_argument("--out-dir", "-o", default="./pcap-profiles", help="Output directory for generated .stx-replay profiles (default: ./pcap-profiles)")
    parser.add_argument("--scrub", action="store_true", help="Sanitize credentials, bearer tokens, and secrets during generation")
    parser.add_argument("--password", "-p", help="Decryption password for password-protected .zip archives")
    parser.add_argument("--no-recursive", action="store_true", help="Do not search subdirectories recursively")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    try:
        files = scan_directory(args.folder, recursive=not args.no_recursive)
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if not files:
        if args.json:
            print(json.dumps({"files": [], "message": "No capture files (.pcap, .pcapng, .zip) found."}))
        else:
            print(f"No capture files found in '{args.folder}'.")
        return

    # Load parsing engine
    engine = _load_engine()

    results = []
    for f in files:
        res = process_single_file(engine, f, scrub=args.scrub, password=args.password)
        results.append(res)

    if args.json:
        clean_results = []
        for r in results:
            cr = dict(r)
            cr.pop("inspection", None)
            clean_results.append(cr)
        print(json.dumps({"folder": args.folder, "total_files": len(results), "results": clean_results}, indent=2))
    else:
        print_terminal_summary(results, args.folder, show_anomalies=args.diagnose)

    if args.diag_out:
        export_diagnostic_package(results, args.diag_out)

    if args.generate:
        generate_profiles(engine, results, args.out_dir, scrub=args.scrub)


if __name__ == "__main__":
    main()
