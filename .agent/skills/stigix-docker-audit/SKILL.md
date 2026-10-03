---
name: stigix-docker-audit
description: Mandatory checklist and audit for Dockerfile source synchronization in Stigix. Use whenever creating or renaming TypeScript files, subdirectories, or Python modules to ensure both stigix-all-in-one/Dockerfile and web-dashboard/Dockerfile include all runtime dependencies.
---

# Stigix Docker Audit Skill

This skill enforces strict synchronization between the repository source files and the Docker images built for deployment.

## The Problem
When building the Stigix All-in-One container or Web Dashboard container, the `Runtime Stage` uses granular `COPY` instructions rather than copying the entire `web-dashboard/` folder (to avoid shipping raw `.tsx`, frontend tests, source maps, etc.).

If a new `.ts` backend file or subdirectory is created in `web-dashboard/`, forgetting to add `COPY web-dashboard/<file>.ts ./` in the Dockerfiles will cause:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/<file>.js' imported from /app/server.ts
```
when the container starts `supervisor` and runs `tsx server.ts`.

---

## Dual Dockerfile Architecture

Stigix maintains **TWO** Dockerfiles that must stay in sync:

1. **`stigix-all-in-one/Dockerfile`** ➔ **PRIMARY CI/CD IMAGE**
   - Built by `.github/workflows/build-stigix-allinone.yml` on push/tag.
   - Powers the entire lab fleet (`jsuzanne/stigix:v2` and versioned releases).
   - Contains supervisor, python engines, MCP server, and Web UI.
   - **Must contain** `COPY web-dashboard/<file>.ts ./` for every backend `.ts` module.

2. **`web-dashboard/Dockerfile`** ➔ **Standalone Web UI Image**
   - Used for standalone dashboard builds.
   - **Must also contain** `COPY web-dashboard/<file>.ts ./`.

---

## Audit Checklist (Before every commit adding a new file)

Whenever you create a new `.ts` or backend file in `web-dashboard/`:

1. Check `stigix-all-in-one/Dockerfile` (around lines 80-105).
2. Check `web-dashboard/Dockerfile` (around lines 58-85).
3. Ensure both files contain:
   ```dockerfile
   COPY web-dashboard/<new-module>.ts ./
   ```
4. If you added a directory (e.g. `web-dashboard/new-dir`):
   ```dockerfile
   COPY web-dashboard/new-dir ./new-dir
   ```

---

## Quick Verification Command

Run this one-liner to verify all root-level backend `.ts` files in `web-dashboard/` are present in `stigix-all-in-one/Dockerfile`:

```bash
for f in web-dashboard/*.ts; do
  base=$(basename "$f")
  if [ "$base" != "vite.config.ts" ]; then
    grep -q "COPY web-dashboard/$base" stigix-all-in-one/Dockerfile || echo "⚠️ MISSING in stigix-all-in-one/Dockerfile: $base"
    grep -q "COPY web-dashboard/$base" web-dashboard/Dockerfile || echo "⚠️ MISSING in web-dashboard/Dockerfile: $base"
  fi
done
```
If the command outputs nothing, all files are synchronized.
