import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getStatus(ctx) {
    const service = strapi.plugin('strapi-plugin-rate-limit').service('rateLimiter') as any;
    ctx.body = { data: service.getStatus() };
  },
});

export default controller;
