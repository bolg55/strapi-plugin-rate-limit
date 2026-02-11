import * as ipaddr from 'ipaddr.js';

/**
 * Check if a client IP matches any entry in an allowlist.
 * Entries can be exact IPs or CIDR notation (e.g. '192.168.1.0/24', '::1/128').
 */
export function isIpInAllowlist(clientIp: string, entries: string[]): boolean {
  if (entries.length === 0) return false;

  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(clientIp);
  } catch {
    return false;
  }

  for (const entry of entries) {
    // Try CIDR match first
    if (entry.includes('/')) {
      try {
        const cidr = ipaddr.parseCIDR(entry);
        if (parsed.match(cidr)) return true;
      } catch {
        // Invalid CIDR — skip
      }
    } else {
      // Exact match (normalize both sides)
      try {
        const entryParsed = ipaddr.process(entry);
        if (parsed.toString() === entryParsed.toString()) return true;
      } catch {
        // Invalid IP entry — skip
      }
    }
  }

  return false;
}

/**
 * Validate that a string is a valid IP address or CIDR notation.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateIpOrCidr(value: string): string | null {
  if (value.includes('/')) {
    try {
      ipaddr.parseCIDR(value);
      return null;
    } catch {
      return `Invalid CIDR notation: '${value}'`;
    }
  }

  try {
    ipaddr.process(value);
    return null;
  } catch {
    return `Invalid IP address: '${value}'`;
  }
}
