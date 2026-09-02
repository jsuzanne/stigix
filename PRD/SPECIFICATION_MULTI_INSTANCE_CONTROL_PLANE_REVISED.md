# Prompt for Google Antigravity

You are working in the `jsuzanne/stigix` repository. This document defines **Phase 3** of the multi-instance roadmap: remote fleet observability and remote control from a central Stigix control-plane instance.

Before implementing anything, read these two prerequisite specifications and treat them as architectural contracts:

1. `STIGIX_DIRECT_CONTROLLER_PEER_INSTALLATION_SPEC.md` — Phase 1: one-line installation, direct controller URL, peer registration to local registry, no Cloudflare use in direct mode.
2. `STIGIX_GLOBAL_CONFIGURATION_PROVISIONING_SPEC.md` — Phase 2: leader-published global configuration, peer pull, local overrides, flat active runtime config files, safe opt-in migration.

## Mandatory coherence rules

- This Phase 3 control plane is **not** the registry and is **not** the configuration-provisioning engine.
- Reuse the existing local registry as the authoritative source for peer identity, presence, liveness, capabilities, controller association, and management reachability metadata.
- Reuse Phase 2 provisioning status; do not create another competing configuration push/deploy mechanism.
- A central control-plane instance may be **off-path**. It does not need to generate traffic, host test targets, have a data-plane role, or be reachable as a target from every peer.
- A control-plane instance can be installed in a central site, a DC, a cloud VM, a management network, a POC environment, or another suitable management location.
- Each remote Stigix peer remains autonomous and continues to work locally if the controller is unavailable.
- In the initial remote-control implementation, do not assume the controller can establish inbound HTTPS connectivity to every branch. Prefer an **agent-pull job model** over controller-to-peer direct REST calls, because peers already establish outbound connectivity to the controller for registry heartbeats and provisioning pulls.
- Do not expose or distribute secrets. Do not share the regular Stigix JWT secret across instances.
- Do not implement this Phase 3 work in the same release as Phase 1 or Phase 2. Finish, test, and release each prerequisite separately.

## Required first task

Inspect the actual repository before editing. Verify:

- Current direct-controller registry client/manager and actual local registry routes.
- Actual peer heartbeat payload and persistent identity fields.
- Current Phase 2 provisioning APIs/status model, if present.
- Existing local APIs for traffic, convergence, voice, XFR, VyOS, health, system state, and maintenance.
- Existing MCP distributed orchestration features and whether an existing client abstraction can be reused.
- Existing authentication, audit, persistence, WebSocket/SSE and job-related utilities.

Do not invent endpoint names, payloads, source paths, or authentication mechanisms where current code already has equivalents. Adapt the implementation to the repository.

---

# Stigix — Specification: Multi-Instance Control Plane

**Status:** Revised proposal, aligned with direct peer installation and global configuration provisioning  
**Version:** 0.2  
**Audience:** Stigix development / Google Antigravity  
**Language:** English for implementation clarity

## Objective

Add a remote multi-instance control capability to Stigix from one central **Control Plane** instance, also called **Controller** or **Hub** in the UI.

The Control Plane lets an operator:

- See the health and state of all registered Stigix peers.
- View consolidated operational metrics.
- Trigger approved remote actions on one or multiple peers.
- Track execution as durable jobs with per-peer results.
- Review configuration rollout status produced by Phase 2.
- Keep an auditable record of remote actions and failures.

The Control Plane must not replace local Stigix autonomy. Each peer stays usable locally and continues to generate traffic, run tests, retain configuration, and collect local results when the Control Plane is unavailable.

## Scope boundary

This document deliberately narrows the older broad “Hub calls every agent directly” model.

### Registry

Registry answers:

```text
Which peers exist, where are they, which capabilities do they declare, and are they alive?
```

It is already handled by the local registry and direct-controller bootstrap from Phase 1.

### Provisioning

Provisioning answers:

```text
Which global configuration revision should this peer apply, and what local overrides remain?
```

It is handled by Phase 2 through immutable revisions, peer pull, local overrides, atomic apply, status and rollback.

### Control Plane

Control Plane answers:

```text
What do I want remote peers to do now, and what happened on each peer?
```

It creates commands/jobs, peers pull those jobs through their existing outbound controller relationship, execute locally using their existing local APIs/service logic, then report results.

