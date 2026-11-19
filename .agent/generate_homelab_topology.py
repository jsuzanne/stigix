#!/usr/bin/env python3
"""
Generate the "Prisma SD-WAN Hybrid Lab" topology diagram (SVG + PNG)
in the visual language of the Prisma SD-WAN Lab (v3) reference poster.

Outputs:
  docs/homelab-topology-v3.svg
  docs/homelab-topology-v3.png   (rendered with headless Chrome)
"""
import os
import subprocess
import tempfile
from html import escape

W, H = 2560, 1900

# ---------------------------------------------------------------- palette
BG = "#f4f6fa"
CARD = "#ffffff"
BORDER = "#e2e8f0"
INK = "#0f172a"
MUTED = "#64748b"
FAINT = "#94a3b8"
BAR = "#1e293b"

INET = "#2563eb"      # Internet / OBS underlay
MPLS = "#15a34a"      # MPLS private underlay
PHYS = "#9333ea"      # physical LAN / inter-NUC underlay
DCI = "#ea580c"       # datacenter interconnect
CLOUD = "#0ea5e9"     # public cloud sites

ION = "#f97316"       # virtual ION appliance
HWION = "#e11d48"     # physical ION appliance
VYOS = "#1e293b"      # VyOS router
PROBE = "#0d9488"     # stigix probe

MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

S = []
def add(s):
    S.append(s)


# ---------------------------------------------------------------- helpers
def tx(x, y, s, size=13, fill=MUTED, weight=400, anchor="start", mono=False, ls=0, op=1.0):
    f = f' font-family="{MONO}"' if mono else ""
    a = f' text-anchor="{anchor}"' if anchor != "start" else ""
    l = f' letter-spacing="{ls}"' if ls else ""
    o = f' opacity="{op}"' if op != 1.0 else ""
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}"{f}{a}{l}{o}>{escape(str(s))}</text>')


def rect(x, y, w, h, r=10, fill=CARD, stroke=None, sw=1, shadow=False, dash=None, op=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    sh = ' filter="url(#soft)"' if shadow else ""
    o = f' fill-opacity="{op}"' if op is not None else ""
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" '
        f'fill="{fill}"{o}{s}{d}{sh}/>')


def pill(x, y, label, fill="#eef2f7", color="#475569", size=12, pad=11, h=22, bold=700, stroke=None):
    w = len(label) * size * 0.60 + pad * 2
    rect(x, y, w, h, r=h / 2, fill=fill, stroke=stroke)
    tx(x + w / 2, y + h / 2 + size * 0.36, label, size, color, bold, anchor="middle")
    return w


def hline(x1, x2, y, color=BORDER, sw=1):
    add(f'<line x1="{x1:.1f}" y1="{y:.1f}" x2="{x2:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="{sw}"/>')


def path(d, stroke, sw=2.6, dash=None, fill="none", cap="round"):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" '
        f'stroke-linecap="{cap}" stroke-linejoin="round"{da}/>')


