# Prompt for Google Antigravity

You are working in the `jsuzanne/stigix` repository. Implement the **smallest possible, backward-compatible MVP** for direct remote-peer installation and local-registry discovery.

## Product objective

The main objective is **extreme simplicity** for non-technical users during a POC or lab deployment:

1. An administrator deploys one Stigix instance centrally (the **leader/controller**).
2. In the leader UI, the administrator opens **Settings** and copies a single automatically generated command.
3. A remote user pastes that command into a Linux shell on a remote host.
4. The existing Stigix installation process performs the whole installation: download deployment assets, generate local configuration, pull images, start Docker Compose.
5. The newly installed instance automatically joins the explicitly supplied leader, appears in the leader’s existing peer registry, and obtains the other known peers as targets.

The remote user must not need to:

- Clone a Git repository.
- Edit a Docker Compose file.
- Edit `.env`.
- Understand Cloudflare, Prisma credentials, registry election, peers, or targets.
- Select a version, port, role, profile, or token.
- Answer installation questions in the MVP.

The target user experience is only:

```bash
curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/main/scripts/install.sh | sudo bash -s -- --controller https://stigix-central.example.net
```

After the command completes, the peer should be online and visible in the central Stigix UI.

## Critical constraints

- Reuse and extend the **existing installation script**. Do not create a second, unrelated installer architecture.
- Reuse the **existing local registry APIs and registry client/manager implementation** whenever possible.
- Do not replace or regress the existing Cloudflare-based autodiscovery mechanism.
- Add a new direct-controller mode that coexists with the existing automatic/hybrid mode.
- In direct-controller mode, do **not** contact Cloudflare at all.
- Keep the change set deliberately small. Do not build RBAC, per-peer enrollment tokens, multi-controller HA, full configuration synchronization, or a new control plane in this MVP.
- Do not distribute secrets between instances: no Prisma client secrets, no VyOS API keys, no `.env` secrets, no private certificates.
- Preserve standalone installation behavior when `--controller` is not supplied.
- Prefer existing names, directory conventions, image references, Compose files, and API payloads from this repository over guessed alternatives.

## First task: inspect before changing

Before implementation, inspect the repository and identify the exact current behavior and paths for:

- The existing installation script and its published/raw GitHub URL.
- Existing Docker Compose templates and how `.env` is generated or consumed.
- `stigix-registry-client.ts`.
- `registry-manager.ts`.
- Existing `/api/registry/register`, `/api/registry/instances`, and `/api/registry/status` routes.
- Current Cloudflare Bootstrap Worker usage and the conditions which trigger it.
- Current peer heartbeat and peer-list refresh timers.
- Existing environment variable names for `STIGIX_CONTROLLER_URL`, `STIGIX_REGISTRY_ENABLED`, `STIGIX_SITE_NAME`, and `STIGIX_INSTANCE_ID`.
- The Settings component/page where a small generated installation-command card should be added.

Do not invent paths, endpoint payloads, API names, or Docker image names when the repository already has an implementation. Adapt this specification to the actual codebase after inspection.

---

# Stigix Direct Controller Peer Installation — MVP Specification

## Context

Stigix already has a hybrid peer-discovery design:

1. A Cloudflare registry/bootstrap mechanism helps instances discover or elect a leader in automatic mode.
2. A local registry hosted by a Stigix leader maintains peer registration and peer discovery.
3. Peers communicate with the local leader through existing registry endpoints.

The relevant documented local-registry endpoints are:

| Endpoint | Method | Current role |
|---|---:|---|
| `/api/registry/register` | `POST` | Peer registration / heartbeat |
| `/api/registry/instances` | `GET` | Retrieve known peers / targets |
| `/api/registry/status` | `GET` | Registry health and operating mode |

The relevant documented Cloudflare bootstrap endpoints are:

| Endpoint | Method | Current role |
|---|---:|---|
| `/leader` | `GET` / `POST` | Discover or announce current leader |
| `/register` | `POST` | Bootstrap registration |
| `/instances` | `GET` | Bootstrap peer list |

The current product has identity fallbacks based on hostname and supports environment overrides for site/instance/registry values. It has also introduced `STIGIX_CONTROLLER_URL` for remote orchestration workflows.

The new feature must exploit these existing components rather than duplicate them.

## Problem to solve

The legacy auto-discovery mode can require Cloudflare reachability and/or Prisma-derived identity/credentials to bootstrap a group of peers.

For a customer POC, demo, lab, or centrally managed deployment, this is unnecessarily complex. The central administrator already knows the leader address. A remote peer should therefore be able to join the local registry directly using a single explicit controller URL.

