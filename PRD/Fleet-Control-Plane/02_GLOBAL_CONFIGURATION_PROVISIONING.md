# Prompt for Google Antigravity

You are working in the `jsuzanne/stigix` repository. Implement the next feature after the direct-controller peer installation work described in `STIGIX_DIRECT_CONTROLLER_PEER_INSTALLATION_SPEC.md`: **centralized global configuration provisioning with safe local overrides**.

## Product objective

Stigix must let an administrator configure common POC/lab settings **once on the central leader** and automatically apply them to many remote peers (for example 50 branches). The remote operator must not have to repeat the same application, probe, or security configuration on every instance.

The product experience must remain extremely simple:

1. The leader is the place where the administrator creates or changes shared configuration.
2. The administrator explicitly clicks **Publish**.
3. Connected peers automatically pull the published configuration.
4. A peer may still have local adaptations.
5. Local adaptations survive later global publications.
6. Existing instances and existing flat configuration files remain safe and usable.
7. Secrets are never distributed.

Do not redesign the existing Stigix configuration system. Reuse existing config formats, existing export/import behavior, existing config APIs, existing file locations, and current hot-reload behavior whenever possible.

## Critical constraints

- This specification assumes the direct-controller registry feature exists or is being implemented separately. It must remain coherent with that design.
- The registry answers **who are the peers?** Configuration provisioning answers **which configuration should a peer apply?** Keep these concerns separate.
- Do not replace current flat files under `config/` with a mandatory new directory tree.
- Do not alter the runtime path used by the existing engines unless genuinely required.
- Existing flat configuration files must remain the active files consumed by Stigix.
- Global provisioning must be **disabled by default for existing instances**. No upgrade may silently overwrite or modify a customer’s current configuration.
- New peers installed through the new direct-controller installer may have global provisioning enabled by default, because this is an explicit centrally managed installation path.
- Do not copy secrets: no Prisma credentials, VyOS API keys, JWT secrets, `.env`, private keys, certificates, refresh tokens, or host-specific management credentials.
- Prefer small, incremental code changes and reuse current export/import validation paths where practical.
- Do not build all configuration domains in the first implementation. Start with the defined MVP scope only.

## First task: inspect before changing

Before coding, inspect and document the actual repository paths and behavior for:

- The direct-controller registry feature and how peers identify their leader.
- Existing configuration files and schemas for applications, connectivity probes, security, convergence, voice, IoT, XFR, and VyOS.
- Existing import/export endpoints, frontend actions, and any validation logic.
- The precise runtime readers/writers of the current flat configuration files.
- Existing hot-reload/watch behavior.
- Existing persistence conventions for configuration state.
- Existing registry heartbeat and peer metadata payloads, so provisioning status can be associated with stable peer IDs.
- Current UI components/pages for applications, probes, security configuration, and Settings.

Use the actual codebase. Do not assume file names, API names, payload shapes, or frontend component names merely because this specification gives suggested names.

---

# Stigix Global Configuration Provisioning and Local Overrides

## Relationship to direct-controller installation

This feature is phase 2 of centralized remote-peer management.

Phase 1 — Direct peer installation and local registry:

```text
Leader Settings shows one copy-paste command
        ↓
Remote user installs Stigix with --controller <leader URL>
        ↓
Peer joins the leader’s local registry directly
        ↓
Peer discovers other peers / targets
        ↓
No Cloudflare dependency in direct-controller mode
```

Phase 2 — This feature:

```text
Administrator configures shared settings once on leader
        ↓
Administrator clicks Publish
        ↓
Leader creates an immutable global configuration revision
        ↓
Peers pull changed configuration bundles
        ↓
Each peer applies Global + Local Override safely
        ↓
Leader shows rollout compliance/status
```

The direct registry remains responsible for peer presence and target discovery. Provisioning is a distinct lightweight capability running through the same controller URL.

## Problem statement

Stigix currently supports configuration export/import, allowing configuration to be cloned manually between instances. That is useful, but it does not scale to 50 peers: the administrator would need to export once and import repeatedly, then repeat the process after each change.

The desired model is:

```text
Configure once centrally → Publish once → All eligible peers update automatically
```

At the same time, each site may require a local exception, for example:

- A local ERP URL or branch-specific endpoint.
- A LAN gateway probe.
- A shorter probe interval at one site.
- A different voice target.
- A local interface mapping.

The solution must preserve local changes when the leader publishes a newer global configuration.

