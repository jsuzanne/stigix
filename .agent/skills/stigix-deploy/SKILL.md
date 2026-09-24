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

---

## Versioning Scheme (v2.x)

The project uses a **flat `v2.0.Z` patch scheme** — no more `patch.NNN` suffix.

- Format: `v2.0.Z` (e.g., `v2.0.63`, `v2.0.64`)
- Increment **Z by exactly +1** on every code change that ships a Docker image
- The VERSION files store the version **with the `v` prefix** (e.g., `v2.0.64`)
- Git tags are **always the full version string** (e.g., `v2.0.64`) — never a bare branch name like `v2`

> [!IMPORTANT]
> Always push **both** the branch push (`git push`) **and** a versioned tag (`git push origin vX.Y.Z`).
> The versioned tag triggers `🚀 Release vX.Y.Z` in GitHub Actions CI — this is the explicit, traceable build.
> Pushing only the branch triggers a generic `⚡ Build v2` run without a version label — this is less visible and harder to trace in the Actions tab.

---

## Steps

### 1 — Determine the new version

Read the current version:
```bash
cat /Users/jsuzanne/Github/stigix/VERSION
```

The format is `v2.0.Z`. Increment Z by exactly +1 (e.g., `v2.0.62` → `v2.0.63`). Do not skip numbers.

Also cross-check with git tags to ensure no version was bumped without a tag:
```bash
git tag | grep "^v2\." | sort -V | tail -5
```

If the current VERSION is ahead of the last git tag (e.g., VERSION=`v2.0.62` but last tag is `v2.0.58`), you must **backfill** the missing tags after the CHANGELOG audit (see Step 2bis).

### 2 — Bump VERSION files and README badge

> [!IMPORTANT]
> All four items below are MANDATORY. Run them as a single block — do NOT skip the README line.

```bash
NEW_VER="v2.0.Z"   # replace Z with the next sequential number
echo "$NEW_VER" > VERSION
echo "$NEW_VER" > web-dashboard/VERSION
echo "$NEW_VER" > engines/VERSION

# README badge — update in the same step
sed -i '' "s|Version-[0-9][^-]*-blue|Version-${NEW_VER#v}-blue|g" README.md
```

Verify all four files are in sync before proceeding:
```bash
cat VERSION && cat web-dashboard/VERSION && cat engines/VERSION
grep "img.shields.io/badge/Version" README.md
```

All four must show the same version.

### 2bis — Update CHANGELOG.md

> [!IMPORTANT]
> **Mandatory step** — `CHANGELOG.md` must be updated before every code commit. Never ship a patch without a changelog entry.

#### Step A — Audit for undocumented versions (ALWAYS run this first)

Before writing the new entry, run this command to compare git tags with CHANGELOG entries:

```bash
# List all v2.x tags
git tag | grep "^v2\." | sort -V

# List all documented versions in CHANGELOG
grep "^## \[2\.\|^## \[v2\." CHANGELOG.md | head -10

# Commits since last tag (to reconstruct missing entries)
git log --oneline $(git tag | sort -V | tail -1)..HEAD --reverse
```

If `git tag` shows versions that do NOT appear in the CHANGELOG, you MUST add entries for ALL missing versions before proceeding.

#### Step B — Write the new entry

Open `/Users/jsuzanne/Github/stigix/CHANGELOG.md` and **prepend** a new entry at the very top (after the file header), following this exact format:

```markdown
## [2.0.Z] - YYYY-MM-DD

### Added / Fixed / Changed
- **Component**: Description of what changed and why. Use emojis for readability. 🚀
```

**Rules for the entry:**
- Use the correct date (`YYYY-MM-DD` in local time).
- Group bullet points under the appropriate heading(s): `Added`, `Fixed`, `Changed`, `Performance`, `Refactored`, `Removed`, `Documentation`.
- Be concise but specific — mention the file/component affected and the user-visible impact.
- **One entry per tagged version** — never aggregate multiple patches into one block.

### 3 — Stage, commit, and push

Stage **all** changed files (source + VERSION files + CHANGELOG together in one commit).

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
- **`🚀 Release vX.Y.Z`** run (labeled with the full version) when a `v2.0.Z` tag is pushed — always explicit and traceable.
- **`⚡ Build v2`** run when only the branch is pushed — no version label, harder to trace.

> [!TIP]
> Always prefer the explicit versioned tag. In the Actions tab, look for `🚀 Release v2.0.Z` to confirm your build triggered correctly.

### 5 — Verify CI Visibility

Check the Actions tab: `https://github.com/jsuzanne/stigix/actions`.
You should see a run labeled **`🚀 Release $NEW_VER`** at the top.

---

## Rules

- **Tag format**: Always use the full version string (e.g., `v2.0.64`). Never push a bare branch name as a tag.
- **Prefix**: Never forget the `$NEW_VER:` prefix in the commit message.
- **Sync**: VERSION files and the git tag must always match exactly.
- **Timing**: Always bump version **before** the tag push.
- **Changelog Verification**: You MUST run the CHANGELOG audit (Step 2bis-A) at every deploy. All missing versions MUST be backfilled — one entry per version — before committing.
- **No Grouping**: Never merge multiple patch versions into a single CHANGELOG entry unless they were released as a single atomic tag.
- **Doc-only**: Skip versioning for README/Documentation-only changes.