Do not add a second configuration deployment engine under `/api/fleet/config/*`. Configuration rollout must use the Phase 2 provisioning framework.

---

## Why agent-pull is the MVP

A controller can be off-path:

- It may be installed on a management VM, in a DC, in a cloud VPC/VNet, on a central site, or even on a laptop used for a POC.
- It may not be a traffic target or a traffic generator.
- It may have no direct route, NAT traversal, port forwarding, Tailscale access, reverse-proxy reachability, or inbound HTTPS access to remote branches.

The remote peer, however, already contacts the controller in direct-controller mode to register and retrieve peer/provisioning data. The safest and most generally deployable control pattern is therefore:

```text
Control Plane stores a job
        ↓
Peer polls/pulls jobs over its outbound controller connection
        ↓
Peer validates and runs the action locally
        ↓
Peer posts sanitized result to Control Plane
```

This avoids requiring the controller to call directly into branches.

A future direct controller-to-agent REST transport may be added for labs with management reachability, but it must be optional and must not be the required MVP transport.

---

## Roles

| Role | Responsibility |
|---|---|
| **Peer / Agent** | Stigix instance in a branch, DC, cloud location or lab. It generates traffic, runs local probes/tests, applies global configuration, polls jobs, executes allowed commands locally, and reports status/results. |
| **Control Plane / Controller** | Central Stigix instance that receives registry information, stores fleet state, publishes configuration through Phase 2, creates jobs, collects results and provides the Fleet UI. It may be off-path. |
| **Registry** | Existing local registry used for peer identity, heartbeat, discovery, liveness, capability and management metadata. |
| **Operator** | Authenticated user viewing fleet data or requesting permitted remote actions. |

Do not conflate the Control Plane role with a traffic target role. A controller must be able to be deployed without target services or a data-plane test function.

---

## Deployment modes

### Control Plane only

Recommended for central management:

```text
Central Stigix Control Plane
- Registry enabled
- Fleet UI enabled
- Provisioning authority enabled
- Remote job API enabled
- Traffic generation optional/off by default
- Target responder services optional/not required
```

### Combined controller and peer

Useful in a small lab:

```text
One Stigix instance can be both:
- Control Plane for other peers
- A normal local traffic/test instance
```

The implementation must not assume this combined mode. The Fleet feature must work when the controller has no data-plane role.

### Standalone peer

An instance without a controller keeps its existing standalone behavior.

---

## Architecture

```mermaid
graph TB
    U[Operator Browser] --> CP[Stigix Control Plane UI]

    CP --> LR[Local Stigix Registry]
    CP --> PS[Global Provisioning Service]
    CP --> JS[Remote Job Store]
    CP --> AS[Audit Store]

    P1[Stigix Peer Paris] -->|Registry heartbeat / peer discovery| LR
    P2[Stigix Peer Milan] -->|Registry heartbeat / peer discovery| LR
    P3[Stigix Peer DC1] -->|Registry heartbeat / peer discovery| LR

    P1 -->|Manifest / global config pull| PS
    P2 -->|Manifest / global config pull| PS
    P3 -->|Manifest / global config pull| PS

    P1 -->|Job poll and result post| JS
    P2 -->|Job poll and result post| JS
    P3 -->|Job poll and result post| JS

    P1 --> L1[Local traffic / probes / voice / convergence / XFR / VyOS]
    P2 --> L2[Local traffic / probes / voice / convergence / XFR / VyOS]
    P3 --> L3[Local traffic / probes / voice / convergence / XFR / VyOS]
```

No Cloudflare dependency is required in direct-controller mode. Existing hybrid Cloudflare autodiscovery must continue to coexist unchanged for users who do not configure an explicit controller URL.

---

## Functional scope

## Phase 3A — Fleet inventory and observability

Implement this first. It is read-only and validates the control-plane data model before remote action is introduced.

### Fleet view

Add a navigation item such as:

```text
Fleet
```

Show all peers known to the existing registry. For each peer, display only data that is available and fresh enough:

- Site/display name and stable instance ID.
- Online/degraded/offline/unknown state.
- Last heartbeat and data freshness.
- Stigix version.
- Declared capabilities.
- Current traffic status if reported.
- Number of failing probes if reported.
- Latest convergence summary if available.
- Latest voice/MOS summary if available.
- Latest XFR summary if available.
- Provisioning status from Phase 2: enabled/disabled, revisions, last sync, errors, local override count where available.

