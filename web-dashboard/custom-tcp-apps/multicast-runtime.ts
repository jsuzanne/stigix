/**
 * Stigix SD-WAN Overlay Multicast Validation Engine — Native UDP/IGMP Runtime
 *
 * Implements:
 * - 24-byte packed STGX wire header (!IQQHH in network byte order)
 * - MulticastSenderRuntime (CBR & Burst pacing, TTL, DSCP, Egress Interface binding)
 * - MulticastReceiverRuntime (IGMPv2/v3 ASM & SSM membership, Late-Join baseline,
 *   4096-packet sliding bitset for loss/duplicate/reordering, RFC 3550 jitter, max gap)
 * - Host & Kernel Pre-Flight Inspector (LAN interface auto-discovery, /proc/net/igmp, rp_filter)
 */

import dgram from 'dgram';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {
    CustomMulticastApplicationConfig,
    MulticastApplicationPreset,
    MulticastExpectationMode,
    MulticastHealthVerdict,
    MulticastNodePreflightResult,
    MulticastPayloadFormat,
    MulticastReceiverStats,
    MulticastSenderStats,
    MulticastThroughputSample
} from './types.js';

export const STGX_MULTICAST_MAGIC = 0x53544758; // "STGX"
export const STGX_HEADER_BYTES = 24;
const SLIDING_WINDOW_SIZE = 4096; // 4096 sequences tracked in 128 x uint32 bitset
const localJoinedReceivers = new Set<MulticastReceiverRuntime>();

export const MULTICAST_INDUSTRY_PRESETS: MulticastApplicationPreset[] = [
    {
        id: 'iptv-ceo-townhall',
        name: 'CEO Townhall HD IPTV',
        shortLabel: 'CEO Townhall IPTV',
        badge: 'RTP / MPEG-TS Video',
        description: 'Live corporate IPTV video broadcast using standard IANA RTP port 5004 and 1316B (7x188B MPEG-TS) framing.',
        appIdHint: 'Recognized as RTP / MPEG-2 Transport Stream (UDP 5004, AF41)',
        group: '239.1.1.100',
        port: 5004,
        mode: 'asm',
        rate: { mode: 'cbr', kbps: 1500, burstPackets: 20, burstIntervalMs: 100 },
        payloadBytes: 1316,
        payloadFormat: 'rtp-mpegts',
        ttl: 16,
        dscp: 'AF41',
        thresholds: { maxLossPct: 0.1, degradedLossPct: 2.0, maxJitterMs: 30, maxDuplicates: 15, maxGapMs: 3000 }
    },
    {
        id: 'market-data-itch',
        name: 'Financial Market Data Feed',
        shortLabel: 'Market Data ITCH',
        badge: 'Low-Latency Burst',
        description: 'High-frequency financial order book / market ticker micro-burst feed (NASDAQ ITCH / FIX Multicast style).',
        appIdHint: 'Low-latency micro-bursts in Real-Time EF queue (UDP 14001, EF)',
        group: '239.192.1.10',
        port: 14001,
        mode: 'asm',
        rate: { mode: 'burst', kbps: 500, burstPackets: 20, burstIntervalMs: 100 },
        payloadBytes: 256,
        payloadFormat: 'raw-stgx',
        ttl: 16,
        dscp: 'EF',
        thresholds: { maxLossPct: 0.05, degradedLossPct: 1.0, maxJitterMs: 15, maxDuplicates: 10, maxGapMs: 1500 }
    },
    {
        id: 'voip-emergency-paging',
        name: 'Emergency VoIP Audio Paging',
        shortLabel: 'VoIP Audio Paging',
        badge: 'RTP G.711 Voice',
        description: 'Enterprise / hospital / retail overhead PA voice paging stream (G.711 20ms voice packets at 50 pps).',
        appIdHint: 'Recognized as RTP Audio Stream (UDP 5004, 200B, EF)',
        group: '239.255.0.1',
        port: 5004,
        mode: 'asm',
        rate: { mode: 'cbr', kbps: 80, burstPackets: 10, burstIntervalMs: 100 },
        payloadBytes: 200,
        payloadFormat: 'rtp-g711',
        ttl: 16,
        dscp: 'EF',
        thresholds: { maxLossPct: 0.5, degradedLossPct: 2.0, maxJitterMs: 20, maxDuplicates: 10, maxGapMs: 2000 }
    },
    {
        id: 'cctv-surveillance',
        name: 'Branch CCTV Security Matrix',
        shortLabel: 'CCTV Camera Stream',
        badge: 'HD Video Stream',
        description: 'Continuous high-bitrate security camera multicast stream for hub or branch-side source (BSS) validation.',
        appIdHint: 'Recognized as RTP / MPEG-TS Video (UDP 5004, 1316B, CS4)',
        group: '239.192.20.1',
        port: 5004,
        mode: 'asm',
        rate: { mode: 'cbr', kbps: 2500, burstPackets: 30, burstIntervalMs: 100 },
        payloadBytes: 1316,
        payloadFormat: 'rtp-mpegts',
        ttl: 16,
        dscp: 'CS4',
        thresholds: { maxLossPct: 0.2, degradedLossPct: 2.5, maxJitterMs: 35, maxDuplicates: 15, maxGapMs: 3000 }
    },
    {
        id: 'sap-session-directory',
        name: 'SAP / SDP Session Directory',
        shortLabel: 'SAP Directory',
        badge: 'IANA SAP 9875',
        description: 'Standard RFC 2974 Session Announcement Protocol (SAP/SDP) directory multicast heartbeat.',
        appIdHint: 'Recognized as Standard SAP App-ID (UDP 9875, CS2)',
        group: '239.255.255.255',
        port: 9875,
        mode: 'asm',
        rate: { mode: 'cbr', kbps: 64, burstPackets: 5, burstIntervalMs: 200 },
        payloadBytes: 512,
        payloadFormat: 'raw-stgx',
        ttl: 16,
        dscp: 'CS2',
        thresholds: { maxLossPct: 0.5, degradedLossPct: 3.0, maxJitterMs: 50, maxDuplicates: 15, maxGapMs: 5000 }
    }
];

/**
 * Computes a deterministic 16-bit non-zero stream ID from an application ID string.
 */
export function computeStreamId(appId: string): number {
    let hash = 5381;
    for (let i = 0; i < appId.length; i++) {
        hash = ((hash << 5) + hash) ^ appId.charCodeAt(i);
    }
    const u16 = (hash >>> 0) & 0xffff;
    return u16 === 0 ? 1 : u16;
}