def link(x1, y1, x2, y2, lane, color, dash=None, sw=2.6, r=8):
    """Orthogonal 3-segment link with rounded corners."""
    if abs(x1 - x2) < 2:
        path(f"M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}", color, sw, dash)
        return
    s1 = 1 if lane > y1 else -1
    s2 = 1 if y2 > lane else -1
    sx = 1 if x2 > x1 else -1
    d = (f"M{x1:.1f} {y1:.1f} "
         f"L{x1:.1f} {lane - s1 * r:.1f} "
         f"Q{x1:.1f} {lane:.1f} {x1 + sx * r:.1f} {lane:.1f} "
         f"L{x2 - sx * r:.1f} {lane:.1f} "
         f"Q{x2:.1f} {lane:.1f} {x2:.1f} {lane + s2 * r:.1f} "
         f"L{x2:.1f} {y2:.1f}")
    path(d, color, sw, dash)
    add(f'<circle cx="{x1:.1f}" cy="{y1:.1f}" r="4" fill="{color}"/>')
    add(f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="4" fill="{color}"/>')


def cloud_path(x, y, w, h, bump=26):
    """Closed scalloped 'cloud' outline around the given box."""
    def side(x0, y0, x1, y1):
        import math
        n = max(2, int(round(math.hypot(x1 - x0, y1 - y0) / (bump * 2))))
        dx, dy = (x1 - x0) / n, (y1 - y0) / n
        r = math.hypot(dx, dy) / 2
        return "".join(f" a{r:.1f},{r:.1f} 0 0,1 {dx:.1f},{dy:.1f}" for _ in range(n))
    d = (f"M{x:.1f} {y:.1f}" + side(x, y, x + w, y) + side(x + w, y, x + w, y + h)
         + side(x + w, y + h, x, y + h) + side(x, y + h, x, y) + " Z")
    return d


# ---------------------------------------------------------------- glyphs
def icon(x, y, kind, size=28):
    g = f'<g transform="translate({x:.1f},{y:.1f}) scale({size/28:.4f})">'
    add(g)
    if kind == "ion":
        rect(0, 0, 28, 28, 8, fill=ION)
        path("M8 10.5 H19 M16 7.5 L19 10.5 L16 13.5", "#fff", 2.1)
        path("M20 17.5 H9 M12 14.5 L9 17.5 L12 20.5", "#fff", 2.1)
    elif kind == "hwion":
        rect(0, 0, 28, 28, 8, fill=HWION)
        rect(5.5, 7.5, 17, 5.5, 1.6, fill="#fff")
        rect(5.5, 15, 17, 5.5, 1.6, fill="#fff")
        add('<circle cx="19" cy="10.2" r="1.1" fill="#e11d48"/>')
        add('<circle cx="19" cy="17.7" r="1.1" fill="#e11d48"/>')
    elif kind == "vyos":
        add('<circle cx="14" cy="14" r="14" fill="#1e293b"/>')
        path("M14 5.5 V22.5 M6.6 9.8 L21.4 18.2 M21.4 9.8 L6.6 18.2", "#fff", 2.1)
    elif kind == "probe":
        rect(0, 0, 28, 28, 8, fill=PROBE)
        path("M5.5 14 H9.5 L12.5 7.5 L16.5 20.5 L19 14 H22.5", "#fff", 2.1)
    elif kind == "cloud":
        rect(0, 0, 28, 28, 8, fill=CLOUD)
        path("M9 18 h10.2 a3.6 3.6 0 0 0 0-7.2 a5.2 5.2 0 0 0-9.8-1.3 A3.9 3.9 0 0 0 9 18 Z",
             "#fff", 1.9, fill="none")
    elif kind == "hub":
        rect(0, 0, 28, 28, 8, fill="#0f766e")
        path("M14 6 V22 M6 14 H22", "#fff", 2.1)
    add("</g>")


# ---------------------------------------------------------------- blocks
def device(x, y, w, h, kind, name, sub, rows=None, notes=None, accent=None, r=10):
    rect(x, y, w, h, r, fill=CARD, stroke=accent or BORDER, sw=1.4 if accent else 1)
    icon(x + 12, y + 12, kind, 26)
    tx(x + 48, y + 24, name, 15, INK, 700)
    tx(x + 48, y + 42, sub, 11.5, MUTED, 500)
    yy = y + 66
    if rows:
        for p, t, tc, v in rows:
            tx(x + 14, yy, p, 11.5, "#334155", 650)
            tx(x + 62, yy, t, 11.5, tc, 750)
            tx(x + 128, yy, v, 11.5, INK, 500, mono=True)
            yy += 19
    if notes:
        for n in notes:
            tx(x + 14, yy, n, 11, MUTED, 500, mono=True)
            yy += 17


def chip(x, y, w, title, sub, color, h=52, extra=None):
    rect(x, y, w, h, 9, fill="#ffffff", stroke=color, sw=1.6)
    rect(x, y, w, h, 9, fill=color, op=0.06)
    tx(x + w / 2, y + 21, title, 12.5, color, 750, anchor="middle")
    tx(x + w / 2, y + 38, sub, 11, "#334155", 550, anchor="middle", mono=True)
    if extra:
        tx(x + w / 2, y + h + 15, extra, 10.5, MUTED, 600, anchor="middle")
    return x + w / 2


def ethbox(x, y, w, label, ip, color, h=44):
    rect(x, y, w, h, 8, fill="#ffffff", stroke=color, sw=1.4)
    tx(x + w / 2, y + 18, label, 11.5, color, 750, anchor="middle")
    tx(x + w / 2, y + 33, ip, 10.5, "#334155", 500, anchor="middle", mono=True)
    return x + w / 2


def lanbar(x, y, w, text, h=26, fill=BAR):
    rect(x, y, w, h, 7, fill=fill)
    tx(x + 14, y + h / 2 + 4.5, text, 12, "#e2e8f0", 650)


def sitecard(x, y, w, h, title, badges, right):
    rect(x, y, w, h, 16, fill=CARD, stroke=BORDER, shadow=True)
    tx(x + 22, y + 38, title, 27, INK, 800, ls=-0.4)
    bx = x + 26 + len(title) * 16.8
    for lbl, bf, bc in badges:
        bx += pill(bx, y + 18, lbl, bf, bc, 11.5, 10, 22) + 8
    tx(x + w - 20, y + 32, right, 11.5, FAINT, 600, anchor="end")


# ================================================================ canvas
add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    f'font-family="Inter, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">')
add('<defs>'
    '<filter id="soft" x="-6%" y="-6%" width="112%" height="112%">'
    '<feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.07"/></filter>'
    '<filter id="softer" x="-10%" y="-10%" width="120%" height="120%">'
    '<feDropShadow dx="0" dy="3" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.06"/></filter>'
    '</defs>')
rect(0, 0, W, H, 0, fill=BG)

# ---------------------------------------------------------------- header
rect(40, 38, 9, 58, 4, fill=ION)
tx(68, 86, "Prisma SD-WAN Hybrid Lab — Topology & Interconnect", 44, INK, 800, ls=-1.1)
tx(70, 122, "2 hyperviseurs KVM (nucubuntu · nucvillers) · WAN émulé par vyosrouter · 8 vIONs + 2 IONs physiques · "
            "4 routeurs VyOS · 7 sondes Stigix · Multi-cloud (AWS, Azure, Hetzner)", 18, MUTED, 500)
bx = 1960
for lbl, bf, bc in [("LAB ONLINE", "#dcfce7", "#15803d"), ("SCM MANAGED", "#dbeafe", "#1d4ed8"),
                    ("v3.18 / LLD", "#fef3c7", "#b45309")]:
    bx += pill(bx, 52, lbl, bf, bc, 13, 14, 30) + 10

# ================================================================ DC-01
X1, Y1, CW, CH = 40, 150, 620, 380
sitecard(X1, Y1, CW, CH, "DC-01", [("Hub", "#e0f2fe", "#0369a1"), ("DC HA", "#fee2e2", "#b91c1c")],
         "Host : nucubuntu (192.168.1.154)")
