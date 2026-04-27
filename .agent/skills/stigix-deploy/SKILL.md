---
name: stigix-deploy
description: Bump version, commit code changes, and push a GitHub tag for the stigix project. Use whenever making code changes that should trigger a Docker image rebuild via GitHub Actions CI.
---

# Stigix Deploy Skill

Use this skill whenever you make **code changes** to the stigix project that should be shipped to Docker Hub via GitHub Actions.

## When to Use

- After any edit to `server.ts`, `*.tsx`, `Dockerfile`, `targets-manager.ts`, or other source files
- After changes to `engines/` scripts, `iot/`, `vyos/`, or `mcp-server/`
- **Skip** for doc-only changes (`docs/`, `README.md`, `CHANGELOG.md`, `*.md`) — those don't need a tag/rebuild

> [!IMPORTANT]
> **Dockerfile Audit**: If you added a NEW `.ts` file or a new directory in `web-dashboard/`, you MUST ensure it is explicitly copied in the `Runtime Stage` of the `web-dashboard/Dockerfile`. Otherwise, the container will fail with `ERR_MODULE_NOT_FOUND`.

## Steps

### 1 — Determine the new version

Read the current version:
```bash
cat /Users/jsuzanne/Github/stigix/VERSION
```
The format is `vX.Y.Z-patch.NNN`. You MUST strictly increment NNN by exactly +1 (e.g., from 140 to 141). Do not skip numbers or round to tens unless the USER explicitly requests it.

### 2 — Bump all three VERSION files

```bash
NEW_VER="v1.2.1-patch.NNN"   # replace NNN
echo "$NEW_VER" > VERSION
echo "$NEW_VER" > web-dashboard/VERSION
echo "$NEW_VER" > engines/VERSION
```

All three files must always stay in sync.

### 3 — Stage, commit, and push

Stage **all** changed files (source + VERSION files together in one commit). 

> [!IMPORTANT]
> **Visibility Rule**: Always prefix the commit message with the new version number. This makes it easy to track which version is being built in the GitHub Actions list.

```bash
git add -A
git commit -m "$NEW_VER: <feat|fix>: <short description>

<expanded bullet summary of what changed>"
git push
```

### 4 — Push a matching git tag

```bash
git tag $NEW_VER
git push origin $NEW_VER
```

This triggers GitHub Actions which automatically creates:
- **Fast AMD64-only images**: For "patch" versions (e.g., `v1.2.1-patch.239`) and pushes to the `main` branch. This speeds up the development CI cycle.
- **Multi-platform images (AMD64 + ARM64)**: Only for official stable tags (e.g. `v1.2.1`). This ensures Raspberry Pi compatibility for releases.

### 5 — Verify CI Visibility

Check the Actions tab: `https://github.com/jsuzanne/stigix/actions`.
You should see the run name labeled with `🚀 Release $NEW_VER`.

## Rules

- **Prefix**: Never forget the `$NEW_VER:` prefix in the commit message.
- **Sync**: VERSION files and the git tag must always match exactly.
- **Timing**: Always bump version **before** the tag push.
- **Doc-only**: Skip versioning for README/Documentation-only changes.
