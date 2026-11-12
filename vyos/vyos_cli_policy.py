"""VyOS command line policy for Stigix Live Inspector: READ-ONLY BY CONSTRUCTION.

A command is accepted only when its whole text matches ONE rule below: a fixed token sequence with typed arguments
(interface name ``ethN`` / ``bondN`` / ``vtiN`` / ``lo``, IPv4 address, IPv4 prefix, small bounded integers, a
tiny capture filter grammar). Everything else is refused with ``command_not_allowed`` plus the allowed forms. Nothing
else is ever sent to a router: the character set is a whitelist (no pipe, redirect, separator, quote, substitution,
newline or control character), at most 200 characters and 16 words, no verb that changes state (set, delete,
commit, configure, reboot, poweroff, reset, clear, restart, generate, install, add, format, telnet, ssh, scp, curl,
wget, shell, ``run``, ``sudo`` ...).
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass

TOOL = "run_vyos_cli_show"
INTERFACES_TOOL = "get_vyos_interfaces"
PROBE_TOOL = "run_vyos_probe"

KIND_SHOW, KIND_PROBE, KIND_CAPTURE, KIND_CONFIG = "show", "probe", "capture", "config"
SHOW_KINDS = (KIND_SHOW, KIND_CONFIG)
ACTIVE_KINDS = (KIND_PROBE, KIND_CAPTURE)
ALL_KINDS = (KIND_SHOW, KIND_CONFIG, KIND_PROBE, KIND_CAPTURE)

MAX_COMMAND_CHARS = 200
MAX_TOKENS = 16
MAX_TOKEN_CHARS = 40
COMMAND_TIMEOUT_S = 20
CAPTURE_SECONDS = 10
CAPTURE_MAX_PACKETS = 50
CAPTURE_MAX_TERMS = 6
MAX_OUTPUT_BYTES = 48 * 1024
CAPTURE_MAX_OUTPUT_BYTES = 64 * 1024
MAX_TABLE_LINES = 200
TAIL_MAX_LINES = 100
_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9 _.:/-]+$")

# Defence in depth: a token that is a state-changing verb, a shell word or a secret holder is refused even if a rule were
# ever written too loosely.
FORBIDDEN_TOKENS = frozenset({
    "set", "delete", "commit", "configure", "conf", "config", "reboot", "poweroff", "halt", "shutdown", "reset", "clear",
    "restart", "reload", "generate", "install", "add", "format", "telnet", "ssh", "scp", "sftp", "tftp", "ftp", "curl",
    "wget", "nc", "netcat", "shell", "bash", "sh", "run", "sudo", "su", "exec", "eval", "kill", "pkill", "rm", "mv", "cp",
    "copy", "rename", "load", "save", "upgrade", "downgrade", "remove", "erase", "enable", "disable", "unset", "edit",
    "write", "echo", "cat", "head", "grep", "sed", "awk", "xargs", "python", "perl", "tee", "dd", "mount", "umount",
    "chmod", "chown", "export", "env", "debug", "monitor", "password", "passwd", "secret", "token", "credential",
    "credentials", "private", "key", "keys", "certificate", "cert", "pki", "tcpdump",
})

DEVICE_REJECT_RX = re.compile(
    r"(invalid command|unknown command|command not found|% ?unknown|incomplete command|"
    r"no such file or directory|usage:|not recognized|syntax error|is not valid)",
    re.I,
)
REJECT_HINT = (
    "The router did not accept this form (VyOS 1.4/1.5 spelling differs between releases). Try ONE closely related "
    "allowed form at most, then say so; do not invent syntax."
)


def device_rejection(text: str) -> str:
    """The router's own rejection line when the output starts with one, else ''."""
    for line in [l for l in str(text or "").splitlines() if l.strip()][:3]:
        if DEVICE_REJECT_RX.search(line):
            return line.strip()[:200]
    return ""


class VyosCliError(ValueError):
    """``code`` / ``message`` are safe to show; ``hint`` says what to do."""

    def __init__(self, code: str, message: str, hint: str = ""):
        super().__init__(message)
        self.code, self.message, self.hint = code, message, hint