lanbar(X1 + 18, Y1 + 54, CW - 36, "SITE LAN 192.168.201.0/24 (virbr5 · Lan201)   ·   Slow App 192.168.203.0/24 (virbr17)")
device(X1 + 18, Y1 + 92, 284, 100, "probe", "ubuntu201", "Stigix client probe",
       notes=[".201.100  ·  .203.100", "gw .201.10 (VyosLANDC)"])
device(X1 + 318, Y1 + 92, 284, 100, "vyos", "VyosLANDC", "DC-01 core / CE router",
       notes=["eth1 .201.10/24 · eth4 DCI .200.3", "eth2 WAN170 · eth3 .81.254 (exit)", "mgmt 192.168.122.210"])
device(X1 + 18, Y1 + 204, 284, 150, "ion", "DC1-R1", "vION 3102v · SW 6.3.6 · ID 1677771407…",
       rows=[("port 1", "INET", INET, "192.168.221.1/24"),
             ("port 2", "MPLS", MPLS, "192.168.191.1/24"),
             ("port 3", "LAN", "#475569", "192.168.201.3/24")])
device(X1 + 318, Y1 + 204, 284, 150, "ion", "DC1-R2", "vION 3102v · SW 6.3.6 · ID 1677771407…",
       rows=[("port 1", "INET", INET, "192.168.221.2/24"),
             ("port 2", "MPLS", MPLS, "192.168.191.3/24"),
             ("port 3", "LAN", "#475569", "192.168.201.5/24")])

# ================================================================ DC-02
X2 = 740
sitecard(X2, Y1, CW, CH, "DC-02", [("Hub", "#e0f2fe", "#0369a1"), ("DC HA", "#fee2e2", "#b91c1c")],
         "Host : nucubuntu (192.168.1.154)")
lanbar(X2 + 18, Y1 + 54, CW - 36, "SITE LAN 192.168.202.0/24 (virbr15 · Lan202)   ·   Server Net virbr39")
device(X2 + 18, Y1 + 92, 284, 100, "probe", "ubuntu202", "Stigix client probe",
       notes=[".202.100/24", "gw .202.10 (VyosLANDC2)"])
device(X2 + 318, Y1 + 92, 284, 100, "vyos", "VyosLANDC2", "DC-02 core / CE router",
       notes=["eth4 .202.10/24 · eth1 DCI .200.4", "eth2 .212.10 · eth3 .81.253 (exit)", "mgmt 192.168.122.211"])
device(X2 + 18, Y1 + 204, 284, 150, "ion", "DC2-R1", "vION 3102v · SW 6.5.3 · ID 1677771600…",
       rows=[("port 1", "INET", INET, "192.168.222.1/24"),
             ("port 2", "MPLS", MPLS, "192.168.192.1/24"),
             ("port 3", "LAN", "#475569", "192.168.202.4/24")])
device(X2 + 318, Y1 + 204, 284, 150, "ion", "DC2-R2", "vION 3102v · SW 6.5.3 · ID 1677771600…",
       rows=[("port 1", "INET", INET, "DHCP (192.168.222.x)"),
             ("port 2", "MPLS", MPLS, "DHCP (192.168.192.x)"),
             ("port 3", "LAN", "#475569", "192.168.202.5/24")])

# DCI backbone between the two cores
link(X1 + 460, Y1 + CH, X2 + 160, Y1 + CH, Y1 + CH + 18, DCI, dash="9 7", sw=2.4)
pill(690, 531, "DCI BACKBONE 192.168.200.0/24   ·   .200.3 ↔ .200.4", "#fff7ed", DCI, 12, 14, 28, 750, stroke=DCI)

# ================================================================ cloud DCs
X3, CW3 = 1380, 640
for i, (title, prov, lan, dev, l1, l2) in enumerate([
    ("DC3-AWS-US", "AWS", "LAN 172.16.2.0/24", "DC3-AWS · vION 3102v", "INET 172.16.1.84", "LAN 172.16.2.243"),
    ("DC4-AZURE-FF", "Azure", "LAN 10.0.1.0/24", "DC4-Azure-FR · vION 7108v", "INET 10.0.3.10", "LAN 10.0.1.5"),
    ("DC5-AZURE-UK", "Azure", "LAN 10.0.100.0/24", "DC5-Azure-UK · vION 7108v", "INET 10.0.3.10", "LAN 10.0.100.4"),
]):
    cy = Y1 + i * 132
    rect(X3, cy, CW3, 116, 16, fill=CARD, stroke=BORDER, shadow=True)
    tx(X3 + 22, cy + 34, title, 21, INK, 800, ls=-0.3)
    pill(X3 + 30 + len(title) * 13.6, cy + 16, prov, "#e0f2fe", "#0369a1", 11.5, 10, 22)
    tx(X3 + CW3 - 20, cy + 30, lan, 12, FAINT, 650, anchor="end")
    icon(X3 + 22, cy + 56, "ion", 26)
    tx(X3 + 58, cy + 70, dev, 14, INK, 700)
    tx(X3 + 58, cy + 93, f"{l1}      {l2}", 12, MUTED, 550, mono=True)

# ================================================================ management
MX, MY, MW = 2040, 150, 480
rect(MX, MY, MW, 520, 16, fill=CARD, stroke=BORDER, shadow=True)
tx(MX + 22, MY + 36, "Management & Lab Underlay", 21, INK, 800, ls=-0.3)
tx(MX + 22, MY + 58, "Infrastructure physique & virtuelle du lab", 12, FAINT, 550)