Do not declare a peer offline just because an optional metric is unavailable. Registry heartbeat/liveness remains the basic presence signal.

### Data collection

For the initial implementation, do not make the controller scrape peer REST APIs directly. Extend the peer’s existing outbound heartbeat or a lightweight periodic telemetry post to include sanitized summary data.

Each peer sends only compact summaries, not raw histories or unbounded logs.

Suggested conceptual telemetry fields:

```json
{
  "instanceId": "existing-stable-id",
  "reportedAt": "timestamp",
  "version": "current-version",
  "capabilities": ["traffic", "connectivity", "convergence"],
  "summary": {
    "traffic": { "active": true },
    "connectivity": { "failingProbeCount": 1 },
    "convergence": { "status": "good", "lastRunAt": "timestamp" },
    "voice": { "mos": 4.1, "lastRunAt": "timestamp" },
    "xfr": { "status": "success", "lastRunAt": "timestamp" }
  },
  "provisioning": {
    "enabled": true,
    "applicationsRevision": 17,
    "probesRevision": 8,
    "status": "applied"
  }
}
```

Use actual existing fields and endpoint conventions after inspection. The example is semantic only.

### Health state

Keep the first health model explainable and conservative:

| State | Meaning |
|---|---|
| `online` | Recent registry heartbeat; peer is reporting normally. |
| `degraded` | Recent heartbeat but a reported health/probe/config/action issue exists. |
| `offline` | Heartbeat expired according to existing registry liveness thresholds. |
| `unknown` | Peer newly registered or no successful telemetry yet. |

A sophisticated 0–100 health score can be deferred until the normalized telemetry model has been proven across versions.

---

## Phase 3B — Remote actions and jobs

Implement only after Fleet inventory is stable.

### Job model

Any remote action must create one durable central job with independent per-peer sub-results.

Suggested state model:

```text
queued -> available -> claimed -> running -> succeeded
                                        ├-> failed
                                        ├-> timed_out
                                        ├-> cancelled
                                        └-> partially_succeeded
```

Store per peer:

- Stable peer/instance ID.
- Command type and sanitized parameters.
- Creation time, claim time, start time, completion time.
- Status.
- Result summary.
- Local remote reference where available.
- HTTP/application error code or safely summarized error.
- Idempotency key.

### Job flow

```text
1. Operator selects one or more peers in Fleet.
2. Operator selects an allowed action.
3. Controller validates declared capabilities and compatibility.
4. For impactful actions, UI asks for explicit confirmation.
5. Controller stores job and target sub-jobs.
6. Target peer polls its controller job endpoint.
7. Peer claims only its own pending job.
8. Peer validates local preconditions and authorization.
9. Peer invokes the existing local Stigix action/service logic.
10. Peer posts a sanitized outcome.
11. Controller updates Fleet UI, job status and audit.
```

### Initial action set

Start with low-risk, easily idempotent actions:

| Domain | Action | Notes |
|---|---|---|
| Traffic | Start traffic | Use existing local traffic logic/API. |
| Traffic | Stop traffic | Confirmation required for multi-peer action. |
| Connectivity | Run a selected configured probe set | Do not create arbitrary unaudited command execution. |
| Convergence | Start a configured test/profile | Only if target/profile is valid locally. |
| Convergence | Stop running test | Confirmation appropriate when multiple peers are affected. |

Do not include raw shell execution.

Defer these until jobs/auth/audit are proven:

- VyOS network-changing sequences.
- Restart/upgrade/maintenance actions.
- Security test campaigns.
- Voice and XFR complex actions.
- Delete/reset/history removal actions.

### Confirmation requirements

Require explicit confirmation in the controller UI for:

- Stop traffic across one or more peers.
- Any action targeting multiple peers.
- Convergence actions that could materially affect a POC measurement schedule.
- Future network-changing VyOS actions.
- Future maintenance/upgrade actions.

The confirmation dialog must show:

- Exact action.
- Selected peer names and count.
- Sanitized parameters.
- Compatibility/offline warnings.

### Idempotency and retries

