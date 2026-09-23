#!/usr/bin/env python3
"""
Report Generator — Produces JSON + Markdown scorecard from MCP contract test results.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List


MOCK_MODES = ["http_404", "http_500", "empty_body", "non_json", "spa_html_200", "slow", "down"]

STATUS_OK = "OK"
STATUS_DEGRADED = "DEGRADED"
STATUS_KO = "KO"


def _mode_short(mode: str) -> str:
    return {
        "http_404": "404",
        "http_500": "500",
        "empty_body": "empty",
        "non_json": "nonjson",
        "spa_html_200": "spa",
        "slow": "slow",
        "down": "down",
    }.get(mode, mode)


def compute_tool_status(results_by_mode: Dict[str, Dict]) -> str:
    """
    Compute tool status from per-mode results.
    OK: all modes pass. DEGRADED: only slow/down fail. KO: any non-timeout failure.
    """
    failures = {mode for mode, r in results_by_mode.items() if not r.get("pass", False)}
    if not failures:
        return STATUS_OK
    timeout_modes = {"slow", "down"}
    if failures <= timeout_modes:
        return STATUS_DEGRADED
    return STATUS_KO


def generate_reports(
    all_results: List[Dict[str, Any]],
    output_dir: str,
) -> tuple:
    """
    Generate JSON report and Markdown scorecard.

    all_results: list of dicts with keys:
        tool_name, category, mock_mode, pass, checks (list of check results),
        elapsed_ms, size_bytes, error_message (if any)
    """
    os.makedirs(output_dir, exist_ok=True)

    # Group by tool
    by_tool: Dict[str, Dict[str, Dict]] = {}
    for r in all_results:
        tool = r["tool_name"]
        mode = r["mock_mode"]
        by_tool.setdefault(tool, {})[mode] = r

    # Build per-tool summary
    tool_summaries = []
    ko_tools = []
    counts = {STATUS_OK: 0, STATUS_DEGRADED: 0, STATUS_KO: 0}

    for tool_name in sorted(by_tool.keys()):
        modes = by_tool[tool_name]
        status = compute_tool_status(modes)
        counts[status] += 1

        max_time = max((m.get("elapsed_ms", 0) for m in modes.values()), default=0)
        max_size = max((m.get("size_bytes", 0) for m in modes.values()), default=0)

        summary = {
            "tool": tool_name,
            "category": next(iter(modes.values()), {}).get("category", "?"),
            "status": status,
            "max_elapsed_ms": round(max_time, 1),
            "max_size_kb": round(max_size / 1024, 2),
            "modes": {},
        }
        for mode in MOCK_MODES:
            mr = modes.get(mode)
            if mr:
                failing = [c["check"] for c in mr.get("checks", []) if not c.get("pass")]
                summary["modes"][mode] = {
                    "pass": mr.get("pass", False),
                    "elapsed_ms": round(mr.get("elapsed_ms", 0), 1),
                    "failing_checks": failing,
                }
            else:
                summary["modes"][mode] = {"pass": None, "skipped": True}

        tool_summaries.append(summary)
        if status == STATUS_KO:
            failing_modes = [m for m, r in modes.items() if not r.get("pass", False)]
            ko_tools.append({"tool": tool_name, "failing_modes": failing_modes})

    # JSON report
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": counts,
        "ko_tools": ko_tools,
        "tools": tool_summaries,
    }
    json_path = os.path.join(output_dir, "mcp_contract_report.json")
    with open(json_path, "w") as f:
        json.dump(report, f, indent=2)

    # Markdown scorecard
    md_path = os.path.join(output_dir, "mcp_contract_scorecard.md")
    with open(md_path, "w") as f:
        ts = report["generated_at"]
        f.write(f"# MCP Error Contract Scorecard — {ts}\n\n")

        f.write("## Summary\n\n")
        f.write("| Status | Count |\n|--------|-------|\n")
        f.write(f"| ✅ OK | {counts[STATUS_OK]} |\n")
        f.write(f"| ⚠️ DEGRADED | {counts[STATUS_DEGRADED]} |\n")
        f.write(f"| ❌ KO | {counts[STATUS_KO]} |\n\n")

        if ko_tools:
            f.write("### KO Tools — Reproduce Commands\n\n")
            for kt in ko_tools:
                modes_str = " or ".join(kt["failing_modes"])
                f.write(f"- **{kt['tool']}**: `pytest tests/test_mcp_error_contract.py -k \"{kt['tool']}\"`\n")
            f.write("\n")

        f.write("## Detail\n\n")
        headers = ["Tool", "Cat"] + [_mode_short(m) for m in MOCK_MODES] + ["Time(ms)", "Size(KB)"]
        f.write("| " + " | ".join(headers) + " |\n")
        f.write("|" + "|".join(["---"] * len(headers)) + "|\n")

        for ts_ in tool_summaries:
            icon = {"OK": "✅", "DEGRADED": "⚠️", "KO": "❌"}.get(ts_["status"], "?")
            row = [f"{icon} {ts_['tool']}", ts_["category"][:4]]
            for mode in MOCK_MODES:
                mr = ts_["modes"].get(mode, {})
                if mr.get("skipped"):
                    row.append("—")
                elif mr.get("pass"):
                    row.append("✅")
                else:
                    fails = mr.get("failing_checks", [])
                    row.append(f"❌{'(' + ','.join(fails[:2]) + ')' if fails else ''}")
            row.append(str(round(ts_["max_elapsed_ms"])))
            row.append(str(ts_["max_size_kb"]))
            f.write("| " + " | ".join(row) + " |\n")

    return json_path, md_path
