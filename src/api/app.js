import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { registerAuthRoutes } from '#api/routes/auth.routes.js';
import { registerHealthRoutes } from '#api/routes/health.routes.js';
import { registerAdminTenantRoutes } from '#api/routes/admin-tenants.routes.js';
import { MODULES } from '#api/modules.js';
import { registerJwt } from '#core/auth/plugin.js';
import { loadEnv, parseCorsOrigins } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { assertModule } from '#core/types/module.js';

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

  app.register(cookie);
  app.register(cors, {
    origin: parseCorsOrigins(config.CORS_ORIGIN),
    credentials: true,
  });
  registerJwt(app, config);
  registerErrorHandlers(app);

  const modules = MODULES.map(assertModule);
  assertUniqueModuleKeys(modules);

  registerHealthRoutes(app, {
    appName: config.APP_NAME,
    modules: modules.map((module) => module.key),
  });

  registerAuthRoutes(app);
  registerAdminTenantRoutes(app);

  for (const module of modules) {
    app.log.info?.({ module: module.key }, `Registrando módulo: ${module.name}`);
    app.register(
      async (moduleScope) => {
        await module.registerRoutes(moduleScope);
      },
      { name: `module-${module.key}` },
    );
  }

  app.addHook('onClose', async () => disconnectDatabase());
  await app.ready();
  return app;
}

/** @param {import('#core/types/module.js').Module[]} modules */
function assertUniqueModuleKeys(modules) {
  const keys = new Set();
  for (const module of modules) {
    if (keys.has(module.key)) throw new Error(`Módulo duplicado: "${module.key}".`);
    keys.add(module.key);
  }
}
