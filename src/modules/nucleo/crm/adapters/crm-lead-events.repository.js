import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: `crm_lead_event` (M6) — append-only (trigger no banco).
 *
 * @typedef {{ tipo: string, autorId?: string | null, diff?: unknown[] }} NovoEvento
 */

/**
 * Grava o evento na transação de quem mudou o lead (`leads.repository.js`),
 * pra mudança e histórico entrarem juntos ou nenhum dos dois.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {NovoEvento} evento
 */
export function inserirEvento(tx, tenantId, leadId, evento) {
  return tx.$executeRaw`
    INSERT INTO modulo_crm.crm_lead_event (tenant_id, lead_id, tipo, autor_id, diff)
    VALUES (
      ${tenantId}::uuid, ${leadId}::uuid, ${evento.tipo}, ${evento.autorId ?? null}::uuid,
      ${JSON.stringify(evento.diff ?? [])}::jsonb
    )
  `;
}

/**
 * Mais novo primeiro, com o nome do autor (usuário removido = `autor_id` nulo).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ limite: number, offset: number }} paginacao
 */
export function listarEventosDoLead(tenantId, leadId, { limite, offset }) {
  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT count(*)::int AS total
      FROM modulo_crm.crm_lead_event
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
    `;
    const itens = await tx.$queryRaw`
      SELECT e.id, e.tipo, e.autor_id, u.nome AS autor_nome, e.diff, e.created_at
      FROM modulo_crm.crm_lead_event e
      LEFT JOIN usuarios u ON u.id = e.autor_id
      WHERE e.tenant_id = ${tenantId}::uuid AND e.lead_id = ${leadId}::uuid
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
    return { itens, total: contagem.total };
  });
}
