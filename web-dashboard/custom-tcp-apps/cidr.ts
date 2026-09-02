/**
 * Stigix Custom TCP Inter-Site Applications — CIDR Allowlist Matcher
 */

import ipaddr from 'ipaddr.js';

/**
 * Normalizes an IPv4 or IPv4-mapped IPv6 address (e.g. "::ffff:192.168.1.5" -> "192.168.1.5").
 */
export function normalizeIp(rawIp: string): string {
    if (!rawIp) return '';
    let ipStr = rawIp.trim();
    if (ipStr.startsWith('::ffff:')) {
        ipStr = ipStr.substring(7);
    }
    return ipStr;
}

/**
 * Validates whether a client IP belongs to any of the configured CIDRs or IPs.
 * If allowCidrs is empty, returns true (open access with warning).
 */
export function isIpInCidrs(clientIp: string, allowCidrs: string[]): boolean {
    if (!allowCidrs || allowCidrs.length === 0) {
        return true; // No allowlist restriction configured
    }

    const cleanIp = normalizeIp(clientIp);
    let parsedClientIp: ipaddr.IPv4 | ipaddr.IPv6;

    try {
        parsedClientIp = ipaddr.parse(cleanIp);
        if (parsedClientIp.kind() === 'ipv6' && (parsedClientIp as ipaddr.IPv6).isIPv4MappedAddress()) {
            parsedClientIp = (parsedClientIp as ipaddr.IPv6).toIPv4Address();
        }
    } catch {
        return false;
    }

    for (const rawCidr of allowCidrs) {
        const cidrStr = rawCidr.trim();
        if (!cidrStr) continue;

        try {
            if (cidrStr.includes('/')) {
                const parsedCidr = ipaddr.parseCIDR(cidrStr);
                if (parsedClientIp.match(parsedCidr)) {
                    return true;
                }
            } else {
                const singleIp = ipaddr.parse(normalizeIp(cidrStr));
                if (parsedClientIp.toString() === singleIp.toString()) {
                    return true;
                }
            }
        } catch {
            // Ignore malformed CIDR entry in list and continue testing others
        }
    }

    return false;
}
