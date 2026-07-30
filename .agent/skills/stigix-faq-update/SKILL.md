---
name: stigix-faq-update
description: >
  Guide for updating the Stigix public FAQ (site/faq.html) when user-facing features change.
  Use after adding new features, changing defaults, or modifying UI workflows that users would notice.
  Decides which FAQ panel to update, writes the HTML, and applies the change.
---

# Stigix FAQ Update Skill

Use this skill **after implementing user-facing changes** to keep the public FAQ at `site/faq.html` in sync with the actual product behavior.

## When to Use

- New feature added that users will configure or encounter in the UI
- Default value changed (e.g., probe frequency, timeout)
- UI workflow changed (e.g., renamed button, new field in a modal)
- New CLI flag or command added
- Behavior of an existing feature changed significantly
- Bug fix that changes visible behavior (e.g., a column that was missing now appears)

## When NOT to Update

- Pure internal refactors with no UI/UX change
- Backend performance improvements invisible to users
- Fix of a bug that was never documented in the FAQ to begin with

---

## Step 1 — Identify the Relevant FAQ Panel

The FAQ is organized in tabs. Each tab has a `data-tab` and a matching `id="panel-*"` div.

| Tab label | `data-tab` | `id` | Covers |
|---|---|---|---|
| Installation | `install` | `panel-install` | Docker, env, startup |
| Traffic Generation | `traffic` | `panel-traffic` | SaaS, patterns, export |
| Digital Experience | `digexp` | `panel-digexp` | Probes, scores, content match, DEM |
| Security Testing | `security` | `panel-security` | URL filter, DNS, EICAR |
| Bandwidth Testing | `xfr` | `panel-xfr` | iPerf3, throughput |
| IoT Simulation | `iot` | `panel-iot` | MQTT, sensors |
| Voice & Convergence | `voice` | `panel-voice` | Voice probes, failover |
| VyOS Control | `vyos` | `panel-vyos` | VyOS impairments |
| Settings & API | `settings` | `panel-settings` | REST API, auth, settings |
| Topology | `topology` | `panel-topology` | Node topology view |
| Operations | `ops` | `panel-ops` | Logs, cleanup, restart |
| Stigix CLI | `cli` | `panel-cli` | CLI commands |
| MCP Server | `mcp` | `panel-mcp` | MCP tools |
| Targets & Registry | `registry` | `panel-registry` | Peer registry |

---

## Step 2 — Determine the Update Type

### A. Modify existing FAQ item
Find the relevant `<div class="faq-item">` block by searching for keywords in the question text.
Edit the answer content inside `<div class="faq-item__answer">`.

### B. Add new FAQ item
Insert a new `<div class="faq-item">` block **before the closing** `</div><!-- /panel-XXX -->` comment of the target panel.

---

## Step 3 — HTML Structure

### New FAQ item template
```html
        <div class="faq-item">
          <button class="faq-item__btn" aria-expanded="false"><span class="faq-item__question">YOUR QUESTION HERE?</span><span class="faq-item__icon"><svg viewBox="0 0 12 12"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg></span></button>
          <div class="faq-item__body"><div class="faq-item__inner"><div class="faq-item__answer">
            <p>ANSWER PARAGRAPH.</p>
            <ul>
              <li><strong>Item</strong> — explanation.</li>
            </ul>
          </div></div></div>
        </div>
```

### Inline code: use `<code>value</code>`
### Emphasis: use `<strong>text</strong>` or `<em>text</em>`
### Lists: use `<ul><li>` or `<ol><li>` as appropriate
### Pre-formatted blocks (e.g. JSON, config): use `<pre>content</pre>`

---

## Step 4 — Language Rule

All FAQ content **must be in English** — even if the conversation with the user is in French.
See the `stigix-lang` skill for the full language policy.

---

## Step 5 — Search Before Writing

Always search the FAQ for existing content on the topic before adding a new item:

```bash
grep -n "keyword" /Users/jsuzanne/Github/stigix/site/faq.html
```

- If the topic is already covered → **edit** the existing item, don't add a duplicate.
- If the topic is new → **add** a new item.

---

## Step 6 — Commit Rules (Doc-only)

Doc-only changes to `site/faq.html` **do NOT require a version bump or git tag**.

```bash
git add site/faq.html
git commit -m "docs(faq): <short description of what changed>

- Updated panel-XXX: <item question or topic>
- Updated panel-YYY: <item question or topic>"
git push
```

> [!NOTE]
> No version bump. No git tag. FAQ commits go directly to `main` without triggering Docker CI rebuild.

---

## Quick Reference — Common FAQ Update Patterns

| What changed | Panel | Action |
|---|---|---|
| New probe type or probe parameter | `digexp` | Add/edit FAQ item |
| Default value changed (freq, timeout) | `digexp` | Edit existing item mentioning the old default |
| New content match feature or change | `digexp` | Edit the "content matching" FAQ item |
| New CLI flag or command | `cli` | Edit or add CLI FAQ item |
| New MCP tool | `mcp` | Add FAQ item |
| Changed UI button label | Relevant panel | Edit step-by-step instructions referencing old label |
| New installation step or env var | `install` | Edit or add item |
| New scoring rule | `digexp` | Edit scoring FAQ item |
