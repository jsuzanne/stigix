# Connectivity Probe Optimizations Roadmap

This document outlines a high-level assessment of the Digital Experience Monitoring (DEM) underlying probe engines, evaluating the potential for deeper integration directly into native `Node.js` APIs versus the current external OS-level subprocess approach.

---

## 1. TCP Port Reachability

### Current Implementation
- **Tool**: Shell `nc` (Netcat) via `child_process.exec`.
- **Workflow**: Spawns an external Bash shell, which then launches the `nc` binary.

### Proposed Optimization
- **Rewrite to**: Pure Native Node.js `net.Socket`.
- **Assessment**: **High ROI / Low Effort**. Replacing `nc` with a native `new net.Socket().connect(port, host)` completely eliminates the heavy OS context-switch and bash wrapper overhead. It would lower container CPU spikes instantly while identically validating standard TCP handshake completion. We can track connect times perfectly within the Node Event Loop.
- **Priority**: High (Whenever next refactoring phase is initiated).

---

## 2. DNS Resolution Speed

### Current Implementation
- **Tool**: Shell `dig` utility.
- **Workflow**: Forked `dig` subprocess targeting specific nameservers using `+time` thresholds.

### Proposed Optimization
- **Rewrite to**: Pure Native Node.js `dns` module (`dns.promises.resolve` combined with `dns.promises.setServers`). 
- **Assessment**: **High ROI / Medium Effort**. Node internally uses `c-ares`, an extremely robust asynchronous DNS C library. Bypassing `dig` means the backend never leaves Node memory space to perform a query. We'd manually attach `Date.now()` wrapping logic to replicate the pristine latency outputs that `dig` currently supplies.
- **Priority**: Medium. 

---

## 3. HTTP / HTTPS (Digital Experience)

### Current Implementation
- **Tool**: Shell `curl` utility.
- **Workflow**: Uses `curl`'s heavily formatted `-w` flags to independently isolate TLS Handshakes, TCP Handshakes, TTFB, and namelookups.

### Proposed Optimization
- **Rewrite to**: **N/A (Keep `curl`)**.
- **Assessment**: **Negative ROI**. While Node.js `fetch` or `https.request` operates in-memory and skips subprocesses, capturing explicit sub-layer timing events (such as tracking when identically the TLS Handshake succeeds vs the physical socket binding) requires exceptionally complex network hooks (`socket.on('secureConnect')`). The external `curl` process is heavier, but provides unparalleled, undisputed raw metric precision automatically. 
- **Priority**: Do not optimize.

---

## 4. ICMP Ping

### Current Implementation
- **Tool**: Shell `ping` utility.
- **Workflow**: Spawns `-c 1` ICMP pings through the host environment.

### Proposed Optimization
- **Rewrite to**: **N/A (Keep `ping`)**.
- **Assessment**: **Negative ROI**. Operating raw ICMP sockets inside Node.js programmatically requires massive security escalations (running Node entirely as `root` or mapping explicit `CAP_NET_RAW` Linux capabilities into the Docker image). Leveraging the pre-escalated native `ping` OS binary is the industry-standard secure approach.
- **Priority**: Do not optimize.

---

## 5. UDP (Real-time QoS)

### Current Implementation
- **Tool**: Shell `iperf3` utility.
- **Workflow**: Client UDP execution binding to proprietary `iperf3` ports.

### Proposed Optimization
- **Rewrite to**: **N/A (Keep `iperf3`)**.
- **Assessment**: **Negative ROI**. `iperf3` handles complex proprietary packet accounting including server-negotiation to calculate end-to-end Packet Loss and Jitter. A native Node `dgram` UDP packet mapping engine would require an identical Node instance to live on the target server just to acknowledge the receipt of the connectionless packet chunks. `iperf3` is irreplaceable for interacting with third-party testing nodes.
- **Priority**: Do not optimize.