rect(MX + 18, MY + 74, MW - 36, 78, 10, fill="#f0fdfa", stroke="#99f6e4")
icon(MX + 30, MY + 86, "probe", 24)
tx(MX + 62, MY + 100, "Stigix Registry & Central Leader", 14, INK, 750)
tx(MX + 62, MY + 119, "http://192.168.1.154:3100  (Docker · nucubuntu)", 11.5, MUTED, 500, mono=True)
tx(MX + 62, MY + 137, "Orchestre trafic IoT, rejeux PCAP & impairments", 11.5, MUTED, 500)

tx(MX + 22, MY + 180, "ADRESSAGE HYPERVISEURS & UNDERLAY", 11.5, FAINT, 800, ls=0.8)
rows = [
    ("nucubuntu — KVM host 1", "#0f766e", "192.168.1.154/24 (enp88s0)"),
    ("", "", "mgmt virbr0 .122.1 · transit virbr11 192.168.80.1"),
    ("nucvillers — KVM host 2", "#0f766e", "192.168.1.242/24 (enp88s0)"),
    ("", "", "VLANs .10.210 | .50.232 · virbr4 INTERNET .100.1/24"),
    ("Ubiquiti Gateway", "#b45309", "192.168.1.240  (default GW)"),
    ("", "", "route 192.168.100.0/24 via 192.168.10.210"),
    ("Hetzner Edge Probe", "#9333ea", "142.132.193.157  (cloud seedbox)"),
]
yy = MY + 202
for label, color, val in rows:
    if label:
        add(f'<circle cx="{MX+28}" cy="{yy-4:.0f}" r="3.2" fill="{color}"/>')
        tx(MX + 40, yy, label, 12, INK, 700)
        tx(MX + MW - 22, yy, val, 11, MUTED, 550, anchor="end", mono=True)
        yy += 18
    else:
        tx(MX + 40, yy, val, 10.5, FAINT, 500, mono=True)
        yy += 20

rect(MX + 18, MY + 404, MW - 36, 96, 10, fill="#eff6ff", stroke="#bfdbfe")
icon(MX + 30, MY + 416, "cloud", 24)
tx(MX + 62, MY + 430, "Prisma SASE Cloud Controller", 14, INK, 750)
tx(MX + 30, MY + 456, "https://api.sase.paloaltonetworks.com  (tenant TSG)", 11.5, MUTED, 500, mono=True)
tx(MX + 30, MY + 475, "Les 10 IONs joignent SCM via le port controller 1", 11.5, MUTED, 500)
tx(MX + 30, MY + 492, "sur l'underlay INET public.", 11.5, MUTED, 500)

# ================================================================ DC circuit chips
CY = 560
dc1_inet = chip(40, CY, 140, "dc1-inet", ".221.1", INET)
dc1_mpls = chip(200, CY, 140, "dc1-mpls", ".191.1", MPLS)
dc1_inet2 = chip(360, CY, 140, "dc1-inet-r2", ".221.2", INET)
dc1_mpls2 = chip(520, CY, 140, "dc1-mpls-r2", ".191.3", MPLS)
dc2_inet = chip(740, CY, 140, "dc2-inet", ".222.1", INET)
dc2_mpls = chip(900, CY, 140, "dc2-mpls", ".192.1", MPLS)
dc2_inet2 = chip(1060, CY, 140, "dc2-inet-r2", "DHCP", INET)
dc2_mpls2 = chip(1220, CY, 140, "dc2-mpls-r2", "DHCP", MPLS)
c3 = chip(1380, CY, 200, "dc3-aws-inet", "172.16.1.84", CLOUD)
c4 = chip(1600, CY, 200, "dc4-azur-inet", "10.0.3.10", CLOUD)
c5 = chip(1820, CY, 200, "dc5-uk-inet", "10.0.3.10", CLOUD)

# ================================================================ carriers
CLY, CLH = 680, 300

# --- MPLS carrier
mx, mw = 60, 680
add(f'<path d="{cloud_path(mx, CLY, mw, CLH)}" fill="#f0fdf4" stroke="#86efac" stroke-width="2.2" filter="url(#softer)"/>')
e_mpls_dc1 = ethbox(mx + 40, CLY + 20, 150, "eth11 (DC1)", "192.168.191.254", MPLS)
e_mpls_dc2 = ethbox(mx + 210, CLY + 20, 150, "eth13 (DC2)", "192.168.192.254", MPLS)
ethbox(mx + 380, CLY + 20, 160, "eth0 (ALL-MPLS)", "192.168.190.254", MPLS)
add(f'<circle cx="{mx+68}" cy="{CLY+120}" r="21" fill="{MPLS}"/>')
tx(mx + 68, CLY + 128, "M", 22, "#fff", 800, anchor="middle")
tx(mx + 102, CLY + 112, "MPLS Underlay Carrier", 22, "#14532d", 800, ls=-0.3)
tx(mx + 102, CLY + 134, "virbr3 · AS 65000 · WAN privé isolé · émulé par vyosrouter (nucubuntu)", 12.5, "#15803d", 600)
tx(mx + 40, CLY + 166, "Subnets : 192.168.190.0/24 (virbr3) · .191.0/24 (virbr32) · .192.0/24 (virbr33)", 12, "#166534", 500, mono=True)
tx(mx + 40, CLY + 185, "            .196.0/24 (virbr21) · .197.0/24 (virbr9)", 12, "#166534", 500, mono=True)
tx(mx + 40, CLY + 206, "Netem QoS actif : jitter, perte & latence pilotés par l'API Stigix sur vyosrouter", 12, "#15803d", 550)
pill(mx + 40, CLY + 218, "PRIVATE-ANYNET FULL MESH", "#dcfce7", "#15803d", 11.5, 12, 24)
e_mpls_br1 = ethbox(mx + 100, CLY + 236, 150, "eth1 (BR1)", "192.168.197.254", MPLS)
e_mpls_br2 = ethbox(mx + 360, CLY + 236, 150, "eth8 (BR2)", "192.168.196.254", MPLS)

