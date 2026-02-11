import { describe, it, expect } from 'vitest';
import { resolveClientKey } from '../../server/src/utils/resolve-client-key';
import { resolveClientIp } from '../../server/src/utils/resolve-client-ip';

function mockCtx(overrides: Record<string, any> = {}): any {
  return {
    state: overrides.state || {},
    request: {
      ip: overrides.ip || '127.0.0.1',
    },
    get: (header: string) => (overrides.headers || {})[header] || '',
  };
}

describe('resolveClientKey', () => {
  it('should return token:{id} for API token auth', () => {
    const ctx = mockCtx({
      state: {
        auth: {
          strategy: { name: 'api-token' },
          credentials: { id: 42 },
        },
      },
    });
    expect(resolveClientKey(ctx, false)).toBe('token:42');
  });

  it('should return user:{id} for Users & Permissions auth', () => {
    const ctx = mockCtx({
      state: {
        auth: {
          strategy: { name: 'users-permissions' },
          credentials: { id: 7 },
        },
        user: { id: 99 },
      },
    });
    expect(resolveClientKey(ctx, false)).toBe('user:99');
  });

  it('should return ip:{ip} for unauthenticated requests', () => {
    const ctx = mockCtx({ ip: '10.0.0.1' });
    expect(resolveClientKey(ctx, false)).toBe('ip:10.0.0.1');
  });

  it('should fall back to IP when auth strategy exists but no credentials', () => {
    const ctx = mockCtx({
      state: {
        auth: {
          strategy: { name: 'api-token' },
          // no credentials
        },
      },
      ip: '192.168.1.1',
    });
    expect(resolveClientKey(ctx, false)).toBe('ip:192.168.1.1');
  });

  it('should coerce token ID to string', () => {
    const ctx = mockCtx({
      state: {
        auth: {
          strategy: { name: 'api-token' },
          credentials: { id: 123 },
        },
      },
    });
    const key = resolveClientKey(ctx, false);
    expect(key).toBe('token:123');
    expect(typeof key.split(':')[1]).toBe('string');
  });

  it('should coerce user ID to string', () => {
    const ctx = mockCtx({
      state: {
        auth: {
          strategy: { name: 'users-permissions' },
          credentials: {},
        },
        user: { id: 456 },
      },
    });
    const key = resolveClientKey(ctx, false);
    expect(key).toBe('user:456');
  });
});

describe('resolveClientIp', () => {
  it('should use CF-Connecting-IP when cloudflare is true and header present', () => {
    const ctx = mockCtx({
      ip: '127.0.0.1',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(resolveClientIp(ctx, true)).toBe('1.2.3.4');
  });

  it('should ignore CF-Connecting-IP when cloudflare is false', () => {
    const ctx = mockCtx({
      ip: '127.0.0.1',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(resolveClientIp(ctx, false)).toBe('127.0.0.1');
  });

  it('should fall back to ctx.request.ip when CF-Connecting-IP is absent', () => {
    const ctx = mockCtx({ ip: '10.0.0.1' });
    expect(resolveClientIp(ctx, true)).toBe('10.0.0.1');
  });
});
