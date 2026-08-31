import { Prisma } from '@prisma/client';

/**
 * Lead esfriando (M9): a regra mora numa expressão SQL só, usada pela
 * leitura do lead (`esfriando_desde`), pelo filtro "Esfriando" e pelo
 * resumo diário — os três nunca divergem. Nada é gravado no lead: muda o
 * relógio, a configuração ou uma atividade, e a próxima leitura já reflete.
 * Fragmentos puros (sem client), pra `lead-filter.service.js` poder usar.
 *
 * - Dias: `stale_days` da opção de status do lead (NULL = desligado).
 * - Base: a última interação (ou a criação), empurrada pra frente pela
 *   maior data agendada de atividade em aberto — atividade agendada pausa
 *   a contagem até a data dela; vencida e não concluída, conta dali.
 * - Lead arquivado ou na lixeira nunca está esfriando.
 *
 * Espera `l` = `modulo_crm.leads` (ou uma linha com as mesmas colunas).
 */

/** Quando o lead esfria (passado ou futuro); NULL se o status não esfria. */
const ESFRIA_EM = Prisma.sql`(
  SELECT GREATEST(
    COALESCE(l.ultima_interacao_em, l.created_at),
    (
      SELECT max(a.agendada_para) FROM modulo_crm.crm_activity a
      WHERE a.tenant_id = l.tenant_id AND a.lead_id = l.id AND a.concluida_em IS NULL
    )
  ) + make_interval(days => o.stale_days)
  FROM modulo_crm.crm_option o
  WHERE o.tenant_id = l.tenant_id AND o.kind = 'status' AND o.key = l.status
    AND (to_jsonb(o)->>'pipeline_id') IS NOT DISTINCT FROM (to_jsonb(l)->>'pipeline_id')
)`;

const LEAD_NA_LISTA = Prisma.sql`l.archived_at IS NULL AND l.deleted_at IS NULL`;

/**
 * Coluna `esfriando_desde` da leitura do lead. Sem `agora` (flag
 * desligada), a expressão nem entra na query.
 *
 * @param {Date | null} agora
 * @returns {Prisma.Sql}
 */
export function colunaEsfriandoDesde(agora) {
  if (!agora) return Prisma.sql`NULL::timestamp AS esfriando_desde`;
  return Prisma.sql`(
    SELECT e.em FROM (SELECT ${ESFRIA_EM} AS em) e
    WHERE e.em <= ${agora} AND ${LEAD_NA_LISTA}
  ) AS esfriando_desde`;
}

/**
 * @param {Date} agora
 * @returns {Prisma.Sql}
 */
export function condicaoEsfriando(agora) {
  return Prisma.sql`(${LEAD_NA_LISTA} AND ${ESFRIA_EM} <= ${agora})`;
}
