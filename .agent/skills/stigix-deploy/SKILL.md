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
The format is `v1.2.1-patch.NNN`. Increment NNN by 1.

### 2 — Bump all three VERSION files

```bash
NEW_VER="v1.2.1-patch.NNN"   # replace NNN
echo "$NEW_VER" > VERSION
echo "$NEW_VER" > web-dashboard/VERSION
echo "$NEW_VER" > engines/VERSION
```

All three files must always stay in sync.

### 3 — Stage, commit, and push

Stage **all** changed files (source + VERSION files together in one commit):
```bash
git add -A
git commit -m "feat/fix: <short description>

<expanded bullet summary of what changed>"
git push
```

### 4 — Push a matching git tag

```bash
git tag $NEW_VER
git push origin $NEW_VER
```

This triggers GitHub Actions (`docker-build.yml`) which builds and pushes:
- `jsuzanne/sdwan-web-ui:latest` + `jsuzanne/sdwan-web-ui:$NEW_VER`
- Same for `sdwan-traffic-gen`, `sdwan-voice-gen`, `sdwan-voice-echo`, `sdwan-mcp-server`

### 5 — Verify CI (optional)

Check the Actions tab: `https://github.com/jsuzanne/stigix/actions`

## Rules

- **Never** bump the version for doc-only commits (no tag needed, CI won't build anyway since no Dockerfile/source changed)
- VERSION files and the git tag must always match exactly
- Always bump version **before** the tag push, not after
- If a tag already exists, use `git tag -f $NEW_VER && git push origin $NEW_VER --force`
