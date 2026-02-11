import { describe, it, expect, vi, beforeEach } from 'vitest';
import createRouteMiddleware from '../../server/src/middlewares/rate-limit';

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
    resolve: overrides.resolve || vi.fn(() => ({ limiter: {}, limit: 100, intervalMs: 60000 })),
    consume:
      overrides.consume ||
      vi.fn(async () => ({
        allowed: true,
        res: { remainingPoints: 99, msBeforeNext: 60000, consumedPoints: 1 },
        limit: 100,
      })),
    shouldWarn: overrides.shouldWarn || vi.fn(() => false),
    isAllowlisted: overrides.isAllowlisted || vi.fn(() => false),
    isExcluded: vi.fn(() => false),
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

describe('Route Rate Limit Middleware', () => {
  let service: any;
  let strapi: any;
  let middleware: any;
  let next: any;

  beforeEach(() => {
    service = mockService();
    strapi = mockStrapi(service);
    middleware = createRouteMiddleware({}, { strapi });
    next = vi.fn();
  });

  it('should pass through when service is disabled', async () => {
    service.enabled = false;
    const ctx = mockCtx();
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should skip (call next without consuming) for unauthenticated requests (ip: key)', async () => {
    const ctx = mockCtx({ ip: '10.0.0.1' });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should consume with token:{id} key for API token auth', async () => {
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 42 } },
      },
    });
    await middleware(ctx, next);
    expect(service.consume).toHaveBeenCalledWith('token:42', expect.anything(), 100);
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
  });

  it('should consume with user:{id} key for Users & Permissions auth', async () => {
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'users-permissions' }, credentials: { id: 7 } },
        user: { id: 99 },
      },
    });
    await middleware(ctx, next);
    expect(service.consume).toHaveBeenCalledWith('user:99', expect.anything(), 100);
    expect(ctx.set).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
  });

  it('should bypass for allowlisted token', async () => {
    service.isAllowlisted = vi.fn(() => true);
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 42 } },
      },
    });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should bypass for allowlisted user', async () => {
    service.isAllowlisted = vi.fn(() => true);
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'users-permissions' }, credentials: {} },
        user: { id: 5 },
      },
    });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(service.consume).not.toHaveBeenCalled();
  });

  it('should return 429 when auth-identified client is rate limited', async () => {
    service.consume = vi.fn(async () => ({
      allowed: false,
      res: { remainingPoints: 0, msBeforeNext: 30000, consumedPoints: 101 },
      limit: 100,
    }));
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(429);
    expect(ctx.body.error.name).toBe('TooManyRequestsError');
  });

  it('should fail open on storage error (null res) without overriding headers', async () => {
    service.consume = vi.fn(async () => ({ allowed: true, res: null, limit: 0 }));
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    // Should NOT set any headers on null res
    expect(ctx.set).not.toHaveBeenCalledWith('X-RateLimit-Limit', expect.anything());
  });

  it('should fail open on unexpected error', async () => {
    service.consume = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(strapi.log.error).toHaveBeenCalled();
  });

  it('should record a blocked event on 429', async () => {
    service.consume = vi.fn(async () => ({
      allowed: false,
      res: { remainingPoints: 0, msBeforeNext: 30000, consumedPoints: 101 },
      limit: 100,
    }));
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(service.recordEvent).toHaveBeenCalledWith({
      type: 'blocked',
      clientKey: 'token:1',
      path: '/api/articles',
      source: 'route',
      consumedPoints: 101,
      limit: 100,
      msBeforeNext: 30000,
    });
  });

  it('should record a warning event when shouldWarn returns true', async () => {
    service.shouldWarn = vi.fn(() => true);
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(service.recordEvent).toHaveBeenCalledWith({
      type: 'warning',
      clientKey: 'token:1',
      path: '/api/articles',
      source: 'route',
      consumedPoints: 1,
      limit: 100,
      msBeforeNext: 60000,
    });
  });

  it('should fire threshold warning with limiter-specific window', async () => {
    service.shouldWarn = vi.fn(() => true);
    const ctx = mockCtx({
      state: {
        auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } },
      },
    });
    await middleware(ctx, next);
    expect(strapi.log.warn).toHaveBeenCalled();
  });
});