/**
 * Maps DSCP string names ('BE', 'EF', 'CS5', 'AF41', etc.) to IPv4 TOS byte (DSCP << 2).
 */
export function dscpToTosByte(dscp: string): number {
    const normalized = (dscp || 'BE').trim().toUpperCase();
    const map: Record<string, number> = {
        BE: 0,
        CS0: 0,
        CS1: 8,
        AF11: 10,
        AF12: 12,
        AF13: 14,
        CS2: 16,
        AF21: 18,
        AF22: 20,
        AF23: 22,
        CS3: 24,
        AF31: 26,
        AF32: 28,
        AF33: 30,
        CS4: 32,
        AF41: 34,
        AF42: 36,
        AF43: 38,
        CS5: 40,
        EF: 46,
        CS6: 48,
        CS7: 56
    };
    if (normalized in map) {
        return map[normalized] << 2;
    }
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 63) {
        return num << 2;
    }
    return 0;
}

export interface ResolvedMulticastInterface {
    interfaceName: string;
    address: string;
    netmask: string;
    family: string;
    isFallbackLoopback: boolean;
    allCandidates: { name: string; address: string; isPrivateLan: boolean }[];
}

/**
 * Auto-detects the host's primary LAN IPv4 interface facing the SD-WAN Edge,
 * avoiding Docker bridges, WireGuard/Tailscale tunnels, and virtual interfaces.
 */
export function resolveMulticastInterface(preferredIp?: string): ResolvedMulticastInterface {
    const nets = os.networkInterfaces();
    const allCandidates: { name: string; address: string; netmask: string; isPrivateLan: boolean; score: number }[] = [];

    const virtualPrefixRegex = /^(lo|docker|br-|veth|virbr|tailscale|wg|tun|tap|utun|zt|cni|flannel|calico)/i;
    const preferredNicRegex = /^(eth|ens|enp|eno|en|bond|wlan|vlan)/i;

    // Read Stigix primary configured traffic interface/IP if available
    let configuredIfaceOrIp = (process.env.STIGIX_IP || process.env.STIGIX_INTERFACE || '').trim();
    if (!configuredIfaceOrIp) {
        for (const cfgPath of ['/app/config/interfaces.txt', path.join(process.cwd(), 'config', 'interfaces.txt')]) {
            try {
                if (fs.existsSync(cfgPath)) {
                    const lines = fs.readFileSync(cfgPath, 'utf8')
                        .split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0 && !l.startsWith('#'));
                    if (lines.length > 0) {
                        configuredIfaceOrIp = lines[0].split(/\s+/)[0];
                        break;
                    }
                }
            } catch {
                // Ignore read errors
            }
        }
    }

    const isPrivateIpv4 = (ip: string): boolean => {
        if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
        if (ip.startsWith('172.')) {
            const second = parseInt(ip.split('.')[1] || '0', 10);
            return second >= 16 && second <= 31;
        }
        return false;
    };

    const getSubnetHeuristicBonus = (ip: string): number => {
        if (ip.startsWith('192.168.')) {
            const third = parseInt(ip.split('.')[2] || '0', 10);
            // Prisma SD-WAN Lab LAN subnets are typically 192.168.200.0/24 .. 192.168.254.0/24 (e.g., .201.x on DC1, .217.x on BR5)
            if (third >= 200 && third <= 254) return 120;
            // Common KVM / Proxmox / OOB management subnets (.122.x libvirt, .175.x OOB WAN/Mgmt)
            if (third === 122 || third === 175) return -60;
        }
        return 0;
    };

    for (const [name, addrs] of Object.entries(nets)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            const isV4 = addr.family === 'IPv4' || (addr.family as unknown as number) === 4;
            if (!isV4) continue;
            if (addr.internal) continue;

            const isVirtual = virtualPrefixRegex.test(name);
            const isPriv = isPrivateIpv4(addr.address);
            const isPreferredNic = preferredNicRegex.test(name);

            let score = 0;
            if (!isVirtual) score += 50;
            if (isPriv) score += 30;
            if (isPreferredNic) score += 20;
            score += getSubnetHeuristicBonus(addr.address);

            if (configuredIfaceOrIp && (name === configuredIfaceOrIp || addr.address === configuredIfaceOrIp)) {
                score += 250;
            }

            allCandidates.push({
                name,
                address: addr.address,
                netmask: addr.netmask || '255.255.255.0',
                isPrivateLan: isPriv && !isVirtual,
                score
            });
        }
    }

    allCandidates.sort((a, b) => b.score - a.score);

    if (preferredIp && preferredIp.trim() && preferredIp.trim().toLowerCase() !== 'auto') {
        const target = preferredIp.trim();
        const matched = allCandidates.find(
            c => c.address === target || c.name === target || c.address.startsWith(target)
        );
        if (matched) {
            return {
                interfaceName: matched.name,
                address: matched.address,
                netmask: matched.netmask,
                family: 'IPv4',
                isFallbackLoopback: false,
                allCandidates: allCandidates.map(c => ({ name: c.name, address: c.address, isPrivateLan: c.isPrivateLan }))
            };
        }
        // Explicit IP provided that isn't in standard non-internal list
        return {
            interfaceName: 'custom',
            address: target,
            netmask: '255.255.255.0',
            family: 'IPv4',
            isFallbackLoopback: target === '127.0.0.1',
            allCandidates: allCandidates.map(c => ({ name: c.name, address: c.address, isPrivateLan: c.isPrivateLan }))
        };
    }

    if (allCandidates.length > 0) {
        const best = allCandidates[0];
        return {
            interfaceName: best.name,
            address: best.address,
            netmask: best.netmask,
            family: 'IPv4',
            isFallbackLoopback: false,
            allCandidates: allCandidates.map(c => ({ name: c.name, address: c.address, isPrivateLan: c.isPrivateLan }))
        };
    }

    return {
        interfaceName: 'lo',
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        isFallbackLoopback: true,
        allCandidates: []
    };
}

/**
 * Reads kernel IGMP version and rp_filter settings on Linux hosts.
 */
