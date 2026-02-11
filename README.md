# strapi-plugin-rate-limit

Production-ready rate limiting for Strapi 5 — IP-based, identity-aware, with optional Redis backing.

![Strapi 5](https://img.shields.io/badge/Strapi-5.x-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- Zero-config — works out of the box with sensible defaults (100 req/min, in-memory)
- Per-route rules with glob pattern matching
- Optional auth-aware middleware (rate limit by API token or user, not just IP)
- Redis support with automatic in-memory fallback (insurance limiter)
- Cloudflare `CF-Connecting-IP` support
- Burst protection mode
- Allowlisting by IP, API token ID, or user ID
- Path exclusion via glob patterns
- Threshold warnings in Strapi logs
- Standard `X-RateLimit-*` response headers
- Admin dashboard showing current status

## Installation

```bash
npm install strapi-plugin-rate-limit
# or
yarn add strapi-plugin-rate-limit
```

Enable the plugin in `./config/plugins.ts`:

```ts
export default ({ env }) => ({
  'strapi-plugin-rate-limit': {
    enabled: true,
  },
});
```

That's it. The global middleware registers automatically and applies to all `/api/*` and `/graphql` routes with default settings (100 requests per minute, in-memory store).

> [!WARNING]
> The default in-memory store is **not shared across server instances**. It is suitable for development and single-process deployments only. For production clusters, configure [Redis](#redis-setup).

## Configuration

All options are optional. Pass them under `config`:

`./config/plugins.ts`

```ts
export default ({ env }) => ({
  'strapi-plugin-rate-limit': {
    enabled: true,
    config: {
      defaults: {
        limit: 100,
        interval: '1m',
        blockDuration: 0,
      },
      redis: {
        url: env('REDIS_URL'),
        tls: true,
      },
      rules: [
        { path: '/api/auth/local', limit: 5, interval: '15m' },
        { path: '/api/upload', limit: 10, interval: '1m' },
      ],
      allowlist: {
        ips: ['127.0.0.1'],
        tokens: [],
        users: [],
      },
      exclude: ['/api/health'],
      cloudflare: false,
      thresholdWarning: 0.8,
    },
  },
});
```

### Configuration Reference

#### `defaults`

| Option          | Type     | Default | Description                                                     |
| --------------- | -------- | ------- | --------------------------------------------------------------- |
| `limit`         | `number` | `100`   | Requests allowed per interval                                   |
| `interval`      | `string` | `'1m'`  | Time window (`'30s'`, `'1m'`, `'1h'`, etc.)                     |
| `blockDuration` | `number` | `0`     | Seconds to block after limit exceeded (0 = no block, max 86400) |

#### `redis`

Leave `redis` unconfigured to use the in-memory store. Provide either `url` **or** `host`/`port` — not both.

| Option     | Type      | Default | Description                                              |
| ---------- | --------- | ------- | -------------------------------------------------------- |
| `url`      | `string`  | —       | Redis connection URL (`redis://` or `rediss://`)         |
| `host`     | `string`  | —       | Redis hostname (alternative to `url`)                    |
| `port`     | `number`  | —       | Redis port (1–65535)                                     |
| `password` | `string`  | —       | Redis password                                           |
| `tls`      | `boolean` | `false` | Enable TLS (required for Upstash and most managed Redis) |

When Redis is configured, the plugin automatically creates an **insurance limiter** — an in-memory fallback that activates if Redis becomes unreachable, so rate limiting keeps working during outages.

#### `rules`

Array of per-route overrides. Each rule requires `path`, `limit`, and `interval`. Paths support glob patterns via [picomatch](https://github.com/micromatch/picomatch).

```ts
rules: [
  { path: '/api/auth/**', limit: 5, interval: '15m' },
  { path: '/api/articles', limit: 50, interval: '1m' },
  { path: '/api/upload', limit: 10, interval: '1m' },
];
```

The first matching rule wins. Unmatched paths fall back to `defaults`.

#### `allowlist`

| Option   | Type       | Default | Description                           |
| -------- | ---------- | ------- | ------------------------------------- |
| `ips`    | `string[]` | `[]`    | IP addresses to bypass rate limiting  |
| `tokens` | `string[]` | `[]`    | API token IDs to bypass rate limiting |
| `users`  | `string[]` | `[]`    | User IDs to bypass rate limiting      |

Token and user allowlisting requires the [route-level middleware](#route-level-middleware).

#### `exclude`

Array of path patterns (glob) to skip entirely. Excluded paths receive no rate limiting and no headers.

```ts
exclude: ['/api/health', '/api/metrics', '/api/webhooks/**'];
```

#### `inMemoryBlock`

Fast local blocking layer for Redis mode. When a client far exceeds the limit, subsequent requests are rejected from memory without hitting Redis.

| Option              | Type      | Default | Description                                         |
| ------------------- | --------- | ------- | --------------------------------------------------- |
| `enabled`           | `boolean` | `true`  | Enable in-memory blocking                           |
| `consumedThreshold` | `number`  | `0`     | Points consumed to trigger block (0 = 2× the limit) |
| `duration`          | `string`  | `'1m'`  | How long the in-memory block lasts                  |

#### Other Options

| Option                 | Type      | Default | Description                                                         |
| ---------------------- | --------- | ------- | ------------------------------------------------------------------- |
| `thresholdWarning`     | `number`  | `0.8`   | Log a warning when usage hits this ratio (0–1, 0 = disabled)        |
| `keyPrefix`            | `string`  | `'rl'`  | Prefix for rate limiter keys (useful when sharing a Redis instance) |
| `cloudflare`           | `boolean` | `false` | Use `CF-Connecting-IP` header for client IP                         |
| `execEvenly`           | `boolean` | `false` | Distribute delay evenly across requests instead of all at once      |
| `execEvenlyMinDelayMs` | `number`  | `0`     | Minimum delay (ms) between requests when `execEvenly` is on         |

#### `burst`

Allows short bursts above the normal limit using a secondary token bucket.

| Option     | Type      | Default | Description                       |
| ---------- | --------- | ------- | --------------------------------- |
| `enabled`  | `boolean` | `false` | Enable burst protection           |
| `points`   | `number`  | `0`     | Extra points for the burst window |
| `duration` | `string`  | `'10s'` | Burst window duration             |

## Route-Level Middleware

The global middleware rate-limits by IP address. If you want **auth-aware** rate limiting (by API token or user ID), add the route-level middleware to specific routes.

Identity resolution priority:

1. **API Token** → `token:{id}`
2. **Authenticated User** → `user:{id}`
3. **IP** (fallback) → skipped (already handled by global middleware)

Add it in your route configuration:

```ts
// src/api/article/routes/article.ts
export default {
  routes: [
    {
      method: 'POST',
      path: '/articles',
      handler: 'article.create',
      config: {
        middlewares: ['plugin::strapi-plugin-rate-limit.rate-limit'],
      },
    },
  ],
};
```

When an authenticated request hits this route, the middleware applies a separate rate limit keyed to the token or user identity. This means a single user can't exhaust the IP-level quota for everyone behind a shared IP.

## Reverse Proxy

If Strapi is behind a reverse proxy (Nginx, Caddy, etc.), enable Koa's proxy trust setting so `ctx.request.ip` resolves correctly:

`./config/server.ts`

```ts
export default ({ env }) => ({
  proxy: {
    koa: true,
  },
});
```

Without this, all requests may appear to come from `127.0.0.1`.

### Cloudflare

If you're behind Cloudflare, enable the `cloudflare` option to read the real client IP from the `CF-Connecting-IP` header:

```ts
config: {
  cloudflare: true,
}
```

## Redis Setup

> [!NOTE]
> Redis is strongly recommended for production. Without it, each server process maintains its own counters, so rate limits won't be enforced correctly behind a load balancer.

### Connection URL

```ts
redis: {
  url: env('REDIS_URL'), // redis://localhost:6379
}
```

### Host / Port

```ts
redis: {
  host: env('REDIS_HOST', 'localhost'),
  port: env.int('REDIS_PORT', 6379),
  password: env('REDIS_PASSWORD'),
}
```

### TLS (Upstash, AWS ElastiCache, etc.)

```ts
redis: {
  url: env('REDIS_URL'), // rediss://...
  tls: true,
}
```

### Insurance Limiter

When Redis is active, an in-memory insurance limiter runs alongside it. If the Redis connection drops, rate limiting continues against the in-memory store until Redis recovers. No configuration needed — this is automatic.

## Response Headers

Every rate-limited response includes standard headers:

| Header                  | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests allowed in the current window  |
| `X-RateLimit-Remaining` | Requests remaining in the current window        |
| `X-RateLimit-Reset`     | Unix timestamp (seconds) when the window resets |

When the limit is exceeded (HTTP 429), the response also includes:

| Header        | Description                     |
| ------------- | ------------------------------- |
| `Retry-After` | Seconds to wait before retrying |

The 429 response body follows the Strapi error format:

```json
{
  "data": null,
  "error": {
    "status": 429,
    "name": "TooManyRequestsError",
    "message": "Too many requests, please try again later.",
    "details": {}
  }
}
```

## Admin Dashboard

The plugin adds a status panel in the Strapi admin under **Plugins → Strapi Rate Limiter**. It shows the current strategy (Memory / Redis), connection status, default limits, number of custom rules, and allowlist counts.

## License

[MIT](LICENSE)
