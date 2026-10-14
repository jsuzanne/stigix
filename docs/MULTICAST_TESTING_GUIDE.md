> **Last Updated:** 2026-10-14 | **Created:** 2026-10-14 (v3.0.19)

# SD-WAN Overlay Multicast Validation — Step-by-Step User Guide

This guide walks a new user through validating end-to-end IP Multicast replication across a Prisma SD-WAN overlay using Stigix — specifically using **`DC1`** as the **Multicast Source (Sender)** and **`BR8`** (plus optional additional branches such as `BR1` or `BR2`) as the **Multicast Receiver(s)**.

---

## 🧭 Overview: How Stigix Multicast Validation Works

```mermaid
flowchart LR
    subgraph DC1["DC1 (Sender Node)"]
        TX["Stigix Multicast Sender\nUDP + STGX 24B Header\n(e.g. 239.1.1.100:5005, TTL 16, EF)"]
    end
    subgraph SDWAN["Prisma SD-WAN Overlay"]
        ION_DC["DC1 ION\n(PIM / IGMP / RP)"]
        ION_BR8["BR8 ION\n(IGMPv2/v3 Querier & PIM)"]
        ION_DC ===>|"Overlay Multicast\nReplication Tree"| ION_BR8
    end
    subgraph BR8["BR8 (Receiver Node)"]
        RX["Stigix Multicast Receiver\nIGMPv2 ASM or IGMPv3 SSM Join\n4096-bit Loss/Dup/OOS + RFC3550 Jitter"]
    end
    TX --> ION_DC
    ION_BR8 --> RX
```

When you click **Start Stream** on the Stigix Leader dashboard (`DC1`):
1. **Phase 1 — Receiver IGMP Join**: Stigix instructs `BR8` to open a UDP socket on port `5005` and issue an **IGMPv2 Join (`addMembership`)** for ASM or **IGMPv3 Source-Specific Join (`addSourceSpecificMembership`)** for SSM on its LAN interface facing the ION router.
2. **Phase 2 — Sender UDP Stream**: After a `250 ms` stabilization delay, `DC1` starts transmitting paced UDP datagrams containing the 24-byte `STGX` binary telemetry header (`seq`, `tx_ns`, `stream_id`, `flags`) with configured `IP_MULTICAST_TTL` and `DSCP`.
3. **Phase 3 — Live 1-to-N Telemetry & Diagnostics**: The Leader polls all participating nodes every second, computing per-branch bitrate, packet loss, duplicates, out-of-order packets, RFC 3550 jitter, join latency (`T_first_packet - T_igmp_join`), and automatic root-cause diagnostics.

---

## ✅ Prerequisites Before Starting

1. **Docker Host Networking (`network_mode: host`)**:
   - Both `DC1` and `BR8` must run Stigix with `network_mode: host` (the default in Stigix `docker-compose.yml`). Bridge networking blocks native IGMP membership reports from reaching the physical/VLAN LAN segment connected to the Prisma SD-WAN ION.
2. **Fleet Cluster Connectivity**:
   - `DC1` (Leader) and `BR8` (Peer) must be enrolled in the same Stigix cluster and show **Online** in the Fleet banner.
3. **Prisma SD-WAN Multicast Configuration**:
   - Multicast routing (PIM-SM / PIM-SSM and IGMPv2/v3 on the LAN interfaces) must be enabled on the `DC1` and `BR8` ION devices.

---

## 🚀 Step-by-Step Guide: Testing `DC1` (Source) $\rightarrow$ `BR8` (Receiver)

### Step 1 — Open the Multicast Overlay Studio
1. Open the Stigix Web Dashboard on your **Leader node (`DC1`)**.
2. In the left navigation sidebar, click **Custom Apps** (under Traffic Generation / Validation).
3. At the top of the page, use the sub-tab switcher to switch from **`TCP Applications`** to **`Multicast Overlay`**:
   ```text
   [ TCP Applications ]   [ 📡 Multicast Overlay ]
   ```

---

### Step 2 — Create (or Edit) a `DC1 -> BR8` Multicast Profile
1. Click the **`+ New Multicast Stream`** button in the top-right corner of the **Multicast Overlay** view.
2. Fill in the profile parameters in the configuration modal:

