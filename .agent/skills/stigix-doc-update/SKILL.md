---
name: stigix-doc-update
description: >
  Mandatory guidelines and automated procedure for creating and modifying Stigix documentation in docs/.
  Enforces standard metadata header (Last Updated, Creation Date, Initial Stigix Version) and Revision History tables.
---

# Stigix Documentation Lifecycle & Metadata Standard

Use this skill whenever **creating a new document** or **modifying an existing document** in `docs/`.

---

## 📌 Standard Document Structure

Every document inside `docs/` must follow this structure:

### 1. Header Metadata Banner (Line 1)
At the very top of every document (before the main title), include the metadata banner:

```markdown
> **Last Updated:** <YYYY-MM-DD> | **Created:** <YYYY-MM-DD> (<version_tag>)
```

- **Last Updated:** Date of the current modification (`YYYY-MM-DD`).
- **Created:** Date when the document was first created (`YYYY-MM-DD`).
- **Version Tag:** Stigix version at creation (e.g. `v2.0.55`, `v1.1.0-patch.94`, or `v1.0.0`).

### 2. Document Content
Standard Markdown content (H1, sections, diagrams, code blocks).

### 3. Revision History Table (Bottom of Document)
At the bottom of the document, maintain a revision history table:

```markdown
---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-24 | `v2.0.64` | Stigix Core Team | Added FastMCP tool definitions and failover runbook |
| 2026-01-25 | `v1.1.0-patch.94` | Stigix Core Team | Initial document creation |
```

---

## 🛠️ Automated Sync Tool

A dedicated helper script is available to automatically format, update headers, and insert revision rows:

```bash
# Update a specific document with a new revision log
python3 .agent/skills/stigix-doc-update/scripts/sync_doc_metadata.py \
  --file docs/MY_DOC.md \
  --add-revision "Describe what was updated"

# Sync all documents across docs/
python3 .agent/skills/stigix-doc-update/scripts/sync_doc_metadata.py --all
```

---

## 📋 Rules for Creating a New Document

When creating a new file `docs/<NEW_DOC>.md`:
1. Obtain the current Stigix version (e.g. `git describe --tags --abbrev=0` or `v2.0.XX`).
2. Insert the top header with today's date and the current version:
   ```markdown
   > **Last Updated:** 2026-09-24 | **Created:** 2026-09-24 (v2.0.64)

   # Title
   ```
3. Append the initial revision entry at the bottom:
   ```markdown
   ---

   ## 📜 Revision History

   | Date | Stigix Version | Author / Trigger | Summary of Changes |
   |---|---|---|---|
   | 2026-09-24 | `v2.0.64` | Stigix Core Team | Initial document creation |
   ```
4. Verify language policy: Content must be in **English** (`stigix-lang` skill).

---

## ✏️ Rules for Modifying an Existing Document

When modifying an existing file `docs/<EXISTING_DOC>.md`:
1. Update the **Last Updated** date in the line 1 header to today's date (`YYYY-MM-DD`). Preserve the original `Created: YYYY-MM-DD (vX.X.X)` metadata.
2. Add a new row to the top of the **Revision History** table summarizing the change.
3. Or run the helper script:
   ```bash
   python3 .agent/skills/stigix-doc-update/scripts/sync_doc_metadata.py \
     --file docs/<EXISTING_DOC>.md \
     --add-revision "Short summary of changes made"
   ```

---

## 🧭 Documentation Map & Triggers

| Feature / Trigger | Primary Doc | Secondary Doc |
|---|---|---|
| New MCP tool / API parameter | `docs/MCP_SERVER.md` | `mcp-server/Exemple/MCP_Test_Plan.md` |
| New CLI command | `docs/STIGIX_CLI.md` | — |
| New VyOS action / sequence | `docs/VYOS_CONTROL.md` | `docs/MCP_SERVER.md` |
| New security test / policy | `docs/SECURITY_TESTING.md` | `docs/SECURITY_TESTING_FAQ.md` |
| New DEM / probe capability | `docs/DIGITAL_EXPERIENCE_TESTING.md` | `docs/TRAFFIC_FLOW_GUIDE.md` |
| In-App Copilot updates | `docs/PRD_STIGIX_AI_COPILOT.md` | `docs/MCP_DEMO_SCENARIO.md` |
| Convergence & Failover | `docs/CONVERGENCE_LAB.md` | `docs/MCD Reports/` |

---

## 🔍 Pre-Commit Checklist

- [ ] Line 1 header matches `> **Last Updated:** YYYY-MM-DD | **Created:** YYYY-MM-DD (vX.X.X)`.
- [ ] Revision History table is updated at the bottom.
- [ ] Content is in **English** (`stigix-lang`).
- [ ] No secrets or sensitive IP addresses (`stigix-secret-guard`).
