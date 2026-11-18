/**
 * @file ADAPTER: o quadro comercial (M3).
 */
import { Prisma } from '@prisma/client';

import { getTenantClient } from '#core/db/tenantClient.js';

import { DIRECOES_DE_ORDEM } from '../constants.js';
import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';

/**
 * ADAPTER: o quadro comercial (M3). Cada linha é uma oportunidade com a pessoa
 * dela, lida do CRM a cada consulta: o Kanban não guarda cópia.
 *
 * Diferente da leitura do lead, o comercial aqui é o da própria oportunidade,
 * não o da principal. Os nomes são os mesmos, para o layout e a regra de
 * "esfriando" valerem sem adaptação.
 *
 * @typedef {{ valor: string | null, id: string }} Cursor
 * @typedef {{ coluna: string, tipo: string, direcao: string }} Ordem  `coluna` e `tipo` vêm de
 *   `ORDENS_DO_QUADRO`, nunca do cliente
 */

/** O filtro por responsável olha o da oportunidade, que é o que o card mostra (P13). */
export const RESPONSAVEL_DO_CARD = Prisma.raw('l.deal_dono_id');

const FONTE_CARDS = Prisma.sql`(
  SELECT contato.*,
         negocio.id AS deal_id, negocio.updated_at AS deal_atualizada_em,
         negocio.created_at AS deal_criada_em,
         negocio.amount AS valor, negocio.status, negocio.status_category,
         negocio.pipeline_id, negocio.title AS deal_titulo,
         negocio.owner_id AS deal_dono_id,
         negocio.won_at AS data_conversao,
         negocio.probability_override::numeric AS probabilidade_fechamento,
         negocio.expected_close_date::timestamp AS data_prevista_fechamento,
         negocio.lost_reason AS motivo_perda,
         negocio.source_reopened_at, negocio.archived_at AS deal_arquivada_em,
         negocio.deleted_at AS deal_excluida_em,
         etapa.id AS funil_estagio_id, etapa.label AS estagio_nome
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

/** @param {{ tenantId: string, pipelineId: string, status: string, condicoes: Prisma.Sql[] }} coluna */
function daColuna({ tenantId, pipelineId, status, condicoes }) {
  return Prisma.join(
    [
      Prisma.sql`l.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`l.pipeline_id = ${pipelineId}::uuid`,
      Prisma.sql`l.status = ${status}`,
      NO_QUADRO,
      ...condicoes,
    ],
    ' AND ',
  );
}

/**
 * Tudo que vem depois do cursor. Vazio fica por último nas duas direções, por
 * isso não dá para comparar a linha inteira de uma vez.
 *
 * @param {Ordem} ordem
 * @param {Cursor | null} cursor
 * @returns {Prisma.Sql}
 */
function depoisDoCursor({ coluna, tipo, direcao }, cursor) {
  if (!cursor) {
    return Prisma.empty;
  }

  const expressao = Prisma.raw(coluna);
  const maior = Prisma.raw(direcao === DIRECOES_DE_ORDEM.ASC ? '>' : '<');
  const desempate = Prisma.sql`l.deal_id ${maior} ${cursor.id}::uuid`;

  if (cursor.valor === null) {
    return Prisma.sql`AND ${expressao} IS NULL AND ${desempate}`;
  }

  const valor = Prisma.sql`CAST(${cursor.valor}::text AS ${Prisma.raw(tipo)})`;

  return Prisma.sql`AND (
    ${expressao} ${maior} ${valor}
    OR (${expressao} = ${valor} AND ${desempate})
    OR ${expressao} IS NULL
  )`;
}

/**
 * Uma página de uma coluna, com cursor por chave: o campo da ordem mais o id.
 *
 * @param {string} tenantId
 * @param {{ pipelineId: string, status: string, condicoes: Prisma.Sql[], ordem: Ordem, cursor: Cursor | null, limite: number }} consulta
 * @returns {Promise<{ deal_id: string, deal_atualizada_em: Date, ordem_valor: string | null }[]>}
 */
