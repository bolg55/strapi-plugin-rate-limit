import { describe, it, expect } from 'vitest';
import configExport from '../../server/src/config/index';

const { default: getDefaults, validator } = configExport;

function makeConfig(overrides: Record<string, any> = {}) {
  const defaults = getDefaults();
  return {
    ...defaults,
    ...overrides,
    defaults: { ...defaults.defaults, ...overrides.defaults },
    redis: { ...defaults.redis, ...overrides.redis },
    allowlist: { ...defaults.allowlist, ...overrides.allowlist },
    inMemoryBlock: { ...defaults.inMemoryBlock, ...overrides.inMemoryBlock },
    burst: { ...defaults.burst, ...overrides.burst },
  };
}

describe('Plugin Config', () => {
  describe('defaults', () => {
    it('should return valid default config', () => {
      const defaults = getDefaults();
      expect(defaults.defaults.limit).toBe(100);
      expect(defaults.defaults.interval).toBe('1m');
      expect(defaults.defaults.blockDuration).toBe(0);
      expect(defaults.redis.tls).toBe(false);
      expect(defaults.rules).toEqual([]);
      expect(defaults.allowlist.ips).toEqual([]);
      expect(defaults.cloudflare).toBe(false);
      expect(defaults.keyPrefix).toBe('rl');
      expect(defaults.thresholdWarning).toBe(0.8);
      expect(defaults.execEvenly).toBe(false);
      expect(defaults.execEvenlyMinDelayMs).toBe(0);
      expect(defaults.burst).toEqual({ enabled: false, points: 0, duration: '10s' });
    });
  });

  describe('validator', () => {
    it('should pass with valid default config', () => {
      expect(() => validator(makeConfig())).not.toThrow();
    });

    // defaults.limit
    it('should throw for non-positive defaults.limit', () => {
      expect(() => validator(makeConfig({ defaults: { limit: 0 } }))).toThrow(
        'defaults.limit must be a positive integer'
      );
      expect(() => validator(makeConfig({ defaults: { limit: -1 } }))).toThrow(
        'defaults.limit must be a positive integer'
      );
    });

    it('should throw for non-integer defaults.limit', () => {
      expect(() => validator(makeConfig({ defaults: { limit: 1.5 } }))).toThrow(
        'defaults.limit must be a positive integer'
      );
    });

    // defaults.interval
    it('should throw for invalid defaults.interval', () => {
      expect(() => validator(makeConfig({ defaults: { interval: 'invalid' } }))).toThrow(
        "Invalid defaults.interval 'invalid'"
      );
    });

    it('should throw for compound interval with helpful message', () => {
      expect(() => validator(makeConfig({ defaults: { interval: '1h30m' } }))).toThrow(
        'Compound intervals'
      );
    });

    it('should pass for valid intervals', () => {
      expect(() => validator(makeConfig({ defaults: { interval: '30s' } }))).not.toThrow();
      expect(() => validator(makeConfig({ defaults: { interval: '1h' } }))).not.toThrow();
      expect(() => validator(makeConfig({ defaults: { interval: '500ms' } }))).not.toThrow();
    });

    // defaults.blockDuration
    it('should throw for negative blockDuration', () => {
      expect(() => validator(makeConfig({ defaults: { blockDuration: -1 } }))).toThrow(
        'defaults.blockDuration must be a number >= 0'
      );
    });

    it('should pass for blockDuration: 0', () => {
      expect(() => validator(makeConfig({ defaults: { blockDuration: 0 } }))).not.toThrow();
    });

    it('should throw for blockDuration > 86400', () => {
      expect(() => validator(makeConfig({ defaults: { blockDuration: 100000 } }))).toThrow(
        'defaults.blockDuration must be <= 86400'
      );
    });

    // redis mutual exclusivity
    it('should throw when both redis.url and redis.host are provided', () => {
      expect(() =>
        validator(makeConfig({ redis: { url: 'redis://localhost:6379', host: 'localhost' } }))
      ).toThrow('Provide either redis.url OR redis.host/port/password, not both.');
    });

    // redis.url
    it('should throw for invalid redis.url', () => {
      expect(() => validator(makeConfig({ redis: { url: 'http://invalid' } }))).toThrow(
        "redis.url must start with 'redis://' or 'rediss://'"
      );
    });

    it('should pass for valid redis.url with rediss://', () => {
      expect(() =>
        validator(makeConfig({ redis: { url: 'rediss://user:pass@host:6379' } }))
      ).not.toThrow();
    });

    it('should pass for valid redis.url with redis://', () => {
      expect(() =>
        validator(makeConfig({ redis: { url: 'redis://localhost:6379' } }))
      ).not.toThrow();
    });

    // redis.port
    it('should throw for redis.port out of range', () => {
      expect(() => validator(makeConfig({ redis: { host: 'localhost', port: 0 } }))).toThrow(
        'redis.port must be an integer between 1 and 65535'
      );
      expect(() => validator(makeConfig({ redis: { host: 'localhost', port: 70000 } }))).toThrow(
        'redis.port must be an integer between 1 and 65535'
      );
    });

    it('should throw for non-integer redis.port', () => {
      expect(() => validator(makeConfig({ redis: { host: 'localhost', port: 1.5 } }))).toThrow(
        'redis.port must be an integer between 1 and 65535'
      );
    });

    // rules
    it('should throw for rules with missing path', () => {
      expect(() =>
        validator(makeConfig({ rules: [{ path: '', limit: 10, interval: '1m' }] }))
      ).toThrow('rules[0].path must be a non-empty string');
    });

    it('should throw for rules with invalid limit', () => {
      expect(() =>
        validator(makeConfig({ rules: [{ path: '/api/test', limit: -5, interval: '1m' }] }))
      ).toThrow('rules[0].limit must be a positive integer');
    });

    it('should pass for valid rules', () => {
      expect(() =>
        validator(makeConfig({ rules: [{ path: '/api/auth/**', limit: 5, interval: '1m' }] }))
      ).not.toThrow();
    });

    // thresholdWarning
    it('should throw for thresholdWarning outside 0-1 range', () => {
      expect(() => validator(makeConfig({ thresholdWarning: 1.5 }))).toThrow(
        'thresholdWarning must be 0 (disabled) or between 0'
      );
      expect(() => validator(makeConfig({ thresholdWarning: -0.5 }))).toThrow(
        'thresholdWarning must be 0 (disabled) or between 0'
      );
    });

    it('should pass for thresholdWarning: 0 (disabled)', () => {
      expect(() => validator(makeConfig({ thresholdWarning: 0 }))).not.toThrow();
    });

    it('should pass for thresholdWarning: 1', () => {
      expect(() => validator(makeConfig({ thresholdWarning: 1 }))).not.toThrow();
    });

    // allowlist coercion
    it('should coerce non-string allowlist tokens to strings', () => {
      const config = makeConfig({ allowlist: { ips: [], tokens: [42 as any, 'abc'], users: [] } });
      validator(config);
      expect(config.allowlist.tokens).toEqual(['42', 'abc']);
    });

    // cloudflare
    it('should throw for non-boolean cloudflare', () => {
      expect(() => validator(makeConfig({ cloudflare: 'yes' as any }))).toThrow(
        'cloudflare must be a boolean'
      );
    });

    // inMemoryBlock.duration
    it('should throw for invalid inMemoryBlock.duration', () => {
      expect(() =>
        validator(
          makeConfig({ inMemoryBlock: { enabled: true, consumedThreshold: 0, duration: 'bad' } })
        )
      ).toThrow("Invalid inMemoryBlock.duration 'bad'");
    });

    // keyPrefix
    it('should throw for empty keyPrefix', () => {
      expect(() => validator(makeConfig({ keyPrefix: '' }))).toThrow(
        'keyPrefix must be a non-empty string'
      );
    });

    it('should throw for keyPrefix with invalid characters', () => {
      expect(() => validator(makeConfig({ keyPrefix: 'rl space' }))).toThrow(
        'keyPrefix must contain only alphanumeric'
      );
      expect(() => validator(makeConfig({ keyPrefix: 'rl/bad' }))).toThrow(
        'keyPrefix must contain only alphanumeric'
      );
    });

    it('should pass for valid keyPrefix with colons and hyphens', () => {
      expect(() => validator(makeConfig({ keyPrefix: 'rl:my-app_v2' }))).not.toThrow();
    });

    // execEvenly
    it('should throw for non-boolean execEvenly', () => {
      expect(() => validator(makeConfig({ execEvenly: 'yes' as any }))).toThrow(
        'execEvenly must be a boolean'
      );
    });

    it('should pass for execEvenly: true', () => {
      expect(() => validator(makeConfig({ execEvenly: true }))).not.toThrow();
    });

    // execEvenlyMinDelayMs
    it('should throw for negative execEvenlyMinDelayMs', () => {
      expect(() => validator(makeConfig({ execEvenlyMinDelayMs: -1 }))).toThrow(
        'execEvenlyMinDelayMs must be a number >= 0'
      );
    });

    // burst
    it('should throw for non-boolean burst.enabled', () => {
      expect(() =>
        validator(makeConfig({ burst: { enabled: 'yes' as any, points: 5, duration: '10s' } }))
      ).toThrow('burst.enabled must be a boolean');
    });

    it('should throw for burst.points <= 0 when burst is enabled', () => {
      expect(() =>
        validator(makeConfig({ burst: { enabled: true, points: 0, duration: '10s' } }))
      ).toThrow('burst.points must be a positive integer');
    });

    it('should throw for invalid burst.duration when burst is enabled', () => {
      expect(() =>
        validator(makeConfig({ burst: { enabled: true, points: 5, duration: 'bad' } }))
      ).toThrow("Invalid burst.duration 'bad'");
    });

    it('should pass for valid burst config', () => {
      expect(() =>
        validator(makeConfig({ burst: { enabled: true, points: 10, duration: '30s' } }))
      ).not.toThrow();
    });

    it('should pass when burst is disabled with points: 0', () => {
      expect(() =>
        validator(makeConfig({ burst: { enabled: false, points: 0, duration: '10s' } }))
      ).not.toThrow();
    });
  });
});
