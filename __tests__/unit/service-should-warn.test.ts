import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import rateLimiter from '../../server/src/services/service';
import type { PluginConfig } from '../../server/src/types';

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    defaults: { limit: 100, interval: '1m', blockDuration: 0 },
    redis: { tls: false },
    rules: [],
    allowlist: { ips: [], tokens: [], users: [] },
    exclude: [],
    inMemoryBlock: { enabled: false, consumedThreshold: 0, duration: '1m' },
    thresholdWarning: 0.8,
    keyPrefix: 'rl',
    cloudflare: false,
    execEvenly: false,
    execEvenlyMinDelayMs: 0,
    burst: { enabled: false, points: 0, duration: '10s' },
    maskClientIps: true,
    adminPollInterval: '10s',
    ...overrides,
  };
}

function mockStrapi(): any {
  return {
    plugin: vi.fn(() => ({
      service: vi.fn(),
    })),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    config: {
      get: vi.fn(),
    },
  };
}

describe('shouldWarn', () => {
  let service: ReturnType<typeof rateLimiter>;
  let strapi: any;

  beforeEach(() => {
    vi.useFakeTimers();
    strapi = mockStrapi();
    service = rateLimiter({ strapi });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function initWithThreshold(threshold: number) {
    await service.initialize(makeConfig({ thresholdWarning: threshold }));
  }

  it('should return true when threshold is hit', async () => {
    await initWithThreshold(0.8);
    // 80/100 = 0.8, exactly at threshold
    expect(service.shouldWarn('ip:1.2.3.4', 80, 100, 60000)).toBe(true);
  });

  it('should return true when threshold is exceeded', async () => {
    await initWithThreshold(0.8);
    expect(service.shouldWarn('ip:1.2.3.4', 90, 100, 60000)).toBe(true);
  });

  it('should return false when below threshold', async () => {
    await initWithThreshold(0.8);
    // 79/100 = 0.79, below 0.8
    expect(service.shouldWarn('ip:1.2.3.4', 79, 100, 60000)).toBe(false);
  });

  it('should deduplicate within the window', async () => {
    await initWithThreshold(0.8);
    const key = 'ip:1.2.3.4';

    // First call: should warn
    expect(service.shouldWarn(key, 90, 100, 60000)).toBe(true);

    // Second call within the same window: should NOT warn (deduplicated)
    expect(service.shouldWarn(key, 95, 100, 60000)).toBe(false);
  });

  it('should warn again after deduplication window expires', async () => {
    await initWithThreshold(0.8);
    const key = 'ip:1.2.3.4';

    expect(service.shouldWarn(key, 90, 100, 60000)).toBe(true);

    // Advance time past the window
    vi.advanceTimersByTime(60001);

    // Should warn again since the window expired
    expect(service.shouldWarn(key, 90, 100, 60000)).toBe(true);
  });

  it('should return false when threshold is 0 (disabled)', async () => {
    await initWithThreshold(0);
    // Even at 100% usage, should not warn
    expect(service.shouldWarn('ip:1.2.3.4', 100, 100, 60000)).toBe(false);
  });

  it('should track independent keys separately', async () => {
    await initWithThreshold(0.8);
    const key1 = 'ip:1.1.1.1';
    const key2 = 'ip:2.2.2.2';

    expect(service.shouldWarn(key1, 90, 100, 60000)).toBe(true);
    // key2 should still warn independently
    expect(service.shouldWarn(key2, 90, 100, 60000)).toBe(true);
    // key1 should be deduplicated
    expect(service.shouldWarn(key1, 95, 100, 60000)).toBe(false);
  });

  it('should evict oldest entry when MAX_WARNED_KEYS is reached', async () => {
    await initWithThreshold(0.8);

    // Fill up to 10000 keys
    for (let i = 0; i < 10000; i++) {
      service.shouldWarn(`ip:key-${i}`, 90, 100, 60000);
    }

    // This should evict the oldest (key-0) and add key-new
    expect(service.shouldWarn('ip:key-new', 90, 100, 60000)).toBe(true);

    // key-0 was evicted, so it should warn again
    expect(service.shouldWarn('ip:key-0', 90, 100, 60000)).toBe(true);
  });

  it('should return true at exact boundary (consumedPoints/limit === threshold)', async () => {
    await initWithThreshold(0.5);
    // 50/100 = 0.5, exactly at threshold
    expect(service.shouldWarn('ip:1.2.3.4', 50, 100, 60000)).toBe(true);
  });

  it('should return false just below boundary', async () => {
    await initWithThreshold(0.5);
    // 49/100 = 0.49, below 0.5
    expect(service.shouldWarn('ip:1.2.3.4', 49, 100, 60000)).toBe(false);
  });

  it('should handle threshold of 1.0 (only at limit)', async () => {
    await initWithThreshold(1.0);
    expect(service.shouldWarn('ip:1.2.3.4', 99, 100, 60000)).toBe(false);
    expect(service.shouldWarn('ip:1.2.3.4', 100, 100, 60000)).toBe(true);
  });
});
