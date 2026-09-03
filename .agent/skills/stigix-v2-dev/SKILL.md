---
name: stigix-v2-dev
description: >
  Guidelines and standards for developing features and releasing builds on the Stigix V2 branch (v2).
  Covers version management, Docker tag conventions, changelog policy, and UI styling.
---

# Stigix V2 Development Skill

Use this skill when developing features, fixing bugs, or updating configurations specifically on the **Stigix V2 branch (`v2`)**.

## V2 Development & Release Rules

1. **Development Strictly on `v2`**: All feature development and bug fixes must be committed and pushed exclusively to the `v2` branch.
2. **Never Push Directly to `main` during Dev**: Do not push or merge to `main` until the user explicitly asks to release / merge.
3. **Release Protocol (Upon User Request)**:
   - When the user asks to merge to `main`, increment version (`VERSION`, `engines/VERSION`, `web-dashboard/package.json`).
   - Merge `v2` into `main` and push to `origin main`.
   - GitHub Actions will automatically tag `v2.0.x`, compile Multi-Arch (`linux/amd64,linux/arm64`), and publish to Docker Hub (`:latest`, `:stable`, `:2.0.x`).
4. **No Force Push**: Never use `git push --force` on `v2` or `main`.

---

## Dynamic Versioning & Docker Builds

Every push to the `v2` branch triggers the fast dev GitHub Actions build:

- **Docker Image Name**: `jsuzanne/stigix`
- **Docker Tags Generated**:
  - `jsuzanne/stigix:v2` (glissant / equivalent of latest for V2)
  - `jsuzanne/stigix:sha-<short-sha>` (immuable)

---

## Changelog Policy

All changes on the V2 branch must be documented in **`CHANGELOG_V2.md`** instead of the main `CHANGELOG.md`.

- Update the file under the `[v2-dev]` section or add a new date section.
- Use categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## Testing & Verification

Before committing UI changes, always verify they compile:

```bash
# In web-dashboard/
npm run build
```

This compiles both TypeScript (`tsc -b`) and bundles with Vite (`vite build`).

---

## Deployment Commands (Lab BR5/BR8)

To deploy the latest V2 container:

1. Configure `TAG=v2` in `.env` or set it in the environment.
2. Pull the latest image:
   ```bash
   TAG=v2 docker compose pull
   ```
3. Restart the service:
   ```bash
   TAG=v2 docker compose up -d --no-deps stigix
   ```
