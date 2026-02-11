import type { Context } from 'koa';
import { resolveClientIp } from './resolve-client-ip';

export function resolveClientKey(ctx: Context, cloudflare: boolean): string {
  const auth = (ctx.state as any)?.auth;

  if (auth?.strategy?.name === 'api-token' && auth?.credentials?.id) {
    return `token:${String(auth.credentials.id)}`;
  }

  if (auth?.strategy?.name === 'users-permissions' && (ctx.state as any)?.user?.id) {
    return `user:${String((ctx.state as any).user.id)}`;
  }

  return `ip:${resolveClientIp(ctx, cloudflare)}`;
}
