---
name: stigix-release-flow
description: >
  Standard operating procedure for Stigix Git workflow, feature development on v2, version bumping, and automated multi-arch releases on main.
---

# Stigix Git & Release Flow Protocol

This skill dictates the strict branching, commit, version increment, and release policy for the Stigix project.

---

## 🎯 Core Rule Summary

| Phase | Active Branch | Allowed Actions | Docker Hub Output |
|---|---|---|---|
| **Development** | `v2` | Code, build (`npm run build`), commit & push on `v2` only | `jsuzanne/stigix:v2` (Fast AMD64 build) |
| **Release / Merge** | `main` | **Triggered only upon explicit user request.** Bump versions, merge `v2` to `main`, push to `origin main` | Multi-Arch (`linux/amd64,linux/arm64`) with tags `:latest`, `:stable`, `:2.0.x`, `:v2.0.x` |

---

## 🛠️ Step-by-Step Workflow Execution

### Phase 1: Feature Development (v2 Only)
1. Ensure working directory is on `v2`:
   ```bash
   git checkout v2
   ```
2. Implement features, UI components, and API routes.
3. Validate build locally:
   ```bash
   cd web-dashboard && npm run build
   ```
4. Commit and push **strictly to `v2`**:
   ```bash
   git add <modified-files>
   git commit -m "feat/fix: <description>"
   git push origin v2
   ```
5. **NEVER push to `main` during this phase.**

---

### Phase 2: User-Requested Release & Merge to `main`
Execute this phase **ONLY when the user explicitly requests a merge / release to `main`** (e.g. *"tu peux merger sur main"*, *"fais la release"*, *"passe en prod"*):

1. **Increment Semantic Version (Patch)**:
   - Update `VERSION` (e.g. `2.0.6`)
   - Update `engines/VERSION` (`2.0.6`)
   - Update `web-dashboard/package.json` (`2.0.6`)
2. **Commit version bump on `v2`**:
   ```bash
   git add VERSION engines/VERSION web-dashboard/package.json
   git commit -m "chore(release): bump version to 2.0.x"
   git push origin v2
   ```
3. **Merge `v2` into `main` and push**:
   ```bash
   git checkout main
   git merge v2 --no-edit
   git push origin main
   git checkout v2
   ```

---

## 🤖 CI/CD Automation Behavior (GitHub Actions)

When `main` receives the push:
1. **Auto-Tagging**: CI/CD discovers the version and automatically creates/pushes the annotated Git tag `v2.0.x`.
2. **Multi-Architecture Build**: CI/CD builds for both **`linux/amd64` and `linux/arm64`** (Apple Silicon / ARM servers).
3. **Docker Hub Publishing**: Tags `latest`, `stable`, `v2.0.x`, `2.0.x`, `2.0`, and git SHA are published.
4. **GitHub Release**: An official GitHub release `Release v2.0.x` is created automatically.
