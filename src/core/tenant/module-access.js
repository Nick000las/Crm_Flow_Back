import { getAdminClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS, TIME_UNITS } from '#shared/constants/index.js';
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

const SEGUNDOS_CACHE = 30;
const TTL_CACHE_MS = SEGUNDOS_CACHE * TIME_UNITS.MILLISECONDS_PER_SECOND;

/**
 * Cache por processo — evita uma query extra em toda requisição. Com mais
 * de uma instância, a invalidação explícita só vale pra própria instância;
 * as demais convergem em no máximo `TTL_CACHE_MS`.
 *
 * @type {Map<string, { ativo: boolean, expiraEm: number }>}
 */
const cache = new Map();

/**
 * @param {string} tenantId
 * @param {string} moduleKey
 * @returns {Promise<boolean>}
 */
export async function moduloAtivo(tenantId, moduleKey) {
  const chave = `${tenantId}:${moduleKey}`;
  const emCache = cache.get(chave);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.ativo;

  const contratado = await getAdminClient().tenantModule.findFirst({
    where: { tenantId, moduleKey, disabledAt: null },
    select: { id: true },
  });
  const ativo = Boolean(contratado);
  cache.set(chave, { ativo, expiraEm: Date.now() + TTL_CACHE_MS });
  return ativo;
}

/**
 * Módulos contratados e ativos do tenant (`module_key` sem `disabled_at`)
 * — o que o frontend usa pra esconder do menu o que não foi contratado.
 * Sem cache: é chamado uma vez por login (`/auth/me`), não por requisição.
 *
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
export async function listarModulosAtivos(tenantId) {
  const modulos = await getAdminClient().tenantModule.findMany({
    where: { tenantId, disabledAt: null },
    select: { moduleKey: true },
    orderBy: { moduleKey: 'asc' },
  });
  return modulos.map((modulo) => modulo.moduleKey);
}

/**
 * Chamado sempre que os módulos de um tenant mudam (`TenantManagement`),
 * pra mudança valer na hora nesta instância.
 *
 * @param {string} tenantId
 */
export function invalidarAcessoModulo(tenantId) {
  for (const chave of cache.keys()) {
    if (chave.startsWith(`${tenantId}:`)) cache.delete(chave);
  }
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