# ---- typed arguments -------------------------------------------------------------------------------------------
_OCTET = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
_IPV4 = re.compile(rf"{_OCTET}(?:\.{_OCTET}){{3}}")
_PREFIX = re.compile(rf"({_OCTET}(?:\.{_OCTET}){{3}})/(3[0-2]|[12]?\d)")
_ETH = re.compile(r"eth(?:[0-9]|1[0-9]|2[0-9]|3[0-1])")
_BOND = re.compile(r"bond(?:[0-9]|1[0-5])")
_VTI = re.compile(r"vti(?:[0-9]{1,3})")
_RULE = re.compile(r"[1-9][0-9]{0,4}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,31}")
CONFIG_SECTIONS = ("interfaces", "protocols", "nat", "firewall", "policy", "qos", "traffic-policy", "load-balancing", "vpn")
CHAINS = ("forward", "input", "output")


def _int_in(lo: int, hi: int):
    return lambda t: t.isdigit() and t[0] != "0" and lo <= int(t) <= hi and len(t) <= len(str(hi))


def _unicast_ipv4(t: str) -> bool:
    if not _IPV4.fullmatch(t):
        return False
    ip = ipaddress.IPv4Address(t)
    return not (ip.is_multicast or ip.is_unspecified or ip.is_loopback or ip.is_reserved or t == "255.255.255.255")


_VALIDATORS = {
    "<ipv4>": lambda t: bool(_IPV4.fullmatch(t)),
    "<unicast>": _unicast_ipv4,
    "<prefix>": lambda t: bool(_PREFIX.fullmatch(t)),
    "<addr>": lambda t: bool(_IPV4.fullmatch(t) or _PREFIX.fullmatch(t)),
    "<eth>": lambda t: bool(_ETH.fullmatch(t)),
    "<bond>": lambda t: bool(_BOND.fullmatch(t)),
    "<vti>": lambda t: bool(_VTI.fullmatch(t)),
    "<ifname>": lambda t: bool(_ETH.fullmatch(t) or _BOND.fullmatch(t) or _VTI.fullmatch(t) or t == "lo"),
    "<count1-5>": _int_in(1, 5),
    "<count1-50>": _int_in(1, CAPTURE_MAX_PACKETS),
    "<tail1-100>": _int_in(1, TAIL_MAX_LINES),
    "<rule>": lambda t: bool(_RULE.fullmatch(t)),
    "<name>": lambda t: bool(_NAME.fullmatch(t)),
    "<chain>": lambda t: t in CHAINS,
    "<section>": lambda t: t in CONFIG_SECTIONS,
}


@dataclass(frozen=True)
class Rule:
    text: str                  # tokens; <...> are typed arguments
    what: str
    category: str = "interfaces"
    kind: str = KIND_SHOW
    send: str = ""             # synthetic form: the fixed command actually sent (else the text as written)
    verified: bool = True      # False = spelling may vary across VyOS 1.4 / 1.5 releases
    post: str = ""             # worker post-processing: "" | match | section | statistics | config | table | tail | queue


