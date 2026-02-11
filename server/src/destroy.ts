import type { Core } from '@strapi/strapi';
import { getRateLimiterService } from './utils/get-service';

const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = getRateLimiterService(strapi);
  service.disconnect();
};

export default destroy;
