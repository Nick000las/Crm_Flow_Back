import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
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
import { AppError } from '#core/errors/app-error.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { assertProvedoresValidos } from '#core/quadros/registro.js';
import { registrarModulos } from '#core/registry/modules.js';
import { exigirModuloAtivo } from '#core/tenant/module-access.js';
import { assertModule } from '#core/types/module.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/** Prefixo das rotas sem login (`Module.registerPublicRoutes`). */
export const PREFIXO_PUBLICO = '/public';

/** Limite por IP em todo `/public`; cada rota pode somar o seu (ex.: por link). */
const MAX_PUBLICO_POR_IP = 120;
export const LIMITE_PUBLICO = Object.freeze({ POR_IP: MAX_PUBLICO_POR_IP, JANELA: '1 minute' });

const REDIS_TIMEOUT_MS = 2000;

/**
 * Application factory: não abre portas e pode ser usada em testes com inject().
 *
 * @param {{ config?: ReturnType<typeof loadEnv>, logger?: boolean | object }} [options]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(options = {}) {
  const config = options.config ?? loadEnv();
  const logger = comUrlSegura(options.logger ?? false);
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
  assertProvedoresValidos(modules);
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

  await registrarRotasPublicas(app, modules, config);

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

/**
 * Rotas sem login dos módulos (`registerPublicRoutes`), sob `/public`, num
 * escopo próprio: sem `authenticateHook` nem `exigirModuloAtivo` (a rota
 * descobre o tenant e confere módulo e flag). Tudo aqui tem limite por IP e
 * resposta que não fica em cache, não vai para buscador e não manda o
 * endereço para outro site.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {import('#core/types/module.js').Module[]} modules
 * @param {ReturnType<typeof loadEnv>} config
 */
async function registrarRotasPublicas(app, modules, config) {
  const comRotas = modules.filter((module) => module.registerPublicRoutes);
  if (comRotas.length === 0) return;

  await app.register(
    async (publico) => {
      const redis = config.REDIS_URL
        ? new Redis(config.REDIS_URL, {
            enableOfflineQueue: false,
            connectTimeout: REDIS_TIMEOUT_MS,
            maxRetriesPerRequest: 1,
          })
        : null;
      // Sem listener, erro de conexão do ioredis derruba o processo.
      redis?.on('error', (erro) => publico.log.warn({ err: erro }, 'Limite público sem Redis'));
      if (redis) publico.addHook('onClose', async () => redis.disconnect());

      await publico.register(rateLimit, {
        global: true,
        max: LIMITE_PUBLICO.POR_IP,
        timeWindow: LIMITE_PUBLICO.JANELA,
        nameSpace: 'limite-publico-',
        ...(redis ? { redis } : {}),
        // Redis fora do ar não derruba a página: o limite volta quando ele volta.
        skipOnError: true,
        errorResponseBuilder: (_request, contexto) =>
          new AppError({
            statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
            code: ERROR_CODES.RATE_LIMITED,
            message: `Muitas tentativas. Tente de novo em ${contexto.after}.`,
          }),
      });

      publico.addHook('onSend', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('X-Robots-Tag', 'noindex, nofollow');
      });

      for (const module of comRotas) {
        await /** @type {NonNullable<typeof module.registerPublicRoutes>} */ (
          module.registerPublicRoutes
        )(publico);
      }
    },
    { prefix: PREFIXO_PUBLICO },
  );
}

/**
 * O caminho de uma rota pública carrega segredo (o token do link): o log
 * guarda só `/public/<recurso>` e troca o resto por `[oculto]`.
 *
 * @param {string} url
 * @returns {string}
 */
export function urlParaLog(url) {
  const [caminho] = url.split('?');
  if (!caminho.startsWith(`${PREFIXO_PUBLICO}/`)) return url;
  const [, , recurso, ...resto] = caminho.split('/');
  return resto.length > 0 ? `${PREFIXO_PUBLICO}/${recurso}/[oculto]` : caminho;
}

/**
 * Liga o serializador de requisição que não grava segredo da URL.
 *
 * @param {boolean | object} logger
 * @returns {boolean | object}
 */
function comUrlSegura(logger) {
  if (!logger) return logger;
  const base = logger === true ? {} : /** @type {object} */ (logger);
  return {
    ...base,
    serializers: {
      .../** @type {{ serializers?: object }} */ (base).serializers,
      req: (request) => ({
        method: request.method,
        url: urlParaLog(request.url),
        host: request.host,
        remoteAddress: request.ip,
      }),
    },
  };
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