- Generate an idempotency key per requested action and peer.
- A peer must recognize a repeat delivery of an already completed idempotency key and return the previous result rather than rerunning an unsafe action.
- The controller may retry delivery only according to clear timeout/retry rules.
- The peer must not execute queued jobs after they expire.

---

## Phase 3C — Advanced controls

Only after 3A and 3B are stable:

- Voice control and campaigns.
- XFR orchestration.
- Security test campaigns.
- VyOS declarative scenarios, subject to strict local mappings and confirmation.
- Maintenance/restart/upgrade orchestration.
- Schedules and multi-step campaigns.
- Optional direct controller-to-peer REST transport for environments with secured management reachability.

Do not add these to the first control-plane release.

---

## Configuration integration

The earlier control-plane draft proposed a separate fleet configuration API with diffs and push deployment. That conflicts with the Phase 2 provisioning model and must be removed.

### Required behavior

- The Control Plane displays configuration rollout status created by Phase 2.
- The Control Plane links to existing Global Configuration publishing/history/rollback controls.
- Global configuration remains leader-published and peer-pulled.
- Local overrides remain local and survive future global revisions.
- The Control Plane does not directly overwrite a peer’s active files.
- No configuration is deployed by remote job in the MVP.

### Future extension

If a future UI needs targeted groups, pilot deployments, diffs or dry-run, extend the existing provisioning manifest/bundle framework. Do not create a second `Fleet Config` transport or duplicate revision system.

---

## Authentication and authorization

### Inter-instance authentication

Do not make the Control Plane use end-user JWT credentials to communicate with peers. In the agent-pull model, the peer authenticates outbound to the controller.

Use or introduce a dedicated peer identity/service credential mechanism that is:

- Bound to the existing stable peer identity.
- Issued/stored securely during controlled registration if required.
- Scoped to registry, provisioning, telemetry and job polling/result posting only.
- Rotatable and revocable.
- Never displayed in UI logs, exports or audit events.

A simple initial signed peer token may be acceptable if it follows existing project security conventions. Prefer a future mTLS or stronger identity model as the product matures.

### Operator authorization

Reuse existing user/JWT mechanisms initially, but add authorization checks around Fleet operations.

Minimum conceptual roles:

| Role | Permission |
|---|---|
| `viewer` | Read Fleet, metrics, provisioning status, jobs and audit. |
| `operator` | Create approved low-risk remote test/traffic jobs. |
| `network-admin` | Future permission for network-changing/VyOS actions. |
| `config-admin` | Use existing global provisioning publish/rollback controls. |
| `fleet-admin` | Manage controller, peers, job retention and advanced settings. |

If full RBAC is not already present, implement the smallest safe authorization gate appropriate to current project design. Do not undertake a full enterprise IAM redesign in this phase.

---

## APIs

Use existing API style and endpoint naming after inspecting the codebase. The following names are conceptual only.

### Controller endpoints used by peers

| Purpose | Conceptual endpoint | Method |
|---|---|---:|
| Poll jobs assigned to peer | `/api/fleet/jobs/poll` | `GET` or `POST` |
| Claim a job | `/api/fleet/jobs/:jobId/claim` | `POST` |
| Report a result | `/api/fleet/jobs/:jobId/result` | `POST` |
| Send telemetry | Extend registry heartbeat or `/api/fleet/telemetry` | `POST` |

### Controller endpoints used by operator UI

| Purpose | Conceptual endpoint | Method |
|---|---|---:|
| Fleet summary | `/api/fleet/overview` | `GET` |
| Peer list | `/api/fleet/agents` | `GET` |
| Peer detail | `/api/fleet/agents/:instanceId` | `GET` |
| Create job | `/api/fleet/jobs` | `POST` |
| Read job | `/api/fleet/jobs/:jobId` | `GET` |
| Cancel pending job targets | `/api/fleet/jobs/:jobId/cancel` | `POST` |
| Audit list | `/api/fleet/audit` | `GET` |

Requirements:

- Associate all records with existing registry instance IDs.
- Never place secrets in job parameters, telemetry, errors, response bodies or audit records.
- Validate peer capability and input schema before job creation and again locally before execution.
- Apply rate limits, payload limits and timeouts consistent with current server design.

---

## Management URL handling

The registry may carry a peer management URL as metadata for convenience, such as “Open peer UI”. This field can be useful in the Fleet view.

