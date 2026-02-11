import type { Core } from '@strapi/strapi';
import { getRateLimiterService } from '../utils/get-service';
import { maskClientKey } from '../utils/mask-client-key';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getStatus(ctx) {
    const service = getRateLimiterService(strapi);
    ctx.body = { data: service.getStatus() };
  },

  async getEvents(ctx) {
    const service = getRateLimiterService(strapi);
    const result = service.getRecentEvents();
    const cfg = service.config;

    if (cfg?.maskClientIps) {
      result.events = result.events.map((event) => ({
        ...event,
        clientKey: maskClientKey(event.clientKey),
      }));
    }

    ctx.body = { data: result };
  },

  async clearEvents(ctx) {
    const service = getRateLimiterService(strapi);
    service.clearEvents();
    ctx.status = 204;
    ctx.body = null;
  },
});

export default controller;
