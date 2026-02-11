import { describe, it, expect } from 'vitest';
import { isIpInAllowlist, validateIpOrCidr } from '../../server/src/utils/ip-match';

describe('isIpInAllowlist', () => {
  it('should return false for empty allowlist', () => {
    expect(isIpInAllowlist('192.168.1.1', [])).toBe(false);
  });

  it('should match exact IPv4 address', () => {
    expect(isIpInAllowlist('192.168.1.1', ['192.168.1.1'])).toBe(true);
  });

  it('should not match different exact IPv4 address', () => {
    expect(isIpInAllowlist('192.168.1.2', ['192.168.1.1'])).toBe(false);
  });

  it('should match IPv4 within CIDR range', () => {
    expect(isIpInAllowlist('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
  });

  it('should not match IPv4 outside CIDR range', () => {
    expect(isIpInAllowlist('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  it('should match with /16 CIDR', () => {
    expect(isIpInAllowlist('10.0.5.100', ['10.0.0.0/16'])).toBe(true);
  });

  it('should not match outside /16 CIDR', () => {
    expect(isIpInAllowlist('10.1.0.1', ['10.0.0.0/16'])).toBe(false);
  });

  it('should match exact IPv6 address', () => {
    expect(isIpInAllowlist('::1', ['::1'])).toBe(true);
  });

  it('should match IPv6 within CIDR range', () => {
    expect(isIpInAllowlist('2001:db8::1', ['2001:db8::/32'])).toBe(true);
  });

  it('should not match IPv6 outside CIDR range', () => {
    expect(isIpInAllowlist('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });

  it('should handle mixed list of exact IPs and CIDRs', () => {
    const list = ['10.0.0.1', '192.168.0.0/16', '::1'];
    expect(isIpInAllowlist('10.0.0.1', list)).toBe(true);
    expect(isIpInAllowlist('192.168.5.5', list)).toBe(true);
    expect(isIpInAllowlist('::1', list)).toBe(true);
    expect(isIpInAllowlist('172.16.0.1', list)).toBe(false);
  });

  it('should return false for invalid client IP', () => {
    expect(isIpInAllowlist('not-an-ip', ['192.168.1.0/24'])).toBe(false);
  });

  it('should skip invalid entries in allowlist gracefully', () => {
    expect(isIpInAllowlist('192.168.1.1', ['bad-entry', '192.168.1.1'])).toBe(true);
  });

  it('should skip invalid CIDR entries gracefully', () => {
    expect(isIpInAllowlist('192.168.1.1', ['192.168.1.0/99', '192.168.1.1'])).toBe(true);
  });
});

describe('validateIpOrCidr', () => {
  it('should return null for valid IPv4', () => {
    expect(validateIpOrCidr('192.168.1.1')).toBeNull();
  });

  it('should return null for valid IPv6', () => {
    expect(validateIpOrCidr('::1')).toBeNull();
    expect(validateIpOrCidr('2001:db8::1')).toBeNull();
  });

  it('should return null for valid IPv4 CIDR', () => {
    expect(validateIpOrCidr('192.168.1.0/24')).toBeNull();
  });

  it('should return null for valid IPv6 CIDR', () => {
    expect(validateIpOrCidr('2001:db8::/32')).toBeNull();
  });

  it('should return error for invalid IP', () => {
    expect(validateIpOrCidr('not-an-ip')).toContain('Invalid IP address');
  });

  it('should return error for invalid CIDR', () => {
    expect(validateIpOrCidr('192.168.1.0/99')).toContain('Invalid CIDR notation');
  });

  it('should return error for garbage CIDR', () => {
    expect(validateIpOrCidr('abc/def')).toContain('Invalid CIDR notation');
  });
});
