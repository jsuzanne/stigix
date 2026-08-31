---
name: stigix-v2-dev
description: >
  Guidelines and standards for developing features and releasing builds on the Stigix V2 branch (v2).
  Covers version management, Docker tag conventions, changelog policy, and UI styling.
---

# Stigix V2 Development Skill

Use this skill when developing features, fixing bugs, or updating configurations specifically on the **Stigix V2 branch (`v2`)**.

## V2 Development Rules

1. **Never Commit Directly to Main**: The `main` branch remains the stable V1 production release. All V2 development commits must go directly to the `v2` branch.
2. **Never Merge V2 to Main**: V2 contains breaking and experimental features. Do not open pull requests or merge V2 into `main` unless explicitly requested.
3. **No Force Push**: Never use `git push --force` on `v2` or `main`.

---

## Dynamic Versioning & Docker Builds

Every push to the `v2` branch triggers the GitHub Actions workflow `.github/workflows/build-stigix-allinone.yml`. 

- **Docker Image Name**: `jsuzanne/stigix`
- **Docker Tags Generated**:
  - `jsuzanne/stigix:v2` (glissant / equivalent of latest for V2)
  - `jsuzanne/stigix:v2-<short-sha>` (immuable, e.g. `v2-df50fdc`)

### Dynamic Version Baking
The Dockerfile automatically intercepts the `VERSION` build argument and bakes it into `/app/VERSION` inside the container:
```dockerfile
ARG VERSION
RUN if [ -n "$VERSION" ]; then echo "$VERSION" > VERSION; fi
```
Do **NOT** manually edit the static `VERSION` file in the Git repository unless raising the baseline V2 version. The running container will dynamically reflect the built tag.

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