| Field | Recommended Value | Why / Notes |
| :--- | :--- | :--- |
| **Application Name** | `DC1-to-BR8 Live Video Feed` | Descriptive label for the stream. |
| **Stream ID** | `mc-dc1-br8` | Unique slug identifier (auto-generated if left blank). |
| **Multicast Mode** | `ASM (Any-Source — IGMPv2/v3)` | Select **ASM** for `239.x.x.x` (`*,G` with RP) or **SSM** for `232.x.x.x` (`S,G` without RP). |
| **Multicast Group IP** | `239.1.1.100` | Must be in `239.0.0.0/8` for ASM (or `232.0.0.0/8` for SSM). Note: `224.0.0.0/24` is rejected because link-local multicast is never routed across SD-WAN. |
| **UDP Port** | `5005` | Any UDP port between `1024` and `65535`. |
| **Sender Node (Source)** | `DC1` (select from dropdown) | The hub/datacenter node that will transmit the UDP multicast stream. |
| **SSM Source IP** *(SSM only)* | *(Leave blank for ASM)* | If testing **SSM (`232.x.x.x`)**, enter `DC1`'s LAN IPv4 address (e.g. `10.200.1.10`). |
| **Receiver Nodes (Branches)** | Check **`BR8`** | Click `BR8` in the Receiver Nodes checklist (you can also check `BR1`, `BR2`, etc. for `1 -> N` replication). |
| **Target Bitrate (kbps)** | `1000` (1 Mbps) | Rate of the synthetic CBR stream (`16` to `50000` kbps). |
| **Payload Size (Bytes)** | `1200` | Safe below typical SD-WAN tunnel MTU (`1400` bytes max) to prevent IP fragmentation. |
| **Multicast TTL** | `16` | **Crucial:** Must be `> 1` (recommended `16` or `32`) so ION routers do not drop packets on hop decrement. |
| **DSCP Marking** | `ef` (`EF - DSCP 46`) | Maps the multicast stream into the SD-WAN Real-Time / Voice-Video QoS queue. |
| **Interface Override** | *(Leave blank)* | Stigix automatically selects the node's private RFC1918 LAN IPv4 interface (ignoring `docker0`, `lo`, and tunnels). |

3. Click **Create Profile** (or **Save Changes**).
4. Verify in the top banner that the provisioning bundle has synchronized to your Receiver node(s) (automatic within a few seconds).

<p align="center">
  <img src="screenshots/15-Multicast-Overlay/01-stigix-multicast-profile-config.png" width="520" alt="Stigix Multicast Profile Configuration" />
</p>

---

### Step 3 — Run the Pre-Flight Check (`DC1` & `BR8` / `BR5`)
Before starting traffic, verify that both nodes have valid LAN multicast interfaces and OS permissions:
1. Select your **`SD-WAN Multicast Feed`** profile in the header dropdown.
2. Click the **`Pre-Flight Check`** button in the stream header.
3. In the **Pre-Flight Check Modal**, verify that both the Sender (`DC1`) and Receiver (`BR5` / `BR8`) display a green **`READY`** badge:
   - **Selected LAN Interface**: Shows the auto-detected LAN IPv4 (e.g. `ens9 — 192.168.203.100` on `DC1`, `enp2s0 — 192.168.217.5` on `BR5`).
   - **UDP Bind & IGMP Membership**: Confirms the kernel allows multicast socket binding.
   - **Kernel IGMP & mroute Table**: Displays active `/proc/net/igmp` memberships and `ip mroute` state.
4. Close the modal once both nodes report **`READY`**.

---

### Step 4 — Start the Multicast Stream & Read the Live Matrix
1. Click the **`Start Stream`** button.
2. Watch the **1-to-N Overlay Replication Tree** and **Live Multicast Receiver Telemetry Matrix**:
   - **Sender Card (`DC1-Ubuntu`)**:
     - Status transitions to **`TX ACTIVE`**.
     - Displays live **TX Bitrate (`48.0 kbps`)**, **Packets/s (`5 pps`)**, **Total Sent Packets**, **TTL (`8`)**, and **DSCP (`EF`)**.
   - **Receiver Row (`BR5-Ubuntu` / `BR8-Ubuntu`)**:
     - Status transitions from `NO TRAFFIC` $\rightarrow$ **`HEALTHY`** (green badge) as soon as the first multicast datagram traverses the SD-WAN overlay.
     - **Join Latency (`ms`)**: Shows the convergence time in milliseconds between the Receiver issuing its IGMP Join and the first packet arriving from `DC1` across the SD-WAN fabric.
     - **RX Bitrate & Trend**: Closely matches `DC1`'s TX bitrate (`48.0 kbps`) with a live sparkline.
     - **Loss / Dup / Reorder**:
       - `0.00% Loss` (`584 / 584` packets) confirms clean forwarding.
       - `Dup > 0` indicates duplicate packet delivery (e.g., dual-tunnel replication anomaly).
       - `Reord > 0` indicates packet reordering across paths.
     - **Jitter (RFC 3550)**: Real-time inter-arrival jitter in milliseconds.

<p align="center">
  <img src="screenshots/15-Multicast-Overlay/02-stigix-multicast-healthy-telemetry.png" width="800" alt="Stigix Live Multicast Healthy Telemetry" />
</p>

When transient WAN impairments or SLA violations occur (e.g., `Loss = 0.11% > 0.1%` or duplicate packets `Dup: 3`), Stigix automatically transitions the verdict to **`DEGRADED`** and highlights the exact root cause in the diagnostics banner:

