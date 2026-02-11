import ms from 'ms';
import type { PluginConfig } from '../types';

const PREFIX = '[strapi-plugin-rate-limit]';

function validateMsInterval(value: unknown, fieldName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${PREFIX} ${fieldName} must be a string. Got ${typeof value}.`);
  }
  const parsed = ms(value as ms.StringValue);
  if (parsed === undefined || parsed <= 0) {
    throw new Error(
      `${PREFIX} Invalid ${fieldName} '${value}'. Use single time units like '1m', '30s', '1h'. Compound intervals like '1h30m' are not supported.`
    );
  }
}

export default {
  default: (): PluginConfig => ({
    defaults: {
      limit: 100,
      interval: '1m',
      blockDuration: 0,
    },
    redis: {
      url: undefined,
      host: undefined,
      port: undefined,
      password: undefined,
      tls: false,
    },
    rules: [],
    allowlist: {
      ips: [],
      tokens: [],
      users: [],
    },
    exclude: [],
    inMemoryBlock: {
      enabled: true,
      consumedThreshold: 0,
      duration: '1m',
    },
    thresholdWarning: 0.8,
    keyPrefix: 'rl',
    cloudflare: false,
    execEvenly: false,
    execEvenlyMinDelayMs: 0,
    burst: {
      enabled: false,
      points: 0,
      duration: '10s',
    },
  }),

  validator(config: PluginConfig): void {
    // defaults.limit
    if (!Number.isInteger(config.defaults.limit) || config.defaults.limit <= 0) {
      throw new Error(
        `${PREFIX} defaults.limit must be a positive integer. Got ${config.defaults.limit}.`
      );
    }

    // defaults.interval
    validateMsInterval(config.defaults.interval, 'defaults.interval');

    // defaults.blockDuration
    if (typeof config.defaults.blockDuration !== 'number' || config.defaults.blockDuration < 0) {
      throw new Error(
        `${PREFIX} defaults.blockDuration must be a number >= 0. Got ${config.defaults.blockDuration}.`
      );
    }
    if (config.defaults.blockDuration > 86400) {
      throw new Error(
        `${PREFIX} defaults.blockDuration must be <= 86400 (24 hours). Got ${config.defaults.blockDuration}.`
      );
    }

    // redis mutual exclusivity
    if (config.redis.url && config.redis.host) {
      throw new Error(`${PREFIX} Provide either redis.url OR redis.host/port/password, not both.`);
    }

    // redis.url
    if (config.redis.url !== undefined && config.redis.url !== null) {
      if (
        typeof config.redis.url !== 'string' ||
        (!config.redis.url.startsWith('redis://') && !config.redis.url.startsWith('rediss://'))
      ) {
        throw new Error(
          `${PREFIX} redis.url must start with 'redis://' or 'rediss://'. Got '${config.redis.url}'.`
        );
      }
    }

    // redis.host
    if (config.redis.host !== undefined && config.redis.host !== null) {
      if (typeof config.redis.host !== 'string' || config.redis.host.length === 0) {
        throw new Error(`${PREFIX} redis.host must be a non-empty string.`);
      }
    }

    // redis.port
    if (config.redis.port !== undefined && config.redis.port !== null) {
      if (
        !Number.isInteger(config.redis.port) ||
        config.redis.port < 1 ||
        config.redis.port > 65535
      ) {
        throw new Error(
          `${PREFIX} redis.port must be an integer between 1 and 65535. Got ${config.redis.port}.`
        );
      }
    }

    // rules
    if (Array.isArray(config.rules)) {
      config.rules.forEach((rule, i) => {
        if (!rule.path || typeof rule.path !== 'string') {
          throw new Error(`${PREFIX} rules[${i}].path must be a non-empty string.`);
        }
        if (!Number.isInteger(rule.limit) || rule.limit <= 0) {
          throw new Error(
            `${PREFIX} rules[${i}].limit must be a positive integer. Got ${rule.limit}.`
          );
        }
        validateMsInterval(rule.interval, `rules[${i}].interval`);
      });
    }

    // allowlist coercion
    const coerceToStringArray = (arr: unknown[], fieldName: string): string[] => {
      return arr.map((v, i) => {
        if (typeof v !== 'string') {
          console.warn(
            `${PREFIX} ${fieldName}[${i}] is not a string, coercing ${typeof v} to string.`
          );
          return String(v);
        }
        return v;
      });
    };

    if (Array.isArray(config.allowlist?.ips)) {
      config.allowlist.ips = coerceToStringArray(config.allowlist.ips, 'allowlist.ips');
    }
    if (Array.isArray(config.allowlist?.tokens)) {
      config.allowlist.tokens = coerceToStringArray(config.allowlist.tokens, 'allowlist.tokens');
    }
    if (Array.isArray(config.allowlist?.users)) {
      config.allowlist.users = coerceToStringArray(config.allowlist.users, 'allowlist.users');
    }

    // thresholdWarning
    if (typeof config.thresholdWarning !== 'number') {
      throw new Error(
        `${PREFIX} thresholdWarning must be a number. Got ${typeof config.thresholdWarning}.`
      );
    }
    if (
      config.thresholdWarning !== 0 &&
      (config.thresholdWarning <= 0 || config.thresholdWarning > 1)
    ) {
      throw new Error(
        `${PREFIX} thresholdWarning must be 0 (disabled) or between 0 (exclusive) and 1 (inclusive). Got ${config.thresholdWarning}.`
      );
    }

    // exclude
    if (config.exclude && !Array.isArray(config.exclude)) {
      throw new Error(`${PREFIX} exclude must be an array of strings.`);
    }

    // inMemoryBlock.duration
    if (config.inMemoryBlock?.duration) {
      validateMsInterval(config.inMemoryBlock.duration, 'inMemoryBlock.duration');
    }

    // keyPrefix
    if (typeof config.keyPrefix !== 'string' || config.keyPrefix.length === 0) {
      throw new Error(`${PREFIX} keyPrefix must be a non-empty string. Got '${config.keyPrefix}'.`);
    }
    if (!/^[a-zA-Z0-9_:-]+$/.test(config.keyPrefix)) {
      throw new Error(
        `${PREFIX} keyPrefix must contain only alphanumeric characters, underscores, colons, and hyphens. Got '${config.keyPrefix}'.`
      );
    }

    // cloudflare
    if (typeof config.cloudflare !== 'boolean') {
      throw new Error(`${PREFIX} cloudflare must be a boolean. Got ${typeof config.cloudflare}.`);
    }

    // execEvenly
    if (typeof config.execEvenly !== 'boolean') {
      throw new Error(`${PREFIX} execEvenly must be a boolean. Got ${typeof config.execEvenly}.`);
    }

    // execEvenlyMinDelayMs
    if (typeof config.execEvenlyMinDelayMs !== 'number' || config.execEvenlyMinDelayMs < 0) {
      throw new Error(
        `${PREFIX} execEvenlyMinDelayMs must be a number >= 0. Got ${config.execEvenlyMinDelayMs}.`
      );
    }

    // burst
    if (typeof config.burst?.enabled !== 'boolean') {
      throw new Error(
        `${PREFIX} burst.enabled must be a boolean. Got ${typeof config.burst?.enabled}.`
      );
    }
    if (config.burst.enabled) {
      if (!Number.isInteger(config.burst.points) || config.burst.points <= 0) {
        throw new Error(
          `${PREFIX} burst.points must be a positive integer when burst is enabled. Got ${config.burst.points}.`
        );
      }
      validateMsInterval(config.burst.duration, 'burst.duration');
    }
  },
};
