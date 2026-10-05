#!/usr/bin/env python3
"""
Stigix PCAP Zip Archive Benchmark & Malware Extractor Validator

Batch analyzes PCAP files stored inside zip archives (including nested zip
structures like EXPLOIT KITS and MALWARE.zip, CRIME.zip, GENERAL.zip).
Validates the stateful extraction engine (pcap_parser.py), L7 turn reassembly,
noise classification, and .stx-replay compilation without writing permanent
uncompressed PCAP or malware binaries to disk.

Usage:
  python3 engines/benchmark_pcap_zip.py --zip "pcap samples/EXPLOIT KITS and MALWARE.zip" --limit 10
  python3 engines/benchmark_pcap_zip.py --all --limit 5
  python3 engines/benchmark_pcap_zip.py --zip "pcap samples/CRIME.zip" --filter "blaster"
  python3 engines/benchmark_pcap_zip.py --zip "pcap samples/EXPLOIT KITS and MALWARE.zip" --export-dir /tmp/stigix_profiles
"""

import sys
import os
import io
import time
import zipfile
import tempfile
import argparse
import traceback
import json
import re
from typing import Dict, List, Any, Optional, Tuple

# Ensure engines directory is in path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

try:
    from pcap_parser import inspect_pcap, compile_stx_profile, save_stx_profile
except ImportError as e:
    print(f"Error importing pcap_parser: {e}", file=sys.stderr)
    print("Ensure scapy is installed in engines/.venv or current python environment.", file=sys.stderr)
    sys.exit(1)


# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def format_bytes(n: int) -> str:
    """Format byte size into human readable string."""
    if n < 1024:
        return f"{n} B"
    elif n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    elif n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.2f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def detect_payload_threats(flows: List[Dict[str, Any]]) -> List[str]:
    """Inspect flow payloads for signatures of malware, exploits, and beacons."""
    threat_indicators = set()
    for flow in flows:
        turns = flow.get("_turns", [])
        for turn in turns:
            payload_b64 = turn.get("payload_b64", "")
            raw = b""
            if payload_b64:
                try:
                    import base64
                    raw = base64.b64decode(payload_b64)
                except Exception:
                    pass
            if not raw:
                preview = turn.get("ascii_preview") or turn.get("preview") or ""
                raw = preview.encode("utf-8", errors="ignore")

            if not raw:
                continue

            # Signatures
            if b"MZ" in raw[:2] or b"PE\x00\x00" in raw[:1024]:
                threat_indicators.add("PE/Executable Binary")
            if b"\x90\x90\x90\x90" in raw or b"\xcc\xcc\xcc\xcc" in raw:
                threat_indicators.add("NOP Sled / Shellcode")
            if b"cmd.exe" in raw.lower() or b"/bin/sh" in raw or b"powershell" in raw.lower():
                threat_indicators.add("Shell Execution Command")
            if re.search(rb"(POST|GET) .*\.(exe|dll|scr|jar|php|jsp)\b", raw, re.IGNORECASE):
                threat_indicators.add("Exploit Payload Drop (HTTP)")
            if b"<script" in raw.lower() and (b"unescape(" in raw.lower() or b"eval(" in raw.lower()):
                threat_indicators.add("Obfuscated JS Exploit Kit")
            if b"SMB" in raw[:16] or b"\xffSMB" in raw[:16]:
                threat_indicators.add("SMB / MS-RPC Network Attack")
    return sorted(list(threat_indicators))


