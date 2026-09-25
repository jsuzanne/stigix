> **Last Updated:** 2026-01-27 | **Created:** 2026-01-27 (v1.1.2-patch.5)

# SD-WAN Architecture Overview

![SD-WAN Overlay Communication](/Users/jsuzanne/.gemini/antigravity/brain/1270a119-0515-441c-82fb-b82e64adc6ed/sdwan_hero_banner_1769465414075.png)

This diagram illustrates how the **SD-WAN Traffic Generator** simulates real-world enterprise connectivity:

1.  **Branch Office (Client)**: Represents the edge location where traffic originates.
2.  **Encrypted SD-WAN Overlay Tunnels**: The logical paths created over various transport methods (MPLS, Broadband, LTE).
3.  **Underlay Internet**: The heterogeneous physical network paths that the SD-WAN orchestrates.
4.  **Data Center / Cloud (Server)**: The destination where services (and our Echo Server) reside.

Our tool allows you to measure exactly how these "energy lines" behave when the underlay internet experiences packet loss, latency, or complete failover.