# --- Internet carrier
ix, iw = 800, 700
add(f'<path d="{cloud_path(ix, CLY, iw, CLH)}" fill="#eff6ff" stroke="#93c5fd" stroke-width="2.2" filter="url(#softer)"/>')
e_inet_dc1 = ethbox(ix + 30, CLY + 20, 150, "eth10 (DC1)", "192.168.221.254", INET)
e_inet_dc2 = ethbox(ix + 200, CLY + 20, 150, "eth12 (DC2)", "192.168.222.254", INET)
e_inet_nat = ethbox(ix + 370, CLY + 20, 150, "eth0 (NAT public)", "AWS · Azure · HETZ", CLOUD)
e_inet_tr = ethbox(ix + 540, CLY + 20, 150, "eth5 (transit .80)", "192.168.80.254", "#f59e0b")
add(f'<circle cx="{ix+58}" cy="{CLY+120}" r="21" fill="{INET}"/>')
tx(ix + 58, CLY + 128, "I", 22, "#fff", 800, anchor="middle")
tx(ix + 92, CLY + 112, "Internet Carrier (OBS / INET-1)", 22, "#1e3a8a", 800, ls=-0.3)
tx(ix + 92, CLY + 134, "virbr2 · breakout public & transit des overlays VPN · émulé par vyosrouter", 12.5, "#1d4ed8", 600)
tx(ix + 30, CLY + 166, "Subnets : 192.168.220.0/24 (virbr2) · .221.0/24 (virbr31) · .222.0/24 (virbr34)", 12, "#1e40af", 500, mono=True)
tx(ix + 30, CLY + 185, "            .226.0/24 (virbr36) · .227.0/24 (virbr10)", 12, "#1e40af", 500, mono=True)
tx(ix + 30, CLY + 206, "NAT exclude rule 10 : 192.168.0.0/16 outbound eth5 → en-têtes ESP natifs préservés", 12, "#b45309", 650)
pill(ix + 30, CLY + 218, "PUBLIC-ANYNET SD-WAN OVERLAY", "#dbeafe", "#1d4ed8", 11.5, 12, 24)
e_inet_br1 = ethbox(ix + 60, CLY + 236, 150, "eth3 (BR1)", "192.168.227.254", INET)
e_inet_br2 = ethbox(ix + 240, CLY + 236, 150, "eth7 (BR2)", "192.168.226.254", INET)

# --- Physical LAN carrier
px, pw = 1580, 440
add(f'<path d="{cloud_path(px, CLY, pw, CLH)}" fill="#faf5ff" stroke="#d8b4fe" stroke-width="2.2" filter="url(#softer)"/>')
ethbox(px + 24, CLY + 20, 180, "BRGW7 (virbr4)", "192.168.100.8", PHYS)
ethbox(px + 216, CLY + 20, 180, "UniFi GW", "192.168.1.240", PHYS)
ethbox(px + 24, CLY + 72, 180, "BR5 (ION 2000)", ".1.235  |  .1.238", PHYS)
ethbox(px + 216, CLY + 72, 180, "BR8 (ION 1200-S)", ".1.155  |  .1.156", PHYS)
add(f'<circle cx="{px+52}" cy="{CLY+150}" r="21" fill="{PHYS}"/>')
tx(px + 52, CLY + 158, "P", 22, "#fff", 800, anchor="middle")
tx(px + 86, CLY + 145, "Physical LAN & Inter-NUC", 19, "#581c87", 800, ls=-0.3)
tx(px + 86, CLY + 165, "192.168.1.0/24 · switch 2.5 GbE enp88s0", 12, "#7e22ce", 600)
tx(px + 24, CLY + 194, "Service nucvillers : sdwan-brgw7-bypass.service", 11.5, "#6b21a8", 550, mono=True)
tx(px + 24, CLY + 211, "(iptables POSTROUTING ACCEPT → bypass NAT libvirt)", 11.5, "#6b21a8", 500)
tx(px + 24, CLY + 230, "Routes netplan nucvillers : .221/.222/.226/.227.0/24", 11.5, "#6b21a8", 550, mono=True)
tx(px + 24, CLY + 247, "via 192.168.1.154 (nucubuntu)", 11.5, "#6b21a8", 550, mono=True)
pill(px + 24, CLY + 258, "CROSS-HOST ESP TUNNELS UP", "#f3e8ff", "#7e22ce", 11.5, 12, 24)

# ================================================================ DC → carrier links
for cx_, ex, lane in [(dc1_mpls, e_mpls_dc1, 628), (dc1_mpls2, e_mpls_dc1, 636),
                      (dc2_mpls, e_mpls_dc2, 644), (dc2_mpls2, e_mpls_dc2, 652)]:
    link(cx_, CY + 52, ex, CLY + 20, lane, MPLS)
for cx_, ex, lane in [(dc1_inet, e_inet_dc1, 660), (dc1_inet2, e_inet_dc1, 668),
                      (dc2_inet, e_inet_dc2, 676), (dc2_inet2, e_inet_dc2, 684)]:
    link(cx_, CY + 52, ex, CLY + 20, lane, INET)
for cx_, lane in [(c3, 620), (c4, 614), (c5, 608)]:
    link(cx_, CY + 52, e_inet_nat, CLY + 20, lane, CLOUD, dash="7 6", sw=2.2)

