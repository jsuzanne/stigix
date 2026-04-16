# Golden Rules - SD-WAN Traffic Generator Workspace

## Docker Build & Deployment

### ⚠️ CRITICAL: Multi-Platform Docker Images
**ALWAYS build Docker images for multiple platforms when pushing to Docker Hub.**

```bash
# ❌ WRONG - Always building ARM64 on every patch (Sloooow ~20 mins)
# git tag v1.1.2-patch.33.15 && git push origin v1.1.2-patch.33.15

# ✅ CORRECT - Standard push/tag uses Fast Build (AMD64 only ~7 mins)
# git tag v1.1.2-patch.33.18 && git push origin v1.1.2-patch.33.18
```

**Why:** Ubuntu LAB servers (Intel NUCs) are AMD64. Emulating ARM64 on GitHub is slow. We only build ARM64 manually via GitHub Actions UI ("Build Full" toggle) when Mac Silicon testing is required for a specific version.

**Why:** Ubuntu LAB servers are AMD64, Mac development is ARM64. Single-platform builds cause "exec format error".

### Docker Image Tags & Usage
- **`latest`** (Personal Testing): Pointing to the last build from `main`. Primarily for user development and internal LAB testing.
- **`stable`** (Public Deployment): Manually promoted version. Recommended for all general users and production sites.
- **`vX.Y.Z-patch.N`** (Fixed Releases): Immutable versions triggered by Git tags. Used for rollback and specific environment anchoring.
- **NEVER** use `latest` for public demos or critical production sites.

### Required Images
1. `jsuzanne/stigix` - Web dashboard + backend API
2. `jsuzanne/sdwan-traffic-gen` - Traffic generation script

---

## Version Management

### VERSION File
- Location: `/VERSION`
- Format: `X.Y.Z` or `X.Y.Z-beta.N`
- Update BEFORE building Docker images

### Beta Versioning Strategy
**CRITICAL:** Use incremental beta numbers for each build to track changes
- ✅ **Correct:** `1.1.0-beta.1`, `1.1.0-beta.2`, `1.1.0-beta.3`
- ❌ **Wrong:** Reusing `1.1.0-beta` for multiple builds

**Why:** Reusing the same version makes it impossible to differentiate which Docker image contains which features/fixes.