export function inspectKernelMulticastState(interfaceName: string): {
    igmpVersion: string;
    rpFilter: number | null;
    inHostNetwork: boolean;
} {
    let igmpVersion = 'v2/v3 (OS Default)';
    let rpFilter: number | null = null;

    try {
        const forceIgmpPath = `/proc/sys/net/ipv4/conf/${interfaceName}/force_igmp_version`;
        if (fs.existsSync(forceIgmpPath)) {
            const val = fs.readFileSync(forceIgmpPath, 'utf8').trim();
            if (val === '2') igmpVersion = 'v2 (forced)';
            else if (val === '3') igmpVersion = 'v3 (forced)';
            else igmpVersion = 'v3 (auto)';
        } else if (fs.existsSync('/proc/net/igmp')) {
            const igmpContent = fs.readFileSync('/proc/net/igmp', 'utf8');
            if (igmpContent.includes(interfaceName)) {
                igmpVersion = 'v3 (kernel active)';
            } else {
                igmpVersion = 'v3 (kernel ready)';
            }
        }
    } catch {}

    try {
        const ifaceRpPath = `/proc/sys/net/ipv4/conf/${interfaceName}/rp_filter`;
        const allRpPath = `/proc/sys/net/ipv4/conf/all/rp_filter`;
        const ifaceRp = fs.existsSync(ifaceRpPath) ? parseInt(fs.readFileSync(ifaceRpPath, 'utf8').trim(), 10) : null;
        const allRp = fs.existsSync(allRpPath) ? parseInt(fs.readFileSync(allRpPath, 'utf8').trim(), 10) : null;
        if (ifaceRp !== null && allRp !== null) {
            rpFilter = Math.max(ifaceRp, allRp); // Linux uses max(conf/all/rp_filter, conf/<iface>/rp_filter)
        } else if (ifaceRp !== null) {
            rpFilter = ifaceRp;
        }
    } catch {}

    // Heuristic to detect Docker bridge mode (only eth0 on 172.17/18/19.x.x and no other physical NIC)
    const nets = os.networkInterfaces();
    const ifaceNames = Object.keys(nets);
    const hasOnlyDockerEth0 = ifaceNames.length <= 2 && ifaceNames.includes('eth0') &&
        (nets['eth0']?.some(a => a.address.startsWith('172.17.') || a.address.startsWith('172.18.')) ?? false);

    return {
        igmpVersion,
        rpFilter,
        inHostNetwork: !hasOnlyDockerEth0
    };
}

/**
 * Executes a non-destructive local pre-flight check for multicast readiness.
 */
export async function inspectLocalMulticastPreflight(
    nodeName: string,
    role: 'sender' | 'receiver',
    config: Partial<CustomMulticastApplicationConfig>,
    preferredInterfaceIp?: string
): Promise<MulticastNodePreflightResult> {
    const resolved = resolveMulticastInterface(preferredInterfaceIp);
    const kernel = inspectKernelMulticastState(resolved.interfaceName);
    const checks: MulticastNodePreflightResult['checks'] = [];
    const hints: string[] = [];

    // 1. Network mode & LAN interface check
    if (!kernel.inHostNetwork) {
        checks.push({
            name: 'Container Network Mode',
            status: 'fail',
            detail: `Detected Docker bridge IP (${resolved.address}). Multicast requires network_mode: host.`
        });
        hints.push('Ensure docker-compose.yml sets network_mode: host so IGMP joins and multicast frames reach the physical SD-WAN LAN.');
    } else if (resolved.isFallbackLoopback) {
        checks.push({
            name: 'LAN Interface Discovery',
            status: 'warn',
            detail: 'No non-loopback IPv4 interface detected; falling back to 127.0.0.1.'
        });
    } else {
        checks.push({
            name: 'LAN Interface Discovery',
            status: 'pass',
            detail: `Bound to ${resolved.interfaceName} (${resolved.address})`
        });
    }

    // 2. IGMP & Addressing Mode check
    const mode = config.mode || 'asm';
    if (mode === 'ssm' && kernel.igmpVersion.startsWith('v2')) {
        checks.push({
            name: 'IGMP Version (SSM)',
            status: 'fail',
            detail: `SSM (232/8) requires IGMPv3, but ${resolved.interfaceName} is forced to ${kernel.igmpVersion}.`
        });
        hints.push(`Run 'sysctl -w net.ipv4.conf.${resolved.interfaceName}.force_igmp_version=0' on ${nodeName} to enable IGMPv3.`);
    } else {
        checks.push({
            name: 'IGMP Stack',
            status: 'pass',
            detail: `Effective version: ${kernel.igmpVersion} (${mode.toUpperCase()})`
        });
    }

    // 3. Reverse Path Filtering (rp_filter) check on Receiver
    if (role === 'receiver' && kernel.rpFilter === 1) {
        checks.push({
            name: 'Reverse Path Filter (rp_filter)',
            status: 'warn',
            detail: `Strict rp_filter=1 active on ${resolved.interfaceName}. Kernel may drop multicast if source subnet route is asymmetric.`
        });
        hints.push(
            `If IGMP join succeeds but 0 packets arrive from remote sender, set loose RPF: 'sysctl -w net.ipv4.conf.all.rp_filter=2 net.ipv4.conf.${resolved.interfaceName}.rp_filter=2'`
        );
    } else if (kernel.rpFilter !== null) {
        checks.push({
            name: 'Reverse Path Filter (rp_filter)',
            status: 'pass',
            detail: `rp_filter=${kernel.rpFilter} (${kernel.rpFilter === 2 ? 'loose' : 'disabled'})`
        });
    }

    // 4. UDP Socket & Multicast Membership test
    const port = Number(config.port) || 5000;
    const group = (config.group || '239.255.1.100').trim();
    let portAvailable = true;
    let multicastCapable = true;

    await new Promise<void>(resolve => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock.once('error', (err: any) => {
            portAvailable = false;
            multicastCapable = false;
            checks.push({
                name: 'UDP Multicast Socket Test',
                status: 'fail',
                detail: `Socket bind failed on :${port}: ${err.message}`
            });
            try { sock.close(); } catch {}
            resolve();
        });

        sock.bind(port, () => {
            try {
                if (role === 'receiver') {
                    if (mode === 'ssm' && config.ssmSource) {
                        sock.addSourceSpecificMembership(config.ssmSource, group, resolved.address);
                        sock.dropSourceSpecificMembership(config.ssmSource, group, resolved.address);
                    } else {
                        sock.addMembership(group, resolved.address);
                        sock.dropMembership(group, resolved.address);
                    }
                    checks.push({
                        name: 'IGMP Group Membership Probe',
                        status: 'pass',
                        detail: `Successfully joined & left ${group}:${port} on ${resolved.address}`
                    });
                } else {
                    sock.setMulticastTTL(Number(config.ttl) || 64);
                    if (!resolved.isFallbackLoopback) {
                        sock.setMulticastInterface(resolved.address);
                    }
                    checks.push({
                        name: 'Multicast Egress Socket Probe',
                        status: 'pass',
                        detail: `IP_MULTICAST_IF=${resolved.address}, TTL=${config.ttl || 64} verified`
                    });
                }
            } catch (err: any) {
                multicastCapable = false;
                checks.push({
                    name: 'Multicast Socket Option Probe',
                    status: 'fail',
                    detail: `Kernel rejected multicast socket option: ${err.message}`
                });
            } finally {
                try { sock.close(); } catch {}
                resolve();
            }
        });
    });

    const hasFail = checks.some(c => c.status === 'fail');
    const hasWarn = checks.some(c => c.status === 'warn');

    return {
        node: nodeName,
        role,
        reachable: true,
        status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
        interfaceName: resolved.interfaceName,
        interfaceIp: resolved.address,
        multicastCapable,
        igmpVersion: kernel.igmpVersion,
        rpFilter: kernel.rpFilter,
        portAvailable,
        checks,
        hints
    };
}