## MVP scope

Implement exactly these capabilities:

- A direct-controller registry mode selected by an explicit controller URL.
- A one-line GitHub-hosted installer command shown automatically in the leader Settings UI.
- An installer argument `--controller <URL>` which injects the supplied URL into the local deployment configuration.
- Automatic local registry registration and refresh against the supplied leader.
- Automatic retrieval of the existing peer list from the supplied leader.
- No Cloudflare calls in direct-controller mode.
- Full backward compatibility for existing standalone and Cloudflare/hybrid autodiscovery users.

## Out of scope for MVP

Do not implement these items now:

- One-time enrollment links or per-peer enrollment tokens.
- Shared cluster secrets or advanced token lifecycle.
- Manual approval workflows.
- Peer authorization/RBAC.
- Synchronization of applications, traffic profiles, convergence settings, IoT, voice, or VyOS configuration.
- Secret replication of any kind.
- VyOS command execution across peer boundaries.
- Controller high availability or multiple-controller failover.
- Changes to existing Cloudflare leader election semantics.
- Changes to existing Cloudflare registry behavior when direct-controller mode is not selected.
- Windows installer work, unless the existing installer architecture makes a tiny compatible addition trivial.

These may be proposed as future work, but must not be mixed into this implementation.

---

## Required behavior

### 1. Direct-controller selection

Add a clear direct-controller mode. Its activation rule must be simple and deterministic:

```text
If STIGIX_CONTROLLER_URL is non-empty:
  registry mode = direct
  local leader/controller URL = STIGIX_CONTROLLER_URL
  Cloudflare bootstrap/discovery = disabled
Else:
  retain existing registry/autodiscovery behavior unchanged
```

The direct mode must take precedence over all auto-discovery logic, including any logic based on Prisma credentials or automatic leader lookup.

Normalize the configured URL once:

- Trim whitespace.
- Remove a trailing slash.
- Require `http://` or `https://`.
- Prefer HTTPS in UI messaging and documentation.
- Reject malformed values with a clear diagnostic rather than silently falling back to Cloudflare.

### 2. Direct peer lifecycle

When direct mode is active, the remote Stigix instance must:

1. Preserve or generate its existing stable identity according to the repository’s current identity approach.
2. Use the hostname fallback for the site name when no explicit `STIGIX_SITE_NAME` exists.
3. Contact the explicit leader through the existing local registry registration/heartbeat mechanism.
4. Retrieve the peer list through the existing local registry instances API.
5. Populate/update the same target-discovery state currently used by auto-discovered peers.
6. Keep using the last valid registry snapshot if the controller is temporarily unreachable.
7. Retry using the existing or equivalent heartbeat/discovery cadence.
8. Never query the Cloudflare bootstrap worker while direct mode is selected.

Do not alter the semantics of the actual peer payload or response schema unless required by the existing code. Reuse the existing registration and instances APIs exactly where possible.

### 3. Existing modes remain unchanged

The following modes must continue to work without a direct controller URL:

| Configuration | Expected mode |
|---|---|
| `STIGIX_CONTROLLER_URL` set | `direct` — local leader only, no Cloudflare |
| No controller URL; existing registry prerequisites are satisfied | Existing automatic/hybrid Cloudflare bootstrap behavior |
| No controller URL; registry not enabled | Existing standalone behavior |

The direct-controller addition must be opt-in. No existing deployment should start attempting to contact a controller because of this change.

---

## Installer requirements

### One installer, not two

Modify the existing Stigix installation script to recognize an optional argument:

```text
--controller <URL>
```

The existing no-argument behavior must remain valid:

```bash
curl -fsSL <existing-install-script-url> | sudo bash
```

It should remain an ordinary standalone installation with no direct-controller configuration.

The new direct-peer command is:

```bash
curl -fsSL <existing-install-script-url> | sudo bash -s -- --controller https://stigix-central.example.net
```

Do not force a new script name if the current script can be extended cleanly.

### Installer defaults

When `--controller` is supplied, the installer must automatically:

- Keep the current install directory default.
- Keep the current Docker Compose/image deployment flow.
- Keep the current image tag/default selection.
- Keep the current dashboard port default.
- Set `STIGIX_CONTROLLER_URL` to the supplied normalized URL.
- Set `STIGIX_REGISTRY_ENABLED=true` only if that is necessary in the current implementation; avoid changing unrelated behavior.
- Set `STIGIX_ROLE=peer` only if the current architecture uses or needs such a variable. Do not introduce an unused environment variable.
- Set `STIGIX_SITE_NAME` to the short local hostname only if no explicit site identity is already established by the current installer/runtime. Avoid overwriting an existing user configuration during reinstall or upgrade.
- Ensure a stable `STIGIX_INSTANCE_ID` is generated/preserved according to the existing implementation.
- Start Stigix using the existing Docker Compose commands.

