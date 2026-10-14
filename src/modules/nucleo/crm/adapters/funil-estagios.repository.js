import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: leitura de `modulo_crm.funil_estagios`. Usado pelo import pra
 * casar o nome do estágio vindo da planilha e escolher o estágio padrão
 * (primeiro por `order`) quando a coluna não é mapeada.
 */

/**
 * @param {string} tenantId
 * @returns {Promise<{ id: string, nome: string }[]>}
 */
export function buscarEstagiosPorTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, nome
      FROM modulo_crm.funil_estagios
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY "order", created_at
    `,
  );
}