---

## Design principles

### 1. Global configuration is explicit

A change made on the leader is not automatically sent while it is being edited. The administrator explicitly chooses:

```text
Publish globally
```

This prevents partially edited configuration from being pushed to many sites.

### 2. Peers pull; leader does not push files

Peers periodically check the leader’s provisioning manifest and fetch only changed bundles.

Benefits:

- Works naturally with intermittent WAN connectivity.
- Avoids the leader needing direct inbound connectivity to every branch.
- Scales cleanly to dozens of peers.
- Lets peers retain the last valid configuration when the controller is unavailable.

### 3. Flat active files stay flat

The existing files under the existing `config/` location remain the live files read by Stigix engines.

Provisioning metadata, snapshots and local override information are stored separately in an internal hidden directory, for example:

```text
config/
├── applications-config.json          # Existing active file; engines continue using it
├── connectivity-custom.json          # Existing active file; engines continue using it
├── <existing security config files>  # Existing active files
│
└── .stigix-provisioning/             # New internal state only
    ├── state.json
    ├── global/
    ├── local-overrides/
    └── backups/
```

Use actual existing paths and names discovered in the repository. The example layout illustrates intent only.

This is deliberately not a mandatory `defaults/global/local/effective` migration. Runtime configuration stays simple and remains where it is today.

### 4. Local overrides are first-class

A peer must be able to adapt a global object locally through the normal UI.

The effective behavior is:

\[
\text{Effective configuration} = \text{Global configuration} + \text{Local overrides}
\]

Precedence is:

```text
1. Explicit local override
2. Published global value
3. Existing built-in/default Stigix value
```

### 5. Never silently overwrite local state

A global publish must not erase a local addition or local override. If the leader deletes a globally published object that has a local override, mark it as orphaned rather than silently deleting it.

### 6. Secrets remain local

Global provisioning is for shareable configuration definitions and profiles. It must never become a secret-distribution channel.

---

## Provisioning mode and migration behavior

### Existing instances

For all existing Stigix deployments after upgrade:

```text
Global provisioning: OFF
```

Their active configuration files remain untouched. They continue to work exactly as before.

The local administrator can explicitly enable provisioning from the peer UI or leader workflow:

```text
Enable global configuration
```

When enabled for the first time:

1. Create an automatic backup of existing active configuration files.
2. Preserve existing configuration as local content/overrides according to the domain’s merge model.
3. Download and validate the global baseline.
4. Build the effective active configuration.
5. Replace active files atomically only after validation succeeds.
6. Report the result to the leader.

If any step fails, do not modify active files.

### New peers installed from leader

A peer deployed through the direct-controller command may default to:

```text
Global provisioning: ON
```

This is safe because it is a new controlled installation and the user’s explicit intent is to join the central lab.

### Disabling provisioning

If global provisioning is disabled on a peer:

- Stop future global synchronization.
- Keep the currently effective flat files in place.
- Do not delete local configuration.
- Do not move or erase backups.
- Display that the peer is no longer centrally managed for configuration.

This makes rollback to traditional local management simple and non-destructive.

---

## MVP scope

Implement provisioning in phases. The first release must support only the lowest-risk, highest-value domains.

### MVP global domains

| Domain | Global content | Local override examples | Why in MVP |
|---|---|---|---|
| Applications / traffic profile | SaaS/application catalogue, domain, endpoint, category, traffic weight, global traffic settings where safe | Local enable/disable, local endpoint, local weight where allowed | High value for SD-WAN/SASE POCs; established structured config exists |
| Connectivity probes | Probe name, type, target, timeout, enabled state, standard interval if present | Branch endpoint/IP, enable/disable, interval/timeout where allowed, branch-only probe | Immediate POC value; current custom probe config exists |

The existing application configuration supports structured application definitions such as domain, weight, endpoint and category. Existing connectivity configuration supports structured probe definitions including name, type, target, timeout and enabled state. Reuse these formats where possible. [file:1][file:6]

### Phase 2 domains

After applications and probes are stable:

