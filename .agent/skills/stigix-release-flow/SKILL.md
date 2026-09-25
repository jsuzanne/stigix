---
name: stigix-release-flow
description: >
  Standard operating procedure for Stigix Git workflow, feature development on v2, version bumping, PR-based merge to main, and controlled stable Docker promotion.
---

# Stigix Git & Release Flow Protocol

This skill dictates the strict branching, commit, version increment, and release policy for the Stigix project.

---

## 🗺️ Complete Flow Overview

```
v2 branch (dev)
  │
  ├── push commit → ⚡ Build v2 (AMD64 only, :v2 + :dev tags)
  │
  ├── push tag v2.0.XX → 🚀 Release v2.0.XX (AMD64 only, versioned tag)
  │
  └── [user requests merge] → Agent creates PR v2 → main
                                │
                         [user approves & merges PR]
                                │
                            main push → 🚀 Auto-Release main
                                        AMD64 + ARM64
                                        Docker: :latest + :vX.Y.Z
                                │
                         [user wants stable]
                                │
                         workflow_dispatch "Promote to Stable"
                                        AMD64 + ARM64
                                        Docker: :stable + :latest + :vX.Y.Z
```

---

## 🎯 Core Rule Summary

| Phase | Branch | Trigger | Docker Tags | Arch |
|---|---|---|---|---|
| **Dev** | `v2` | branch push | `:v2`, `:devNNN` | AMD64 only |
| **Dev build** | `v2` | tag `v2.0.XX` | `:2.0.XX`, `:v2.0.XX`, `:sha-XXXX` | AMD64 only |
| **Merge to prod** | `main` | PR merge | `:latest`, `:2.0.XX`, `:v2.0.XX` | AMD64 + ARM64 |
| **Stable promotion** | `main` | `workflow_dispatch` | `:stable`, `:latest`, `:2.0.XX` | AMD64 + ARM64 |

> [!IMPORTANT]
> **`stable` is NEVER set automatically.** It is only applied via the manual `workflow_dispatch` "Promote to Stable" job in GitHub Actions. This ensures a deliberate human decision separates `:latest` (bleeding edge) from `:stable` (validated for production).

---

## 🛠️ Step-by-Step Workflow

### Phase 1: Feature Development (v2 Only)

1. Ensure working directory is on `v2`:
   ```bash
   git checkout v2
   ```
2. Implement features, bug fixes.
3. **For lab testing** — just push the branch, no version bump needed:
   ```bash
   git add -A && git commit -m "fix: <description>"
   git push   # → CI builds :v2 image (AMD64, ~2 min)
   ```
   Lab nodes update with: `docker compose pull && docker compose up -d`

4. **For a traceable milestone** (feature complete, confirmed fix) — follow the **stigix-deploy** skill (Mode B):
   - Bump `VERSION` files to `v2.0.Z`
   - Update `CHANGELOG.md`
   - Commit + push branch + push versioned tag `v2.0.Z`

5. **NEVER push directly to `main` during this phase.**

---

### Phase 2: Merge to main (User-Requested)

Execute **ONLY when the user explicitly requests a merge** (e.g. *"merge sur main"*, *"fais la release"*, *"passe en prod"*).

**Step 1 — Ensure v2 is at a clean tagged version:**
```bash
git tag | sort -V | tail -3   # last tag should be v2.0.XX
cat VERSION                   # must match the tag
```

**Step 2 — Create a PR v2 → main (agent action):**

Use the GitHub CLI to create the PR:
```bash
gh pr create \
  --base main \
  --head v2 \
  --title "Release v$(cat VERSION | tr -d 'v')" \
  --body "## Stigix $(cat VERSION)

### Changes since last release
$(git log --oneline main..v2 | head -20)

### Docker images after merge
- \`jsuzanne/stigix:latest\` — auto-published (AMD64+ARM64)
- \`jsuzanne/stigix:$(cat VERSION | tr -d 'v')\` — versioned tag

> Stable promotion is a separate manual step via GitHub Actions workflow_dispatch."
```

**Step 3 — User reviews and merges the PR on GitHub.**

Once merged, GitHub Actions automatically:
- Builds `linux/amd64` + `linux/arm64`
- Pushes `:latest`, `:vX.Y.Z`, `:X.Y.Z`, `:X.Y`, `:X` to Docker Hub
- Creates a GitHub Release

---

### Phase 3: Stable Promotion (Optional, Manual)

When you want to declare a version as **stable** (validated, recommended for prod):

1. Go to **GitHub Actions → Build and Push Stigix All-in-One → Run workflow**
2. Fill in `version_to_stable` (e.g. `2.0.64`)
3. Leave `build_full` checked (multi-arch)
4. Click **Run workflow**

This re-tags the existing AMD64+ARM64 image as `:stable` + `:latest` without rebuilding from scratch.

Alternatively, ask the agent:
> *"Promeus la version 2.0.64 en stable"*

The agent will trigger:
```bash
gh workflow run build-stigix-allinone.yml \
  --field version_to_stable=2.0.64
```

---

## 🤖 CI/CD Automation Behavior (GitHub Actions)

| Trigger | Job | Output |
|---|---|---|
| Push to `v2` branch | `build` | `:v2`, `:2.0.XX.devNNN` — AMD64 only |
| Push tag `v2.0.XX` | `build` | `:2.0.XX`, `:v2.0.XX`, `:sha-XXXX` — AMD64 only |
| Push to `main` | `build` + `create-release` | `:latest`, `:2.0.XX`, multi-arch — AMD64+ARM64 |
| `workflow_dispatch` with `version_to_stable` | `promote-to-stable` | `:stable`, `:latest`, `:2.0.XX` — AMD64+ARM64 |

---

## Rules

- **Dev branch**: All active development stays on `v2`. Never commit features directly to `main`.
- **Tags**: Every shippable version on `v2` gets a `v2.0.Z` tag (see stigix-deploy skill).
- **Merge gate**: The agent creates the PR but never merges it — the human always approves.
- **Stable gate**: `:stable` is only promoted via explicit `workflow_dispatch` — never automatic.
- **No force push to main**: Always use PR merge, never `git push --force`.
