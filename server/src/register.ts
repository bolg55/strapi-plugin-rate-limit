import type { Core } from '@strapi/strapi';
import createGlobalRateLimit from './middlewares/global-rate-limit';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.server.use(createGlobalRateLimit(strapi));
};

export default register;
