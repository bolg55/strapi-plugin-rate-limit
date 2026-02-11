import type { Core } from '@strapi/strapi';

const PREFIX = '[strapi-plugin-rate-limit]';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::strapi-plugin-rate-limit') as any;
  const service = strapi.plugin('strapi-plugin-rate-limit').service('rateLimiter') as any;

  await service.initialize(config);

  // Proxy validation warning
  const proxyKoa = strapi.config.get('server.proxy.koa');
  if (!proxyKoa) {
    strapi.log.warn(
      `${PREFIX} server.proxy.koa is not enabled. If running behind a reverse proxy (Nginx, Cloudflare, etc.), rate limiting may not identify clients correctly. Set server.proxy.koa = true in config/server.ts.`
    );
  }

  // Memory strategy in production warning
  if (service.strategy === 'memory' && process.env.NODE_ENV === 'production') {
    strapi.log.warn(
      `${PREFIX} Using memory strategy in production. Rate limits are per-process — if running multiple workers (PM2, cluster), effective limits are multiplied by worker count. Consider configuring Redis for shared state.`
    );
  }

  // Startup summary
  const { defaults, rulesCount } = service.getStatus();
  strapi.log.info(
    `${PREFIX} Initialized with ${service.strategy} strategy. Default: ${defaults.limit} requests per ${defaults.interval}. ${rulesCount} custom rules.`
  );
};

export default bootstrap;