// ─── Multicast Sender Runtime ─────────────────────────────────────────────────

export class MulticastSenderRuntime {
    private config: CustomMulticastApplicationConfig;
    private nodeName: string;
    private socket: dgram.Socket | null = null;
    private pacingTimer: NodeJS.Timeout | null = null;
    private stopTimeout: NodeJS.Timeout | null = null;
    private active: boolean = false;
    private runId: number = 0;
    private streamId: number;
    private currentSeq: bigint = 0n;
    private packetsSent: number = 0;
    private bytesSent: number = 0;
    private windowPacketsSent: number = 0;
    private windowBytesSent: number = 0;
    private lastWindowCalcMs: number = Date.now();
    private txBitrateKbps: number = 0;
    private txPps: number = 0;
    private startedAt?: number;
    private lastError?: string;
    private interfaceName: string = 'auto';
    private interfaceIp: string = '0.0.0.0';

    constructor(config: CustomMulticastApplicationConfig, nodeName: string) {
        this.config = config;
        this.nodeName = nodeName;
        this.streamId = computeStreamId(config.id);
    }

    public static packHeader(
        buf: Buffer,
        sequenceId: bigint,
        timestampNs: bigint,
        streamId: number,
        runId: number
    ): void {
        buf.writeUInt32BE(STGX_MULTICAST_MAGIC, 0);
        buf.writeBigUInt64BE(sequenceId, 4);
        buf.writeBigUInt64BE(timestampNs, 12);
        buf.writeUInt16BE(streamId & 0xffff, 20);
        buf.writeUInt16BE(runId & 0xffff, 22);
    }

    public isRunning(): boolean {
        return this.active;
    }

    public updateConfig(config: CustomMulticastApplicationConfig, nodeName?: string): void {
        this.config = config;
        if (nodeName) this.nodeName = nodeName;
        this.streamId = computeStreamId(config.id);
    }

