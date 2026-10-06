#!/usr/bin/env python3
"""
Stigix PCAP Folder Scraper & Batch Profile Generator
Recursively scans a local directory for .pcap, .pcapng, and .zip files,
analyzes their L7 replay suitability, and automatically compiles .stx-replay profiles.

Usage:
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps --generate --out-dir ./profiles --scrub
  python3 Scripts/pcap_folder_scraper.py /path/to/pcaps --json
"""

import sys
import os
import argparse
import json
import zipfile
import tempfile
import shutil
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
        print("Please ensure scapy is installed in your python environment: pip3 install scapy", file=sys.stderr)
        sys.exit(1)


def guess_app_id(flows: List[Dict[str, Any]]) -> str:
    """Guess App-ID based on server port and payload signatures."""
    for f in flows:
        if f.get("is_noise"):
            continue
        port = f.get("server_port")
        if port in WELL_KNOWN_APPS:
            return WELL_KNOWN_APPS[port]
    return "custom-app"


def evaluate_replay_suitability(inspection: Dict[str, Any]) -> Tuple[str, str, List[int]]:
    """
    Evaluates whether a capture is suitable for stateful L7 replay.
    Returns (Rating, Reason, Candidate_Flow_IDs).
    Ratings: EXCELLENT, GOOD, PARTIAL, UNSUITABLE
    """
    flows = inspection.get("flows", [])
    if not flows:
        return "UNSUITABLE", "No TCP/UDP flows detected", []

    unicast_flows = [f for f in flows if not f.get("is_noise")]
    if not unicast_flows:
        return "UNSUITABLE", "All flows are broadcast/multicast background noise", []

    valid_candidate_flows = []
    total_turns = 0
    total_payload = 0

    for f in unicast_flows:
        turns = f.get("turns_count", 0)
        payload = f.get("payload_bytes", 0)
        if turns > 0 and payload > 0:
            valid_candidate_flows.append(f["flow_id"])
            total_turns += turns
            total_payload += payload

    if not valid_candidate_flows:
        return "UNSUITABLE", "No L7 application payload or turns in unicast flows", []

    has_bidirectional = any(f.get("turns_count", 0) >= 2 for f in unicast_flows if f["flow_id"] in valid_candidate_flows)
    
    if has_bidirectional and total_payload > 100:
        return "EXCELLENT", f"Clean bidirectional L7 ({len(valid_candidate_flows)} flow(s), {total_turns} turns, {total_payload:,} B)", valid_candidate_flows
    elif len(valid_candidate_flows) > 0 and total_payload > 0:
        return "GOOD", f"Valid L7 replay flow ({len(valid_candidate_flows)} flow(s), {total_turns} turns, {total_payload:,} B)", valid_candidate_flows

    return "PARTIAL", "Unidirectional or minimal payload", valid_candidate_flows


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
    """Run inspection and return evaluation results for a single file."""
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
        "inspection": None,
        "error": None
    }

    try:
        inspection = engine.inspect_pcap(str(file_path), scrub=scrub, password=password)
        res["inspection"] = inspection
        res["flows_count"] = inspection.get("total_active_flows", 0)
        res["unicast_flows"] = inspection.get("unicast_flows_count", 0)
        
        rating, reason, candidate_flow_ids = evaluate_replay_suitability(inspection)
        res["suitability"] = rating
        res["reason"] = reason
        res["candidate_flow_ids"] = candidate_flow_ids
        res["suggested_app_id"] = guess_app_id(inspection.get("flows", []))
        
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


def print_terminal_summary(results: List[Dict[str, Any]], base_dir: str):
    """Print a rich terminal summary table."""
    print("=" * 115)
    print(f"📁 STIGIX PCAP FOLDER ANALYSIS: {base_dir}")
    print(f"📦 Total Files Scanned: {len(results)}")
    print("=" * 115)

    suitability_badges = {
        "EXCELLENT": "🟢 EXCELLENT",
        "GOOD": "🔵 GOOD     ",
        "PARTIAL": "🟡 PARTIAL  ",
        "UNSUITABLE": "🔴 NO REPLAY",
        "ERROR": "❌ ERROR    "
    }

    print(f"{'#':<3} {'File Name':<32} {'Size':<10} {'Suitability':<13} {'Flows':<7} {'App-ID':<14} {'Port':<6} {'Replay Diagnostics'}")
    print("-" * 115)

    ready_count = 0
    for idx, r in enumerate(results, 1):
        badge = suitability_badges.get(r["suitability"], r["suitability"])
        size_str = f"{r['size_bytes'] / 1024:.1f} KB" if r['size_bytes'] < 1024 * 1024 else f"{r['size_bytes'] / (1024*1024):.1f} MB"
        flows_str = f"{r['unicast_flows']}/{r['flows_count']}"
        port_str = str(r['suggested_port']) if r.get('suggested_port') else "-"
        app_str = r.get("suggested_app_id", "-")
        diag = r.get("reason", "") if r["status"] == "success" else f"Err: {r.get('error', '')}"

        if r["suitability"] in ("EXCELLENT", "GOOD"):
            ready_count += 1

        print(f"{idx:<3} {r['name'][:30]:<32} {size_str:<10} {badge:<13} {flows_str:<7} {app_str:<14} {port_str:<6} {diag[:30]}")

    print("-" * 115)
    print(f"🎯 Profiles Ready for Generation: {ready_count} / {len(results)} files")
    print("=" * 115)


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
        description="Stigix PCAP Folder Scraper & Batch Profile Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan a directory and display replay suitability table
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps

  # Scan and compile all eligible captures into .stx-replay files
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps --generate --out-dir ./stigix_profiles --scrub

  # Output JSON report for integration
  python3 Scripts/pcap_folder_scraper.py /home/user/my_pcaps --json
"""
    )
    parser.add_argument("folder", help="Path to folder containing .pcap, .pcapng, or .zip files")
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
        print_terminal_summary(results, args.folder)

    if args.generate:
        generate_profiles(engine, results, args.out_dir, scrub=args.scrub)


if __name__ == "__main__":
    main()
