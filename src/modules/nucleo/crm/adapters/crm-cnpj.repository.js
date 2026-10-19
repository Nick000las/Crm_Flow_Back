import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: enriquecimento por CNPJ (M11b, migration 0025).
 *
 * `crm_cnpj_cache` é global (sem `tenant_id` nem RLS — dado público da
 * Receita); passa pelo `getTenantClient` do tenant que consultou só porque
 * é por onde o módulo fala com o banco (role `app_tenant`). Nada do
 * tenant é gravado ali.
 */

/**
 * @typedef {{ cnpj: string, status: string, dados: Record<string, unknown>, provedor: string, consultado_em: Date }} CacheCnpj
 * @typedef {{ ativo: boolean, modo: string, sobrescrever: boolean, mapeamento: Record<string, string> }} ConfigCnpjGravada
 */

/**
 * @param {string} tenantId
 * @param {string} cnpj  forma canônica (14 caracteres)
 * @param {Date} validoDesde  consultas mais antigas que isso ficam de fora (TTL)
 * @returns {Promise<CacheCnpj | undefined>}
 */
export function buscarCacheCnpj(tenantId, cnpj, validoDesde) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT cnpj, status, dados, provedor, consultado_em FROM modulo_crm.crm_cnpj_cache
      WHERE cnpj = ${cnpj} AND consultado_em >= ${validoDesde}
    `.then((linhas) => linhas[0]),
  );
}

/**
 * Upsert: consulta nova substitui a antiga (renova o TTL).
 *
 * @param {string} tenantId
 * @param {{ cnpj: string, status: string, dados: Record<string, unknown>, provedor: string }} entrada
 */
export function gravarCacheCnpj(tenantId, { cnpj, status, dados, provedor }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_cnpj_cache (cnpj, status, dados, provedor, consultado_em)
      VALUES (${cnpj}, ${status}, ${JSON.stringify(dados)}::jsonb, ${provedor}, now())
      ON CONFLICT (cnpj)
      DO UPDATE SET status = EXCLUDED.status, dados = EXCLUDED.dados, provedor = EXCLUDED.provedor, consultado_em = now()
    `,
  );
}

/**
 * @param {string} tenantId
 * @returns {Promise<ConfigCnpjGravada | undefined>}
 */
export function buscarConfigCnpj(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ativo, modo, sobrescrever, mapeamento FROM modulo_crm.crm_cnpj_config
      WHERE tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[0]),
  );
}

/**
 * @param {string} tenantId
 * @param {ConfigCnpjGravada} config
 */
export function salvarConfigCnpj(tenantId, { ativo, modo, sobrescrever, mapeamento }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_cnpj_config (tenant_id, ativo, modo, sobrescrever, mapeamento)
      VALUES (${tenantId}::uuid, ${ativo}, ${modo}, ${sobrescrever}, ${JSON.stringify(mapeamento)}::jsonb)
      ON CONFLICT (tenant_id)
      DO UPDATE SET ativo = EXCLUDED.ativo, modo = EXCLUDED.modo, sobrescrever = EXCLUDED.sobrescrever,
        mapeamento = EXCLUDED.mapeamento, updated_at = now()
    `,
  );
}