| Domain | Global content | Always local / special handling |
|---|---|---|
| Security test profiles | Test selection, schedules, EDL references, non-secret parameters | Credentials and secrets remain local; destructive/active test controls need safeguards |
| Convergence policy | Thresholds and policy settings | Site-specific destinations and local parameters can override if allowed |
| Voice profiles | Codec, logical target profile, weights, call duration | Physical interface and branch-specific IP/target mapping remain local |
| IoT profiles | Device catalogue, behavior, protocols, security behavior | Interface, network context, MAC/IP collision avoidance and site-specific addressing remain local |
| XFR / iperf profiles | Non-secret test settings and logical target definitions | Local binding/interface and reachable endpoint mapping remain local |
| VyOS scenarios | Declarative scenario definitions only | Router management IP, API key, credentials, local interface mapping always remain local |

### Explicitly excluded from MVP

- Full global security configuration implementation.
- Global VyOS inventory or API key replication.
- Global `.env` management.
- Interface configuration propagation.
- Prisma credential propagation.
- Complex per-field RBAC.
- Multi-controller configuration authority.
- Arbitrary remote file transfer.
- Bi-directional peer-to-leader configuration editing.

---

## Object identity requirement

Global/local merge is only safe if objects use stable IDs.

### Requirement

Every globally provisioned object must have a stable `id` that does not change when its display name changes.

Example for a connectivity probe:

```json
{
  "id": "probe-m365-teams",
  "name": "Microsoft Teams",
  "type": "HTTPS",
  "target": "https://teams.microsoft.com",
  "timeout": 5000,
  "enabled": true
}
```

Example for an application:

```json
{
  "id": "app-m365-teams",
  "domain": "teams.microsoft.com",
  "endpoint": "/api/mt/emea/beta/users/",
  "category": "Microsoft 365 Suite",
  "weight": 76,
  "enabled": true
}
```

### Backward-compatible ID migration

Existing configurations may not contain IDs. Do not break them.

Implement a deterministic migration/normalization strategy after inspecting current formats:

- Preserve an existing ID if present.
- Otherwise derive a deterministic ID from a canonical identity such as normalized type + target for probes, or normalized domain + endpoint for applications.
- Store the normalized ID in provisioning metadata or add it to the schema only if current readers tolerate unknown fields.
- Avoid changing legacy user-visible configuration unnecessarily.
- Detect duplicates and present an actionable error rather than merging ambiguous objects.

Do not use mutable display names as merge keys.

---

## Effective configuration workflow

### Leader workflow

1. Administrator edits Applications or Connectivity Probes on the leader using existing UI and existing configuration workflow.
2. The leader continues to use its normal active configuration.
3. Administrator chooses:

```text
Publish globally
```

4. The leader validates the chosen domain using the existing validation/import path where available.
5. The leader creates an immutable revision for that domain.
6. The leader calculates a checksum for the published payload.
7. The leader updates a global provisioning manifest.
8. Eligible peers discover the new revision at their next sync.

### Peer workflow

1. Peer fetches the provisioning manifest from its configured leader.
2. Peer compares manifest revisions/checksums with its local provisioning state.
3. Peer downloads only bundles that changed.
4. Peer validates the downloaded bundle.
5. Peer loads its own local override data.
6. Peer merges global content with local overrides.
7. Peer validates the merged effective configuration.
8. Peer creates a backup of the currently active file.
9. Peer writes the active existing flat configuration file atomically.
10. Existing hot-reload behavior applies the new configuration without changing engine file paths.
11. Peer reports success/failure and active revision to the leader.

### Atomicity requirement

Never write a partially downloaded or partially merged configuration into an active file.

Use a safe sequence equivalent to:

```text
Download -> checksum -> schema validation -> merge -> effective validation -> write temp file -> atomic rename
```

If anything fails, retain the previous active file and previous active revision.

---

## Bundle and manifest model

Do not use one monolithic `global-config.json`. A bad probe update must not block or roll back applications, and vice versa.

### Suggested logical bundles

```text
applications
connectivity-probes
security             # Phase 2
convergence          # Phase 2
voice                # Phase 2
iot                  # Phase 2
xfr                  # Phase 2
vyos-scenarios       # Phase 2, no secrets
```

### Suggested manifest shape