RULES: tuple[Rule, ...] = (
    # -- 1. Interfaces & Netem Queues ---------------------------------------------------------------------------
    Rule("show interfaces", "All interfaces: addresses, admin / link state (S/L), description", category="interfaces"),
    Rule("show interfaces ethernet <eth>", "One Ethernet interface: state, addresses, rx / tx packets, errors, drops", category="interfaces"),
    Rule("show interfaces ethernet <eth> queue", "The interface's tc queue statistics (qdiscs, netem impairments, drops)",
         category="interfaces", verified=False, post="queue"),
    Rule("show interfaces bonding <bond>", "One bonding interface", category="interfaces", verified=False),
    Rule("show interfaces vti <vti>", "One VTI tunnel interface", category="interfaces", verified=False),
    Rule("show interfaces loopback lo", "The loopback interface", category="interfaces", verified=False),
    Rule("show interfaces counters", "RX / TX packet and byte counters per interface", category="interfaces", verified=False),
    Rule("show interfaces statistics", "Per interface: admin / link state, MTU, rx / tx packets, errors, dropped (kernel `ip -s link`)",
         category="interfaces", send="/bin/ip -s link show", verified=False, post="statistics"),
    Rule("show arp", "ARP / neighbour table", category="interfaces", verified=False),
    Rule("show arp interface <ifname>", "ARP / neighbour table of one interface", category="interfaces", verified=False),
    Rule("show neighbors", "Neighbour table (VyOS 1.4+ spelling)", category="interfaces", verified=False),
    Rule("show ip neighbors", "IPv4 neighbour table", category="interfaces", verified=False),
    Rule("show ip forwarding", "Whether IPv4 forwarding is enabled", category="interfaces", verified=False),
    Rule("show qos interface <ifname>", "QoS / shaper / network-emulator state of one interface", category="interfaces", verified=False),

    # -- 2. Routing & BGP ---------------------------------------------------------------------------------------
    Rule("show ip route", "The IPv4 routing table", category="routing"),
    Rule("show ip route <addr>", "The route used for one IPv4 address, or the routes of one prefix", category="routing"),
    Rule("show ip route summary", "Route counts per protocol", category="routing", verified=False),
    Rule("show ip route connected", "Connected routes", category="routing"),
    Rule("show ip route static", "Static routes (including tag-999 blackhole routes)", category="routing"),
    Rule("show ip route bgp", "BGP routes in RIB", category="routing"),
    Rule("show ip bgp", "The BGP table", category="routing", verified=False),
    Rule("show ip bgp summary", "BGP neighbours: state, uptime, prefixes received/advertised", category="routing"),
    Rule("show ip bgp <addr>", "One BGP prefix or address: paths, attributes, best path", category="routing"),
    Rule("show ip bgp neighbors <ipv4>", "One BGP neighbour in detail", category="routing"),
    Rule("show ip bgp neighbors <ipv4> advertised-routes", "Routes advertised to one BGP neighbour", category="routing"),
    Rule("show ip bgp neighbors <ipv4> received-routes", "Routes received from one BGP neighbour (needs soft-reconfiguration inbound)",
         category="routing", verified=False),
    Rule("show ip bgp neighbors <ipv4> routes", "Routes accepted from one BGP neighbour", category="routing", verified=False),

    # -- 3. Conntrack, NAT & Firewall Counters ------------------------------------------------------------------
    Rule("show conntrack table ipv4", f"The IPv4 connection tracking table (first {MAX_TABLE_LINES} lines)",
         category="conntrack_nat_fw", post="table"),
    Rule("show conntrack table ipv4 match <ipv4>", f"Conntrack entries matching one IPv4 address (first {MAX_TABLE_LINES} lines)",
         category="conntrack_nat_fw", send="show conntrack table ipv4", post="match"),
    Rule("show conntrack statistics", "Connection tracking statistics (entries, drops, insert failures)",
         category="conntrack_nat_fw", verified=False),
    Rule("show nat source rules", "Source NAT rules with their packet / byte match counters", category="conntrack_nat_fw"),
    Rule("show nat source statistics", "Source NAT rule hit statistics", category="conntrack_nat_fw", verified=False),
    Rule("show nat source translations", f"Active source NAT translations (first {MAX_TABLE_LINES} lines)",
         category="conntrack_nat_fw", post="table", verified=False),
    Rule("show nat source translations match <ipv4>", f"Active source NAT translations matching one IPv4 address (first {MAX_TABLE_LINES} lines)",
         category="conntrack_nat_fw", send="show nat source translations", post="match", verified=False),
    Rule("show firewall", "Firewall rule sets with packet / byte counters", category="conntrack_nat_fw", verified=False),
    Rule("show firewall summary", "Firewall summary", category="conntrack_nat_fw", verified=False),
    Rule("show firewall statistics", "Firewall rule counters", category="conntrack_nat_fw", verified=False),
    Rule("show firewall group", "Firewall address / network / port groups", category="conntrack_nat_fw", verified=False),
    Rule("show firewall ipv4 <chain> filter", "IPv4 forward / input / output filter chain (VyOS 1.5)",
         category="conntrack_nat_fw", verified=False),
    Rule("show firewall ipv4 <chain> filter rule <rule>", "One rule of that IPv4 filter chain",
         category="conntrack_nat_fw", verified=False),
    Rule("show firewall ipv4 name <name>", "One named IPv4 firewall rule set", category="conntrack_nat_fw", verified=False),
    Rule("show policy route", "Policy-based routing (PBR) rules and their counters", category="conntrack_nat_fw", verified=False),
    Rule("show policy route-map", "Route maps", category="conntrack_nat_fw", verified=False),
    Rule("show policy prefix-list", "Prefix lists", category="conntrack_nat_fw", verified=False),
    Rule("show policy access-list", "Access lists", category="conntrack_nat_fw", verified=False),

    # -- System & Sanitized Config ------------------------------------------------------------------------------
    Rule("show system uptime", "System uptime and load averages", category="system"),
    Rule("show version", "VyOS version and hardware model", category="system"),
    Rule("show log tail <tail1-100>", "The last N lines of the system log", category="system", verified=False, post="tail"),
    Rule("show configuration commands", "The running configuration as `set` lines (secret-looking lines withheld)",
         category="system", kind=KIND_CONFIG, post="config"),
    Rule("show configuration commands section <section>",
         "One section of the running configuration (" + ", ".join(CONFIG_SECTIONS) + ")",
         category="system", kind=KIND_CONFIG, send="show configuration commands", post="section"),

    # -- 4. Active Probes & Bounded Text Capture ----------------------------------------------------------------
    Rule("ping <unicast> count <count1-5>", "ICMP echo from the router (1-5 packets, unicast destination)",
         category="probes_capture", kind=KIND_PROBE),
    Rule("ping <unicast> count <count1-5> source-address <ipv4>", "ICMP echo from one of the router's own source addresses",
         category="probes_capture", kind=KIND_PROBE),
    Rule("traceroute <unicast>", "UDP traceroute from the router (numeric, 12 hops, 1 probe per hop, structured hop parser)",
         category="probes_capture", kind=KIND_PROBE),
    Rule("traceroute <unicast> source-address <ipv4>", "Traceroute from one of the router's own source addresses",
         category="probes_capture", kind=KIND_PROBE),
    Rule("capture <ifname> count <count1-50> <filter>",
         f"Bounded tcpdump text summary: up to {CAPTURE_MAX_PACKETS} packets or {CAPTURE_SECONDS}s, filter required "
         "(host <ipv4> | net <prefix> | port <n> | icmp | tcp | udp, joined by and / or, at most 6 terms); not eth0 or lo",
         category="probes_capture", kind=KIND_CAPTURE, verified=False),
)