# ================================================================ branch circuit chips
BY = 1050
br1_mpls = chip(40, BY, 162, "br1-mpls", "192.168.197.1", MPLS)
br1_inet = chip(218, BY, 162, "br1-inet", "192.168.227.1", INET)
br2_mpls = chip(396, BY, 110, "br2-mpls", ".196.1", MPLS)
br2_inet = chip(516, BY, 110, "br2-inet", ".226.1", INET)
br2_mpls2 = chip(636, BY, 110, "br2-mpls2", ".196.2", MPLS)
br2_inet2 = chip(756, BY, 110, "br2-inet2", ".226.2", INET)
br7_c = chip(972, BY, 230, "virbr4 INTERNET", "192.168.100.8", PHYS)
br8_1 = chip(1308, BY, 166, "INET1 · OBS", "192.168.1.155", PHYS)
br8_2 = chip(1490, BY, 166, "INET2 · SFR", "192.168.1.156", PHYS)
br5_1 = chip(1672, BY, 166, "INET1 · OBS", "192.168.1.235", PHYS)
br5_2 = chip(1854, BY, 166, "INET2 · SFR", "192.168.1.238", PHYS)

CB = CLY + CLH - 20  # carrier bottom anchor row
for sx, tx_, lane, col in [(e_mpls_br1, br1_mpls, 996, MPLS), (e_mpls_br2, br2_mpls, 1004, MPLS),
                           (e_mpls_br2, br2_mpls2, 1012, MPLS), (e_inet_br1, br1_inet, 1020, INET),
                           (e_inet_br2, br2_inet, 1028, INET), (e_inet_br2, br2_inet2, 1036, INET)]:
    link(sx, CLY + 280, tx_, BY, lane, col)
for sx, tx_, lane in [(px + 70, br7_c, 1040), (px + 160, br8_1, 1032), (px + 250, br8_2, 1024),
                      (px + 330, br5_1, 1016), (px + 410, br5_2, 1008)]:
    link(sx, CLY + CLH - 12, tx_, BY, lane, PHYS)

# ================================================================ branches
BRY, BRH = 1130, 470

# --- Branch-01
bx1, bw1 = 40, 340
sitecard(bx1, BRY, bw1, BRH, "Branch-01", [("Spoke", "#e0e7ff", "#4338ca")], "nucubuntu")
tx(bx1 + 22, BRY + 58, "BR1", 13, FAINT, 750)
device(bx1 + 18, BRY + 74, bw1 - 36, 150, "ion", "BR1", "vION 3102v · SW 6.5.3",
       rows=[("port 1", "INET", INET, "192.168.227.1/24"),
             ("port 2", "MPLS", MPLS, "192.168.197.1/24"),
             ("port 3", "LAN", "#475569", "192.168.207.1/24")])
device(bx1 + 18, BRY + 236, bw1 - 36, 86, "probe", "ubuntu207", "Stigix client probe",
       notes=["192.168.207.100/24", "gw 192.168.207.1 (BR1 LAN)"])
lanbar(bx1 + 18, BRY + 334, bw1 - 36, "BRANCH LAN 192.168.207.0/24 (virbr4)")
tx(bx1 + 22, BRY + 384, "mgmt virbr0 192.168.122.176", 11, FAINT, 550, mono=True)
tx(bx1 + 22, BRY + 406, "✔ Tunnels UP → DC1 · DC2 · BR2 · BR8", 11.5, "#15803d", 700)

# --- Branch-02
bx2, bw2 = 396, 470
sitecard(bx2, BRY, bw2, BRH, "Branch-02", [("Spoke HA", "#ffedd5", "#c2410c")], "nucubuntu")
tx(bx2 + 22, BRY + 58, "BR2", 13, FAINT, 750)
device(bx2 + 18, BRY + 74, 209, 130, "ion", "BR2-R1", "vION 3102v · SW 6.3.6",
       rows=[("port 1", "INET", INET, "192.168.226.1"),
             ("port 2", "MPLS", MPLS, "192.168.196.1"),
             ("LAN", "virbr37", "#475569", "interco206b")])
device(bx2 + 243, BRY + 74, 209, 130, "ion", "BR2-R2", "vION 3102v · SW 6.3.6",
       rows=[("port 1", "INET", INET, "192.168.226.2"),
             ("port 2", "MPLS", MPLS, "192.168.196.2"),
             ("LAN", "virbr37", "#475569", "interco206b")])
device(bx2 + 18, BRY + 216, 209, 106, "vyos", "VyosBR2", "Core CE router",
       notes=["eth3 .216.2 · eth5 .206.1", "AWS ER 10.10.206.6", "mgmt .122.64"])
device(bx2 + 243, BRY + 216, 209, 106, "probe", "ubuntu206", "Stigix client probe",
       notes=["192.168.206.100/24", "(virbr38)", "gw .206.1 (VyosBR2)"])
lanbar(bx2 + 18, BRY + 334, bw2 - 36, "BRANCH LAN 192.168.216.0/24  &  192.168.206.0/24 (Lan206B)")
tx(bx2 + 22, BRY + 384, "HA control link : virbr22", 11, FAINT, 550, mono=True)
tx(bx2 + 22, BRY + 406, "✔ Tunnels IPsec actifs → DC1 · DC2 · BRGW7", 11.5, "#15803d", 700)

