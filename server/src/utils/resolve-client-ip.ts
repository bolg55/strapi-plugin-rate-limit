import type { Context } from 'koa';

export function resolveClientIp(ctx: Context, cloudflare: boolean): string {
  if (cloudflare) {
    const cfIp = ctx.get('CF-Connecting-IP');
    if (cfIp) {
      return cfIp;
    }
  }
  return ctx.request.ip;
}
