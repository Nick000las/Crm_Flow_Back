import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: `crm_field_permission` (M13; tabela da 0012). Só as restrições
 * são gravadas — campo sem linha pro papel = `edit`.
 *
 * @typedef {{ field_id: string, role: string, access: string }} PermissaoLinha
 */

/**
 * @param {string} tenantId
 * @returns {Promise<PermissaoLinha[]>}
 */
export function listarPermissoes(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT field_id::text, role, access FROM modulo_crm.crm_field_permission
      WHERE tenant_id = ${tenantId}::uuid
    `,
  );
}

/**
 * Troca todas as restrições de um papel numa transação.
 *
 * @param {string} tenantId
 * @param {string} papel
 * @param {{ campoId: string, acesso: string }[]} restricoes  só `view`/`hidden`
 */
export function substituirPermissoesDoPapel(tenantId, papel, restricoes) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_field_permission
      WHERE tenant_id = ${tenantId}::uuid AND role = ${papel}
    `;
    if (restricoes.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_field_permission (tenant_id, field_id, role, access)
      SELECT ${tenantId}::uuid, r.field_id, ${papel}, r.access
      FROM unnest(
        ${restricoes.map((restricao) => restricao.campoId)}::uuid[],
        ${restricoes.map((restricao) => restricao.acesso)}::varchar[]
      ) AS r(field_id, access)
    `;
  });
}