### Changelog
- Location: `/CHANGELOG.md`
- Update for ALL changes (features, fixes, breaking changes)
- Follow [Keep a Changelog](https://keepachangelog.com/) format

---

## Development Workflow

### 1. Local Development
```bash
cd web-dashboard
npm run dev  # Runs on http://localhost:5173
```

**Note:** Traffic generation won't work on macOS in dev mode (Linux-only feature)

### 2. Testing
- Security features: Test on Mac (works in dev mode)
- Traffic generation: Test in Docker on Ubuntu LAB

### 3. Beta Release

**⚠️ CRITICAL PRE-RELEASE CHECKLIST:**
```bash
# ALWAYS run these commands BEFORE creating a tag:
git status                    # Verify NO uncommitted changes
git diff                      # Check for any unstaged changes
git log --oneline -5          # Verify recent commits look correct
```

**Why:** Uncommitted files (like App.tsx) won't be in the Docker build, causing missing features and wasted debugging time.

1. **Verify all changes are committed** (run `git status` - should be clean)
2. Update `VERSION` to `X.Y.Z-beta.N` (incremental beta number)
3. Update `CHANGELOG.md`
4. Commit VERSION and CHANGELOG changes
5. Push to GitHub: `git push origin main`
6. Create and push tag: `git tag vX.Y.Z-beta.N && git push origin vX.Y.Z-beta.N`
7. Wait for GitHub Actions to complete (~6-8 minutes)
8. Test in LAB environment

### 4. Promotion to Stable (Production Release)
1. After validation of a `vX.Y.Z-patch.N` or `latest` build in the LAB:
2. Go to **GitHub Actions** → **Build and Push Multi-Platform Docker Images**.
3. Click **"Run workflow"** and use the **"Promote to Stable"** field.
4. Saisis la version choisie (ex: `1.1.0-patch.26`).
5. This updates the `stable` tag on Docker Hub.

---

## Code Standards

### Backend (server.ts)
- Use ES Modules (`import`), NOT CommonJS (`require()`)
- All security API endpoints MUST use `authenticateToken` middleware
- Use `promisify(exec)` for shell commands, imported at top

### Frontend (React/TypeScript)
- Use TypeScript interfaces for all API responses
- Add toast notifications for user actions
- Handle loading states and errors gracefully

### Configuration & Migrations 🔄
- **Robustness First**: When updating global configuration structures (like `security-tests.json`), ALWAYS implement aggressive migration logic in the backend. 
- **Handle Legacy Formats**: Never assume the existing config file follows the latest schema. Handle legacy booleans, strings, or missing objects explicitly.
- **Fail Gracefully**: Backend migration should never return `null` or throw errors that crash the API. Always return a valid default object if reading fails.
- **Frontend Safety**: The UI should never assume data exists. Use optional chaining (`?.`) and provide local fallbacks for deeply nested configuration properties.

### Environment-Specific Testing 🧪
- **UI Components**: Even if it works perfectly in `npm run dev` (local), ALWAYS verify UI rendering in the Docker container before final validation.
- **Persistent Storage**: Remember that Docker uses persistent volumes (like `./config`). Test with existing/old config files to verify migrations work as expected.

---

## Documentation Requirements

### For New Features
1. Technical documentation in `/docs/`
2. Quick reference guide
3. FAQ document (if complex feature)
4. Update main README.md
5. Add to CHANGELOG.md

### Artifacts (Brain Directory)
- `task.md` - Task checklist
- `implementation_plan.md` - Technical plan (for complex features)
- `walkthrough.md` - What was accomplished
- `TODO.md` - Next session tasks

---

## Security Testing Feature Specifics

### Configuration
- Location: `config/security-tests.json`
- Contains: test configs, statistics, history

### API Endpoints
- All under `/api/security/*`
- All require authentication
- Return consistent JSON format with `success`, `status`, `message`

### Test Types
1. URL Filtering (67 categories)
2. DNS Security (24 domains)
3. Threat Prevention (EICAR)

---

## Common Pitfalls

### ❌ Don't
- Push single-platform Docker images
- Commit untested code to main branch
- Update `latest` tag before LAB validation
- Use `require()` in ES Module files
- Forget to update VERSION file

### ✅ Do
- Build multi-platform Docker images
- Test in LAB before promoting to stable
- Update CHANGELOG.md for all changes
- Use `import` statements in TypeScript/Node
- Document all new features

---

## Quick Commands Reference

### Multi-Platform Docker Build
```bash
# Setup buildx (once)
docker buildx create --use --name multiplatform-builder

# Build and push web-ui
docker buildx build --platform linux/amd64,linux/arm64 \
  -t jsuzanne/stigix:1.1.0-beta \
  -f web-dashboard/Dockerfile \
  --push .

# Build and push traffic-gen
docker buildx build --platform linux/amd64,linux/arm64 \
  -t jsuzanne/sdwan-traffic-gen:1.1.0-beta \
  -f Dockerfile.traffic-gen \
  --push .
```

### Promote to Stable (Manual)
1. Trigger via GitHub Actions UI (**workflow_dispatch**).
2. Input the target version string.
3. The workflow pulls, retags, and pushes as `:stable`.

---

## 📋 Commit & Release Policy

### 📦 Bundle Fixes (Selective Commit)
- **Don't commit every single fix immediately** if multiple related improvements are planned.
- **Group related fixes** into a single cohesive commit to keep history clean and avoid triggering unnecessary CI/CD builds for minor intermediate steps.
- **Exception for Critical Fixes**: If a bug is **critical** (e.g., the app fails to start, container crash, security vulnerability), you MUST commit and push the fix **immediately** without waiting to bundle it with other changes.
- **Wait for user confirmation** or until the "bundle" is complete before pushing to GitHub for non-critical changes.

### 📝 Changelog Enforcement
- **ALL commits** that modify behavior, fix bugs, or add features MUST be documented in `CHANGELOG.md`.
- Ensure the version number is bumped accordingly in the `VERSION` file if the bundle represents a new release.

### 🔍 Remote Tag Verification (The "Patch 17" Rule)
- **NEVER** assume a tag push was successful simply because the `git push` command returned.
- **ALWAYS** verify the tag is visible on the remote repository by running:
  ```bash
  git ls-remote --tags origin | grep vX.Y.Z-patch.N
  ```
- **Only notify the user** once the tag is confirmed to be on the remote server. This avoids "phantom releases" where the user checks GitHub and finds nothing.

---

---

## 🤝 Collaborative Policy

### 🛡️ THE GOLDEN RULE: Explanation & Validation First
**NEVER implement a proactive fix when answering a technical question.**

1.  **Explain First**: When asked "how" or "why", provide a clear technical explanation of the root cause.
2.  **Proposed Fix**: Describe the proposed fix in detail, outlining *exactly* what files and logic will change.
3.  **Confirm Version & Context**: ALWAYS ask the user which version they are currently testing before analyzing a problem.
4.  **Acknowledge Build Latency**: NEVER assume a reported bug is in the version just pushed. Docker builds take 20+ minutes, so the user is likely testing the *previous* version while the new one builds.
5.  **Browser Tool Restriction**: NEVER use the browser tool (for GitHub status or any other research) unless explicitly requested by the user. It causes severe performance issues (lags) on the user's system (Mac Mini).
6.  **GitHub Status**: The user will monitor GitHub Actions themselves. Do not attempt to check, report, or "ping" build status.
7.  **Wait for Validation**: ALWAYS wait for the user to understand and explicitly validate the approach and version before touching any code.
8.  **No "Secret" Fixes**: Do not bundle proactive fixes into an unrelated answer unless specifically requested.

**Why:** The user must maintain full mental parity with the codebase, and the assistant must not interfere with the host system's performance or the user's external monitoring workflows.

---

**Last Updated:** 2026-01-30  
**Workspace:** stigix
