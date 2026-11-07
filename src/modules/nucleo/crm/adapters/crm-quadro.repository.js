import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';

/**
 * ADAPTER: o quadro comercial (M3). Cada linha é uma oportunidade com a pessoa
 * dela, lida do CRM a cada consulta: o Kanban não guarda cópia.
 *
 * Diferente da leitura do lead, o comercial aqui é o da própria oportunidade,
 * não o da principal. Os nomes são os mesmos, para o layout e a regra de
 * "esfriando" valerem sem adaptação.
 *
 * @typedef {{ emTexto: string, id: string }} Cursor
 */

const FONTE_CARDS = Prisma.sql`(
  SELECT contato.*,
         negocio.id::text AS deal_id, negocio.updated_at AS deal_atualizada_em,
         negocio.updated_at::text AS deal_cursor,
         negocio.amount AS valor, negocio.status, negocio.status_category,
         negocio.pipeline_id, negocio.title AS deal_titulo,
         negocio.owner_id::text AS deal_dono_id,
         negocio.won_at AS data_conversao,
         negocio.probability_override::numeric AS probabilidade_fechamento,
         negocio.expected_close_date::timestamp AS data_prevista_fechamento,
         negocio.lost_reason AS motivo_perda,
         negocio.source_reopened_at, negocio.archived_at AS deal_arquivada_em,
         negocio.deleted_at AS deal_excluida_em,
         etapa.label AS estagio_nome
  FROM modulo_crm.crm_deal negocio
  JOIN modulo_crm.leads contato
    ON contato.tenant_id = negocio.tenant_id AND contato.id = negocio.lead_id
  LEFT JOIN modulo_crm.crm_option etapa
    ON etapa.tenant_id = negocio.tenant_id AND etapa.pipeline_id = negocio.pipeline_id
    AND etapa.kind = 'status' AND etapa.key = negocio.status
)`;

/** Arquivada, na lixeira ou de pessoa arquivada ou na lixeira sai do quadro (P9). */
const NO_QUADRO = Prisma.sql`
  l.deal_excluida_em IS NULL AND l.deal_arquivada_em IS NULL
  AND l.deleted_at IS NULL AND l.archived_at IS NULL
`;

/**
 * Uma página de uma coluna, da atualização mais recente para a mais antiga
 * (padrão da D2), com cursor por chave. Ordem escolhida e filtros chegam no M4.
 *
 * @param {string} tenantId
 * @param {{ pipelineId: string, status: string, cursor: Cursor | null, limite: number }} consulta
 * @returns {Promise<{ deal_id: string, deal_atualizada_em: Date, deal_cursor: string }[]>}
 */
export function listarCardsDaColuna(tenantId, { pipelineId, status, cursor, limite }) {
  const depoisDe = cursor
    ? Prisma.sql`AND (l.deal_atualizada_em, l.deal_id::uuid) < (${cursor.emTexto}::timestamp, ${cursor.id}::uuid)`
    : Prisma.empty;
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT l.deal_id, l.deal_atualizada_em, l.deal_cursor
      FROM ${FONTE_CARDS} l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.pipeline_id = ${pipelineId}::uuid
        AND l.status = ${status} AND ${NO_QUADRO} ${depoisDe}
      ORDER BY l.deal_atualizada_em DESC, l.deal_id::uuid DESC
      LIMIT ${limite}
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {{ pipelineId: string, status: string }} consulta
 * @returns {Promise<{ total: number, soma: unknown }>}
 */
export function resumirColuna(tenantId, { pipelineId, status }) {
  return getTenantClient(tenantId, async (tx) => {
    const [resumo] = await tx.$queryRaw`
      SELECT count(*)::int AS total, COALESCE(sum(l.valor), 0) AS soma
      FROM ${FONTE_CARDS} l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.pipeline_id = ${pipelineId}::uuid
        AND l.status = ${status} AND ${NO_QUADRO}
    `;
    return resumo;
  });
}

/**
 * Oportunidades pelos ids, sem as dos pipelines ocultos para quem pede.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @param {{ ocultos: string[], inatividade: Date | null }} opcoes
 * @returns {Promise<Record<string, any>[]>}
 */
export function buscarCardsPorIds(tenantId, ids, { ocultos, inatividade }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT l.*, ${colunaEsfriandoDesde(inatividade)}
      FROM ${FONTE_CARDS} l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.deal_id::uuid = ANY(${ids}::uuid[])
        AND l.deal_excluida_em IS NULL AND l.pipeline_id <> ALL(${ocultos}::uuid[])
    `,
  );
}

/**
 * Sem usuário: chamado por job. Oportunidade apagada volta `null`.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<string[]>} as que ainda existem
 */
export async function buscarIdsDeOportunidades(tenantId, ids) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id::text FROM modulo_crm.crm_deal
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
    `,
  );
  return linhas.map((linha) => linha.id);
}