# --- Branch-07
bx7, bw7 = 882, 410
sitecard(bx7, BRY, bw7, BRH, "Branch-07", [("Cross-Host", "#f3e8ff", "#7e22ce")], "nucvillers")
tx(bx7 + 22, BRY + 58, "BRGW7", 13, FAINT, 750)
device(bx7 + 18, BRY + 74, bw7 - 36, 150, "ion", "DCBR7 (BRGW7)", "vION 3102v · SW 6.5.3",
       rows=[("INET", "vnet3", INET, "192.168.100.8"),
             ("LAN", "vnet1", "#475569", "192.168.204.254"),
             ("LAN2", "vnet2", "#475569", "192.168.205.254")])
device(bx7 + 18, BRY + 236, 180, 86, "vyos", "vyosdc7", "Test router",
       notes=["eth1 .204.1 · eth2 .205.1", "mgmt 192.168.123.1"])
device(bx7 + 214, BRY + 236, 180, 86, "probe", "UbuntuDC7", "Test host",
       notes=["vnet8 / br217 (VLAN 217)", "probe direct → BR5 LAN"])
lanbar(bx7 + 18, BRY + 334, bw7 - 36, "BRANCH LAN 192.168.204.0/24  &  .205.0/24 (virbr2/3)")
tx(bx7 + 22, BRY + 384, "✔ NAT bypass actif · ESP natif (proto 50)", 11.5, "#15803d", 700)
tx(bx7 + 22, BRY + 406, "✔ Tunnels UP → DC1 · DC2 · BR1 · BR8", 11.5, "#15803d", 700)

# --- Branch-08
bx8, bw8 = 1308, 348
sitecard(bx8, BRY, bw8, BRH, "Branch-08", [("Hardware", "#fee2e2", "#b91c1c")], "Bordeaux")
tx(bx8 + 22, BRY + 58, "BR8", 13, FAINT, 750)
device(bx8 + 18, BRY + 74, bw8 - 36, 150, "hwion", "BR8", "ION 1200-S physique · SW 6.5.3",
       rows=[("port 1", "INET1", INET, "192.168.1.155"),
             ("port 2", "INET2", PHYS, "192.168.1.156"),
             ("LAN", "users", "#475569", "192.168.219.254/24")], accent="#fecdd3")
device(bx8 + 18, BRY + 236, bw8 - 36, 86, "probe", "UbuntuBR8", "Sonde lab",
       notes=["vnet16 / br219 (VLAN 219)", "branchée sur le LAN de l'ION"])
lanbar(bx8 + 18, BRY + 334, bw8 - 36, "USERS LAN 192.168.219.0/24 (VLAN 219)")
tx(bx8 + 22, BRY + 384, "Dual-ISP : OBS + SFR sur le LAN physique", 11, FAINT, 550)
tx(bx8 + 22, BRY + 406, "✔ Tunnels → DC1 · DC2 · BRGW7 · BR1 · BR2", 11.5, "#15803d", 700)

# --- Branch-05
bx5, bw5 = 1672, 348
sitecard(bx5, BRY, bw5, BRH, "Branch-05", [("Hardware", "#fee2e2", "#b91c1c")], "ION 2000")
tx(bx5 + 22, BRY + 58, "BR5", 13, FAINT, 750)
device(bx5 + 18, BRY + 74, bw5 - 36, 150, "hwion", "BR5", "ION 2000 physique · SW 6.5.3",
       rows=[("port 1", "INET1", INET, "192.168.1.235"),
             ("port 2", "INET2", PHYS, "192.168.1.238"),
             ("LAN", "3.217/2", "#475569", ".217.254 / .218.254")], accent="#fecdd3")
device(bx5 + 18, BRY + 236, bw5 - 36, 86, "probe", "UbuntuBR5", "Sonde lab",
       notes=["vnet14 / br217 (VLAN 217)", "mesure multicast & voix (PIM)"])
lanbar(bx5 + 18, BRY + 334, bw5 - 36, "BRANCH LAN 192.168.217.0/24 & .218.0/24")
tx(bx5 + 22, BRY + 384, "raspi2K sur le segment .218.0/24", 11, FAINT, 550)
tx(bx5 + 22, BRY + 406, "✔ Tunnels dual-ISP → DC1 · DC2 · BR1 · BR2", 11.5, "#15803d", 700)

# ================================================================ legend
LX, LY, LW, LH = 2040, 700, 480, 900
rect(LX, LY, LW, LH, 16, fill=CARD, stroke=BORDER, shadow=True)
tx(LX + 22, LY + 38, "Légende & repères", 21, INK, 800, ls=-0.3)

tx(LX + 22, LY + 72, "CIRCUITS & UNDERLAYS", 11.5, FAINT, 800, ls=0.8)
yy = LY + 96
for color, dash, name, desc in [
    (INET, None, "Internet underlay (INET-1 / OBS)", "vyosrouter eth2,3,7,10,12 · virbr2"),
    (MPLS, None, "MPLS underlay (AS 65000, privé)", "vyosrouter eth0,1,8,11,13 · virbr3"),
    (PHYS, None, "LAN physique / bridge underlay", "192.168.1.0/24 · bypass NAT virbr4"),
    (DCI, "9 7", "Datacenter Interconnect (DCI)", "192.168.200.0/24 VyosLANDC ↔ LANDC2"),
    (CLOUD, "7 6", "Accès cloud public (NAT eth0)", "AWS · Azure · Hetzner"),
]:
    path(f"M{LX+24} {yy} L{LX+76} {yy}", color, 3.4, dash)
    tx(LX + 90, yy + 4, name, 12.5, INK, 700)
    tx(LX + 90, yy + 21, desc, 11, MUTED, 500)
    yy += 44