<p align="center">
  <img src="screenshots/15-Multicast-Overlay/03-stigix-multicast-degraded-sla-detection.png" width="800" alt="Stigix Degraded Multicast SLA Violation Detection" />
</p>

---

### Step 5 — Test Advanced SD-WAN Scenarios (`IGMP Leave` & `Late-Join`)
While the stream is actively running from `DC1`, you can validate dynamic IGMP/PIM tree pruning and grafting on the Receiver without stopping the sender:

1. **Test IGMP Prune (`S8`)**:
   - On the Receiver row in the Telemetry Matrix, click the **`IGMP Leave`** button.
   - The Receiver immediately sends an IGMP Leave group message to its local ION router.
   - Its status badge changes to **`PRUNED`**, and its RX bitrate drops to `0 kbps`.
2. **Test Late-Join (`S4`)**:
   - Wait 5–10 seconds while `DC1` continues transmitting, then click **`IGMP Join`** on the Receiver row.
   - The Receiver re-joins the multicast group mid-stream.
   - Notice two things:
     1. **`Join Latency (ms)`** updates with the fresh graft convergence time.
     2. **`Packet Loss (%)` remains `0.00%`** — Stigix automatically initializes its 4096-bit sequence window on the first packet received after joining (`firstSeq`), avoiding false "phantom loss" for packets sent before joining.

---

### Step 6 — Stop the Stream
1. Click the red **`Stop Stream`** button in the stream header.
2. Stigix stops the UDP transmitter on `DC1` and cleanly leaves the IGMP group on all Receivers.

---

## 🛠️ Troubleshooting Common SD-WAN Multicast Issues

Stigix includes an automated **SD-WAN Multicast Replication & Policy Diagnostics Banner** above the receiver matrix:

<p align="center">
  <img src="screenshots/15-Multicast-Overlay/04-stigix-multicast-blackhole-diagnostics.png" width="800" alt="Stigix Multicast Blackhole Diagnostics Banner" />
</p>

| Diagnostic Banner / Symptom | Root Cause | How to Fix |
| :--- | :--- | :--- |
| **🚨 TTL Decay Risk (`TTL = 1`)** | The profile's Multicast TTL is set to `1`. The `DC1` router or ION decrements TTL to `0` and drops the packet before encapsulating it into the SD-WAN tunnel. | Edit the profile and set **Multicast TTL** to **`8`**, **`16`**, or **`32`**. |
| **🚨 Complete Overlay Blackhole (`DC1 TX > 0`, `RX = 0`, status `NO TRAFFIC`)** | `DC1` is transmitting and the Receiver has sent its IGMP Join, but zero packets cross the SD-WAN fabric. | 1. Verify **IGMPv3** is enabled on the Branch ION LAN sub-interface.<br>2. Verify **PIM-SM** and Static **Rendezvous Point (RP)** (`192.168.201.3` for `224.0.0.0/4`) are configured on both Hub and Branch IONs.<br>3. **Intermediary Core Router Check**: If a transit router (e.g., `VyOS`) sits between the `DC1` Sender subnet and the `DC1-R1` ION LAN port, ensure `protocols pim` is enabled on both transit interfaces and points to the RP. See the [SD-WAN Multicast Validation Technical White Paper](WHITEPAPER_SDWAN_MULTICAST_VALIDATION.md) for the complete reference configuration. |
| **⚠️ Partial Replication Asymmetry** *(when testing `DC1 -> BR1 + BR5`)* | Some branches receive the stream (`HEALTHY`) while another remains stuck in `NO TRAFFIC`. | `DC1` source and RP are working; the issue is isolated to the failing branch's local ION LAN IGMP configuration or missing PIM neighbor/tunnel adjacency. |
| **⚠️ Wrong Local Interface Selected** | A node with multiple NICs bound to a management VLAN instead of the SD-WAN LAN VLAN. | Run **Pre-Flight Check** to see all detected interfaces, or verify the selected interface in the Sender/Receiver cards. |

---

## 📚 Deep-Dive Reference Documentation

For a complete architectural walkthrough—including Leader/Peer WebSocket orchestration, the 24-byte `STGX` binary protocol, `BR8 -> BR5` Spoke-to-Spoke SPT switchover, Prisma SD-WAN ION screenshots, and VyOS PIM-SM transit configuration—read the **[Technical White Paper: Distributed SD-WAN Overlay Multicast Validation with Stigix](WHITEPAPER_SDWAN_MULTICAST_VALIDATION.md)**.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-14 | `v3.0.21` | Stigix Core Team | Embedded live UI screenshots (`HEALTHY`, `DEGRADED`, `NO TRAFFIC`, Profile Configuration) and linked to the Technical White Paper |
| 2026-10-14 | `v3.0.19` | Stigix Core Team | Initial step-by-step user guide for validating SD-WAN Overlay Multicast (`DC1` source to `BR8` receiver) |

