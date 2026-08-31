import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { registerAuthRoutes } from '#api/routes/auth.routes.js';
import { registerHealthRoutes } from '#api/routes/health.routes.js';
import { registerAdminTenantRoutes } from '#api/routes/admin-tenants.routes.js';
import { registerNotificacoesRoutes } from '#api/routes/notificacoes.routes.js';
import { MODULES } from '#api/modules.js';
import { registerRealtime } from '#core/realtime/socket-server.js';
import { registerJwt } from '#core/auth/plugin.js';
import { encerrarCache } from '#core/cache/cache.js';
import { authenticateHook } from '#core/auth/rbac.js';
import { loadEnv, parseCorsOrigins } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { registrarModulos } from '#core/registry/modules.js';
import { exigirModuloAtivo } from '#core/tenant/module-access.js';
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
  const app = Fastify({
    logger,
    // O watcher deve reiniciar sem ficar preso em conexões HTTP do navegador.
    // Produção preserva o encerramento gracioso de requisições em andamento.
    ...(config.NODE_ENV === 'development' && { forceCloseConnections: true }),
  });

  app.decorate('config', config);
  app.decorateRequest('tenantContext', null);

  app.register(cookie);
  app.register(cors, {
    origin: parseCorsOrigins(config.CORS_ORIGIN),
    credentials: true,
    // @fastify/cors, ao contrário do pacote `cors` genérico, tem default
    // restrito a 'GET,HEAD,POST' — sem isso, todo PUT/DELETE da API (ex:
    // /auth/mfa, /admin/tenants/:id) é barrado no preflight pelo navegador.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  registerJwt(app, config);
  registerErrorHandlers(app);
  await registerRealtime(app);

  const modules = MODULES.map(assertModule);
  assertUniqueModuleKeys(modules);
  // O core (provisionamento, flags, reconcile) lê a lista daqui — não
  // pode importar `#api/modules.js`.
  registrarModulos(modules);

  registerHealthRoutes(app, {
    appName: config.APP_NAME,
    modules: modules.map((module) => module.key),
  });

  registerAuthRoutes(app);
  registerAdminTenantRoutes(app);
  registerNotificacoesRoutes(app);

  for (const module of modules) {
    app.log.info?.({ module: module.key }, `Registrando módulo: ${module.name}`);
    app.register(
      async (moduleScope) => {
        // Autenticação + módulo contratado valem pra TODA rota de módulo,
        // registrados aqui (antes das rotas) pra nenhum módulo depender de
        // lembrar disso (MASTER_DOCUMENT §1.1.2).
        moduleScope.addHook('preHandler', authenticateHook);
        moduleScope.addHook('preHandler', exigirModuloAtivo(module.key));
        await module.registerRoutes(moduleScope);
      },
      { name: `module-${module.key}` },
    );
  }

  app.addHook('onClose', async () => {
    await encerrarCache();
    await disconnectDatabase();
  });
  await app.ready();
  return app;
}

/** @param {import('#core/types/module.js').Module[]} modules */
function assertUniqueModuleKeys(modules) {
  const keys = new Set();
  for (const module of modules) {
    if (keys.has(module.key)) {
      throw new Error(`Módulo duplicado: "${module.key}".`);
    }
    keys.add(module.key);
  }
}
