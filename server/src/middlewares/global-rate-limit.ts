import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { resolveClientIp } from '../utils/resolve-client-ip';
import { TOO_MANY_REQUESTS_BODY } from '../utils/constants';
import { getRateLimiterService } from '../utils/get-service';
import { isIpInAllowlist } from '../utils/ip-match';

const PREFIX = '[strapi-plugin-rate-limit]';

export default function createGlobalRateLimit(strapi: Core.Strapi) {
  return async function globalRateLimit(ctx: Context, next: Next): Promise<void> {
    try {
      // Path normalization: strip trailing slash
      const normalizedPath =
        ctx.path.endsWith('/') && ctx.path.length > 1 ? ctx.path.slice(0, -1) : ctx.path;

      // Path filter: only content API paths
      if (!normalizedPath.startsWith('/api/') && normalizedPath !== '/graphql') {
        return next();
      }

      // Get service (may be null before bootstrap completes)
      const service = getRateLimiterService(strapi);

      // Enabled check (includes null guard for pre-bootstrap race)
      if (!service || !service.enabled) {
        return next();
      }

      // Exclude check
      if (service.isExcluded(normalizedPath)) {
        return next();
      }

      // Cache config once per request to avoid repeated deep clones
      const cfg = service.config!;

      // Resolve client IP
      const ip = resolveClientIp(ctx, cfg.cloudflare);

      // IP allowlist check (supports exact IPs and CIDR notation)
      if (isIpInAllowlist(ip, cfg.allowlist.ips)) {
        return next();
      }

      // Resolve limiter for this path (F2: now includes intervalMs)
      const { limiter, limit, intervalMs } = service.resolve(normalizedPath);

      // Consume
      const result = await service.consume(`ip:${ip}`, limiter, limit);

      if (result.res === null) {
        // Storage error — fail open
        return next();
      }

      if (result.allowed) {
        // Set rate limit headers
        ctx.set('X-RateLimit-Limit', String(result.limit));
        ctx.set('X-RateLimit-Remaining', String(result.res.remainingPoints));
        ctx.set(
          'X-RateLimit-Reset',
          String(Math.ceil((Date.now() + result.res.msBeforeNext) / 1000))
        );

        // F2: Use per-rule intervalMs instead of global default interval
        if (service.shouldWarn(`ip:${ip}`, result.res.consumedPoints, result.limit, intervalMs)) {
          strapi.log.warn(
            `${PREFIX} IP ${ip} has consumed ${result.res.consumedPoints}/${result.limit} requests.`
          );
          service.recordEvent({
            type: 'warning',
            clientKey: `ip:${ip}`,
            path: normalizedPath,
            source: 'global',
            consumedPoints: result.res.consumedPoints,
            limit: result.limit,
            msBeforeNext: result.res.msBeforeNext,
          });
        }

        return next();
      }

      // Rate limited — 429
      ctx.status = 429;
      ctx.body = TOO_MANY_REQUESTS_BODY;
      ctx.set('Retry-After', String(Math.round(result.res.msBeforeNext / 1000) || 1));
      ctx.set('X-RateLimit-Limit', String(result.limit));
      ctx.set('X-RateLimit-Remaining', '0');
      ctx.set(
        'X-RateLimit-Reset',
        String(Math.ceil((Date.now() + result.res.msBeforeNext) / 1000))
      );
      service.recordEvent({
        type: 'blocked',
        clientKey: `ip:${ip}`,
        path: normalizedPath,
        source: 'global',
        consumedPoints: result.res.consumedPoints,
        limit: result.limit,
        msBeforeNext: result.res.msBeforeNext,
      });
    } catch (error) {
      strapi.log.error(`${PREFIX} Global middleware error: ${error}`);
      return next();
    }
  };
}
