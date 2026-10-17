import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: `crm_field_rule` (M8; tabela da 0012, completada na 0022).
 *
 * @typedef {{
 *   id: string, field_id: string, kind: string, condition: Record<string, any>,
 *   effect: Record<string, any>, position: number, is_active: boolean, system_key: string | null,
 * }} RegraLinha
 */

/**
 * @param {string} tenantId
 * @returns {Promise<RegraLinha[]>}
 */
export function buscarRegrasDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, field_id, kind, condition, effect, position, is_active, system_key
      FROM modulo_crm.crm_field_rule
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY position, created_at
    `,
  );
}

/**
 * Regras do sistema (`REGRAS_DO_SISTEMA`) que faltam no tenant — alvo pelo
 * `system_key` do campo. Idempotente; campo do sistema ausente = não semeia.
 *
 * @param {string} tenantId
 * @param {{ systemKey: string, campoSystemKey: string, kind: string, condicao: object, efeito: object }[]} regras
 * @returns {Promise<number>} quantas foram criadas
 */
export function semearRegrasDoSistema(tenantId, regras) {
  return getTenantClient(tenantId, async (tx) => {
    let criadas = 0;
    for (const regra of regras) {
      criadas += await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_field_rule (tenant_id, field_id, kind, condition, effect, system_key)
        SELECT ${tenantId}::uuid, f.id, ${regra.kind}, ${JSON.stringify(regra.condicao)}::jsonb,
               ${JSON.stringify(regra.efeito)}::jsonb, ${regra.systemKey}
        FROM modulo_crm.crm_field f
        WHERE f.tenant_id = ${tenantId}::uuid AND f.system_key = ${regra.campoSystemKey}
        ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING
      `;
    }
    return criadas;
  });
}

/**
 * @param {string} tenantId
 * @param {{ campoId: string, kind: string, condicao: object, efeito: object, ativo: boolean }} regra
 * @returns {Promise<RegraLinha>}
 */
export function inserirRegra(tenantId, regra) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.crm_field_rule (tenant_id, field_id, kind, condition, effect, is_active, position)
      VALUES (
        ${tenantId}::uuid, ${regra.campoId}::uuid, ${regra.kind}, ${JSON.stringify(regra.condicao)}::jsonb,
        ${JSON.stringify(regra.efeito)}::jsonb, ${regra.ativo},
        (SELECT COALESCE(max(position), -1) + 1 FROM modulo_crm.crm_field_rule WHERE tenant_id = ${tenantId}::uuid)
      )
      RETURNING id, field_id, kind, condition, effect, position, is_active, system_key
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Substitui o conteúdo da regra (o service já mesclou com o atual).
 *
 * @param {string} tenantId
 * @param {string} regraId
 * @param {{ campoId: string, condicao: object, efeito: object, ativo: boolean }} regra
 * @returns {Promise<RegraLinha | undefined>}
 */
export function atualizarRegra(tenantId, regraId, regra) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.crm_field_rule
      SET field_id = ${regra.campoId}::uuid, condition = ${JSON.stringify(regra.condicao)}::jsonb,
          effect = ${JSON.stringify(regra.efeito)}::jsonb, is_active = ${regra.ativo}, updated_at = now()
      WHERE id = ${regraId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING id, field_id, kind, condition, effect, position, is_active, system_key
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} regraId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function excluirRegra(tenantId, regraId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      DELETE FROM modulo_crm.crm_field_rule
      WHERE id = ${regraId}::uuid AND tenant_id = ${tenantId}::uuid AND system_key IS NULL
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}