@dataclass(frozen=True)
class Parsed:
    command: str               # normalised (single spaces)
    kind: str
    category: str
    send: str                  # what the router is given
    post: str                  # worker post-processing key
    timeout_s: int
    max_bytes: int
    arg: str = ""              # match address / config section / tail count / eth queue
    verified: bool = True


def allowed_forms(kinds=None) -> list[str]:
    return [r.text for r in RULES if kinds is None or r.kind in kinds]


def describe_rules(kinds=None) -> str:
    return "; ".join(f"`{r.text}`" for r in RULES if kinds is None or r.kind in kinds)


def rules_catalog() -> list[dict]:
    """Return structured rule definitions for UI quick presets and documentation."""
    return [
        {
            "syntax": r.text,
            "description": r.what,
            "category": r.category,
            "kind": r.kind,
            "verified": r.verified,
        }
        for r in RULES
    ]


def _match(rule_tokens: list[str], tokens: list[str]):
    """Typed match; returns the list of (placeholder, value) for the typed arguments, or None."""
    typed = []
    i = 0
    for r in rule_tokens:
        if r == "<filter>":
            f = _filter_terms(tokens[i:])
            if f is None:
                return None
            typed.append((r, " ".join(tokens[i:])))
            return typed
        if i >= len(tokens):
            return None
        t = tokens[i]
        if r.startswith("<"):
            if not _VALIDATORS[r](t):
                return None
            typed.append((r, t))
        elif t != r:
            return None
        i += 1
    return typed if i == len(tokens) else None


def _filter_terms(tokens: list[str]):
    """The filter tokens when they are exactly ``term (and|or term)*`` (<= CAPTURE_MAX_TERMS terms), else None."""
    terms, i = 0, 0
    if not tokens:
        return None
    while i < len(tokens):
        t = tokens[i]
        if t in ("icmp", "tcp", "udp"):
            i += 1
        elif t in ("host", "net", "port") and i + 1 < len(tokens):
            ok = {"host": _VALIDATORS["<ipv4>"], "net": _VALIDATORS["<prefix>"], "port": _int_in(1, 65535)}[t](tokens[i + 1])
            if not ok:
                return None
            i += 2
        else:
            return None
        terms += 1
        if terms > CAPTURE_MAX_TERMS:
            return None
        if i < len(tokens):
            if tokens[i] not in ("and", "or") or i + 1 >= len(tokens):
                return None
            i += 1
    return terms