    public async start(allowLoopback: boolean = false): Promise<MulticastSenderStats> {
        if (this.active) {
            await this.stop();
        }

        const resolved = resolveMulticastInterface(this.config.senderInterfaceIp);
        this.interfaceName = resolved.interfaceName;
        this.interfaceIp = resolved.address;
        this.runId = (this.runId + 1) & 0xffff;
        if (this.runId === 0) this.runId = 1;

        this.currentSeq = 0n;
        this.packetsSent = 0;
        this.bytesSent = 0;
        this.windowPacketsSent = 0;
        this.windowBytesSent = 0;
        this.lastWindowCalcMs = Date.now();
        this.txBitrateKbps = 0;
        this.txPps = 0;
        this.lastError = undefined;

        const payloadFormat = this.config.payloadFormat || 'raw-stgx';
        const minPayloadBytes = payloadFormat === 'rtp-mpegts' ? 40 : payloadFormat === 'rtp-g711' ? 36 : STGX_HEADER_BYTES;
        const payloadBytes = Math.max(minPayloadBytes, Math.min(1400, Number(this.config.payloadBytes) || 1316));
        const ttl = Math.max(1, Math.min(255, Number(this.config.ttl) || 64));
        const group = this.config.group.trim();
        const port = Number(this.config.port) || 5000;

        // Determine STGX header offset based on L7 framing
        const stgxOffset = payloadFormat === 'rtp-mpegts' ? 16 : payloadFormat === 'rtp-g711' ? 12 : 0;
        const ssrc = ((this.streamId & 0xffff) << 16) | (this.runId & 0xffff);

        // Pre-allocate packet buffer with optional L7 RTP/MPEG-TS framing + 24-byte STGX header
        const packetBuf = Buffer.alloc(payloadBytes);
        for (let i = 0; i < payloadBytes; i++) {
            packetBuf[i] = 0x41 + (i % 26); // 'A'..'Z' deterministic fill
        }

        if (payloadFormat === 'rtp-mpegts') {
            // 12-byte RFC 3550 RTP v2 header (PT = 33 MP2T)
            packetBuf[0] = 0x80; // V=2, P=0, X=0, CC=0
            packetBuf[1] = 0x21; // M=0, PT=33 (MPEG-2 TS)
            packetBuf.writeUInt32BE(ssrc >>> 0, 8);
            // Write 0x47 MPEG-TS sync headers at every 188-byte boundary starting at offset 12
            for (let tsOff = 12; tsOff + 4 <= payloadBytes; tsOff += 188) {
                packetBuf[tsOff] = 0x47;     // Sync byte
                packetBuf[tsOff + 1] = 0x01; // PID 0x0100
                packetBuf[tsOff + 2] = 0x00;
                packetBuf[tsOff + 3] = 0x10; // Payload only
            }
        } else if (payloadFormat === 'rtp-g711') {
            // 12-byte RFC 3550 RTP v2 header (PT = 0 PCMU)
            packetBuf[0] = 0x80; // V=2
            packetBuf[1] = 0x00; // PT=0 (G.711 PCMU)
            packetBuf.writeUInt32BE(ssrc >>> 0, 8);
        }

        packetBuf.writeUInt32BE(STGX_MULTICAST_MAGIC, stgxOffset);
        packetBuf.writeUInt16BE(this.streamId, stgxOffset + 20);
        packetBuf.writeUInt16BE(this.runId, stgxOffset + 22);

        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.socket = sock;

        sock.on('error', (err) => {
            this.lastError = err.message;
        });

        await new Promise<void>((resolve, reject) => {
            sock.once('error', reject);
            sock.bind(0, () => {
                sock.removeListener('error', reject);
                try {
                    sock.setMulticastTTL(ttl);
                    // Enable loopback only if a receiver is co-located on the same node or on loopback fallback
                    sock.setMulticastLoopback(allowLoopback || resolved.isFallbackLoopback);
                    sock.setMulticastInterface(resolved.address);
                } catch (err: any) {
                    this.lastError = err.message;
                }
                resolve();
            });
        });

        this.active = true;
        this.startedAt = Date.now();

        const rateMode = this.config.rate?.mode || 'cbr';
        const targetKbps = Math.max(16, Math.min(50000, Number(this.config.rate?.kbps) || 1000));
        const bitsPerPacket = payloadBytes * 8;
        const targetPacketsPerSec = (targetKbps * 1000) / bitsPerPacket;

        const sendOneDatagram = () => {
            if (!this.active || !this.socket) return;
            const seq = this.currentSeq++;
            const wallNs = BigInt(Date.now()) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n);
            if (payloadFormat === 'rtp-mpegts' || payloadFormat === 'rtp-g711') {
                const rtpSeq = Number(seq & 0xffffn);
                const clockRate = payloadFormat === 'rtp-mpegts' ? 90000n : 8000n;
                const rtpTs = Number(((wallNs / 1_000_000n) * clockRate / 1000n) & 0xffffffffn) >>> 0;
                packetBuf.writeUInt16BE(rtpSeq, 2);
                packetBuf.writeUInt32BE(rtpTs, 4);
            }
            packetBuf.writeBigUInt64BE(seq, stgxOffset + 4);
            packetBuf.writeBigUInt64BE(wallNs, stgxOffset + 12);
            const frameCopy = resolved.address === '127.0.0.1' ? Buffer.from(packetBuf) : null;

            this.socket.send(packetBuf, 0, payloadBytes, port, group, (err: any) => {
                if (err) {
                    if (
                        resolved.address === '127.0.0.1' &&
                        frameCopy &&
                        (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH')
                    ) {
                        this.lastError = undefined;
                        for (const rcv of localJoinedReceivers) {
                            rcv.deliverLoopbackFrame(group, port, frameCopy);
                        }
                    } else {
                        this.lastError = err.message;
                    }
                }
            });

            this.packetsSent++;
            this.bytesSent += payloadBytes;
            this.windowPacketsSent++;
            this.windowBytesSent += payloadBytes;
        };

        if (rateMode === 'burst') {
            const burstPackets = Math.max(1, Math.min(500, Number(this.config.rate?.burstPackets) || 25));
            const burstIntervalMs = Math.max(20, Math.min(10000, Number(this.config.rate?.burstIntervalMs) || 100));
            this.pacingTimer = setInterval(() => {
                for (let i = 0; i < burstPackets; i++) {
                    sendOneDatagram();
                }
                this.updateRollingThroughput();
            }, burstIntervalMs);
        } else {
            // High-resolution token-bucket CBR pacing (tick every 10ms)
            let lastTickNs = process.hrtime.bigint();
            let tokenAccumulator = 1.0; // Send 1st packet immediately on start

            this.pacingTimer = setInterval(() => {
                if (!this.active) return;
                const nowNs = process.hrtime.bigint();
                const elapsedSec = Number(nowNs - lastTickNs) / 1e9;
                lastTickNs = nowNs;

                tokenAccumulator += elapsedSec * targetPacketsPerSec;
                // Cap burst catch-up to prevent event-loop starvation
                if (tokenAccumulator > 250) {
                    tokenAccumulator = 250;
                }

                const toSend = Math.floor(tokenAccumulator);
                if (toSend > 0) {
                    tokenAccumulator -= toSend;
                    for (let i = 0; i < toSend; i++) {
                        sendOneDatagram();
                    }
                }
                this.updateRollingThroughput();
            }, 10);
        }

        if (this.config.durationSec && this.config.durationSec > 0) {
            this.stopTimeout = setTimeout(() => {
                this.stop().catch(() => {});
            }, this.config.durationSec * 1000);
        }

        return this.getStats();
    }

    private updateRollingThroughput(): void {
        const now = Date.now();
        const elapsedMs = now - this.lastWindowCalcMs;
        if (elapsedMs >= 1000) {
            this.txBitrateKbps = Math.round(((this.windowBytesSent * 8) / (elapsedMs / 1000)) / 1000 * 100) / 100;
            this.txPps = Math.round((this.windowPacketsSent / (elapsedMs / 1000)) * 10) / 10;
            this.windowBytesSent = 0;
            this.windowPacketsSent = 0;
            this.lastWindowCalcMs = now;
        }
    }

    public async stop(): Promise<MulticastSenderStats> {
        this.active = false;
        if (this.pacingTimer) {
            clearInterval(this.pacingTimer);
            this.pacingTimer = null;
        }
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        if (this.socket) {
            const s = this.socket;
            this.socket = null;
            await new Promise<void>(resolve => {
                try {
                    s.close(() => resolve());
                } catch {
                    resolve();
                }
            });
        }
        this.txBitrateKbps = 0;
        this.txPps = 0;
        return this.getStats();
    }

    public getStats(): MulticastSenderStats {
        this.updateRollingThroughput();
        const uptimeSec = this.active && this.startedAt
            ? Math.max(0, Math.round((Date.now() - this.startedAt) / 1000))
            : 0;
        return {
            appId: this.config.id,
            node: this.nodeName,
            active: this.active,
            group: this.config.group,
            port: this.config.port,
            interfaceName: this.interfaceName,
            interfaceIp: this.interfaceIp,
            runId: this.runId,
            streamId: this.streamId,
            currentSeq: Number(this.currentSeq),
            packetsSent: this.packetsSent,
            bytesSent: this.bytesSent,
            txBitrateKbps: this.active ? this.txBitrateKbps : 0,
            txPps: this.active ? this.txPps : 0,
            targetKbps: this.config.rate?.kbps || 1000,
            payloadBytes: this.config.payloadBytes || 1316,
            ttl: this.config.ttl || 64,
            dscp: this.config.dscp || 'CS5',
            startedAt: this.startedAt,
            uptimeSec,
            lastError: this.lastError
        };
    }
}

// ─── Multicast Receiver Runtime ───────────────────────────────────────────────

export class MulticastReceiverRuntime {
    private config: CustomMulticastApplicationConfig;
    private nodeName: string;
    private expectMode: MulticastExpectationMode = 'traffic';
    private preferredInterfaceIp?: string;
    private socket: dgram.Socket | null = null;
    private sampleTimer: NodeJS.Timeout | null = null;
    private joined: boolean = false;
    private streamId: number;
    private interfaceName: string = 'auto';
    private interfaceIp: string = '0.0.0.0';
    private igmpVersion: string = 'v3';

