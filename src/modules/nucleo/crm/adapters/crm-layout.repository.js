import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: layout do lead (`crm_layout_config` e `crm_user_layout_override`,
 * migration 0017 — docs/crm/plano-configuracoes.md M4). O formato do JSON é
 * responsabilidade de `layout.service.js`; aqui só se lê e grava.
 *
 * @typedef {import('../services/layout.service.js').LayoutRefs} LayoutRefs
 */

/**
 * @param {string} tenantId
 * @returns {Promise<LayoutRefs | undefined>} `undefined` = nunca configurado
 */
export function buscarLayoutPadrao(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT layout FROM modulo_crm.crm_layout_config WHERE tenant_id = ${tenantId}::uuid
    `.then((rows) => rows[FIRST_RESULT_INDEX]?.layout),
  );
}

/**
 * @param {string} tenantId
 * @param {LayoutRefs} layout
 */
export function salvarLayoutPadrao(tenantId, layout) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_layout_config (tenant_id, layout)
      VALUES (${tenantId}::uuid, ${JSON.stringify(layout)}::jsonb)
      ON CONFLICT (tenant_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<{ layout: Partial<LayoutRefs>, padraoVisto: Record<string, string[]> } | undefined>}
 */
export function buscarOverride(tenantId, usuarioId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT layout, padrao_visto AS "padraoVisto"
      FROM modulo_crm.crm_user_layout_override
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {Partial<LayoutRefs>} layout
 * @param {Record<string, string[]>} padraoVisto
 */
export function salvarOverride(tenantId, usuarioId, layout, padraoVisto) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_user_layout_override (tenant_id, usuario_id, layout, padrao_visto)
      VALUES (${tenantId}::uuid, ${usuarioId}::uuid, ${JSON.stringify(layout)}::jsonb, ${JSON.stringify(padraoVisto)}::jsonb)
      ON CONFLICT (tenant_id, usuario_id)
      DO UPDATE SET layout = EXCLUDED.layout, padrao_visto = EXCLUDED.padrao_visto, updated_at = now()
    `,
  );
}

/**
 * "Voltar ao padrão".
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 */
export function excluirOverride(tenantId, usuarioId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      DELETE FROM modulo_crm.crm_user_layout_override
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
    `,
  );
}
