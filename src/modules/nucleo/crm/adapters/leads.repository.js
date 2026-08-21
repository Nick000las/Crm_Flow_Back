import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: único lugar deste módulo que chama getTenantClient.
 * @typedef {import('../types/index.js').Lead} Lead
 * @typedef {import('../types/index.js').CriarLeadInput} CriarLeadInput
 */

/**
 * @param {string} tenantId
 * @returns {Promise<Lead[]>}
 */
export function buscarLeadsPorTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT l.id, l.nome, l.telefone, l.valor, f.nome AS estagio_nome
      FROM modulo_crm.leads l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
      WHERE l.tenant_id = ${tenantId}::uuid
      ORDER BY f."order", l.created_at DESC
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {CriarLeadInput} dados
 * @returns {Promise<{ id: string }>}
 */
export function criarLead(tenantId, dados) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.leads (tenant_id, nome, telefone, funil_estagio_id)
      VALUES (${tenantId}::uuid, ${dados.nome}, ${dados.telefone}, ${dados.funilEstagioId}::uuid)
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}