class PcapZipExtractor:
    """Discovers, unpacks, and benchmarks PCAPs from zip archives."""

    def __init__(self, zip_path: str, filter_regex: Optional[str] = None, export_dir: Optional[str] = None):
        self.zip_path = os.path.abspath(zip_path)
        self.filter_regex = re.compile(filter_regex, re.IGNORECASE) if filter_regex else None
        self.export_dir = os.path.abspath(export_dir) if export_dir else None
        if self.export_dir:
            os.makedirs(self.export_dir, exist_ok=True)

    def discover_pcaps(self) -> List[Tuple[str, Optional[str]]]:
        """
        Discovers all PCAP files. Returns tuples of:
        (outer_item_name, inner_pcap_name_or_none)
        """
        if not os.path.isfile(self.zip_path):
            raise FileNotFoundError(f"Archive not found: {self.zip_path}")

        pcaps_found = []
        with zipfile.ZipFile(self.zip_path, 'r') as outer_zip:
            for item in outer_zip.namelist():
                # Direct PCAP file in outer zip
                if item.lower().endswith(('.pcap', '.pcapng', '.cap')):
                    if self.filter_regex and not self.filter_regex.search(item):
                        continue
                    pcaps_found.append((item, None))
                # Nested zip file
                elif item.lower().endswith(('.zip', '.zip')):
                    if self.filter_regex and not self.filter_regex.search(item):
                        # Still check inner names if outer name doesn't match
                        pass
                    try:
                        data = outer_zip.read(item)
                        with zipfile.ZipFile(io.BytesIO(data), 'r') as inner_zip:
                            for inner_item in inner_zip.namelist():
                                if inner_item.lower().endswith(('.pcap', '.pcapng', '.cap')):
                                    if self.filter_regex:
                                        if not (self.filter_regex.search(item) or self.filter_regex.search(inner_item)):
                                            continue
                                    pcaps_found.append((item, inner_item))
                    except Exception:
                        continue
        return pcaps_found

    def benchmark_sample(self, outer_item: str, inner_item: Optional[str], tmpdir: str) -> Dict[str, Any]:
        """Extracts and benchmarks a single PCAP sample."""
        sample_title = inner_item if inner_item else outer_item
        short_title = os.path.basename(sample_title)

        start_time = time.time()
        record: Dict[str, Any] = {
            "title": short_title,
            "outer": outer_item,
            "inner": inner_item,
            "status": "PASS",
            "error": None,
            "packets": 0,
            "duration_sec": 0.0,
            "total_flows": 0,
            "unicast_flows": 0,
            "noise_flows": 0,
            "total_turns": 0,
            "total_payload_bytes": 0,
            "compressed_profile_bytes": 0,
            "elapsed_ms": 0.0,
            "threats": [],
            "protocols": []
        }

        # 1. Extract bytes to temp file with malware password recovery
        pcap_temp_path = os.path.join(tmpdir, "sample.pcap")
        pcap_bytes = None
        COMMON_PASSWORDS = [None, b"infected", b"virus", b"password", b"malware", b"clean", b"infected!"]

        try:
            with zipfile.ZipFile(self.zip_path, 'r') as outer_zip:
                if inner_item:
                    outer_data = outer_zip.read(outer_item)
                    with zipfile.ZipFile(io.BytesIO(outer_data), 'r') as inner_zip:
                        for pwd in COMMON_PASSWORDS:
                            try:
                                pcap_bytes = inner_zip.read(inner_item, pwd=pwd)
                                break
                            except RuntimeError:
                                continue
                        if pcap_bytes is None:
                            record["status"] = "SKIP"
                            record["warning_note"] = "Encrypted PCAP (Password required)"
                            return record
                else:
                    for pwd in COMMON_PASSWORDS:
                        try:
                            pcap_bytes = outer_zip.read(outer_item, pwd=pwd)
                            break
                        except RuntimeError:
                            continue
                    if pcap_bytes is None:
                        record["status"] = "SKIP"
                        record["warning_note"] = "Encrypted PCAP (Password required)"
                        return record

            with open(pcap_temp_path, "wb") as pf:
                pf.write(pcap_bytes)

        except Exception as e:
            record["status"] = "SKIP"
            record["warning_note"] = f"Archive read error: {str(e)}"
            return record

        # 2. Inspect with pcap_parser
        try:
            inspection = inspect_pcap(pcap_temp_path, scrub=False)
            record["packets"] = inspection.get("packet_count", 0)
            record["duration_sec"] = inspection.get("duration_seconds", 0.0)
            record["total_flows"] = inspection.get("total_active_flows", 0)
            record["unicast_flows"] = inspection.get("unicast_flows_count", 0)
            record["noise_flows"] = inspection.get("noise_flows_count", 0)

            flows = inspection.get("flows", [])
            protocols = set()
            total_turns = 0
            total_payload = 0
            for f in flows:
                protocols.add(f.get("transport", "tcp").upper())
                total_turns += f.get("turns_count", 0)
                total_payload += f.get("payload_bytes", 0)

            record["protocols"] = sorted(list(protocols))
            record["total_turns"] = total_turns
            record["total_payload_bytes"] = total_payload
            record["threats"] = detect_payload_threats(flows)

            # 3. Test compilation into .stx-replay profile (if L7 flows exist)
            if record["total_flows"] == 0:
                record["status"] = "WARN"
                record["warning_note"] = "Recon / Port Scan (0 L7 flows)"
            else:
                clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', os.path.splitext(short_title)[0])
                category = "EXPLOIT" if any("malware" in s.lower() or "ek" in s.lower() for s in [outer_item, inner_item or ""]) else "CRIME"
                profile = compile_stx_profile(inspection, profile_name=clean_name, category=category)
                
                # 4. Save and measure compression
                profile_temp_path = os.path.join(tmpdir, f"{clean_name}.stx-replay")
                saved_size, ratio = save_stx_profile(profile, profile_temp_path)
                record["compressed_profile_bytes"] = saved_size

                # Optional: export profile
                if self.export_dir:
                    dest_path = os.path.join(self.export_dir, f"{clean_name}.stx-replay")
                    with open(profile_temp_path, "rb") as sf, open(dest_path, "wb") as df:
                        df.write(sf.read())
                    record["exported_to"] = dest_path

        except Exception as e:
            record["status"] = "FAIL"
            record["error"] = str(e)
            record["stack"] = traceback.format_exc()

        finally:
            if os.path.exists(pcap_temp_path):
                try:
                    os.unlink(pcap_temp_path)
                except Exception:
                    pass

        record["elapsed_ms"] = round((time.time() - start_time) * 1000, 2)
        return record


