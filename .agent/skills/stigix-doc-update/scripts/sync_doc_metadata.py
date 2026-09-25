#!/usr/bin/env python3
"""
sync_doc_metadata.py - Stigix Documentation Header & Revision Table Manager

Usage:
  python3 sync_doc_metadata.py [--all] [--file docs/MY_DOC.md] [--add-revision "Description of change"]

Features:
  - Detects creation date & git tag at creation via git history
  - Detects last modified date
  - Updates / prepends top header: `> **Last Updated:** YYYY-MM-DD | **Created:** YYYY-MM-DD (vX.Y.Z)`
  - Appends or updates the `## 📜 Revision History` table at the end of the document
"""

import argparse
import glob
import os
import re
import subprocess
from datetime import datetime


def get_current_stigix_version():
    """Retrieve current version from git tags or version.txt/package.json."""
    res = subprocess.run(["git", "describe", "--tags", "--abbrev=0"], capture_output=True, text=True)
    if res.returncode == 0 and res.stdout.strip():
        return res.stdout.strip()
    return "v2.0.64"


def get_git_metadata(file_path):
    """Retrieve last commit date, first commit date, and tag at creation."""
    # Last commit date
    res_last = subprocess.run(["git", "log", "-1", "--format=%as", "--", file_path], capture_output=True, text=True)
    last_date = res_last.stdout.strip() or datetime.now().strftime("%Y-%m-%d")

    # First commit
    res_first = subprocess.run(["git", "log", "--follow", "--format=%as %H", "--", file_path], capture_output=True, text=True)
    commits = res_first.stdout.strip().splitlines()
    if commits:
        first_date, first_hash = commits[-1].split()[:2]
        res_tag = subprocess.run(["git", "describe", "--tags", "--abbrev=0", first_hash], capture_output=True, text=True)
        tag = res_tag.stdout.strip() if res_tag.returncode == 0 and res_tag.stdout.strip() else "v1.0.0"
    else:
        first_date = datetime.now().strftime("%Y-%m-%d")
        tag = get_current_stigix_version()

    return last_date, first_date, tag


def update_doc_file(file_path, revision_entry=None, today_override=True):
    if not os.path.isfile(file_path):
        print(f"Error: File not found: {file_path}")
        return False

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    last_date, first_date, tag = get_git_metadata(file_path)
    if today_override:
        last_date = datetime.now().strftime("%Y-%m-%d")

    new_header = f"> **Last Updated:** {last_date} | **Created:** {first_date} ({tag})"

    # Replace existing header or prepend
    header_pattern = re.compile(r"^> \*\*Last Updated:\*\*.*?(\n\n|\n|$)", re.MULTILINE)
    if header_pattern.search(content):
        content = header_pattern.sub(new_header + "\n\n", content, count=1)
    else:
        content = new_header + "\n\n" + content

    # Handle Revision History table if requested
    if revision_entry:
        current_ver = get_current_stigix_version()
        today_str = datetime.now().strftime("%Y-%m-%d")
        table_row = f"| {today_str} | `{current_ver}` | Stigix Core Team | {revision_entry} |\n"

        rev_pattern = re.compile(r"(## (?:📜 )?Revision History\s*\n\s*\|[^\n]+\|\s*\n\s*\|[-| ]+\|\s*\n)(.*)", re.DOTALL | re.IGNORECASE)
        match = rev_pattern.search(content)
        if match:
            table_head = match.group(1)
            table_body = match.group(2)
            # Avoid duplicate same entry on same day
            if revision_entry not in table_body:
                content = content[:match.start(2)] + table_row + table_body
        else:
            # Append new section
            rev_section = (
                "\n\n---\n\n"
                "## 📜 Revision History\n\n"
                "| Date | Stigix Version | Author / Trigger | Summary of Changes |\n"
                "|---|---|---|---|\n"
                f"| {first_date} | `{tag}` | Stigix Core Team | Initial document creation |\n"
            )
            if first_date != today_str:
                rev_section += table_row
            content = content.rstrip() + rev_section

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"✅ Updated {file_path}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Manage Stigix doc headers & revision history")
    parser.add_argument("--all", action="store_true", help="Sync all .md files in docs/")
    parser.add_argument("--file", type=str, help="Specific .md file to update")
    parser.add_argument("--add-revision", type=str, help="Revision description to add to table")
    parser.add_argument("--no-today", action="store_true", help="Do not override last-updated with today")

    args = parser.parse_args()

    if args.file:
        update_doc_file(args.file, revision_entry=args.add_revision, today_override=not args.no_today)
    elif args.all:
        docs = sorted(glob.glob("docs/**/*.md", recursive=True))
        for doc in docs:
            update_doc_file(doc, revision_entry=args.add_revision, today_override=not args.no_today)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
