import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import {
  CAMPO_PERSONALIZADO_NO_DIFF,
  CAMPO_RESPONSAVEL_NO_DIFF,
  CATEGORIAS_EVENTO,
  TIPOS_CICLO_DE_VIDA,
  TIPOS_EVENTO_LEAD,
  TIPOS_SO_DIFF,
} from '../constants.js';

/**
 * ADAPTER: `crm_lead_event` (M6) — append-only (trigger no banco).
 *
 * @typedef {{ tipo: string, autorId?: string | null, diff?: unknown[], detalhes?: Record<string, unknown> }} NovoEvento
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
    INSERT INTO modulo_crm.crm_lead_event (tenant_id, lead_id, tipo, autor_id, diff, detalhes)
    VALUES (
      ${tenantId}::uuid, ${leadId}::uuid, ${evento.tipo}, ${evento.autorId ?? null}::uuid,
      ${JSON.stringify(evento.diff ?? [])}::jsonb, ${JSON.stringify(evento.detalhes ?? {})}::jsonb
    )
  `;
}

/**
 * Predicado SQL de cada categoria do filtro (M16), sobre `e` = crm_lead_event.
 * Só das constantes — nunca texto do cliente.
 */
const PREDICADO_DA_CATEGORIA = Object.freeze({
  [CATEGORIAS_EVENTO.CAMPOS]: Prisma.sql`e.tipo = ${TIPOS_EVENTO_LEAD.ATUALIZADO}`,
  [CATEGORIAS_EVENTO.ATRIBUICAO]: Prisma.sql`(
    EXISTS (SELECT 1 FROM jsonb_array_elements(e.diff) AS d(item) WHERE d.item->>'campo' = ${CAMPO_RESPONSAVEL_NO_DIFF})
    OR e.detalhes->'distribuicao' IS NOT NULL
  )`,
  [CATEGORIAS_EVENTO.MESCLAGEM]: Prisma.sql`e.tipo = ${TIPOS_EVENTO_LEAD.MESCLADO}`,
  [CATEGORIAS_EVENTO.ENRIQUECIMENTO]: Prisma.sql`e.tipo = ${TIPOS_EVENTO_LEAD.ENRIQUECIDO}`,
  [CATEGORIAS_EVENTO.CICLO]: Prisma.sql`e.tipo = ANY(${[...TIPOS_CICLO_DE_VIDA]}::text[])`,
});

/**
 * Mais novo primeiro, com o nome do autor (usuário removido = `autor_id` nulo).
 *
 * `visiveis` (M16): o que o papel de quem lê enxerga — evento só de diff
 * (`TIPOS_SO_DIFF`) sem nenhuma entrada visível fica de fora, no total
 * também. `categorias`: só os eventos de alguma delas (vazio = todos).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{
 *   limite: number, offset: number, categorias?: string[],
 *   visiveis?: { chaves: string[], campoIds: string[] },
 * }} opcoes
 */
export function listarEventosDoLead(tenantId, leadId, { limite, offset, categorias = [], visiveis }) {
  const condicoes = [Prisma.sql`e.tenant_id = ${tenantId}::uuid AND e.lead_id = ${leadId}::uuid`];
  if (visiveis) {
    condicoes.push(Prisma.sql`(
      e.tipo <> ALL(${[...TIPOS_SO_DIFF]}::text[])
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(e.diff) AS d(item)
        WHERE d.item->>'campo' = ANY(${visiveis.chaves}::text[])
          OR (d.item->>'campo' = ${CAMPO_PERSONALIZADO_NO_DIFF} AND d.item->>'campoId' = ANY(${visiveis.campoIds}::text[]))
      )
    )`);
  }
  const predicados = categorias.map((categoria) => PREDICADO_DA_CATEGORIA[categoria]).filter(Boolean);
  if (predicados.length > 0) condicoes.push(Prisma.sql`(${Prisma.join(predicados, ' OR ')})`);
  const where = Prisma.join(condicoes, ' AND ');

  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT count(*)::int AS total
      FROM modulo_crm.crm_lead_event e
      WHERE ${where}
    `;
    const itens = await tx.$queryRaw`
      SELECT e.id, e.tipo, e.autor_id, u.nome AS autor_nome, e.diff, e.detalhes, e.created_at
      FROM modulo_crm.crm_lead_event e
      LEFT JOIN usuarios u ON u.id = e.autor_id
      WHERE ${where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
    return { itens, total: contagem.total };
  });
}
