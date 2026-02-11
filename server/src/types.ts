import type { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';

export interface PluginConfig {
  defaults: { limit: number; interval: string; blockDuration: number };
  redis: { url?: string; host?: string; port?: number; password?: string; tls: boolean };
  rules: RateLimitRule[];
  allowlist: { ips: string[]; tokens: string[]; users: string[] };
  exclude: string[];
  inMemoryBlock: { enabled: boolean; consumedThreshold: number; duration: string };
  thresholdWarning: number;
  keyPrefix: string;
  cloudflare: boolean;
  execEvenly: boolean;
  execEvenlyMinDelayMs: number;
  burst: { enabled: boolean; points: number; duration: string };
}

export interface RateLimitRule {
  path: string;
  limit: number;
  interval: string;
}

export interface ResolvedLimiter {
  limiter: RateLimiterAbstract;
  limit: number;
  intervalMs: number;
}

export interface ConsumeResult {
  allowed: boolean;
  res: RateLimiterRes | null;
  limit: number;
}

export interface PluginStatus {
  enabled: boolean;
  strategy: 'memory' | 'redis' | 'none';
  redisConnected: boolean;
  defaults: { limit: number; interval: string };
  rulesCount: number;
  allowlistCounts: { ips: number; tokens: number; users: number };
}

export type RateLimitEventType = 'blocked' | 'warning';

export interface RateLimitEvent {
  id: number;
  timestamp: string;
  type: RateLimitEventType;
  clientKey: string;
  path: string;
  source: 'global' | 'route';
  consumedPoints: number;
  limit: number;
  msBeforeNext: number;
}
