import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import rateLimiterFactory from '../../server/src/services/service';
import createGlobalRateLimit from '../../server/src/middlewares/global-rate-limit';
import type { PluginConfig } from '../../server/src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    defaults: { limit: 5, interval: '1m', blockDuration: 0 },
    redis: { url: undefined, host: undefined, port: undefined, password: undefined, tls: false },
    rules: [{ path: '/api/auth/**', limit: 3, interval: '1m' }],
    allowlist: { ips: ['10.0.0.1'], tokens: [], users: [] },
    exclude: ['/api/healthcheck'],
    inMemoryBlock: { enabled: true, consumedThreshold: 0, duration: '1m' },
    thresholdWarning: 0.8,
    keyPrefix: `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cloudflare: false,
    execEvenly: false,
    execEvenlyMinDelayMs: 0,
    burst: { enabled: false, points: 0, duration: '10s' },
    ...overrides,
  };
}

function mockCtx(overrides: Record<string, any> = {}): any {
  const headers: Record<string, string> = {};
  return {
    path: overrides.path || '/api/articles',
    status: 200,
    body: undefined,
    state: overrides.state || {},
    request: { ip: overrides.ip || '127.0.0.1' },
    get: (h: string) => (overrides.headers || {})[h] || '',
    set: (key: string, value: string) => {
      headers[key] = value;
    },
    _headers: headers,
  };
}

/**
 * Build a mock strapi object that wires up a REAL rate-limiter service instance.
 * The global middleware accesses:
 *   strapi.plugin('strapi-plugin-rate-limit').service('rateLimiter')
 */
function buildStrapi(service: ReturnType<typeof rateLimiterFactory>) {
  return {
    plugin: vi.fn(() => ({
      service: vi.fn(() => service),
    })),
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Integration tests: Real RateLimiterMemory through the global middleware
// ---------------------------------------------------------------------------

describe('Integration: Global rate-limit middleware with real limiter', () => {
  let service: ReturnType<typeof rateLimiterFactory>;
  let strapi: any;
  let middleware: (ctx: any, next: any) => Promise<void>;
  let config: PluginConfig;

  beforeAll(async () => {
    config = makeConfig();
    // Create a REAL service instance (backed by RateLimiterMemory)
    strapi = { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as any;
    service = rateLimiterFactory({ strapi });
    await service.initialize(config);

    // Now build the full strapi mock that the middleware expects
    strapi = buildStrapi(service);
    middleware = createGlobalRateLimit(strapi);
  });

  // --------------------------------------------------
  // 1. Content API request gets X-RateLimit-* headers
  // --------------------------------------------------
  describe('rate-limit headers on content-API requests', () => {
    it('should set X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset', async () => {
      // Use a unique IP so this doesn't interfere with other tests
      const ctx = mockCtx({ ip: '192.168.100.1' });
      const next = vi.fn();

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(ctx._headers['X-RateLimit-Limit']).toBe('5');
      expect(ctx._headers['X-RateLimit-Remaining']).toBeDefined();
      expect(Number(ctx._headers['X-RateLimit-Remaining'])).toBeLessThanOrEqual(4);
      expect(ctx._headers['X-RateLimit-Reset']).toBeDefined();
      expect(Number(ctx._headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------
  // 2. Requests up to limit succeed, limit+1 returns 429
  // --------------------------------------------------
  describe('rate limit enforcement', () => {
    it('should allow requests up to the limit and return 429 on limit+1', async () => {
      const ip = '192.168.200.1';
      const limit = config.defaults.limit; // 5
      const next = vi.fn();

      // Make `limit` successful requests
      for (let i = 0; i < limit; i++) {
        const ctx = mockCtx({ ip });
        await middleware(ctx, next);
        expect(ctx.status).toBe(200);
        expect(ctx._headers['X-RateLimit-Limit']).toBe(String(limit));
        expect(Number(ctx._headers['X-RateLimit-Remaining'])).toBe(limit - 1 - i);
      }

      // The (limit+1)th request should be rate-limited
      const blockedCtx = mockCtx({ ip });
      await middleware(blockedCtx, next);

      expect(blockedCtx.status).toBe(429);
      expect(blockedCtx.body).toEqual({
        data: null,
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message: 'Too many requests, please try again later.',
          details: {},
        },
      });
    });

    it('should include a positive Retry-After header on 429 response', async () => {
      const ip = '192.168.201.1';
      const limit = config.defaults.limit; // 5
      const next = vi.fn();

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await middleware(mockCtx({ ip }), next);
      }

      // Trigger 429
      const blockedCtx = mockCtx({ ip });
      await middleware(blockedCtx, next);

      expect(blockedCtx.status).toBe(429);
      const retryAfter = Number(blockedCtx._headers['Retry-After']);
      expect(retryAfter).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------
  // 3. Excluded path returns no rate limit headers
  // --------------------------------------------------
  describe('excluded paths', () => {
    it('should not set any rate-limit headers for an excluded path', async () => {
      const ctx = mockCtx({ path: '/api/healthcheck', ip: '192.168.300.1' });
      const next = vi.fn();

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(ctx._headers['X-RateLimit-Limit']).toBeUndefined();
      expect(ctx._headers['X-RateLimit-Remaining']).toBeUndefined();
      expect(ctx._headers['X-RateLimit-Reset']).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // 4. Allowlisted IP bypasses rate limiting
  // --------------------------------------------------
  describe('allowlisted IPs', () => {
    it('should not rate-limit a request from an allowlisted IP', async () => {
      const next = vi.fn();

      // Send more requests than the limit from the allowlisted IP
      for (let i = 0; i < config.defaults.limit + 3; i++) {
        const ctx = mockCtx({ ip: '10.0.0.1' });
        await middleware(ctx, next);
        // Should always pass through without rate-limit headers
        expect(ctx.status).toBe(200);
        expect(ctx._headers['X-RateLimit-Limit']).toBeUndefined();
        expect(ctx._headers['X-RateLimit-Remaining']).toBeUndefined();
      }
    });
  });

  // --------------------------------------------------
  // 5. Non-API paths (/admin) are not rate limited
  // --------------------------------------------------
  describe('non-API paths', () => {
    it('should not rate-limit /admin paths', async () => {
      const next = vi.fn();

      for (let i = 0; i < config.defaults.limit + 3; i++) {
        const ctx = mockCtx({ path: '/admin/settings', ip: '192.168.400.1' });
        await middleware(ctx, next);
        expect(ctx.status).toBe(200);
        expect(ctx._headers['X-RateLimit-Limit']).toBeUndefined();
      }

      expect(next).toHaveBeenCalledTimes(config.defaults.limit + 3);
    });

    it('should not rate-limit /uploads paths', async () => {
      const ctx = mockCtx({ path: '/uploads/image.png', ip: '192.168.401.1' });
      const next = vi.fn();

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(ctx._headers['X-RateLimit-Limit']).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // 6. Per-route rule with stricter limit
  // --------------------------------------------------
  describe('per-route rules', () => {
    it('should enforce the per-route rule limit independently from defaults', async () => {
      const ip = '192.168.500.1';
      const ruleLimit = 3; // /api/auth/** has limit: 3
      const next = vi.fn();

      // Make ruleLimit successful requests to /api/auth/local
      for (let i = 0; i < ruleLimit; i++) {
        const ctx = mockCtx({ path: '/api/auth/local', ip });
        await middleware(ctx, next);
        expect(ctx.status).toBe(200);
        expect(ctx._headers['X-RateLimit-Limit']).toBe(String(ruleLimit));
        expect(Number(ctx._headers['X-RateLimit-Remaining'])).toBe(ruleLimit - 1 - i);
      }

      // The (ruleLimit+1)th request to auth should be blocked
      const blockedCtx = mockCtx({ path: '/api/auth/local', ip });
      await middleware(blockedCtx, next);
      expect(blockedCtx.status).toBe(429);
      expect(blockedCtx._headers['X-RateLimit-Limit']).toBe(String(ruleLimit));
    });

    it('should not exhaust the default limiter when the per-route limiter blocks', async () => {
      // Use same IP as the per-route test above, but different IP to isolate
      const ip = '192.168.501.1';
      const ruleLimit = 3;
      const defaultLimit = config.defaults.limit; // 5
      const next = vi.fn();

      // Exhaust the per-route limiter on /api/auth/local
      for (let i = 0; i < ruleLimit; i++) {
        await middleware(mockCtx({ path: '/api/auth/local', ip }), next);
      }

      // /api/auth/local should now be blocked
      const authCtx = mockCtx({ path: '/api/auth/local', ip });
      await middleware(authCtx, next);
      expect(authCtx.status).toBe(429);

      // But /api/articles (default limiter) should still have capacity
      const articlesCtx = mockCtx({ path: '/api/articles', ip });
      await middleware(articlesCtx, next);
      expect(articlesCtx.status).toBe(200);
      expect(articlesCtx._headers['X-RateLimit-Limit']).toBe(String(defaultLimit));
    });

    it('should match /api/auth/register under the /api/auth/** rule', async () => {
      const ip = '192.168.502.1';
      const next = vi.fn();

      const ctx = mockCtx({ path: '/api/auth/register', ip });
      await middleware(ctx, next);
      expect(ctx._headers['X-RateLimit-Limit']).toBe('3');
    });
  });

  // --------------------------------------------------
  // 7. Path with trailing slash treated same as without
  // --------------------------------------------------
  describe('trailing slash normalization', () => {
    it('should treat /api/articles/ the same as /api/articles', async () => {
      const ip = '192.168.600.1';
      const next = vi.fn();

      // First request without trailing slash
      const ctx1 = mockCtx({ path: '/api/articles', ip });
      await middleware(ctx1, next);
      expect(ctx1.status).toBe(200);
      const remaining1 = Number(ctx1._headers['X-RateLimit-Remaining']);

      // Second request with trailing slash (same IP, same effective path)
      const ctx2 = mockCtx({ path: '/api/articles/', ip });
      await middleware(ctx2, next);
      expect(ctx2.status).toBe(200);
      const remaining2 = Number(ctx2._headers['X-RateLimit-Remaining']);

      // Remaining should have decreased by 1 (same limiter bucket)
      expect(remaining2).toBe(remaining1 - 1);
    });

    it('should normalize trailing slash on per-route rule paths too', async () => {
      const ip = '192.168.601.1';
      const next = vi.fn();

      // Request to /api/auth/local/
      const ctx = mockCtx({ path: '/api/auth/local/', ip });
      await middleware(ctx, next);

      // Should match the /api/auth/** rule with limit 3
      expect(ctx._headers['X-RateLimit-Limit']).toBe('3');
    });
  });
});

// ---------------------------------------------------------------------------
// Separate suite: fresh service per test for isolation scenarios
// ---------------------------------------------------------------------------

describe('Integration: isolated limiter instances', () => {
  it('should decrement X-RateLimit-Remaining with each request', async () => {
    const config = makeConfig();
    const strapiLogger = { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as any;
    const service = rateLimiterFactory({ strapi: strapiLogger });
    await service.initialize(config);
    const strapi = buildStrapi(service);
    const middleware = createGlobalRateLimit(strapi);

    const ip = '10.10.10.10';
    const next = vi.fn();
    const remainingValues: number[] = [];

    for (let i = 0; i < config.defaults.limit; i++) {
      const ctx = mockCtx({ ip });
      await middleware(ctx, next);
      remainingValues.push(Number(ctx._headers['X-RateLimit-Remaining']));
    }

    // Remaining should count down: 4, 3, 2, 1, 0
    expect(remainingValues).toEqual([4, 3, 2, 1, 0]);
  });

  it('should have X-RateLimit-Remaining of 0 and Retry-After on 429', async () => {
    const config = makeConfig({ defaults: { limit: 2, interval: '1m', blockDuration: 0 } });
    const strapiLogger = { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as any;
    const service = rateLimiterFactory({ strapi: strapiLogger });
    await service.initialize(config);
    const strapi = buildStrapi(service);
    const middleware = createGlobalRateLimit(strapi);

    const ip = '10.10.10.11';
    const next = vi.fn();

    // Exhaust: 2 requests
    await middleware(mockCtx({ ip }), next);
    await middleware(mockCtx({ ip }), next);

    // 3rd should be blocked
    const ctx = mockCtx({ ip });
    await middleware(ctx, next);

    expect(ctx.status).toBe(429);
    expect(ctx._headers['X-RateLimit-Remaining']).toBe('0');
    expect(Number(ctx._headers['Retry-After'])).toBeGreaterThan(0);
    expect(ctx._headers['X-RateLimit-Limit']).toBe('2');
  });

  it('next should NOT be called when a request is rate-limited', async () => {
    const config = makeConfig({ defaults: { limit: 1, interval: '1m', blockDuration: 0 } });
    const strapiLogger = { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as any;
    const service = rateLimiterFactory({ strapi: strapiLogger });
    await service.initialize(config);
    const strapi = buildStrapi(service);
    const middleware = createGlobalRateLimit(strapi);

    const ip = '10.10.10.12';
    const next = vi.fn();

    // First request: allowed
    await middleware(mockCtx({ ip }), next);
    expect(next).toHaveBeenCalledTimes(1);

    // Second request: blocked -- next should NOT be called again
    const ctx = mockCtx({ ip });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(ctx.status).toBe(429);
  });
});