The user must not be asked any questions in the default direct-peer command.

### Non-interactive requirement

The command must work from:

- An interactive SSH shell.
- A pasted terminal command.
- Automation tools such as cloud-init, Ansible, Terraform provisioners, or SSH scripts.

Do not add `read` prompts in the default flow. In particular, `curl | bash` installers should not depend on interactive `stdin` prompts.

Optional future arguments may be supported if inexpensive and consistent with the current script, for example:

```text
--site <name>
--port <port>
--yes
```

But do not put these choices into the leader UI for the MVP. The generated command should remain one line and only include `--controller`.

### Idempotency

The installer should be safe to run again on the same host as far as the existing installer supports it:

- Do not regenerate a different instance identity unnecessarily.
- Do not erase local persistent data, logs, or user configuration.
- Do update the controller URL if `--controller` is explicitly supplied.
- Clearly report if an existing Stigix installation is detected.

### Installer output

Keep output concise and human-friendly. At the end, display only useful information:

```text
Stigix installed successfully.
Site: <hostname-or-site>
Controller: <controller-url>
Dashboard: http://<local-ip-or-hostname>:<port>
Peer registration is starting automatically.
```

If the initial health check or controller reachability is not yet available, do not fail a successful Docker installation solely because registration is delayed. Instead, show one useful command:

```text
docker compose logs -f
```

Use the actual service/install paths from the repository.

---

## Leader UI requirements

### Minimal Settings card

Add one compact card or section in the existing leader Settings UI. Suggested title:

```text
Add a remote Stigix instance
```

It must contain:

1. A configurable leader URL field.
2. A generated one-line installation command.
3. A copy button.

Suggested layout:

```text
Add a remote Stigix instance

Leader URL
[ https://stigix-central.example.net                 ]

Copy and paste this command on the remote Linux host:

curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/main/<actual-script-path> | sudo bash -s -- --controller https://stigix-central.example.net

[ Copy command ]
```

Use the actual canonical raw GitHub URL and script path from the repository. If the project has a version source available in the running application, use the current validated release/tag only if it is already supported cleanly. Otherwise, use the existing `main` behavior consistently.

### Leader URL handling

The application cannot always reliably infer a reachable external URL because it may be deployed behind NAT, reverse proxy, VPN, a public DNS name, or a non-default port. Therefore:

- Provide an editable URL field.
- Pre-fill it with the best available value, such as current browser origin or existing configured controller/public URL.
- Persist it using the project’s existing configuration persistence convention.
- Validate it as an HTTP(S) URL.
- Avoid auto-replacing a manually configured value.

The field is an installation convenience value. It is not a replacement for the current leader-election mechanism.

### UI state

Keep the UI deliberately small. Do not add enrollment wizards, security options, token pickers, role menus, or complex peer management in this MVP.

If easy using current registry status data, show a short status line:

```text
Local registry: active • 4 peers online
```

But this is optional. The primary deliverable is the generated copy-paste command.

---

## Local registry API use

Do not introduce `/api/cluster/*` endpoints for the MVP.

Use the current registry endpoints:

```text
POST /api/registry/register
GET  /api/registry/instances
GET  /api/registry/status
```

The direct peer’s behavior should be logically equivalent to an auto-discovered peer after auto-discovery has found a leader. The difference is only how the leader URL is obtained:

```text
Existing auto mode:
Cloudflare bootstrap/discovery -> discover leader -> local registry APIs

New direct mode:
Installer injects leader URL -> local registry APIs
```

This ensures that target handling, existing UI badges, peer data structures, heartbeat semantics, and registry state are reused rather than forked.

---

## Configuration and secret boundaries

This MVP is only for peer installation and peer discovery. Do not accidentally broaden it into configuration replication.

The leader may expose peer metadata already supported by current registry code, such as:

- instance ID;
- hostname;
- site name;
- reported endpoint(s);
- version;
- capabilities;
- liveness/last-seen data.

Do not send or copy:

- `PRISMA_SDWAN_CLIENT_SECRET`;
- any Prisma service-account credentials;
- VyOS API keys;
- `.env` files;
- JWT secrets;
- private keys, client certificates, or refresh tokens;
- local router-management addresses unless already intentionally included in the existing peer metadata.

