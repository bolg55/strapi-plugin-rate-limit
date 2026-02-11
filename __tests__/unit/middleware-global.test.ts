import { describe, it, expect, vi, beforeEach } from 'vitest';
import createGlobalRateLimit from '../../server/src/middlewares/global-rate-limit';

function mockCtx(overrides: Record<string, any> = {}): any {
  const headers: Record<string, string> = {};
  return {
    path: overrides.path || '/api/articles',
    status: 200,
    body: undefined,
    state: overrides.state || {},
    request: { ip: overrides.ip || '127.0.0.1' },
    get: (h: string) => (overrides.headers || {})[h] || '',
    set: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    _headers: headers,
  };
}

function mockService(overrides: Record<string, any> = {}) {
  return {
    enabled: overrides.enabled ?? true,
    config: overrides.config || {
      cloudflare: false,
      allowlist: { ips: [], tokens: [], users: [] },
      defaults: { limit: 100, interval: '1m', blockDuration: 0 },
      rules: [],
      exclude: [],
    },
    isExcluded: overrides.isExcluded || vi.fn(() => false),
    resolve: overrides.resolve || vi.fn(() => ({ limiter: {}, limit: 100, intervalMs: 60000 })),
    consume:
      overrides.consume ||
      vi.fn(async () => ({
        allowed: true,
        res: { remainingPoints: 99, msBeforeNext: 60000, consumedPoints: 1 },
        limit: 100,
      })),
    shouldWarn: overrides.shouldWarn || vi.fn(() => false),
    isAllowlisted: vi.fn(() => false),
    recordEvent: overrides.recordEvent || vi.fn(),
  };
}

function mockStrapi(service: any): any {
  return {
    plugin: vi.fn(() => ({
      service: vi.fn(() => service),
    })),
    log: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
}

describe('Global Rate Limit Middleware', () => {
  let service: any;
  let strapi: any;
  let middleware: any;
  let next: any;

  beforeEach(() => {
    service = mockService();
    strapi = mockStrapi(service);
    middleware = createGlobalRateLimit(strapi);
    next = vi.fn();
  });

  it('should pass through non-API paths', async () => {
    const ctx = mockCtx({ path: '/admin/settings' });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.set).not.toHaveBeenCalled();
  });

  it('should pass through when service is disabled', async () => {
    service.enabled = false;
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  it('should set rate limit headers on allowed request', async () => {
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
  });

  it('should return 429 when rate limited', async () => {
    service.consume = vi.fn(async () => ({
      allowed: false,
      res: { remainingPoints: 0, msBeforeNext: 30000, consumedPoints: 101 },
      limit: 100,
    }));
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(429);
    expect(ctx.body).toEqual({
      data: null,
      error: {
        status: 429,
        name: 'TooManyRequestsError',
        message: 'Too many requests, please try again later.',
        details: {},
      },
    });
    expect(ctx.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('should bypass excluded paths', async () => {
    service.isExcluded = vi.fn(() => true);
    const ctx = mockCtx({ path: '/api/healthcheck' });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should bypass allowlisted IPs', async () => {
    service.config.allowlist.ips = ['10.0.0.1'];
    const ctx = mockCtx({ ip: '10.0.0.1' });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should fail open on storage error (null res)', async () => {
    service.consume = vi.fn(async () => ({ allowed: true, res: null, limit: 0 }));
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  it('should fail open on unexpected error', async () => {
    service.consume = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(strapi.log.error).toHaveBeenCalled();
  });

  it('should normalize trailing slash', async () => {
    const ctx = mockCtx({ path: '/api/articles/' });
    await middleware(ctx, next);
    expect(service.resolve).toHaveBeenCalledWith('/api/articles');
  });

  it('should use ip: key prefix, never call resolveClientKey', async () => {
    const ctx = mockCtx({ ip: '5.5.5.5' });
    await middleware(ctx, next);
    expect(service.consume).toHaveBeenCalledWith('ip:5.5.5.5', expect.anything(), 100);
  });

  it('should handle /graphql path', async () => {
    const ctx = mockCtx({ path: '/graphql' });
    await middleware(ctx, next);
    expect(service.resolve).toHaveBeenCalledWith('/graphql');
    expect(next).toHaveBeenCalled();
  });

  it('should use resolved rule limit, not default', async () => {
    service.resolve = vi.fn(() => ({ limiter: {}, limit: 5, intervalMs: 60000 }));
    service.consume = vi.fn(async () => ({
      allowed: true,
      res: { remainingPoints: 4, msBeforeNext: 60000, consumedPoints: 1 },
      limit: 5,
    }));
    const ctx = mockCtx({ path: '/api/auth/local' });
    await middleware(ctx, next);
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
  });

  it('should record a blocked event on 429', async () => {
    service.consume = vi.fn(async () => ({
      allowed: false,
      res: { remainingPoints: 0, msBeforeNext: 30000, consumedPoints: 101 },
      limit: 100,
    }));
    const ctx = mockCtx({ path: '/api/articles' });
    await middleware(ctx, next);
    expect(service.recordEvent).toHaveBeenCalledWith({
      type: 'blocked',
      clientKey: 'ip:127.0.0.1',
      path: '/api/articles',
      source: 'global',
      consumedPoints: 101,
      limit: 100,
      msBeforeNext: 30000,
    });
  });

  it('should record a warning event when shouldWarn returns true', async () => {
    service.shouldWarn = vi.fn(() => true);
    const ctx = mockCtx({ path: '/api/articles' });
    await middleware(ctx, next);
    expect(service.recordEvent).toHaveBeenCalledWith({
      type: 'warning',
      clientKey: 'ip:127.0.0.1',
      path: '/api/articles',
      source: 'global',
      consumedPoints: 1,
      limit: 100,
      msBeforeNext: 60000,
    });
  });

  it('should NOT check token/user allowlists', async () => {
    service.config.allowlist.tokens = ['42'];
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 42 } },
      },
    });
    await middleware(ctx, next);
    // Still consumes — global MW doesn't check token allowlists
    expect(service.consume).toHaveBeenCalled();
  });
});
