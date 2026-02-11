/**
 * Mask the IP portion of a client key for privacy in admin API responses.
 * - `ip:192.168.1.5` → `ip:192.168.1.***`
 * - `ip:2001:db8::1` → `ip:2001:db8::***`
 * - `token:42` and `user:99` are left unchanged (already abstract IDs).
 */
export function maskClientKey(clientKey: string): string {
  if (!clientKey.startsWith('ip:')) {
    return clientKey;
  }

  const ip = clientKey.slice(3);

  if (ip.includes(':')) {
    // IPv6: mask last segment
    const lastColon = ip.lastIndexOf(':');
    return `ip:${ip.slice(0, lastColon + 1)}***`;
  }

  // IPv4: mask last octet
  const lastDot = ip.lastIndexOf('.');
  if (lastDot === -1) {
    return `ip:***`;
  }
  return `ip:${ip.slice(0, lastDot + 1)}***`;
}