Adapt field names to current code conventions, but retain these semantics:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-30T11:00:00Z",
  "bundles": [
    {
      "type": "applications",
      "revision": 17,
      "checksum": "sha256:...",
      "scope": "all"
    },
    {
      "type": "connectivity-probes",
      "revision": 8,
      "checksum": "sha256:...",
      "scope": "all"
    }
  ]
}
```

A peer records locally:

```json
{
  "applications": {
    "globalRevision": 17,
    "checksum": "sha256:...",
    "appliedAt": "2026-08-30T11:01:12Z",
    "status": "applied"
  },
  "connectivity-probes": {
    "globalRevision": 8,
    "checksum": "sha256:...",
    "appliedAt": "2026-08-30T11:01:13Z",
    "status": "applied"
  }
}
```

### Immutability and retention

Published revisions must be immutable. Keep at least a small bounded history per bundle so the leader can roll back to a prior revision.

The exact retention count can be conservative for the MVP, for example the latest 10 revisions, but avoid unbounded disk growth.

---

## API design

Keep provisioning APIs distinct from existing registry APIs.

Do not create `/api/cluster/*` APIs.

Suggested API family:

| Endpoint | Method | Caller | Purpose |
|---|---:|---|---|
| `/api/provisioning/manifest` | `GET` | Peer | Get current revisions/checksums applicable to the peer |
| `/api/provisioning/bundles/:type/:revision` | `GET` | Peer | Download a specific immutable bundle |
| `/api/provisioning/status` | `POST` | Peer | Report application status/revision/error |
| `/api/provisioning/publish/:type` | `POST` | Leader UI | Publish current leader config for one domain |
| `/api/provisioning/rollback/:type/:revision` | `POST` | Leader UI | Publish an earlier immutable revision again |

These endpoint names are suggestions. If the repository has established API conventions, follow them. The separation is mandatory; exact naming is not.

### Peer association

Provisioning status must be associated with the existing stable peer/instance identity used by the registry. Do not invent a parallel peer identity model.

### Scope in MVP

MVP scope is simply:

```text
all connected peers with global provisioning enabled
```

Design the manifest so future scopes can be added, but do not build complex group/label assignment yet.

Future examples, not MVP requirements:

```json
{ "scope": { "mode": "all" } }
```

```json
{ "scope": { "mode": "selected-peers", "peerIds": ["peer-1", "peer-2"] } }
```

```json
{ "scope": { "mode": "labels", "match": { "region": "emea" } } }
```

---

## Local override model

### User interaction

On a centrally managed peer, users continue to use normal Stigix configuration screens.

For a globally managed object, expose a simple action:

```text
Override locally
```

Once modified, label it:

```text
Overridden locally
```

To return to central behavior:

```text
Restore global value
```

For a newly created object on a peer, label it:

```text
Local
```

It is not sent to other peers and it is not modified by global publications.

### Required UI indicators

Use clear, minimal visual source indicators:

| State | Meaning |
|---|---|
| `Global` | Object is inherited unchanged from the leader |
| `Overridden locally` | Object originated globally but has local field changes |
| `Local` | Object only exists on this peer |
| `Orphaned local` | Its global parent was removed but a local override remains |

Do not build a complicated configuration editor. Preserve existing screens and add only source badges/actions needed for safe behavior.

### Merge behavior

For each object ID:

- Global object with no local override: use the global object.
- Global object with local override: merge only fields allowed for local override.
- Local-only object: append to effective configuration.
- Global object deleted while local override exists: preserve it as `orphaned local`; never silently delete it.

### Allowed override fields

For the MVP, keep local override behavior conservative and explicit.

#### Applications

Potential local override fields:

```text
enabled
weight
endpoint
```

Do not permit local changes to immutable identity fields (`id`) or fields that would make merge ambiguous.

#### Connectivity probes

Potential local override fields:

```text
enabled
target
timeout
interval
```

Only include `interval` if it exists in the current probe schema.

The leader’s bundle may later declare field-level policy. For the MVP, a fixed documented allowlist per bundle type is sufficient.

---

## Deletion and orphan handling

Do not let global deletes cause accidental branch breakage.

### Global object deletion

If the leader removes an object from a new global revision:

- Peers without a local override remove it from their effective configuration on successful application of the new revision.
- Peers with a local override preserve their local effective object.
- Mark that local object as `Orphaned local`.
- Report the orphan to the leader.

Example leader status:

```text
BRANCH-LYON-01
Applications revision 18: Applied with 1 orphaned local override
Object: app-legacy-erp
```

A peer UI should offer simple actions:

```text
Keep local
Delete local
Restore from global when republished
```

Do not automatically delete orphaned local objects.

---

## Rollback

Every global publish creates an immutable revision. The leader must show recent revisions and allow an administrator to select a prior known-good revision.

The rollback action should create a new current publication pointing to or republishing the selected historical content. Do not mutate historical revisions.

Peer behavior remains normal:

```text
Manifest changes -> peer downloads selected revision -> validates -> merges local override -> applies atomically
```

Rollback must retain local overrides exactly as a normal newer revision would.

---

## Migration without disruption

### Fundamental rule

No existing runtime component should need to know whether a value originated globally or locally. It continues reading the existing flat active configuration files.

### First enable sequence

For a legacy peer that chooses to enable global provisioning:

```text
1. Backup current active flat files.
2. Save current values as local baseline/override state.
3. Fetch global bundle.
4. Normalize IDs and validate both sides.
5. Merge global + preserved local state.
6. Validate merged result.
7. Atomically update existing active flat file.
8. Notify engines via existing hot reload behavior.
9. Report status to leader.
```

### Safety fallback

If migration/normalization cannot be performed safely because of ambiguous or duplicate identifiers:

- Do not enable provisioning for that bundle on that peer.
- Do not modify the current active file.
- Mark the peer/bundle as `Needs attention`.
- Give a direct explanation, such as:

```text
Cannot enable global Applications provisioning: two local applications resolve to the same identity key.
```

This is better than silently choosing one entry and losing configuration.

---

## Leader user experience

The leader should be the central source of truth but the UI must remain lightweight.

### Suggested location

Add a `Global configuration` section in Settings, or add small publish controls in each existing configuration page. Choose the approach that minimizes frontend disruption and is clearest in the existing UI.

### MVP UI

For Applications and Connectivity Probes, display something equivalent to:

```text
Global configuration

Applications
Current global revision: 17
Last published: 2026-08-30 12:00
[ Publish applications ]  [ Revision history ]

Connectivity probes
Current global revision: 8
Last published: 2026-08-30 12:02
[ Publish probes ]  [ Revision history ]
```

A global dashboard summary can be simple:

```text
Global configuration rollout

Applications rev 17: 46 applied • 3 pending/offline • 1 failed
Probes rev 8:       48 applied • 2 pending/offline
```

Do not introduce wizards, per-peer token management, elaborate policy editors, or multi-stage change approval in the MVP.

### Publish confirmation

Because Publish changes many peers, require a clear confirmation showing:

```text
Publish Applications revision 17 to all centrally managed peers?
```

Show a concise change summary if readily available. This protects against accidental mass rollout while preserving a simple workflow.

---

## Peer user experience

A peer needs only a small status section, for example in Settings:

```text
Global configuration: Enabled
Source: https://stigix-central.example.net
Last sync: 12:05:14
Applications: Revision 17 — Up to date
Probes: Revision 8 — Up to date
Local overrides: 2
```

If a failure occurs:

```text
Applications: Revision 17 — Failed validation
Using local effective revision 16
```

The peer must remain functional during leader outages. It uses the last successfully applied configuration and retries at the normal provisioning interval.

---

## Security boundaries

### Safe global content

Global provisioning may distribute only non-secret declarative configuration such as:

- Application catalogues and weights.
- Connectivity probe definitions.
- Non-secret security test profiles in a future phase.
- Convergence thresholds in a future phase.
- Voice/IoT logical profiles in a future phase.
- Declarative VyOS scenarios in a future phase.

### Never global

Never distribute:

- Prisma client ID/secret, TSG credentials, access tokens or refresh tokens.
- VyOS API keys or router credentials.
- JWT secrets.
- `.env` values containing secrets.
- SSH keys, private certificates or CA private keys.
- Host-specific network interfaces, routes, default gateway or management IPs.
- Local logs, result history or user accounts.

Stigix already documents that Prisma credentials should be stored in environment/secrets mechanisms, not committed, and should use least privilege. Preserve that model. [file:24]

---

## Reliability and operational behavior

### Caching

Each peer stores:

- Last successfully applied global revision/checksum per bundle.
- Last downloaded global bundle.
- Local override state.
- Last effective configuration backup.
- Last sync status/error.

### Controller outage

If the leader is unreachable:

```text
Provisioning controller unavailable.
Keeping global revision 17 and local overrides.
Retrying later.
```

Do not reset, clear, or revert peer configuration simply because the leader cannot be reached.

### Scale

For 50 peers, periodic manifest polling is sufficient.

Recommended logical behavior:

- Retrieve a small manifest at a modest interval, ideally reusing/aligning with existing registry heartbeat/discovery cadence.
- Download a bundle only when revision/checksum differs.
- Report status after each apply attempt and periodically if appropriate.

Do not implement WebSocket fanout, queues, or event infrastructure unless existing architecture already makes it trivial. Pull plus a manifest is simpler and more robust for the intended POC/lab use case.

### Logs

Use concise, supportable logs:

```text
Provisioning enabled: controller https://stigix-central.example.net
Provisioning manifest unchanged
Applications global revision 17 downloaded
Applications effective configuration applied successfully
Applications revision 18 rejected: invalid target URL
Retaining previous active configuration
```

Never log secret values.

---

## Suggested implementation order

1. Inspect existing config storage, import/export, validation, runtime readers/writers and direct-controller registry code.
2. Introduce provisioning state storage under a hidden internal directory without changing active config paths.
3. Implement manifest and immutable revision storage on the leader for Applications only.
4. Implement peer pull, validation, merge, atomic active-file write, state persistence, and status reporting for Applications.
5. Add leader publish/status UI and peer source/override indicators for Applications.
6. Add Connectivity Probes using the same generic provisioning framework.
7. Add backups, rollback and orphan handling for the two MVP domains.
8. Add focused tests and validate legacy migration paths.
9. Only after the MVP is stable, consider Security profiles and the other Phase 2 domains.

---

## Acceptance criteria

### Safety and compatibility

- [ ] Existing deployments remain unchanged after upgrade; global provisioning is OFF by default.
- [ ] Existing flat active configuration files remain the runtime source used by existing Stigix engines.
- [ ] Enabling provisioning creates a backup before any active config change.
- [ ] Failed downloads, validation failures or merge failures never overwrite active config.
- [ ] Disabling provisioning stops sync without deleting or moving active config.
- [ ] Existing Cloudflare/hybrid registry and direct-controller registry modes are unaffected.

### Leader publishing

- [ ] Leader can publish Applications globally as an immutable revision.
- [ ] Leader can publish Connectivity Probes globally as an immutable revision.
- [ ] Leader maintains a manifest with per-bundle revision and checksum.
- [ ] Leader retains bounded revision history.
- [ ] Leader can roll back to a prior revision.
- [ ] Leader displays basic rollout status per peer and bundle.

### Peer synchronization

- [ ] Enabled peers poll the leader manifest and download only changed bundles.
- [ ] Peers verify checksum and schema before application.
- [ ] Peers merge global configuration with local overrides.
- [ ] Peers atomically write the effective result to existing active flat config files.
- [ ] Peers report applied, pending, failed and orphaned status.
- [ ] Peers remain usable with the last valid configuration while the leader is unavailable.

### Local override behavior

- [ ] A globally inherited object can be overridden locally via the normal peer UI.
- [ ] A user can restore a globally inherited object to the global value.
- [ ] Locally created objects are preserved through global updates.
- [ ] A global deletion does not delete an object that has a local override; it becomes orphaned local.
- [ ] UI clearly distinguishes Global, Overridden locally, Local and Orphaned local.

### Security

- [ ] No secret configuration is included in a bundle, manifest, revision history, peer status payload or logs.
- [ ] Prisma and VyOS credentials remain local.
- [ ] No `.env` replication is introduced.

### Quality

- [ ] Unit tests cover merge precedence, allowed local fields, deletion/orphan handling, duplicate identity detection and atomic failure behavior.
- [ ] Integration tests or mocks cover leader publication, peer manifest polling, bundle download, status reporting and rollback.
- [ ] Existing import/export behavior remains functional.
- [ ] Build, lint and relevant tests pass.
- [ ] Documentation explains the simple end-user workflow and safe migration behavior.

---

## Expected final deliverables

Provide:

- A generic internal provisioning framework that supports Applications and Connectivity Probes.
- Leader-side immutable global revisions, manifest generation, publish, status and rollback.
- Peer-side pull, validation, merge, backup, atomic apply, cache and status reporting.
- Minimal leader UI controls for publish/history/status.
- Minimal peer UI status plus Global/Local/Override source indicators.
- Safe opt-in migration for existing peers.
- Focused tests.
- Concise documentation covering:
  - What global provisioning is.
  - What is included in the MVP.
  - What always remains local.
  - How to publish once to many peers.
  - How to override locally.
  - How to restore a global value.
  - How migration and rollback remain safe.
- A final implementation summary listing actual files changed, actual endpoints added/reused, test commands executed, and any deliberate deviations from this specification based on repository reality.
