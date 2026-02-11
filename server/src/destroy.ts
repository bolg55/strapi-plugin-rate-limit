import type { Core } from '@strapi/strapi';

const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = strapi.plugin('strapi-plugin-rate-limit').service('rateLimiter') as any;
  service.disconnect();
};

export default destroy;
