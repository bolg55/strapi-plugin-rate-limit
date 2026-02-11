import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { resolveClientKey } from '../utils/resolve-client-key';
import { TOO_MANY_REQUESTS_BODY } from '../utils/constants';
import { getRateLimiterService } from '../utils/get-service';

const PREFIX = '[strapi-plugin-rate-limit]';

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  return async (ctx: Context, next: Next): Promise<void> => {
    try {
      // Get service
      const service = getRateLimiterService(strapi);

      // Enabled check
      if (!service.enabled) {
        return next();
      }

      // Cache config once per request to avoid repeated deep clones
      const cfg = service.config!;

      // Resolve client key (three-tier identity)
      const clientKey = resolveClientKey(ctx, cfg.cloudflare);

      // If key starts with ip: — skip (global MW already handled IP-based limiting)
      if (clientKey.startsWith('ip:')) {
        return next();
      }

      // Token/User allowlist check
      if (service.isAllowlisted(clientKey, cfg)) {
        return next();
      }

      // Normalize path
      const normalizedPath =
        ctx.path.endsWith('/') && ctx.path.length > 1 ? ctx.path.slice(0, -1) : ctx.path;

      // Resolve limiter for this path (F2: now includes intervalMs)
      const { limiter, limit, intervalMs } = service.resolve(normalizedPath);

      // Consume with identity-based key
      const result = await service.consume(clientKey, limiter, limit);

      if (result.res === null) {
        // Storage error — fail open, do NOT override global MW headers
        return next();
      }

      if (result.allowed) {
        // Override X-RateLimit-* headers with identity-based values
        ctx.set('X-RateLimit-Limit', String(result.limit));
        ctx.set('X-RateLimit-Remaining', String(result.res.remainingPoints));
        ctx.set(
          'X-RateLimit-Reset',
          String(Math.ceil((Date.now() + result.res.msBeforeNext) / 1000))
        );

        // F2: Use per-rule intervalMs instead of global default interval
        if (service.shouldWarn(clientKey, result.res.consumedPoints, result.limit, intervalMs)) {
          strapi.log.warn(
            `${PREFIX} ${clientKey} has consumed ${result.res.consumedPoints}/${result.limit} requests.`
          );
          service.recordEvent({
            type: 'warning',
            clientKey,
            path: normalizedPath,
            source: 'route',
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
        clientKey,
        path: normalizedPath,
        source: 'route',
        consumedPoints: result.res.consumedPoints,
        limit: result.limit,
        msBeforeNext: result.res.msBeforeNext,
      });
    } catch (error) {
      strapi.log.error(`${PREFIX} Route middleware error: ${error}`);
      return next();
    }
  };
};