    // Per-run sequence & telemetry counters
    private runId: number = 0;
    private firstSeq: bigint | null = null;
    private highestSeq: bigint | null = null;
    private seqBitset: Uint32Array = new Uint32Array(SLIDING_WINDOW_SIZE / 32);
    private packetsReceived: number = 0;
    private packetsLost: number = 0;
    private duplicatePackets: number = 0;
    private reorderedPackets: number = 0;
    private foreignPackets: number = 0;
    private bytesReceived: number = 0;

    // Timing & Jitter (RFC 3550)
    private joinedAt?: number;
    private joinedMonoNs?: bigint;
    private firstPacketAt?: number;
    private lastPacketAt?: number;
    private lastPacketMonoNs?: bigint;
    private lastSenderTimestampNs?: bigint;
    private jitterMs: number = 0;
    private maxGapMs: number = 0;
    private joinLatencyMs: number | null = null;

    // 1-second rolling throughput window
    private windowBytesRx: number = 0;
    private windowPacketsRx: number = 0;
    private lastWindowCalcMs: number = Date.now();
    private rxBitrateKbps: number = 0;
    private rxPps: number = 0;
    private history: MulticastThroughputSample[] = [];
    private lastError?: string;

    constructor(
        config: CustomMulticastApplicationConfig,
        nodeName: string,
        expectMode: MulticastExpectationMode = 'traffic',
        preferredInterfaceIp?: string
    ) {
        this.config = config;
        this.nodeName = nodeName;
        this.expectMode = expectMode;
        this.preferredInterfaceIp = preferredInterfaceIp;
        this.streamId = computeStreamId(config.id);
    }

    public static unpackHeader(buf: Buffer): {
        sequenceId: bigint;
        timestampNs: bigint;
        streamId: number;
        runId: number;
    } | null {
        if (!buf || buf.length < STGX_HEADER_BYTES) return null;
        const candidateOffsets = [0, 16, 12];
        for (const offset of candidateOffsets) {
            if (buf.length >= offset + STGX_HEADER_BYTES && buf.readUInt32BE(offset) === STGX_MULTICAST_MAGIC) {
                return {
                    sequenceId: buf.readBigUInt64BE(offset + 4),
                    timestampNs: buf.readBigUInt64BE(offset + 12),
                    streamId: buf.readUInt16BE(offset + 20),
                    runId: buf.readUInt16BE(offset + 22)
                };
            }
        }
        return null;
    }

    public isJoined(): boolean {
        return this.joined;
    }

    public updateConfig(
        config: CustomMulticastApplicationConfig,
        nodeName?: string,
        expectMode?: MulticastExpectationMode,
        preferredInterfaceIp?: string
    ): void {
        this.config = config;
        if (nodeName) this.nodeName = nodeName;
        if (expectMode) this.expectMode = expectMode;
        if (preferredInterfaceIp !== undefined) this.preferredInterfaceIp = preferredInterfaceIp;
        this.streamId = computeStreamId(config.id);
    }

    private resetRunCounters(newRunId: number): void {
        this.runId = newRunId;
        this.firstSeq = null;
        this.highestSeq = null;
        this.seqBitset.fill(0);
        this.packetsReceived = 0;
        this.packetsLost = 0;
        this.duplicatePackets = 0;
        this.reorderedPackets = 0;
        this.bytesReceived = 0;
        this.firstPacketAt = undefined;
        this.lastPacketAt = undefined;
        this.lastPacketMonoNs = undefined;
        this.lastSenderTimestampNs = undefined;
        this.jitterMs = 0;
        this.maxGapMs = 0;
    }

    /**
     * Live counter reset without leaving the IGMP group or closing the socket.
     * Clears transient PIM SPT switchover spikes or initial convergence loss.
     */
    public resetCounters(): MulticastReceiverStats {
        this.resetRunCounters(this.runId);
        this.foreignPackets = 0;
        this.history = [];
        return this.getStats();
    }

    /**
     * Marks a sequence offset (0 = highestSeq, 1 = highestSeq - 1, ...) in the 4096-bit window.
     */
    private isBitSet(offset: number): boolean {
        if (offset < 0 || offset >= SLIDING_WINDOW_SIZE) return false;
        const wordIdx = offset >>> 5;
        const bitMask = 1 << (offset & 31);
        return (this.seqBitset[wordIdx] & bitMask) !== 0;
    }

    private setBit(offset: number): void {
        if (offset < 0 || offset >= SLIDING_WINDOW_SIZE) return;
        const wordIdx = offset >>> 5;
        const bitMask = 1 << (offset & 31);
        this.seqBitset[wordIdx] |= bitMask;
    }

    private shiftBitset(shift: number): void {
        if (shift <= 0) return;
        if (shift >= SLIDING_WINDOW_SIZE) {
            this.seqBitset.fill(0);
            return;
        }
        const wordShift = shift >>> 5;
        const bitShift = shift & 31;
        const numWords = this.seqBitset.length;

        if (wordShift > 0) {
            for (let i = numWords - 1; i >= wordShift; i--) {
                this.seqBitset[i] = this.seqBitset[i - wordShift];
            }
            for (let i = 0; i < wordShift; i++) {
                this.seqBitset[i] = 0;
            }
        }
        if (bitShift > 0) {
            for (let i = numWords - 1; i > 0; i--) {
                this.seqBitset[i] = (this.seqBitset[i] << bitShift) | (this.seqBitset[i - 1] >>> (32 - bitShift));
            }
            this.seqBitset[0] = this.seqBitset[0] << bitShift;
        }
    }