However:

- It must not be required for the MVP remote-action transport.
- An off-path controller must still manage an agent that can reach the controller outbound but has no publicly routable management URL.
- The UI must distinguish “peer management URL unavailable” from “peer offline.”
- Direct controller-to-peer API calls remain a future optional transport, not a dependency.

---

## Persistence and audit

Persist centrally at least:

- Fleet peer summary/last telemetry as needed beyond registry ephemeral state.
- Jobs and per-peer job outcomes.
- Audit records.
- Job idempotency records/references for a bounded retention period.

Use existing persistence conventions when available. A robust local file/JSONL or SQLite approach may be sufficient initially; do not require an external database for the MVP.

Audit these events:

- Job created, cancelled, expired, succeeded, partially succeeded and failed.
- Operator identity.
- Target peer IDs.
- Action type and sanitized parameters.
- Peer result and timestamps.
- Configuration publication/rollback events should remain in the provisioning audit trail but can be referenced by Fleet.

Never record secrets, JWTs, passwords, full authorization headers, private URLs with embedded credentials, or raw shell-like payloads.

---

## Failure behavior

| Situation | Required behavior |
|---|---|
| Controller unavailable | Peer continues all local functions; it retries heartbeat, provisioning pull, telemetry and job poll later. |
| Peer offline | Controller marks it offline from registry liveness; jobs for other peers continue. |
| Peer comes back online | It resumes normal polling; expired jobs are not executed. |
| One peer fails a group job | Other peers proceed; overall job becomes partially succeeded where appropriate. |
| Controller restarts | Persisted jobs/audit remain visible; retries respect idempotency and expiry. |
| Controller cannot reach peer inbound | No impact in agent-pull MVP. |
| Unsupported capability/version | Controller blocks or clearly skips action; it does not count as generic peer outage. |
| Duplicate job delivery | Peer returns prior outcome rather than repeating the action. |

---

## UI requirements

### Fleet overview

Add a compact fleet page with:

- Peer list/table/cards.
- Online/degraded/offline/unknown counters.
- Search/filter by site, status, version and declared capability.
- Last heartbeat/telemetry freshness.
- Provisioning status/revision summary.
- Recent job list.

Start simple. Do not build a global context switcher that attempts to make every existing local page transparently operate against a remote backend in this phase. That would be invasive and error-prone.

Instead:

- Fleet shows summary information.
- Peer detail shows summarized remote information and remote actions.
- “Open peer UI” can open the peer’s management URL if one is registered and reachable.

### Peer detail

Provide:

- Identity, liveness and capabilities.
- Compact telemetry summary.
- Provisioning state from Phase 2.
- Recent jobs/results.
- Allowed actions based on capabilities and operator permissions.
- Optional management URL link.

### Jobs

Show:

- Overall state.
- Per-peer state.
- Start/end timestamps.
- Safe result/error summaries.
- Retry/expiration state where applicable.

### Action confirmation

Use confirmation UI for impactful actions as described above. Confirmations must display exact targets and parameters.

---

## Compatibility requirements

- Existing standalone Stigix must work unchanged.
- Existing hybrid Cloudflare registry mode must work unchanged when no direct controller URL is configured.
- Direct-controller peers from Phase 1 must work without Cloudflare.
- Phase 2 global provisioning must remain peer-pull and must not be replaced by job pushes.
- Existing local APIs, local UI and local workflows must remain functional.
- A controller can operate off-path and not be a target.
- A combined controller+peer lab deployment remains possible but is not required.

---

## Implementation order

Do not merge the three roadmap items into one release. Use this sequence.

### Release 1 — Direct peer onboarding and direct registry

Use `STIGIX_DIRECT_CONTROLLER_PEER_INSTALLATION_SPEC.md`.

Deliver only:

- Existing installer extended with `--controller <URL>`.
- Leader Settings generates the copy-paste installation command.
- Direct registry mode bypasses Cloudflare entirely.
- Peer registers and obtains peer list through the existing local registry APIs.
- Backward-compatible coexistence with standalone and hybrid autodiscovery modes.

**Exit gate:** install three fresh peers by copy/paste, verify they appear/discover each other through the explicit controller, disconnect Internet/Cloudflare access, and verify direct mode still works.

### Release 2 — Global configuration provisioning