def run_benchmark(zip_path: str, limit: int = 10, filter_regex: Optional[str] = None,
                  export_dir: Optional[str] = None, json_output: bool = False) -> Dict[str, Any]:
    """Runs batch extraction benchmark on specified zip archive."""
    archive_name = os.path.basename(zip_path)
    if not json_output:
        print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════════{RESET}")
        print(f"{BOLD}{CYAN} 🛡️  STIGIX PCAP EXTRACTOR BENCHMARK — {archive_name}{RESET}")
        print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════════{RESET}")
        print(f"📦 Archive Path:   {zip_path}")
        print(f"🎯 Target Samples: {limit if limit > 0 else 'All Available'}")
        if filter_regex:
            print(f"🔍 Name Filter:    {filter_regex}")
        if export_dir:
            print(f"💾 Profile Export: {export_dir}")
        print(f"⚡ Memory Guard:   Active (0 permanent PCAPs written to disk)\n")

    extractor = PcapZipExtractor(zip_path, filter_regex=filter_regex, export_dir=export_dir)
    discovered = extractor.discover_pcaps()
    total_found = len(discovered)

    if not json_output:
        print(f"🔎 Discovered {BOLD}{total_found}{RESET} PCAP captures inside archive.")

    if total_found == 0:
        return {"error": "No PCAP files found matching filter in archive", "total_found": 0}

    targets = discovered[:limit] if limit > 0 else discovered
    results = []

    total_packets = 0
    total_turns = 0
    total_payload = 0
    total_compressed = 0
    pass_count = 0
    warn_count = 0
    skip_count = 0
    fail_count = 0
    threats_detected_total = set()

    col_fmt = "{:<4} {:<42} {:<6} {:>7} {:>6} {:>6} {:>9} {:>8} {:<18}"
    if not json_output:
        print("-" * 110)
        print(col_fmt.format("#", "Capture Name", "Status", "Packets", "Flows", "Turns", "Payload", "Time", "Threat Detection"))
        print("-" * 110)

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, (outer, inner) in enumerate(targets, 1):
            record = extractor.benchmark_sample(outer, inner, tmpdir)
            results.append(record)

            status = record["status"]
            if status == "PASS":
                pass_count += 1
                status_color = f"{GREEN}PASS{RESET}"
            elif status == "WARN":
                warn_count += 1
                status_color = f"{YELLOW}WARN{RESET}"
            elif status == "SKIP":
                skip_count += 1
                status_color = f"{DIM}SKIP{RESET}"
            else:
                fail_count += 1
                status_color = f"{RED}FAIL{RESET}"

            total_packets += record["packets"]
            total_turns += record["total_turns"]
            total_payload += record["total_payload_bytes"]
            total_compressed += record["compressed_profile_bytes"]
            for t in record["threats"]:
                threats_detected_total.add(t)

            if not json_output:
                threat_summary = ", ".join(record["threats"][:1]) if record["threats"] else (record.get("warning_note") or "Clean / Benign")
                if len(record["threats"]) > 1:
                    threat_summary += f" (+{len(record['threats'])-1})"
                
                name_disp = record["title"]
                if len(name_disp) > 40:
                    name_disp = name_disp[:37] + "..."

                print(col_fmt.format(
                    idx,
                    name_disp,
                    status_color,
                    f"{record['packets']:,}",
                    f"{record['total_flows']}",
                    f"{record['total_turns']:,}",
                    format_bytes(record['total_payload_bytes']),
                    f"{record['elapsed_ms']}ms",
                    threat_summary[:22]
                ))

                if record["error"]:
                    print(f"     {RED}↳ Error: {record['error']}{RESET}")

    summary = {
        "archive": archive_name,
        "total_discovered": total_found,
        "total_tested": len(targets),
        "passed": pass_count,
        "warnings": warn_count,
        "skipped": skip_count,
        "failed": fail_count,
        "success_rate_pct": round(((pass_count + warn_count) / (len(targets) - skip_count)) * 100, 1) if (len(targets) - skip_count) > 0 else 0.0,
        "total_packets_parsed": total_packets,
        "total_turns_reassembled": total_turns,
        "total_payload_bytes": total_payload,
        "total_compressed_profile_bytes": total_compressed,
        "compression_ratio": round((total_compressed / total_payload) * 100, 2) if total_payload > 0 else 0.0,
        "threat_signatures_identified": sorted(list(threats_detected_total)),
        "samples": results
    }

    if not json_output:
        print("-" * 110)
        print(f"\n{BOLD}📊 EXTRACTOR BENCHMARK SUMMARY:{RESET}")
        print(f"  • Total Tested:      {BOLD}{len(targets)}{RESET} PCAPs (Discovered {total_found})")
        print(f"  • Success Rate:      {GREEN if fail_count == 0 else RED}{summary['success_rate_pct']}%{RESET} ({pass_count} Passed, {warn_count} Warnings, {skip_count} Skipped, {fail_count} Failed)")
        print(f"  • Total Packets:     {BOLD}{total_packets:,}{RESET} packets streamed & classified")
        print(f"  • Stateful Turns:    {BOLD}{total_turns:,}{RESET} application turns reassembled")
        print(f"  • Reassembled Data:  {BOLD}{format_bytes(total_payload)}{RESET} (Compiled Profile: {format_bytes(total_compressed)})")
        if threats_detected_total:
            print(f"  • Malware/Threats:   {MAGENTA}{', '.join(sorted(list(threats_detected_total)))}{RESET}")
        print()

    return summary