    public async join(): Promise<MulticastReceiverStats> {
        if (this.joined) {
            await this.leave();
        }

        const resolved = resolveMulticastInterface(this.preferredInterfaceIp);
        const kernel = inspectKernelMulticastState(resolved.interfaceName);
        this.interfaceName = resolved.interfaceName;
        this.interfaceIp = resolved.address;
        this.igmpVersion = kernel.igmpVersion;
        this.lastError = undefined;
        this.resetRunCounters(0);
        this.foreignPackets = 0;
        this.joinLatencyMs = null;
        this.history = [];

        const port = Number(this.config.port) || 5000;
        const group = this.config.group.trim();
        const mode = this.config.mode || 'asm';

        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.socket = sock;

        sock.on('error', (err) => {
            this.lastError = err.message;
        });

        sock.on('message', (msg: Buffer) => {
            this.handleIncomingPacket(msg);
        });

        await new Promise<void>((resolve, reject) => {
            sock.once('error', reject);
            sock.bind(port, () => {
                sock.removeListener('error', reject);
                try {
                    if (mode === 'ssm' && this.config.ssmSource) {
                        sock.addSourceSpecificMembership(this.config.ssmSource.trim(), group, resolved.address);
                    } else {
                        sock.addMembership(group, resolved.address);
                    }
                    this.joined = true;
                    this.joinedAt = Date.now();
                    this.joinedMonoNs = process.hrtime.bigint();
                } catch (err: any) {
                    if (resolved.address === '127.0.0.1') {
                        // In restricted OS sandboxes without multicast routing on lo0, allow local UDP loopback reception
                        this.joined = true;
                        this.joinedAt = Date.now();
                        this.joinedMonoNs = process.hrtime.bigint();
                    } else {
                        this.lastError = `IGMP Join failed on ${resolved.address}: ${err.message}`;
                    }
                }
                resolve();
            });
        });

        this.lastWindowCalcMs = Date.now();
        if (this.joined) {
            localJoinedReceivers.add(this);
        }
        this.sampleTimer = setInterval(() => {
            this.sampleThroughputTick();
        }, 1000);

        return this.getStats();
    }

    public deliverLoopbackFrame(group: string, port: number, msg: Buffer): void {
        if (!this.joined) return;
        const myPort = Number(this.config.port) || 5000;
        const myGroup = this.config.group.trim();
        if (myPort === port && myGroup === group) {
            this.handleIncomingPacket(msg);
        }
    }

    private handleIncomingPacket(msg: Buffer): void {
        const parsed = MulticastReceiverRuntime.unpackHeader(msg);
        if (!parsed) {
            this.foreignPackets++;
            return;
        }

        if (parsed.streamId !== this.streamId) {
            // Valid STGX multicast packet belonging to another application profile on the same port
            return;
        }

        const nowMs = Date.now();
        const nowMonoNs = process.hrtime.bigint();
        const seq = parsed.sequenceId;
        const senderTsNs = parsed.timestampNs;
        const packetRunId = parsed.runId;

        // Detect sender restart (run_id change) -> cleanly reset counters so we don't report false loss
        if (this.runId !== 0 && packetRunId !== this.runId) {
            this.resetRunCounters(packetRunId);
        } else if (this.runId === 0) {
            this.runId = packetRunId;
        }

        // First packet received in this run (Late-Join safe baseline: firstSeq = seq)
        if (this.firstSeq === null || this.highestSeq === null) {
            this.firstSeq = seq;
            this.highestSeq = seq;
            this.setBit(0);
            this.packetsReceived = 1;
            this.bytesReceived = msg.length;
            this.windowPacketsRx += 1;
            this.windowBytesRx += msg.length;
            this.firstPacketAt = nowMs;
            this.lastPacketAt = nowMs;
            this.lastPacketMonoNs = nowMonoNs;
            this.lastSenderTimestampNs = senderTsNs;

            if (this.joinedMonoNs !== undefined) {
                const rawJoinMs = Number(nowMonoNs - this.joinedMonoNs) / 1e6;
                this.joinLatencyMs = Math.round(rawJoinMs * 10) / 10;
            }
            return;
        }

        // Inter-arrival gap calculation on receiver's monotonic clock
        if (this.lastPacketMonoNs !== undefined) {
            const gapMs = Number(nowMonoNs - this.lastPacketMonoNs) / 1e6;
            if (gapMs > this.maxGapMs) {
                this.maxGapMs = Math.round(gapMs * 10) / 10;
            }
        }

        // RFC 3550 inter-arrival jitter calculation (clock offset cancels out)
        if (this.lastPacketMonoNs !== undefined && this.lastSenderTimestampNs !== undefined) {
            const rxDeltaMs = Number(nowMonoNs - this.lastPacketMonoNs) / 1e6;
            const txDeltaMs = Number(senderTsNs - this.lastSenderTimestampNs) / 1e6;
            const transitDiffMs = Math.abs(rxDeltaMs - txDeltaMs);
            // Sanity bound against wall-clock jumps (> 10s)
            if (transitDiffMs < 10000) {
                this.jitterMs = this.jitterMs + (transitDiffMs - this.jitterMs) / 16.0;
            }
        }

        this.lastPacketAt = nowMs;
        this.lastPacketMonoNs = nowMonoNs;
        this.lastSenderTimestampNs = senderTsNs;
        this.bytesReceived += msg.length;
        this.windowBytesRx += msg.length;
        this.windowPacketsRx += 1;

        if (seq > this.highestSeq) {
            const delta = Number(seq - this.highestSeq);
            if (delta > 1) {
                this.packetsLost += (delta - 1);
            }
            this.shiftBitset(delta);
            this.setBit(0);
            this.highestSeq = seq;
            this.packetsReceived++;
        } else {
            const offset = Number(this.highestSeq - seq);
            if (offset < SLIDING_WINDOW_SIZE) {
                if (this.isBitSet(offset)) {
                    this.duplicatePackets++;
                } else {
                    // Out-of-order packet arrived late: mark seen, count reordered, and reconcile loss
                    this.setBit(offset);
                    this.reorderedPackets++;
                    this.packetsReceived++;
                    if (this.packetsLost > 0) {
                        this.packetsLost--;
                    }
                }
            } else {
                // Very old out-of-order packet beyond 4096 window
                this.reorderedPackets++;
                this.packetsReceived++;
            }
        }
    }

    private sampleThroughputTick(): void {
        const now = Date.now();
        const elapsedMs = Math.max(1, now - this.lastWindowCalcMs);
        this.rxBitrateKbps = Math.round(((this.windowBytesRx * 8) / (elapsedMs / 1000)) / 1000 * 100) / 100;
        this.rxPps = Math.round((this.windowPacketsRx / (elapsedMs / 1000)) * 10) / 10;
        this.windowBytesRx = 0;
        this.windowPacketsRx = 0;
        this.lastWindowCalcMs = now;

        const packetsExpected = this.getPacketsExpected();
        const lossPct = packetsExpected > 0
            ? Math.round((this.packetsLost / packetsExpected) * 10000) / 100
            : 0;

        this.history.push({
            ts: now,
            kbps: this.rxBitrateKbps,
            pps: this.rxPps,
            lossPct,
            maxGapMs: this.maxGapMs
        });
        if (this.history.length > 60) {
            this.history.shift();
        }
    }