Use `STIGIX_GLOBAL_CONFIGURATION_PROVISIONING_SPEC.md`.

Deliver only:

- Global provisioning framework.
- Applications and Connectivity Probes only.
- Explicit publish on leader.
- Peer pull, checksum, validation, merge, local overrides, atomic apply, status and rollback.
- Existing instances remain opt-in and unchanged until enabled.

**Exit gate:** deploy five peers, publish an applications revision and a probes revision, verify all apply; add a local override on one peer; publish an update; verify local override survives; simulate controller outage; verify peers retain last valid config; test rollback.

### Release 3 — Fleet inventory and read-only observability

Deliver only Phase 3A:

- Fleet page.
- Registry-based peer inventory.
- Outbound peer telemetry summaries.
- Provisioning rollout visibility.
- No remote actions yet.

**Exit gate:** observe at least 10 peers, including online/offline/stale states, and validate that controller outage does not affect local peer functions.

### Release 4 — Remote jobs for low-risk actions

Deliver only Phase 3B:

- Durable job store and audit.
- Peer job poll/claim/result workflow.
- Start/stop traffic plus selected configured connectivity/convergence actions.
- Capability validation, confirmations, expiry and idempotency.

**Exit gate:** run a multi-peer action with one offline peer, one successful peer and one intentional failure; verify partial result, audit, no duplicate execution and correct recovery after controller restart.

### Release 5 — Advanced remote control

Deliver Phase 3C iteratively:

- Voice/XFR/security campaigns.
- Carefully controlled VyOS scenarios.
- Maintenance orchestration.
- Target groups/campaigns.
- Optional direct REST transport where appropriate.

Each advanced category should be its own release or feature flag because it has materially different operational risk.

---

## Acceptance criteria for Release 3

- [ ] Controller lists peers using existing registry stable IDs.
- [ ] Controller can operate with no traffic/target role.
- [ ] Peers report compact telemetry outbound; controller does not require inbound peer management reachability.
- [ ] Fleet distinguishes online, degraded, offline and unknown without false offline states for missing optional metrics.
- [ ] Fleet displays Phase 2 provisioning status when available.
- [ ] Existing local peer behavior continues during controller outage.
- [ ] No Cloudflare use occurs for direct-controller peers.
- [ ] No secrets appear in telemetry, UI or logs.

## Acceptance criteria for Release 4

- [ ] Operator can create a low-risk action job for one or multiple peers.
- [ ] Peer pulls and claims only jobs targeted to its existing identity.
- [ ] Peer validates capability and parameters before local execution.
- [ ] Jobs have expiry, per-peer outcomes and idempotency protection.
- [ ] Multi-peer jobs can complete partially without blocking successful peers.
- [ ] Confirmation is required for multi-peer or impactful actions.
- [ ] Jobs and audit survive controller restart according to selected persistence model.
- [ ] No raw shell execution or secret propagation is possible.

---

## Deliberate changes from the earlier draft

This revision intentionally changes the following points to remain coherent with Phase 1 and Phase 2:

| Earlier concept | Revised decision | Reason |
|---|---|---|
| Hub directly calls each agent API as MVP | Peer pulls jobs as MVP | Controller may be off-path or unable to reach branches inbound; peers already contact controller outbound |
| Fleet config profiles/diff/deploy APIs | Reuse Phase 2 provisioning manifest/bundle framework | Avoid two competing config distribution systems |
| Hub assumed as active participant/target | Controller can be control-plane only | Central management must work from an off-path VM/DC/cloud location |
| Fleet dashboard plus full remote context selector | Start with Fleet and peer detail | Lower implementation risk; avoids making all existing UI pages remote-aware at once |
| Broad action set including VyOS/maintenance | Start with low-risk traffic/connectivity/convergence actions | Build security, jobs, audit and idempotency before network-changing operations |
| Agent management URL required for direct API calls | Management URL optional metadata | Agent-pull works behind NAT and does not require inbound access |

---

## Expected deliverables

For each release, provide:

- Actual files changed.
- Actual APIs added/reused.
- Data model and persistence decisions.
- Authentication/authorization mechanism used.
- Test commands and test results.
- Explicit evidence of backward compatibility.
- A short migration/rollback note.

Do not start Release 3 implementation until Release 1 and Release 2 are individually complete, tested and released.