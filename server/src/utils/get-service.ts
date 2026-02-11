import type { Core } from '@strapi/strapi';
import type { RateLimiterService } from '../types';

export function getRateLimiterService(strapi: Core.Strapi): RateLimiterService {
  return strapi.plugin('strapi-plugin-rate-limit').service('rateLimiter') as RateLimiterService;
}