    private getPacketsExpected(): number {
        if (this.firstSeq === null || this.highestSeq === null) return 0;
        return Number(this.highestSeq - this.firstSeq) + 1;
    }

    public async leave(): Promise<MulticastReceiverStats> {
        localJoinedReceivers.delete(this);
        if (this.sampleTimer) {
            clearInterval(this.sampleTimer);
            this.sampleTimer = null;
        }
        if (this.socket) {
            const s = this.socket;
            this.socket = null;
            const group = this.config.group.trim();
            try {
                if (this.config.mode === 'ssm' && this.config.ssmSource) {
                    s.dropSourceSpecificMembership(this.config.ssmSource.trim(), group, this.interfaceIp);
                } else {
                    s.dropMembership(group, this.interfaceIp);
                }
            } catch {}
            await new Promise<void>(resolve => {
                try {
                    s.close(() => resolve());
                } catch {
                    resolve();
                }
            });
        }
        this.joined = false;
        this.rxBitrateKbps = 0;
        this.rxPps = 0;
        return this.getStats();
    }

    public getStats(senderActiveHint?: boolean): MulticastReceiverStats {
        const now = Date.now();
        const packetsExpected = this.getPacketsExpected();
        const lossPct = packetsExpected > 0
            ? Math.round((this.packetsLost / packetsExpected) * 10000) / 100
            : 0;

        const currentSilenceMs = this.lastPacketAt
            ? Math.max(0, now - this.lastPacketAt)
            : (this.joinedAt ? Math.max(0, now - this.joinedAt) : 0);

        const maxLossThreshold = this.config.thresholds?.maxLossPct ?? 0.1;
        const degradedLossThreshold = this.config.thresholds?.degradedLossPct ?? 2.0;
        const maxJitterThreshold = this.config.thresholds?.maxJitterMs ?? 30;
        const maxDuplicatesThreshold = this.config.thresholds?.maxDuplicates ?? 0;
        const silenceFailMs = this.config.thresholds?.maxGapMs ?? 3000;
        const roundedJitterMs = Math.round(this.jitterMs * 100) / 100;

        let verdict: MulticastHealthVerdict = 'NO_TRAFFIC';
        let verdictReason = 'Waiting for multicast stream';

        if (this.expectMode === 'none') {
            // Leak test (EXPECT_NONE): 0 valid packets = HEALTHY (PASS), >= 1 valid packet = FAILED (LEAK)
            if (this.packetsReceived > 0) {
                verdict = 'FAILED';
                verdictReason = `LEAK DETECTED: Received ${this.packetsReceived} multicast packets on isolated segment`;
            } else if (this.joined) {
                verdict = 'HEALTHY';
                verdictReason = 'PASS (0 multicast packets leaked to receiver)';
            } else {
                verdict = 'NO_TRAFFIC';
                verdictReason = 'Receiver not joined';
            }
        } else {
            // Standard mode (EXPECT_TRAFFIC)
            if (this.packetsReceived === 0) {
                if (senderActiveHint && this.joined && currentSilenceMs > silenceFailMs) {
                    verdict = 'FAILED';
                    verdictReason = `No multicast packets received (${Math.round(currentSilenceMs / 1000)}s silence — check PIM/IGMP/RPF)`;
                } else {
                    verdict = 'NO_TRAFFIC';
                    verdictReason = this.joined ? 'Joined group, awaiting sender stream' : 'Not joined';
                }
            } else if (this.joined && senderActiveHint !== false && currentSilenceMs > silenceFailMs) {
                verdict = 'FAILED';
                verdictReason = `Stream interrupted for ${(currentSilenceMs / 1000).toFixed(1)}s`;
            } else if (lossPct > degradedLossThreshold) {
                verdict = 'FAILED';
                verdictReason = `Packet loss ${lossPct.toFixed(2)}% exceeds ${degradedLossThreshold}% threshold`;
            } else if (
                lossPct > maxLossThreshold ||
                this.duplicatePackets > maxDuplicatesThreshold ||
                roundedJitterMs > maxJitterThreshold
            ) {
                verdict = 'DEGRADED';
                const reasons: string[] = [];
                if (lossPct > maxLossThreshold) {
                    reasons.push(`Loss ${lossPct.toFixed(2)}% > ${maxLossThreshold}%`);
                }
                if (this.duplicatePackets > maxDuplicatesThreshold) {
                    reasons.push(`Duplicates ${this.duplicatePackets} > ${maxDuplicatesThreshold} (PIM SPT / HER)`);
                }
                if (roundedJitterMs > maxJitterThreshold) {
                    reasons.push(`Jitter ${roundedJitterMs.toFixed(1)}ms > ${maxJitterThreshold}ms`);
                }
                verdictReason = reasons.join(' · ');
            } else {
                verdict = 'HEALTHY';
                verdictReason = `Healthy replication (${lossPct.toFixed(2)}% loss, ${roundedJitterMs.toFixed(1)}ms jitter, ${this.duplicatePackets} dup)`;
            }
        }

        return {
            appId: this.config.id,
            node: this.nodeName,
            joined: this.joined,
            expect: this.expectMode,
            group: this.config.group,
            port: this.config.port,
            mode: this.config.mode || 'asm',
            ssmSource: this.config.ssmSource,
            interfaceName: this.interfaceName,
            interfaceIp: this.interfaceIp,
            igmpVersion: this.igmpVersion,
            runId: this.runId,
            firstSeq: this.firstSeq !== null ? Number(this.firstSeq) : null,
            highestSeq: this.highestSeq !== null ? Number(this.highestSeq) : null,
            packetsReceived: this.packetsReceived,
            packetsExpected,
            packetsLost: this.packetsLost,
            lossPct,
            duplicatePackets: this.duplicatePackets,
            reorderedPackets: this.reorderedPackets,
            foreignPackets: this.foreignPackets,
            bytesReceived: this.bytesReceived,
            rxBitrateKbps: this.joined ? this.rxBitrateKbps : 0,
            rxPps: this.joined ? this.rxPps : 0,
            jitterMs: roundedJitterMs,
            maxGapMs: this.maxGapMs,
            currentSilenceMs,
            joinLatencyMs: this.joinLatencyMs,
            joinedAt: this.joinedAt,
            firstPacketAt: this.firstPacketAt,
            lastPacketAt: this.lastPacketAt,
            verdict,
            verdictReason,
            lastError: this.lastError,
            history: this.history
        };
    }
}
