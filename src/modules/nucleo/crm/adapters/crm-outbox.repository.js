/**
 * ADAPTER: outbox `modulo_crm.crm_event` (migration 0037). Sempre dentro da
 * transação de quem mudou o dado: evento e mudança entram juntos ou nenhum dos
 * dois. Por isso recebe `tx`, nunca abre conexão própria.
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
