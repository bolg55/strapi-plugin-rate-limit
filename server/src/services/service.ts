import type { Core } from '@strapi/strapi';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, BurstyRateLimiter } from 'rate-limiter-flexible';
import type { RateLimiterAbstract } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import ms from 'ms';
import picomatch from 'picomatch';
import type { PluginConfig, ResolvedLimiter, ConsumeResult, PluginStatus } from '../types';

const PREFIX = '[strapi-plugin-rate-limit]';
const MAX_WARNED_KEYS = 10000;

const rateLimiter = ({ strapi }: { strapi: Core.Strapi }) => {
  let enabled = false;
  let strategy: 'memory' | 'redis' | 'none' = 'none';
  let defaultLimiter: RateLimiterAbstract | null = null;
  let ruleLimiters: Array<{ matcher: (path: string) => boolean; limiter: RateLimiterAbstract; limit: number; intervalMs: number }> = [];
  let excludeMatchers: Array<(path: string) => boolean> = [];
  let redisClient: Redis | null = null;
  let config: PluginConfig | null = null;
  let defaultIntervalMs = 0;
  const warnedKeys = new Map<string, number>();

  /**
   * Optionally wrap a limiter in BurstyRateLimiter if burst config is enabled.
   */
  function maybeBurst(limiter: RateLimiterAbstract, keyPrefix: string, isRedis: boolean): RateLimiterAbstract {
    if (!config?.burst.enabled) return limiter;
    const burstDurationSec = ms(config.burst.duration as ms.StringValue) / 1000;
    const burstLimiter = isRedis
      ? new RateLimiterRedis({
          storeClient: redisClient!,
          points: config.burst.points,
          duration: burstDurationSec,
          keyPrefix: `${keyPrefix}:burst`,
        })
      : new RateLimiterMemory({
          points: config.burst.points,
          duration: burstDurationSec,
          keyPrefix: `${keyPrefix}:burst`,
        });
    // BurstyRateLimiter implements consume() with same signature but doesn't extend RateLimiterAbstract in typings
    return new BurstyRateLimiter(limiter, burstLimiter) as unknown as RateLimiterAbstract;
  }

  return {
    get enabled() {
      return enabled;
    },

    get strategy() {
      return strategy;
    },

    // F5: Return a frozen shallow copy to prevent mutation of internal state
    get config(): PluginConfig | null {
      if (!config) return null;
      return Object.freeze({ ...config });
    },

    async initialize(pluginConfig: PluginConfig): Promise<void> {
      try {
        config = pluginConfig;

        const durationMs = ms(config.defaults.interval as ms.StringValue);
        defaultIntervalMs = durationMs;
        const durationSeconds = durationMs / 1000;
        const { limit, blockDuration } = config.defaults;

        const inMemoryBlockDurationMs = ms(config.inMemoryBlock.duration as ms.StringValue);
        const inMemoryBlockDuration = inMemoryBlockDurationMs / 1000;
        const inMemoryBlockOnConsumed =
          config.inMemoryBlock.consumedThreshold === 0
            ? 2 * limit
            : config.inMemoryBlock.consumedThreshold;

        // Shared execEvenly options
        const execEvenlyOpts = config.execEvenly
          ? {
              execEvenly: true as const,
              ...(config.execEvenlyMinDelayMs > 0
                ? { execEvenlyMinDelayMs: config.execEvenlyMinDelayMs }
                : {}),
            }
          : {};

        const hasRedis = !!(config.redis.url || config.redis.host);

        if (hasRedis) {
          // Create ioredis client
          const isRedissUrl = config.redis.url?.startsWith('rediss://');
          const redisOptions: Record<string, unknown> = {
            enableOfflineQueue: false,
            maxRetriesPerRequest: 3,
            lazyConnect: true, // F4: Don't connect until first command
          };

          if (config.redis.tls && !isRedissUrl) {
            redisOptions.tls = {};
          }

          if (isRedissUrl && !config.redis.tls) {
            strapi.log.warn(
              `${PREFIX} redis.tls is false but URL uses rediss:// scheme. TLS is enabled automatically by ioredis for rediss:// URLs.`
            );
          }

          if (config.redis.url) {
            redisClient = new Redis(config.redis.url, redisOptions as any);
          } else {
            redisClient = new Redis({
              host: config.redis.host!,
              port: config.redis.port || 6379,
              password: config.redis.password,
              ...redisOptions,
            } as any);
          }

          // F1: Attach error handler to prevent unhandled 'error' events crashing the process
          redisClient.on('error', (err) => {
            strapi.log.error(`${PREFIX} Redis error: ${err.message}`);
          });

          // F6: Log connection lifecycle events
          redisClient.on('connect', () => {
            strapi.log.info(`${PREFIX} Redis connected.`);
          });
          redisClient.on('close', () => {
            strapi.log.warn(`${PREFIX} Redis connection closed.`);
          });
          redisClient.on('reconnecting', () => {
            strapi.log.info(`${PREFIX} Redis reconnecting...`);
          });

          // Connect explicitly (since lazyConnect: true)
          await redisClient.connect();

          // Shared insurance limiter
          const insuranceLimiter = new RateLimiterMemory({
            points: limit,
            duration: durationSeconds,
          });

          // Default limiter (Redis)
          const defaultRedisLimiter = new RateLimiterRedis({
            storeClient: redisClient,
            points: limit,
            duration: durationSeconds,
            blockDuration,
            keyPrefix: `${config.keyPrefix}:default`,
            inMemoryBlockOnConsumed: config.inMemoryBlock.enabled ? inMemoryBlockOnConsumed : undefined,
            inMemoryBlockDuration: config.inMemoryBlock.enabled ? inMemoryBlockDuration : undefined,
            insuranceLimiter,
            ...execEvenlyOpts,
          });
          defaultLimiter = maybeBurst(defaultRedisLimiter, `${config.keyPrefix}:default`, true);

          // Per-rule limiters (Redis)
          ruleLimiters = config.rules.map((rule, index) => {
            const ruleIntervalMs = ms(rule.interval as ms.StringValue);
            const ruleDuration = ruleIntervalMs / 1000;
            const baseLimiter = new RateLimiterRedis({
              storeClient: redisClient!,
              points: rule.limit,
              duration: ruleDuration,
              blockDuration, // F7: propagate blockDuration to per-rule limiters
              keyPrefix: `${config!.keyPrefix}:rule-${index}`,
              inMemoryBlockOnConsumed: config!.inMemoryBlock.enabled ? 2 * rule.limit : undefined,
              inMemoryBlockDuration: config!.inMemoryBlock.enabled ? inMemoryBlockDuration : undefined,
              insuranceLimiter,
              ...execEvenlyOpts,
            });
            return {
              matcher: picomatch(rule.path),
              limiter: maybeBurst(baseLimiter, `${config!.keyPrefix}:rule-${index}`, true),
              limit: rule.limit,
              intervalMs: ruleIntervalMs,
            };
          });

          strategy = 'redis';
        } else {
          // Default limiter (Memory)
          const defaultMemoryLimiter = new RateLimiterMemory({
            points: limit,
            duration: durationSeconds,
            blockDuration,
            keyPrefix: `${config.keyPrefix}:default`,
            ...execEvenlyOpts,
          });
          defaultLimiter = maybeBurst(defaultMemoryLimiter, `${config.keyPrefix}:default`, false);

          // Per-rule limiters (Memory)
          ruleLimiters = config.rules.map((rule, index) => {
            const ruleIntervalMs = ms(rule.interval as ms.StringValue);
            const ruleDuration = ruleIntervalMs / 1000;
            const baseLimiter = new RateLimiterMemory({
              points: rule.limit,
              duration: ruleDuration,
              blockDuration, // F7: propagate blockDuration to per-rule limiters
              keyPrefix: `${config!.keyPrefix}:rule-${index}`,
              ...execEvenlyOpts,
            });
            return {
              matcher: picomatch(rule.path),
              limiter: maybeBurst(baseLimiter, `${config!.keyPrefix}:rule-${index}`, false),
              limit: rule.limit,
              intervalMs: ruleIntervalMs,
            };
          });

          strategy = 'memory';
        }

        // Compile exclude matchers
        excludeMatchers = config.exclude.map((pattern) => picomatch(pattern));

        enabled = true;
      } catch (error) {
        strapi.log.error(`${PREFIX} Failed to initialize: ${error}. Plugin disabled.`);
        enabled = false;
      }
    },

    // F2: Include intervalMs in resolved result so middleware can use per-rule interval for warnings
    resolve(path: string): ResolvedLimiter {
      for (const rule of ruleLimiters) {
        if (rule.matcher(path)) {
          return { limiter: rule.limiter, limit: rule.limit, intervalMs: rule.intervalMs };
        }
      }
      return { limiter: defaultLimiter!, limit: config!.defaults.limit, intervalMs: defaultIntervalMs };
    },

    isExcluded(path: string): boolean {
      return excludeMatchers.some((matcher) => matcher(path));
    },

    async consume(key: string, limiter: RateLimiterAbstract, limit: number): Promise<ConsumeResult> {
      try {
        const res = await limiter.consume(key);
        return { allowed: true, res, limit };
      } catch (rejRes) {
        if (rejRes instanceof RateLimiterRes) {
          return { allowed: false, res: rejRes, limit };
        }
        strapi.log.error(`${PREFIX} Storage error: ${rejRes}`);
        return { allowed: true, res: null, limit: 0 };
      }
    },

    getStatus(): PluginStatus {
      return {
        enabled,
        strategy,
        redisConnected: (redisClient as any)?.status === 'ready',
        defaults: {
          limit: config?.defaults.limit ?? 0,
          interval: config?.defaults.interval ?? '0',
        },
        rulesCount: config?.rules.length ?? 0,
        allowlistCounts: {
          ips: config?.allowlist.ips.length ?? 0,
          tokens: config?.allowlist.tokens.length ?? 0,
          users: config?.allowlist.users.length ?? 0,
        },
      };
    },

    isAllowlisted(key: string, cfg: PluginConfig): boolean {
      if (key.startsWith('ip:')) {
        return cfg.allowlist.ips.includes(key.slice(3));
      }
      if (key.startsWith('token:')) {
        return cfg.allowlist.tokens.includes(key.slice(6));
      }
      if (key.startsWith('user:')) {
        return cfg.allowlist.users.includes(key.slice(5));
      }
      return false;
    },

    shouldWarn(key: string, consumedPoints: number, limit: number, windowDurationMs: number): boolean {
      if (!config || config.thresholdWarning === 0) {
        return false;
      }

      const now = Date.now();
      const existing = warnedKeys.get(key);

      // Check existing entry — if present and not expired, skip
      if (existing !== undefined) {
        if (now < existing) {
          return false;
        }
        // Expired — remove stale entry
        warnedKeys.delete(key);
      }

      if (consumedPoints / limit >= config.thresholdWarning) {
        // Enforce bounded map
        if (warnedKeys.size >= MAX_WARNED_KEYS) {
          const firstKey = warnedKeys.keys().next().value;
          if (firstKey !== undefined) {
            warnedKeys.delete(firstKey);
          }
        }
        warnedKeys.set(key, now + windowDurationMs);
        return true;
      }

      return false;
    },

    disconnect(): void {
      if (redisClient) {
        redisClient.disconnect();
      }
    },
  };
};

export default rateLimiter;
