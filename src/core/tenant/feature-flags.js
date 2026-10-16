import { cacheDel, lerComCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * Feature flags por tenant (`tenant_module_features`): uma linha = feature
 * ligada. Servem pra rollout gradual e kill switch de funcionalidade nova
 * — NÃO pra cobrança: tudo que está atrás de flag faz parte do módulo, e a
 * flag sai do código 1-2 releases depois de estabilizar.
 *
 * A chave da feature é prefixada pelo módulo (`crm.listas`) e vem do
 * catálogo `featureFlags` que cada módulo declara (MODULE_CONTRACT.md §7).
 *
 * Mesmo padrão de `module-access.js` (client admin, `tenant_id` explícito),
 * mas com o cache de `#core/cache` — com Redis, desligar uma flag vale na
 * hora em todas as instâncias, o que é o ponto de um kill switch.
 */

const TTL_CACHE_SEGUNDOS = 30;

/** @param {string} tenantId */
const chaveCache = (tenantId) => `features:${tenantId}`;

/**
 * Chaves das features ligadas do tenant, em ordem alfabética.
 *
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
export function listarFeaturesAtivas(tenantId) {
  return lerComCache(chaveCache(tenantId), TTL_CACHE_SEGUNDOS, async () => {
    const linhas = await getAdminClient().tenantModuleFeature.findMany({
      where: { tenantId },
      select: { featureKey: true },
      orderBy: { featureKey: 'asc' },
    });
    return linhas.map((linha) => linha.featureKey);
  });
}

/**
 * @param {string} tenantId
 * @param {string} featureKey  ex: `crm.listas`
 * @returns {Promise<boolean>}
 */
export async function featureAtiva(tenantId, featureKey) {
  return (await listarFeaturesAtivas(tenantId)).includes(featureKey);
}

/**
 * Chamado sempre que as flags de um tenant mudam (`TenantManagement`).
 *
 * @param {string} tenantId
 */
export function invalidarFeatures(tenantId) {
  return cacheDel(chaveCache(tenantId));
}

/**
 * preHandler pra rota que só existe com a feature ligada. Exige
 * `req.tenantContext` — dentro de um módulo, `#api/app.js` já garante.
 *
 * Pra rota que existe nos dois modos e só muda de comportamento, use
 * `featureAtiva` no service em vez deste hook.
 *
 * @param {string} featureKey
 */
export function exigirFeature(featureKey) {
  /** @param {import('fastify').FastifyRequest} req */
  return async (req) => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId || !(await featureAtiva(tenantId, featureKey))) {
      throw new AppError({
        statusCode: HTTP_STATUS.FORBIDDEN,
        code: ERROR_CODES.FEATURE_NOT_ENABLED,
        message: 'Esta funcionalidade ainda não está disponível para a sua conta',
        details: { featureKey },
      });
    }
  };
}