A later phase may add a versioned configuration bundle API for non-sensitive application profiles, convergence settings, target catalogues, and declarative VyOS scenarios. That is explicitly not part of this implementation.

---

## Logging and diagnostics

The feature needs enough diagnostics to make remote deployments supportable, but no noisy logs.

### Peer logs

Log clear state transitions:

```text
Registry mode: direct
Direct controller: https://stigix-central.example.net
Local registry registration successful
Registry snapshot updated: <n> peers
Controller unavailable; retaining last known registry snapshot
Retrying direct controller registration in <n>s
```

Never log secrets or full authorization headers.

### Registry status

If the existing registry status model supports it, expose a mode indicator such as:

```json
{
  "enabled": true,
  "mode": "direct",
  "controllerUrl": "https://stigix-central.example.net"
}
```

Only extend response schemas in a backward-compatible manner.

### Failure behavior

| Failure | Expected behavior |
|---|---|
| Bad controller URL in installer | Fail early with a clear error; do not silently use Cloudflare |
| Leader unreachable at first boot | Containers remain running; peer retries; logs explain state |
| Leader later becomes unreachable | Keep last known peer snapshot; retry normally; local Stigix continues working |
| Cloudflare unreachable in direct mode | No impact; it must not be contacted |
| Cloudflare unreachable in auto mode | Preserve existing behavior unchanged |
| No Docker / Compose | Preserve or improve existing installer diagnostics |

---

## Acceptance criteria

### Direct mode

- [ ] `STIGIX_CONTROLLER_URL` activates direct registry mode.
- [ ] Direct mode sends registration/heartbeat traffic only to the explicit leader using existing local registry APIs.
- [ ] Direct mode retrieves peer instances/targets from the explicit leader using existing local registry APIs.
- [ ] Direct mode makes no Cloudflare bootstrap/discovery calls.
- [ ] The peer retains a last-known-good peer list when the leader is unavailable.
- [ ] Site naming defaults to the local hostname when no site override is supplied.

### Backward compatibility

- [ ] Existing standalone installation remains unchanged when `--controller` is absent.
- [ ] Existing Cloudflare/hybrid discovery remains unchanged when `STIGIX_CONTROLLER_URL` is absent.
- [ ] Existing peer discovery and target UI behavior continue to work.
- [ ] Existing environment variable behavior is not broken.

### Installer

- [ ] The existing installation script accepts `--controller <URL>`.
- [ ] The one-line `curl | sudo bash -s -- --controller ...` command works non-interactively.
- [ ] It writes the required controller configuration into the existing local deployment configuration.
- [ ] It reuses existing Docker Compose deployment assets and image configuration.
- [ ] It starts Stigix successfully and does not require manual file editing.
- [ ] It is safe to rerun without unnecessarily losing stable local identity/data.

### UI

- [ ] Leader Settings includes a compact editable leader URL field.
- [ ] It displays the generated one-line peer installation command.
- [ ] The Copy button copies the exact displayed command.
- [ ] A manually configured leader URL persists and is not overwritten automatically.

### Quality

- [ ] Unit or focused integration tests cover direct-mode selection and Cloudflare bypass logic.
- [ ] Tests or mocks verify registration and instance retrieval against a configured controller URL.
- [ ] Existing registry tests remain green.
- [ ] Lint, build, and relevant test suites pass.
- [ ] Documentation is updated with a concise “Install a remote peer” section.

---

## Suggested implementation order

1. Inspect the existing installer, Compose templates, registry client, registry manager, routes, and Settings UI.
2. Add direct-mode precedence to the registry client:
   - Normalize `STIGIX_CONTROLLER_URL`.
   - Bypass Cloudflare bootstrap entirely when present.
   - Reuse local leader registration/list APIs.
3. Verify a manually configured controller URL causes a peer to register and retrieve the peer list.
4. Extend the existing install script with `--controller` and inject the controller URL into the existing configuration path.
5. Add the compact generated-command card to Settings.
6. Add focused tests and concise documentation.
7. Validate all three modes: standalone, existing auto/hybrid, and new direct-controller mode.

---

## Expected final deliverables

Provide:

- The code changes implementing direct-controller registry mode.
- The updated existing installer script with `--controller` support.
- The Settings UI card showing an editable leader URL and generated one-line install command.
- Focused tests for mode precedence and Cloudflare bypass.
- Short documentation explaining installation of a remote peer.
- A concise implementation summary stating:
  - actual files changed;
  - actual API endpoints reused;
  - how direct mode is selected;
  - how backward compatibility was maintained;
  - commands used to test the feature.