def parse_command(command, *, kinds=None) -> Parsed:
    """The parsed command when it is exactly one allowed form (of ``kinds``, default all); VyosCliError otherwise."""
    if not isinstance(command, str):
        raise VyosCliError("bad_request", "command must be a string")
    if len(command) > MAX_COMMAND_CHARS:
        raise VyosCliError("bad_request", f"command is longer than {MAX_COMMAND_CHARS} characters")
    if not command.strip() or not _ALLOWED_CHARS.fullmatch(command):
        raise VyosCliError(
            "command_not_allowed",
            "The command has characters that are never sent to a router.",
            "Only letters, digits, spaces and . _ : / - are accepted: no pipes, quotes, separators or newlines. "
            "Allowed forms: " + describe_rules(kinds),
        )
    tokens = command.split()
    if len(tokens) > MAX_TOKENS or any(len(t) > MAX_TOKEN_CHARS for t in tokens):
        raise VyosCliError(
            "command_not_allowed",
            f"At most {MAX_TOKENS} words of {MAX_TOKEN_CHARS} characters.",
            "Allowed forms: " + describe_rules(kinds),
        )
    bad = [t for t in tokens if t.lower() in FORBIDDEN_TOKENS]
    if bad:
        raise VyosCliError(
            "command_not_allowed",
            f"{bad[0]!r} is not a read-only VyOS command word.",
            "Allowed forms: " + describe_rules(kinds),
        )
    for rule in RULES:
        typed = _match(rule.text.split(), tokens)
        if typed is None:
            continue
        if kinds is not None and rule.kind not in kinds:
            raise VyosCliError(
                "command_not_allowed",
                "This form is not available through this tool.",
                ("Use run_vyos_probe for ping / traceroute / capture." if rule.kind in ACTIVE_KINDS
                 else "Use run_vyos_cli_show for show commands.") + " Allowed forms here: " + describe_rules(kinds),
            )
        return _build(rule, tokens, typed)
    if tokens[0] == "capture":
        raise VyosCliError(
            "command_not_allowed",
            "That capture form is not allowed.",
            "Form: `capture <ifname> count <1-50> <filter>`; the filter is required, joined by and / or, "
            "terms `host <ipv4>`, `net <prefix>`, `port <n>`, `icmp`, `tcp`, `udp`, at most 6; "
            "not eth0 (management) or lo.",
        )
    raise VyosCliError(
        "command_not_allowed",
        "That form is not one of the allowed read-only VyOS commands.",
        "Allowed forms: " + describe_rules(kinds),
    )


def _build(rule: Rule, tokens: list[str], typed: list[tuple[str, str]]) -> Parsed:
    command = " ".join(tokens)
    vals: dict[str, str] = {}
    for name, value in typed:
        vals.setdefault(name, value)
    timeout, cap = COMMAND_TIMEOUT_S, MAX_OUTPUT_BYTES
    arg = ""
    if rule.kind == KIND_PROBE:
        dst = vals["<unicast>"]
        src = tokens[-1] if "source-address" in tokens else ""
        if tokens[0] == "ping":
            send = f"ping {dst} count {vals['<count1-5>']}" + (f" source-address {src}" if src else "")
            arg = dst
        else:
            send = f"/usr/bin/traceroute -n -q 1 -w 1 -m 12" + (f" -s {src}" if src else "") + f" {dst}"
            arg = dst
    elif rule.kind == KIND_CAPTURE:
        iface = vals["<ifname>"]
        if iface in ("eth0", "lo"):
            raise VyosCliError(
                "command_not_allowed",
                f"{iface} is not captured (eth0 is the management NIC, lo is local).",
                "Capture a data NIC (eth1 and up).",
            )
        send = (
            f"sudo timeout {CAPTURE_SECONDS} tcpdump -nn -l -s 96 -c {vals['<count1-50>']} -i {iface} "
            + vals["<filter>"]
        )
        cap = CAPTURE_MAX_OUTPUT_BYTES
        arg = iface
    else:
        send = rule.send or command
        if rule.post == "match":
            arg = vals["<ipv4>"]
        elif rule.post == "section":
            arg = vals["<section>"]
        elif rule.post == "tail":
            arg = vals["<tail1-100>"]
            send = command
        elif rule.post == "queue":
            arg = vals.get("<eth>", "")
    return Parsed(
        command=command,
        kind=rule.kind,
        category=rule.category,
        send=send,
        post=rule.post,
        timeout_s=timeout,
        max_bytes=cap,
        arg=arg,
        verified=rule.verified,
    )


def validate_command(command, *, kinds=None) -> str:
    """The normalised command (single spaces) when it is exactly one allowed form; VyosCliError otherwise."""
    return parse_command(command, kinds=kinds).command
