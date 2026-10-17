import { cacheDel, lerComCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * Validação de módulo contratado (MASTER_DOCUMENT §1.1.2): o backend
 * confere `tenant_modules` antes de aceitar qualquer requisição das rotas
 * de um módulo — esconder o menu no frontend não basta.
 *
 * Aplicado genericamente por `#api/app.js` a todo módulo de `MODULES`, pra
 * nenhum módulo depender de lembrar de registrar a checagem.
 *
 * Usa o client admin (mesmo padrão de `management.js`): é infraestrutura
 * do core, com `tenant_id` explícito no WHERE, rodando antes de qualquer
 * acesso a dado de negócio.
 */

const TTL_CACHE_SEGUNDOS = 30;

/** @param {string} tenantId */
const chaveCache = (tenantId) => `modulos:${tenantId}`;

/**
 * Módulos contratados e ativos do tenant (`module_key` sem `disabled_at`),
 * em ordem alfabética — o que o frontend usa pra esconder do menu o que não
 * foi contratado e o que `exigirModuloAtivo` confere a cada requisição.
 *
 * Mesmo cache das feature flags (`#core/cache`): com Redis, desligar um
 * módulo vale na hora em todas as instâncias.
 *
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
export function listarModulosAtivos(tenantId) {
  return lerComCache(chaveCache(tenantId), TTL_CACHE_SEGUNDOS, async () => {
    const modulos = await getAdminClient().tenantModule.findMany({
      where: { tenantId, disabledAt: null },
      select: { moduleKey: true },
      orderBy: { moduleKey: 'asc' },
    });
    return modulos.map((modulo) => modulo.moduleKey);
  });
}

/**
 * Todo tenant que já contratou o módulo, ativo ou não — pra job de
 * manutenção que precisa rodar mesmo depois do cancelamento (ex.: a purga
 * da lixeira do CRM, que é prazo de retenção). Sem cache: roda em worker.
 *
 * @param {string} moduleKey
 * @returns {Promise<string[]>}
 */
export async function listarTenantsDoModulo(moduleKey) {
  const linhas = await getAdminClient().tenantModule.findMany({
    where: { moduleKey },
    select: { tenantId: true },
    orderBy: { tenantId: 'asc' },
  });
  return linhas.map((linha) => linha.tenantId);
}

/**
 * @param {string} tenantId
 * @param {string} moduleKey
 * @returns {Promise<boolean>}
 */
export async function moduloAtivo(tenantId, moduleKey) {
  return (await listarModulosAtivos(tenantId)).includes(moduleKey);
}

/**
 * Chamado sempre que os módulos de um tenant mudam (`TenantManagement`).
 *
 * @param {string} tenantId
 */
export function invalidarAcessoModulo(tenantId) {
  return cacheDel(chaveCache(tenantId));
}

/**
 * preHandler: exige `req.tenantContext` (registrar depois de
 * `authenticateHook`) e o módulo ativo pro tenant do token.
 *
 * @param {string} moduleKey
 */
export function exigirModuloAtivo(moduleKey) {
  /** @param {import('fastify').FastifyRequest} req */
  return async (req) => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId || !(await moduloAtivo(tenantId, moduleKey))) {
      throw new AppError({
        statusCode: HTTP_STATUS.FORBIDDEN,
        code: ERROR_CODES.MODULE_NOT_ENABLED,
        message: 'Este módulo não está contratado para a sua conta',
        details: { moduleKey },
      });
    }
  };
}
