import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAuthRoutes } from '#api/routes/auth.js';
import { registerJwt } from '#core/auth/plugin.js';
import { loadEnv, parseCorsOrigins } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';

/**
 * Application factory: não abre portas e pode ser usada em testes com inject().
 *
 * @param {{ config?: ReturnType<typeof loadEnv>, logger?: boolean | object }} [options]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(options = {}) {
  const config = options.config ?? loadEnv();
  const logger = options.logger ?? false;
  const app = Fastify({ logger });

  app.decorate('config', config);
  app.decorateRequest('tenantContext', null);

  app.register(cors, { origin: parseCorsOrigins(config.CORS_ORIGIN) });
  registerJwt(app, config);
  registerErrorHandlers(app);

  registerAuthRoutes(app);

  app.addHook('onClose', async () => disconnectDatabase());
  await app.ready();
  return app;
}
