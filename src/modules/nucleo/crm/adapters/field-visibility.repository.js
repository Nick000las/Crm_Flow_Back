import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: único lugar deste módulo que chama getTenantClient p/ este
 * recurso. `modulo_crm.tenant_lead_field_visibility` não é `model` do
 * Prisma — SQL cru via `$queryRaw`/`$executeRaw`, tagged template, ver
 * MODULE_CONTRACT.md §4.
 *
 * @typedef {import('../types/index.js').FieldVisibility} FieldVisibility
 */

/**
 * @param {string} tenantId
 * @returns {Promise<FieldVisibility[]>}
 */
export function buscarVisibilidadePorTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT coluna, visivel, ordem, obrigatorio
      FROM modulo_crm.tenant_lead_field_visibility
      WHERE tenant_id = ${tenantId}::uuid
    `,
  );
}

/**
 * Upsert em lote, uma única transação — mesmo racional de
 * `reordenarDefinicoes` em field-definitions.repository.js: evita
 * atualização parcial se um item no meio da lista falhar. `coluna` já
 * chega validada pelo service (contra `CAMADA_2_COLUNAS`) antes daqui.
 *
 * @param {string} tenantId
 * @param {{ coluna: string, visivel: boolean, ordem: number, obrigatorio: boolean }[]} itens
 * @returns {Promise<void>}
 */
export function definirVisibilidade(tenantId, itens) {
  return getTenantClient(tenantId, async (tx) => {
    for (const { coluna, visivel, ordem, obrigatorio } of itens) {
      await tx.$executeRaw`
        INSERT INTO modulo_crm.tenant_lead_field_visibility (tenant_id, coluna, visivel, ordem, obrigatorio)
        VALUES (${tenantId}::uuid, ${coluna}, ${visivel}, ${ordem}, ${obrigatorio})
        ON CONFLICT (tenant_id, coluna)
        DO UPDATE SET visivel = ${visivel}, ordem = ${ordem}, obrigatorio = ${obrigatorio}
      `;
    }
  });
}