tx(LX + 22, yy + 10, "RÔLES & ÉQUIPEMENTS", 11.5, FAINT, 800, ls=0.8)
yy += 34
for kind, name, desc in [
    ("ion", "Prisma SD-WAN vION", "appliances KVM — ion 3102v / 7108v"),
    ("hwion", "ION physique", "BR8 : ion 1200-S · BR5 : ion 2000"),
    ("vyos", "Routeur VyOS core / CE", "vyosrouter · VyosLANDC/2 · VyosBR2 · vyosdc7"),
    ("probe", "Sonde cliente Stigix", "ubuntu201/202/206/207 · UbuntuBR5/BR8/DC7"),
    ("cloud", "Site cloud public", "DC3 AWS · DC4 Azure FR · DC5 Azure UK"),
]:
    icon(LX + 24, yy - 14, kind, 26)
    tx(LX + 62, yy, name, 12.5, INK, 700)
    tx(LX + 62, yy + 17, desc, 11, MUTED, 500)
    yy += 42

tx(LX + 22, yy + 12, "LECTURE DU SCHÉMA", 11.5, FAINT, 800, ls=0.8)
yy += 38
rect(LX + 22, yy - 18, 116, 44, 8, fill="#fff", stroke=MPLS, sw=1.4)
tx(LX + 80, yy - 2, "circuit", 11.5, MPLS, 750, anchor="middle")
tx(LX + 80, yy + 14, "adresse", 10.5, "#334155", 500, anchor="middle", mono=True)
tx(LX + 152, yy - 2, "Chaque « chip » = un circuit WAN", 11.5, INK, 650)
tx(LX + 152, yy + 15, "SD-WAN rattaché à un bridge libvirt.", 11, MUTED, 500)
yy += 56
lanbar(LX + 22, yy - 16, 160, "SITE LAN x.x.x.0/24", 26)
tx(LX + 196, yy - 2, "Barre sombre = LAN du site", 11.5, INK, 650)
tx(LX + 196, yy + 15, "(bridge libvirt ou VLAN physique).", 11, MUTED, 500)

# ================================================================ runbook footer
FY = 1640
rect(40, FY, 2480, 196, 16, fill=CARD, stroke=BORDER, shadow=True)
tx(62, FY + 36, "Règles critiques du runbook lab", 20, INK, 800, ls=-0.3)
rect(62, FY + 50, 2456, 1, 0, fill=BORDER)

cols = [
    (62, "1 · Bypass NAT libvirt pour BRGW7 (nucvillers)", HWION, [
        ("mono", "iptables -t nat -I POSTROUTING 1 -s 192.168.100.0/24 \\"),
        ("mono", "        -d 192.168.0.0/16 -j ACCEPT"),
        ("text", "Persisté via sdwan-brgw7-bypass.service pour conserver"),
        ("text", "l'ESP natif (proto 50) non NATé entre les deux hyperviseurs."),
    ]),
    (902, "2 · Exclusion du source-NAT sur le core VyOS (nucubuntu)", INET, [
        ("mono", "set nat source rule 10 exclude"),
        ("mono", "set nat source rule 10 destination 192.168.0.0/16"),
        ("mono", "set nat source rule 10 outbound-interface eth5"),
        ("text", "Préserve le trafic RFC1918 inter-sites DC1/DC2/BR1/BR2/BRGW7."),
    ]),
    (1742, "3 · Tuning KVM des hôtes (/etc/sysctl.d/99-kvm-lab.conf)", MPLS, [
        ("mono", "vm.swappiness = 10"),
        ("mono", "vm.vfs_cache_pressure = 150"),
        ("text", "KSM strictement DÉSACTIVÉ — évite la famine mémoire des vIONs"),
        ("text", "et les faux positifs de latence pendant les campagnes de test."),
    ]),
]
for cx_, title, color, lines in cols:
    add(f'<rect x="{cx_}" y="{FY+70}" width="4" height="96" rx="2" fill="{color}"/>')
    tx(cx_ + 18, FY + 86, title, 13.5, INK, 750)
    yy = FY + 110
    for kind, line in lines:
        tx(cx_ + 18, yy, line, 11.5, "#334155" if kind == "mono" else MUTED,
           550, mono=(kind == "mono"))
        yy += 19

tx(62, FY + 234, "Généré pour Homelab Operations & Stigix Testing Framework  ·  "
                 "compatible Prisma SASE 3.18  ·  source : .agent/generate_homelab_topology.py",
   12.5, FAINT, 550)
tx(2518, FY + 234, "Lab 192.168.0.0/16  ·  confidentiel / usage interne", 12.5, FAINT, 550, anchor="end")

add("</svg>")

# ---------------------------------------------------------------- write
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_svg = os.path.join(ROOT, "docs", "homelab-topology-v3.svg")
out_png = os.path.join(ROOT, "docs", "homelab-topology-v3.png")
svg = "\n".join(S)
with open(out_svg, "w") as f:
    f.write(svg)
print("SVG :", out_svg, f"({len(svg)//1024} KB)")

# ---------------------------------------------------------------- PNG
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if os.path.exists(CHROME):
    with tempfile.TemporaryDirectory() as td:
        html = os.path.join(td, "page.html")
        with open(html, "w") as f:
            f.write(f'<!doctype html><meta charset="utf-8">'
                    f'<style>html,body{{margin:0;padding:0;background:{BG};}}'
                    f'svg{{display:block;}}</style>{svg}')
        subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                        f"--screenshot={out_png}", f"--window-size={W},{H}",
                        "--force-device-scale-factor=1.5", f"--user-data-dir={td}/cd",
                        f"file://{html}"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("PNG :", out_png, f"({os.path.getsize(out_png)//1024} KB)")
else:
    print("Chrome introuvable — PNG non généré.")
