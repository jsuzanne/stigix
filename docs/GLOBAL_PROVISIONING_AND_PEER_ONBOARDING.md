# 📖 User Guide — Central Configuration Provisioning & Peer Onboarding

Welcome to the **Stigix Multi-Node User Guide**! This guide explains how to connect remote branch sites in 30 seconds and centrally manage SaaS applications and synthetic connectivity probes across your entire SD-WAN / SASE lab environment.

---

## 💡 What does this feature do?

When running Stigix across multiple sites (e.g., Data Center Leader `DC1` and remote branch peers `BR1`, `BR5`), you don't need to manually configure applications or probes on every single machine.

With **Central Configuration Provisioning**:
1. **One-Command Onboarding**: Connect any new remote branch server to your Leader in 30 seconds with a single copy-paste command.
2. **Centralized Publishing**: Define your SaaS Applications and Connectivity Probes once on the Leader, then click **Publish** to push them to all remote branch sites.
3. **Local Branch Autonomy**: Branch operators can customize probe targets or timeouts locally for their specific site without losing central updates.

---

## 🚀 Guide 1: Connect a Remote Site in 30 Seconds

Follow these 3 simple steps to add a new Linux host (e.g., a branch server or hub instance) to your Stigix cluster.

### Step 1: Copy the Onboarding Command from the Leader
1. Open the Stigix Web Dashboard on your **Leader node** (e.g., `http://192.168.203.100:8080`).
2. Go to **Settings** → **Target Controller** tab.
3. Locate the **Onboard a Remote Peer** box and click **Copy**.

> [!TIP]
> The onboarding command looks like this:
> ```bash
> curl -sSL http://192.168.203.100:8080/onboard.sh | bash
> ```

### Step 2: Run the Command on your Remote Linux Server
1. Connect via SSH to your remote branch server (e.g., `BR5`).
2. Paste and run the command in your terminal.

> [!NOTE]
> The script automatically detects Docker, downloads Stigix, sets the Leader URL, and starts the container in under 30 seconds!

### Step 3: Verify Connection in the Leader Dashboard
1. Return to **Settings → Target Controller** on your Leader node.
2. You will see your new remote site listed under **Connected Peers** with a green **CONNECTED** status badge.

---

## 🌐 Guide 2: Publish Global Applications & Probes

Once your branch sites are connected, you can publish shared configuration catalogues from your central Leader.

### How to Publish from the Leader Node

1. On your **Leader node**, configure your SaaS Applications (**Settings → Traffic Distribution**) and Synthetic Probes (**Settings → Synthetic Probes**).
2. Go to **Settings → Target Controller**.
3. Under **Central Global Provisioning**, click:
   - **`[ Publish Apps ]`**: Publishes your SaaS application catalogue.
   - **`[ Publish Probes ]`**: Publishes all active HTTP, PING, DNS, and UDP synthetic probes.

> [!SUCCESS]
> A notification will confirm: *Published Applications revision 1* or *Published Connectivity Probes revision 1*.

### What happens on Remote Branch Sites?

- Every connected branch site automatically polls the Leader every **30 seconds**.
- Within 30 seconds, remote branch sites detect the new revision (`rev 1`, `rev 2`) and update their active catalogues automatically.
- No container restarts or manual file edits are required!

---

## ✏️ Guide 3: Local Site Overrides & Badges

Stigix is designed to respect local site independence. A branch operator can adapt a probe or application for their local site without breaking central synchronization.

### How Local Site Overrides Work

1. On a **Branch Peer** (e.g., `BR5`), go to **Connectivity Performance** or **Settings → Synthetic Probes**.
2. Probes inherited from the Leader display a green **`🌐 Global`** badge.
3. If you edit a probe (e.g., changing its target IP or reducing its timeout from `5000ms` to `3000ms` for your local site):
   - The probe badge automatically changes to amber **`✏️ Overridden`**.
   - Your local modification is saved locally on that branch site.

### What happens when the Leader publishes a new update?

When the central administrator publishes a new revision on the Leader (e.g. updating a probe URL), the branch site pulls the update, **applies the central updates, and preserves the local site customization**!

### Understanding UI Badges

| Badge | Meaning |
| :--- | :--- |
| **`🌐 Global`** | Pure global item published by the central Leader. |
| **`✏️ Overridden`** | Global item customized locally by the branch site. Local changes are preserved during central updates. |
| **`📍 Local`** | Probe or application created locally on the branch site. |
| **`⚠️ Orphaned`** | Global item deleted on the Leader that had local site modifications. Preserved locally so local monitoring isn't broken. |

---

## ❓ Frequently Asked Questions (FAQ)

### Do I need to upgrade the Leader and Peers at the same time?
**No.** Stigix is designed with full backward compatibility. You can upgrade your Leader first, and upgrade remote branch peers whenever convenient. Peers on older versions will continue running seamlessly with their local configurations.

### Why do I need to click "Publish" on the Leader?
Edits made on the Leader stay local until you click **Publish**. This acts as a draft/production safety barrier so that half-baked edits or typos aren't pushed to 50 branch sites while you are testing.

### What happens if I delete a probe globally on the Leader?
- If the branch site **did not modify** the probe, the probe is automatically removed from the branch site at the next 30-second pull.
- If the branch site **had local modifications** (`✏️ Overridden`), the probe becomes **`⚠️ Orphaned`** on the branch site so local site monitoring is never silently destroyed.

### Can a branch site opt-out of central provisioning?
**Yes.** On any branch site, go to **Settings → Target Controller** and click the **`[ Global Provisioning: ON / OFF ]`** toggle to turn off central sync. The branch site will retain its current configuration and stop pulling updates from the Leader.

---

*Need help? Visit the main project documentation at [README.md](../README.md) or explore technical references in [docs/](README.md).*