export function listarCardsDaColuna(
  tenantId,
  { pipelineId, status, condicoes, ordem, cursor, limite },
) {
  const expressao = Prisma.raw(ordem.coluna);
  const direcao = Prisma.raw(ordem.direcao === DIRECOES_DE_ORDEM.ASC ? 'ASC' : 'DESC');

  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        l.deal_id,
        l.deal_atualizada_em,
        (${expressao})::text AS ordem_valor
      FROM
        ${FONTE_CARDS} l
      WHERE
        ${daColuna({ tenantId, pipelineId, status, condicoes })} ${depoisDoCursor(ordem, cursor)}
      ORDER BY
        ${expressao} ${direcao} NULLS LAST,
        l.deal_id ${direcao}
      LIMIT
        ${limite}
    `,
  );
}

/**
 * Os cards pedidos que ainda estão neste quadro e atendem ao filtro: a tela
 * relê só o que o evento apontou (M5).
 *
 * @param {string} tenantId
 * @param {{ pipelineId: string, ids: string[], condicoes: Prisma.Sql[] }} consulta
 * @returns {Promise<{ deal_id: string, deal_atualizada_em: Date, status: string }[]>}
 */
export function listarCardsPorIds(tenantId, { pipelineId, ids, condicoes }) {
  const onde = Prisma.join(
    [
      Prisma.sql`l.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`l.pipeline_id = ${pipelineId}::uuid`,
      Prisma.sql`l.deal_id = ANY(${ids}::uuid[])`,
      NO_QUADRO,
      ...condicoes,
    ],
    ' AND ',
  );

  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        l.deal_id,
        l.deal_atualizada_em,
        l.status
      FROM
        ${FONTE_CARDS} l
      WHERE
        ${onde}
    `,
  );
}

/**
 * Total e soma saem do banco, sobre o filtro inteiro, nunca da página.
 *
 * @param {string} tenantId
 * @param {{ pipelineId: string, status: string, condicoes: Prisma.Sql[] }} consulta
 * @returns {Promise<{ total: number, soma: unknown }>}
 */
export function resumirColuna(tenantId, { pipelineId, status, condicoes }) {
  return getTenantClient(tenantId, async (tx) => {
    const [resumo] = await tx.$queryRaw`
      SELECT
        count(*)::int AS total,
        COALESCE(sum(l.valor), 0) AS soma
      FROM
        ${FONTE_CARDS} l
      WHERE
        ${daColuna({ tenantId, pipelineId, status, condicoes })}
    `;

    return resumo;
  });
}

/**
 * O card ainda atende ao filtro? Usado depois de mover (D1).
 *
 * @param {string} tenantId
 * @param {string} dealId
 * @param {Prisma.Sql[]} condicoes
 * @returns {Promise<boolean>}
 */
export async function cardAtendeAoFiltro(tenantId, dealId, condicoes) {
  const onde = Prisma.join([Prisma.sql`l.deal_id = ${dealId}::uuid`, ...condicoes], ' AND ');
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        1
      FROM
        ${FONTE_CARDS} l
      WHERE
        l.tenant_id = ${tenantId}::uuid
        AND ${onde}
    `,
  );

  return linhas.length > 0;
}

/**
 * Oportunidades pelos ids. A visibilidade entra na própria consulta: lista
 * antiga em cache revelaria card oculto, e lê-la antes custaria uma transação.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @param {{ soVisiveis: boolean, inatividade: Date | null }} opcoes  `soVisiveis`: sem as dos
 *   pipelines ocultos para o OPERADOR (D4)
 * @returns {Promise<Record<string, any>[]>}
 */
export function buscarCardsPorIds(tenantId, ids, { soVisiveis, inatividade }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        l.*,
        ${colunaEsfriandoDesde(inatividade)}
      FROM
        ${FONTE_CARDS} l
      WHERE
        l.tenant_id = ${tenantId}::uuid
        AND l.deal_id = ANY (${ids}::UUID[])
        AND l.deal_excluida_em IS NULL
        AND (
          NOT ${soVisiveis}::boolean
          OR l.pipeline_id IN (
            SELECT
              p.id
            FROM
              modulo_crm.crm_pipeline p
            WHERE
              p.tenant_id = ${tenantId}::uuid
              AND p.operator_visible
          )
        )
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
      SELECT
        id::text
      FROM
        modulo_crm.crm_deal
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ANY (${ids}::UUID[])
    `,
  );

  return linhas.map((linha) => linha.id);
}
