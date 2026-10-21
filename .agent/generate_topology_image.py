#!/usr/bin/env python3
"""
Generate SVG and PNG topology diagram for SD-WAN Lab Architecture.
"""
import os
import hashlib
import base64
import fitz  # PyMuPDF

def generate_svg():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1150 780" width="1150" height="780" style="background:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.08"/>
    </filter>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
    <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#eff6ff"/>
      <stop offset="100%" stop-color="#dbeafe"/>
    </linearGradient>
    <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f0fdf4"/>
      <stop offset="100%" stop-color="#dcfce7"/>
    </linearGradient>
    <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#faf5ff"/>
      <stop offset="100%" stop-color="#f3e8ff"/>
    </linearGradient>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#0284c7" />
    </marker>
    <marker id="arrowhead-green" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#16a34a" />
    </marker>
  </defs>

  <!-- Title Banner -->
  <rect x="25" y="20" width="1100" height="55" rx="8" fill="url(#headerGrad)" filter="url(#shadow)"/>
  <text x="50" y="55" font-size="20" font-weight="700" fill="#ffffff" letter-spacing="0.5">SD-WAN LAB HYBRID TOPOLOGY &amp; INTERCONNECT ARCHITECTURE</text>
  <text x="960" y="53" font-size="12" fill="#94a3b8">Stigix Architecture v3.0</text>

  <!-- Physical Underlay Banner -->
  <rect x="25" y="95" width="1100" height="150" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" filter="url(#shadow)"/>
  <rect x="25" y="95" width="1100" height="28" rx="8" fill="#e2e8f0"/>
  <text x="45" y="114" font-size="13" font-weight="700" fill="#334155">🌐 PHYSICAL UNDERLAY NETWORK — LAN 192.168.1.0/24</text>

  <!-- Ubiquiti Gateway Box -->
  <rect x="50" y="135" width="320" height="95" rx="8" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>
  <rect x="50" y="135" width="320" height="24" rx="6" fill="#0284c7"/>
  <text x="65" y="152" font-size="12" font-weight="700" fill="#ffffff">Ubiquiti Gateway (192.168.1.240)</text>
  <text x="65" y="176" font-size="11" fill="#475569">• Default Internet Gateway for physical LAN</text>
  <text x="65" y="194" font-size="11" font-weight="600" fill="#0369a1">• Static Route: 192.168.100.0/24 → 192.168.10.210</text>
  <text x="65" y="212" font-size="11" fill="#64748b">• Underlay transit between Branch &amp; Datacenter</text>

  <!-- Physical LAN Switch Bus -->
  <line x1="390" y1="182" x2="680" y2="182" stroke="#0284c7" stroke-width="4" stroke-dasharray="8 4"/>
  <rect x="440" y="165" width="180" height="34" rx="6" fill="#ffffff" stroke="#0284c7" stroke-width="1.5"/>
  <text x="450" y="186" font-size="11" font-weight="700" fill="#0369a1">Physical LAN Switch</text>

  <!-- Branch 8 Physical Box -->
  <rect x="700" y="135" width="390" height="95" rx="8" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>
  <rect x="700" y="135" width="390" height="24" rx="6" fill="#0f766e"/>
  <text x="715" y="152" font-size="12" font-weight="700" fill="#ffffff">Branch 8 — Physical ION Appliance</text>
  <text x="715" y="176" font-size="11" fill="#334155"><tspan font-weight="700">INET1:</tspan> 192.168.1.155/24 (via physical LAN)</text>
  <text x="715" y="194" font-size="11" fill="#334155"><tspan font-weight="700">INET2:</tspan> 192.168.1.156/24 (via physical LAN)</text>
  <text x="715" y="212" font-size="11" fill="#15803d">✔ Active IPSec tunnels to BRGW7, DC1, DC2, BR1, BR2</text>

  <!-- HOST 1: NUCBUNTU -->
  <rect x="25" y="265" width="650" height="490" rx="10" fill="#f8fafc" stroke="#3b82f6" stroke-width="2" filter="url(#shadow)"/>
  <rect x="25" y="265" width="650" height="32" rx="8" fill="#1e40af"/>
  <text x="45" y="287" font-size="14" font-weight="700" fill="#ffffff">🖥️ HOST: nucbuntu (192.168.1.154)</text>
  <text x="450" y="286" font-size="11" fill="#bfdbfe">Ubuntu KVM Hypervisor</text>

  <!-- Nucbuntu Host Interfaces -->
  <rect x="45" y="310" width="610" height="50" rx="6" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="60" y="330" font-size="11" font-weight="700" fill="#1e293b">Physical NIC enp88s0: <tspan font-weight="400">192.168.1.154/24 | Default GW: 192.168.1.240</tspan></text>
  <text x="60" y="348" font-size="11" fill="#475569"><tspan font-weight="700">Host Routes:</tspan> 192.168.100.0/24 via 192.168.1.163 | 192.168.221/222/226/227.0/24 via 192.168.80.254</text>

  <!-- Bridges on nucbuntu -->
  <rect x="45" y="370" width="295" height="42" rx="6" fill="#eff6ff" stroke="#93c5fd"/>
  <text x="55" y="387" font-size="11" font-weight="700" fill="#1e40af">virbr11 (Underlay Transit): 192.168.80.1/24</text>
  <text x="55" y="402" font-size="10" fill="#3b82f6">Interconnect host ↔ VyOS eth5</text>

  <rect x="360" y="370" width="295" height="42" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="370" y="387" font-size="11" font-weight="700" fill="#334155">virbr0 (Lab Mgmt): 192.168.122.1/24</text>
  <text x="370" y="402" font-size="10" fill="#64748b">virbr2 (INET): .220.1 | virbr3 (MPLS): .190.1</text>

  <!-- VyOS VM Box -->
  <rect x="45" y="425" width="610" height="150" rx="8" fill="#ffffff" stroke="#6366f1" stroke-width="1.8"/>
  <rect x="45" y="425" width="610" height="26" rx="6" fill="#4f46e5"/>
  <text x="60" y="443" font-size="12" font-weight="700" fill="#ffffff">🔀 VM: vyosrouter (Id 1) — Core WAN Emulator &amp; Underlay Router</text>

  <text x="60" y="470" font-size="11" fill="#1e293b"><tspan font-weight="700">eth5 (Transit):</tspan> 192.168.80.254 (GW 192.168.80.1) • <tspan font-weight="700" fill="#b91c1c">NAT Exclude Rule 10: 192.168.0.0/16</tspan></text>
  <text x="60" y="490" font-size="11" fill="#334155"><tspan font-weight="700">eth10 (DC1 INET):</tspan> 192.168.221.254/24 | <tspan font-weight="700">eth12 (DC2 INET):</tspan> 192.168.222.254/24</text>
  <text x="60" y="510" font-size="11" fill="#334155"><tspan font-weight="700">eth3  (BR1 INET):</tspan> 192.168.227.254/24 | <tspan font-weight="700">eth7  (BR2 INET):</tspan> 192.168.226.254/24</text>
  <text x="60" y="530" font-size="11" fill="#334155"><tspan font-weight="700">eth4  (Mgmt):</tspan> 192.168.122.254/24    | <tspan font-weight="700">eth11/13/2/6:</tspan> MPLS Underlay Segments</text>
  <text x="60" y="555" font-size="10.5" fill="#4338ca" font-weight="600">Routes to 192.168.100.0/24 &amp; 192.168.1.0/24 routed back via eth5 (192.168.80.1)</text>

  <!-- SD-WAN VMs on nucbuntu -->
  <rect x="45" y="588" width="610" height="155" rx="8" fill="#ffffff" stroke="#0ea5e9" stroke-width="1.5"/>
  <rect x="45" y="588" width="610" height="24" rx="6" fill="#0284c7"/>
  <text x="60" y="605" font-size="12" font-weight="700" fill="#ffffff">🏢 Prisma SD-WAN Hub &amp; Branch Virtual Appliances (nucbuntu)</text>

  <!-- Mini nodes -->
  <g transform="translate(55, 622)">
    <!-- DC1 -->
    <rect x="0" y="0" width="140" height="105" rx="6" fill="#f0f9ff" stroke="#bae6fd"/>
    <text x="10" y="18" font-size="11" font-weight="700" fill="#0369a1">DC1 Cluster</text>
    <text x="10" y="36" font-size="10" fill="#334155">• DC1-R1: .221.1</text>
    <text x="10" y="52" font-size="10" fill="#334155">• DC1-R2: .221.2</text>
    <text x="10" y="70" font-size="10" fill="#64748b">MPLS: .191.1/.2</text>
    <text x="10" y="92" font-size="10" font-weight="700" fill="#16a34a">✔ UP to BRGW7</text>

    <!-- DC2 -->
    <rect x="150" y="0" width="140" height="105" rx="6" fill="#f0f9ff" stroke="#bae6fd"/>
    <text x="160" y="18" font-size="11" font-weight="700" fill="#0369a1">DC2 Cluster</text>
    <text x="160" y="36" font-size="10" fill="#334155">• DC2-R1: .222.1</text>
    <text x="160" y="52" font-size="10" fill="#334155">• DC2-R2: .222.2</text>
    <text x="160" y="70" font-size="10" fill="#64748b">MPLS: .192.1/.2</text>
    <text x="160" y="92" font-size="10" font-weight="700" fill="#16a34a">✔ UP to BRGW7</text>

    <!-- BR1 -->
    <rect x="300" y="0" width="140" height="105" rx="6" fill="#f0fdf4" stroke="#bbf7d0"/>
    <text x="310" y="18" font-size="11" font-weight="700" fill="#15803d">Branch 1 (BR1)</text>
    <text x="310" y="36" font-size="10" fill="#334155">• BR1-R1: .227.1</text>
    <text x="310" y="52" font-size="10" fill="#64748b">MPLS: .197.1</text>
    <text x="310" y="70" font-size="10" fill="#475569">Domain ID: 16</text>
    <text x="310" y="92" font-size="10" font-weight="700" fill="#16a34a">✔ UP to BRGW7</text>

    <!-- BR2 -->
    <rect x="450" y="0" width="140" height="105" rx="6" fill="#f0fdf4" stroke="#bbf7d0"/>
    <text x="460" y="18" font-size="11" font-weight="700" fill="#15803d">Branch 2 (BR2)</text>
    <text x="460" y="36" font-size="10" fill="#334155">• BR2-R1: .226.1</text>
    <text x="460" y="52" font-size="10" fill="#334155">• BR2-R2: .226.2</text>
    <text x="460" y="70" font-size="10" fill="#64748b">MPLS: .196.1/.2</text>
    <text x="460" y="92" font-size="10" font-weight="700" fill="#16a34a">✔ UP to BRGW7</text>
  </g>

  <!-- HOST 2: NUCVILLERS -->
  <rect x="700" y="265" width="425" height="490" rx="10" fill="#f8fafc" stroke="#16a34a" stroke-width="2" filter="url(#shadow)"/>
  <rect x="700" y="265" width="425" height="32" rx="8" fill="#15803d"/>
  <text x="720" y="287" font-size="14" font-weight="700" fill="#ffffff">🖥️ HOST: nucvillers (192.168.1.163 / .10.210)</text>
  <text x="1000" y="286" font-size="11" fill="#dcfce7">Branch Hypervisor</text>

  <!-- Nucvillers Interfaces -->
  <rect x="720" y="310" width="385" height="75" rx="6" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="735" y="330" font-size="11" font-weight="700" fill="#1e293b">Physical NIC enp88s0: <tspan font-weight="400">192.168.1.163/24</tspan></text>
  <text x="735" y="348" font-size="11" fill="#166534"><tspan font-weight="700">VLAN 10 Interface (br10):</tspan> 192.168.10.210/24</text>
  <text x="735" y="366" font-size="10" fill="#475569">Static Routes to nucbuntu (.221/.222/.226/.227 via .1.154)</text>

  <!-- virbr4 & NAT Bypass -->
  <rect x="720" y="400" width="385" height="110" rx="8" fill="#eff6ff" stroke="#3b82f6" stroke-width="1.5"/>
  <rect x="720" y="400" width="385" height="24" rx="6" fill="#2563eb"/>
  <text x="735" y="417" font-size="11" font-weight="700" fill="#ffffff">Bridge virbr4 (INTERNET) — 192.168.100.1/24</text>
  <text x="735" y="440" font-size="11" fill="#1e3a8a"><tspan font-weight="700">DHCP Range:</tspan> 192.168.100.2 - 192.168.100.254</text>
  <rect x="730" y="450" width="365" height="50" rx="4" fill="#fef2f2" stroke="#f87171"/>
  <text x="740" y="468" font-size="10.5" font-weight="700" fill="#b91c1c">🔥 CRITICAL IPTABLES BYPASS (RULE 1):</text>
  <text x="740" y="488" font-size="9.5" font-family="monospace" fill="#991b1b">-t nat -I POSTROUTING 1 -s 192.168.100.0/24 -d 192.168.0.0/16 -j ACCEPT</text>

  <!-- BRGW7 VM Box -->
  <rect x="720" y="525" width="385" height="140" rx="8" fill="#ffffff" stroke="#16a34a" stroke-width="2"/>
  <rect x="720" y="525" width="385" height="26" rx="6" fill="#16a34a"/>
  <text x="735" y="543" font-size="12" font-weight="700" fill="#ffffff">🚀 VM: DCBR7 / BRGW7 (Id 3) — Prisma SD-WAN Branch</text>
  <text x="735" y="572" font-size="11" fill="#1e293b"><tspan font-weight="700">WAN Interface:</tspan> 192.168.100.8/24 (attached to virbr4)</text>
  <text x="735" y="592" font-size="11" fill="#1e293b"><tspan font-weight="700">Default Gateway:</tspan> 192.168.100.1 (virbr4 host gateway)</text>
  <text x="735" y="612" font-size="11" fill="#15803d"><tspan font-weight="700">Native ESP (proto 50):</tspan> Preserves 192.168.100.8 source IP</text>
  <text x="735" y="632" font-size="11" fill="#15803d" font-weight="600">✔ Tunnels to DC1, DC2, BR1, BR2 &amp; BR8 all UP &amp; Active</text>

  <!-- Persistence Service -->
  <rect x="720" y="680" width="385" height="60" rx="6" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="735" y="698" font-size="11" font-weight="700" fill="#334155">⚙️ Persistence Mechanism:</text>
  <text x="735" y="715" font-size="10.5" fill="#475569">• /etc/netplan/60-sdwan-routes.yaml (Static routes)</text>
  <text x="735" y="730" font-size="10.5" fill="#475569">• sdwan-brgw7-bypass.service (Systemd boot hook)</text>

  <!-- Inter-Host Connecting lines -->
  <path d="M 675 335 L 720 335" stroke="#0284c7" stroke-width="3" stroke-dasharray="6 4" marker-end="url(#arrowhead)"/>
  <path d="M 720 345 L 675 345" stroke="#16a34a" stroke-width="3" stroke-dasharray="6 4" marker-end="url(#arrowhead-green)"/>
</svg>"""

def main():
    svg_data = generate_svg()
    svg_path = "docs/lab_network_topology.svg"
    png_path = "docs/lab_network_topology.png"
    
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_data)
    print(f"Saved SVG to {svg_path}")
    
    # Render SVG to high-res PNG using PyMuPDF (fitz)
    doc = fitz.open(stream=svg_data.encode("utf-8"), filetype="svg")
    page = doc[0]
    # Zoom x2 for sharp display on Retina/Evernote
    mat = fitz.Matrix(2.0, 2.0)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    pix.save(png_path)
    print(f"Rendered PNG to {png_path} ({pix.width}x{pix.height})")

if __name__ == "__main__":
    main()
