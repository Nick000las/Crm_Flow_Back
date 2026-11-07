import { getAdminClient } from '#core/db/tenantClient.js';
import { DESPACHO_DE_EVENTOS, ENTIDADE_DO_EVENTO_DA_PESSOA } from '../constants.js';

/**
 * ADAPTER: outbox `modulo_crm.crm_event` (migration 0037). A escrita é sempre
 * dentro da transação de quem mudou o dado: evento e mudança entram juntos ou
 * nenhum dos dois. Por isso recebe `tx`, nunca abre conexão própria. O despacho
 * lê todos os tenants, sem usuário: por isso usa o cliente administrativo.
 *
 * O payload leva só ids e chaves de status, nunca dado pessoal.
 *
 * @typedef {{ tipo: string, entidade: string, entidadeId: string, payload: Record<string, unknown> }} EventoCrm
 */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {EventoCrm} evento
 */
export function publicarEvento(tx, tenantId, { tipo, entidade, entidadeId, payload }) {
  return tx.$executeRaw`
    INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload)
    VALUES (
      ${tenantId}::uuid, ${tipo}, ${entidade}, ${entidadeId}::uuid,
      ${JSON.stringify(payload)}::jsonb
    )
  `;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} tipo
 */
export function publicarEventoDaPessoa(tx, tenantId, leadId, tipo) {
  return publicarEvento(tx, tenantId, {
    tipo,
    entidade: ENTIDADE_DO_EVENTO_DA_PESSOA,
    entidadeId: leadId,
    payload: {},
  });
}

/**
 * Reserva eventos pendentes. `SKIP LOCKED` deixa várias instâncias drenarem sem
 * pegar o mesmo evento.
 *
 * @param {number} limite
 * @returns {Promise<{ id: string, tenant_id: string, entidade: string, entidade_id: string, payload: Record<string, any>, recente: boolean }[]>}
 */
export function reservarEventos(limite) {
  const { RESERVA_SEGUNDOS, MAX_TENTATIVAS, VALIDADE_SEGUNDOS } = DESPACHO_DE_EVENTOS;
  return getAdminClient().$queryRaw`
    WITH proximos AS (
      SELECT id FROM modulo_crm.crm_event
      WHERE processed_at IS NULL AND attempts < ${MAX_TENTATIVAS}
        AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      ORDER BY occurred_at
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE modulo_crm.crm_event e
    SET locked_until = CURRENT_TIMESTAMP + make_interval(secs => ${RESERVA_SEGUNDOS}),
        attempts = e.attempts + 1
    FROM proximos
    WHERE e.id = proximos.id
    RETURNING e.id::text, e.tenant_id::text, e.entidade, e.entidade_id::text, e.payload,
      e.occurred_at > CURRENT_TIMESTAMP - make_interval(secs => ${VALIDADE_SEGUNDOS}) AS recente
  `;
}

/** @param {string[]} ids */
export function confirmarEventos(ids) {
  return getAdminClient().$executeRaw`
    UPDATE modulo_crm.crm_event
    SET processed_at = CURRENT_TIMESTAMP, locked_until = NULL
    WHERE id = ANY(${ids}::uuid[])
  `;
}

/**
 * Oportunidades de cada pessoa, para o evento dela chegar aos cards.
 *
 * @param {string[]} leadIds
 * @returns {Promise<{ id: string, tenant_id: string, pipeline_id: string }[]>}
 */
export function buscarOportunidadesParaEventos(leadIds) {
  return getAdminClient().$queryRaw`
    SELECT id::text, tenant_id::text, pipeline_id::text FROM modulo_crm.crm_deal
    WHERE lead_id = ANY(${leadIds}::uuid[]) AND deleted_at IS NULL
  `;
}