def main():
    parser = argparse.ArgumentParser(description="Stigix PCAP Zip Benchmark & Exploit Extractor Validator")
    parser.add_argument("--zip", help="Path to a specific zip archive (e.g. 'pcap samples/EXPLOIT KITS and MALWARE.zip')")
    parser.add_argument("--all", action="store_true", help="Run benchmark across all detected default zip archives in 'pcap samples/'")
    parser.add_argument("--limit", type=int, default=10, help="Max number of PCAPs to benchmark per archive (default: 10, set 0 for all)")
    parser.add_argument("--filter", help="Regex filter on PCAP sample names (e.g. 'Rig-EK|Nuclear|blaster')")
    parser.add_argument("--export-dir", help="Directory to export compiled .stx-replay profiles")
    parser.add_argument("--json", action="store_true", help="Output summary in JSON format")

    args = parser.parse_args()

    default_archives = [
        "pcap samples/EXPLOIT KITS and MALWARE.zip",
        "pcap samples/CRIME.zip",
        "pcap samples/GENERAL.zip"
    ]

    target_archives = []
    if args.zip:
        target_archives.append(args.zip)
    elif args.all:
        for a in default_archives:
            p = os.path.join(os.getcwd(), a)
            if os.path.isfile(p):
                target_archives.append(p)
    else:
        # Default: pick first available archive
        for a in default_archives:
            p = os.path.join(os.getcwd(), a)
            if os.path.isfile(p):
                target_archives.append(p)
                break

    if not target_archives:
        print(f"{RED}Error: No zip archive specified or found in 'pcap samples/'. Provide --zip <path>{RESET}", file=sys.stderr)
        sys.exit(1)

    all_summaries = []
    for archive in target_archives:
        summary = run_benchmark(
            archive,
            limit=args.limit,
            filter_regex=args.filter,
            export_dir=args.export_dir,
            json_output=args.json
        )
        all_summaries.append(summary)

    if args.json:
        print(json.dumps(all_summaries if len(all_summaries) > 1 else all_summaries[0], indent=2))


if __name__ == "__main__":
    main()
