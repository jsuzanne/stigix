# Stigix CI/CD Trigger Guide

This document explains how to manually trigger the build processes for Stigix using the GitHub CLI (`gh`).

## Process A: Individual Containers
Builds and pushes the 5 separate images (`stigix`, `sdwan-traffic-gen`, `sdwan-voice-gen`, `sdwan-voice-echo`, `sdwan-mcp-server`).

### Standard build (latest)
Triggers a build for the current branch (usually `main`).
```bash
gh workflow run docker-build.yml
```

### Promote a version to :stable
Builds for both AMD64 and ARM64 and tags them as `stable`.
```bash
gh workflow run docker-build.yml -f version_to_stable=1.2.3 -f build_full=true
```

---

## Process B: All-in-One Container (Stigix)
Builds and pushes the single combined image `jsuzanne/stigix`.

### Standard build (latest)
Triggers a build of the all-in-one image for the current branch.
```bash
gh workflow run build-stigix-allinone.yml
```

### Promote to :stable
Builds the all-in-one image for both platforms and tags it as `stable`.
```bash
gh workflow run build-stigix-allinone.yml -f version_to_stable=1.2.3 -f build_full=true
```

---

## Unified Tagging (Automatic A + B)
If you want to produce **both** individual containers and the all-in-one container for a specific version (e.g., `1.2.1-patch.152`), simply push a Git tag:

```bash
git tag v1.2.1-patch.152
git push origin v1.2.1-patch.152
```

**What happens next:**
- **Workflow A** triggers: produces 5 images tagged `1.2.1-patch.152`
- **Workflow B** triggers: produces 1 image `jsuzanne/stigix:1.2.1-patch.152`

---

## Granular Control: When to build A or B?

It makes perfect sense to build them independently if you only changed one component.

### To build ONLY individual containers (A):
Use this if you fixed something in `web-dashboard` and only want to update those specific images.
```bash
gh workflow run docker-build.yml -f version_to_stable=1.2.1-patch.153
```

### To build ONLY the all-in-one image (B):
Use this if you fixed a packaging issue in the supervisor config or the all-in-one Dockerfile.
```bash
gh workflow run build-stigix-allinone.yml -f version_to_stable=1.2.1-patch.153
```

---

## Summary of Triggering Methods

| Method | Result | Best for... |
|---|---|---|
| **Git Tag** (`v*`) | Builds **Both** A + B | Formal releases, matching source to images. |
| **Push to main** | Builds **Both** A + B (`:latest`) | Continuous integration / Dev updates. |
| **GH CLI** (Manual) | Builds **Only** requested file | Targeted fixes, testing build logic, or partial updates. |
