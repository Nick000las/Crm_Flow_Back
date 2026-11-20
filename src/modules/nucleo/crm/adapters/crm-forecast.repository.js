import { Prisma } from '@prisma/client';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import {
  AGRUPAMENTOS_FORECAST,
  BLOCOS_FORECAST,
  CATEGORIAS_STATUS,
  TIPOS_MES_FORECAST,
  TIPOS_PIPELINE,
} from '../constants.js';

/**
 * ADAPTER: o forecast (FC2). Somas, ponderado e previsto saem do banco: o Node
 * só monta a resposta. Entram as oportunidades ativas (fora do arquivo e da
 * lixeira, de pessoa também ativa; anonimizada conta) dos pipelines de vendas
 * ativos que o papel vê.
 *
 * Datas: `expected_close_date` é `DATE` (já é calendário); `won_at` é
 * `TIMESTAMP` gravado em UTC, levado ao fuso do tenant antes de virar mês.
 * Meses e `hoje` chegam como texto (`AAAA-MM-01`, `AAAA-MM-DD`).
 *
 * @typedef {{
 *   tenantId: string, ocultos: string[], pipelineId: string | null, responsavelId: string | null,
 * }} Escopo
 * @typedef {Escopo & {
 *   fuso: string, hoje: string, de: string, ate: string, agrupar: string,
 * }} ConsultaAgregada  `de`/`ate`: primeiro dia do mês
 * @typedef {{
 *   do_total: boolean, grupo_chave: string | null, grupo_rotulo: string | null, chave: string,
 *   realizado_quantidade: number, realizado_soma: string, ganhas_sem_valor: number,
 *   aberto_quantidade: number, aberto_soma: string, aberto_ponderado: string, previsto: string,
 * }} LinhaAgregada  `chave`: `AAAA-MM` ou um de `BLOCOS_FORECAST`; somas em texto (decimal exato)
 */

const ABERTO = CATEGORIAS_STATUS.ABERTO;
const GANHO = CATEGORIAS_STATUS.GANHO;

/** Probabilidade efetiva (FC1): a da oportunidade, senão a padrão do status. */
const PROBABILIDADE = Prisma.raw('COALESCE(d.probability_override, o.default_probability)');

/**
 * @param {string} fuso
 * @returns {Prisma.Sql} mês local (`DATE`, dia 1) em que a oportunidade foi ganha
 */
const mesDoGanho = (fuso) =>
  Prisma.sql`date_trunc('month', (d.won_at AT TIME ZONE 'UTC') AT TIME ZONE ${fuso})::date`;

/** Pipeline, pessoa e status de cada oportunidade. */
const JUNCOES = Prisma.sql`
  JOIN modulo_crm.crm_pipeline p ON p.tenant_id = d.tenant_id AND p.id = d.pipeline_id
  JOIN modulo_crm.leads l ON l.tenant_id = d.tenant_id AND l.id = d.lead_id
  LEFT JOIN modulo_crm.crm_option o
    ON o.tenant_id = d.tenant_id AND o.kind = 'status'
    AND o.pipeline_id = d.pipeline_id AND o.key = d.status
`;

/**
 * Abertas e ganhas ativas dos pipelines de vendas visíveis, com os filtros.
 *
 * @param {Escopo} escopo
 * @returns {Prisma.Sql}
 */
function noEscopo({ tenantId, ocultos, pipelineId, responsavelId }) {
  return Prisma.sql`
    d.tenant_id = ${tenantId}::uuid
    AND p.type = ${TIPOS_PIPELINE.VENDAS} AND p.is_active
    AND NOT (d.pipeline_id = ANY(${ocultos}::uuid[]))
    AND d.deleted_at IS NULL AND d.archived_at IS NULL
    AND l.deleted_at IS NULL AND l.archived_at IS NULL
    AND d.status_category IN (${ABERTO}, ${GANHO})
    AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId}::uuid)
    AND (${responsavelId}::uuid IS NULL OR d.owner_id = ${responsavelId}::uuid)
  `;
}

/** Chave e rótulo do grupo, por `agrupar`. Texto fixo, nunca vindo do cliente. */
const COLUNAS_DO_GRUPO = Object.freeze({
  [AGRUPAMENTOS_FORECAST.TOTAL]: Prisma.raw(
    'NULL::text AS grupo_chave, NULL::text AS grupo_rotulo',
  ),
  [AGRUPAMENTOS_FORECAST.RESPONSAVEL]: Prisma.raw(
    'd.owner_id::text AS grupo_chave, u.nome AS grupo_rotulo',
  ),
  [AGRUPAMENTOS_FORECAST.STATUS]: Prisma.raw(
    'd.status AS grupo_chave, COALESCE(o.label, d.status) AS grupo_rotulo',
  ),
});

/** O nome do responsável só é lido quando o agrupamento pede. */
const JUNCAO_DO_RESPONSAVEL = Prisma.sql`
  LEFT JOIN public.usuarios u ON u.tenant_id = d.tenant_id AND u.id = d.owner_id
`;

/**
 * O agregado inteiro numa consulta: uma linha por mês ou bloco, do conjunto e,
 * com agrupamento, de cada grupo (`GROUPING SETS`). Cada oportunidade cai numa
 * faixa só (mês, atrasadas, sem previsão ou além do horizonte); a aberta sem
 * valor aparece também em `sem_valor`, que conta à parte.
 *
 * @param {ConsultaAgregada} consulta
 * @returns {Prisma.Sql}
 */
function consultaAgregada(consulta) {
  const { fuso, hoje, de, ate, agrupar } = consulta;
  const agrupado = agrupar !== AGRUPAMENTOS_FORECAST.TOTAL;
  const nivel = agrupado
    ? Prisma.raw('GROUPING(f.grupo_chave) = 1 AS do_total, f.grupo_chave, f.grupo_rotulo')
    : Prisma.raw('true AS do_total, NULL::text AS grupo_chave, NULL::text AS grupo_rotulo');
  const agrupamento = agrupado
    ? Prisma.raw('GROUPING SETS ((f.chave), (f.grupo_chave, f.grupo_rotulo, f.chave))')
    : Prisma.raw('f.chave');
  const { REALIZADO, ABERTO: TIPO_ABERTO } = TIPOS_MES_FORECAST;
  const somaRealizada = Prisma.sql`COALESCE(sum(f.amount) FILTER (WHERE f.tipo = ${REALIZADO}), 0)`;
  const ponderado = Prisma.sql`COALESCE(round(
    sum(f.amount * f.probabilidade / 100.0) FILTER (WHERE f.tipo = ${TIPO_ABERTO}), 2
  ), 0)`;

  return Prisma.sql`
    WITH b AS (
      SELECT d.amount, d.status_category, d.expected_close_date,
             ${PROBABILIDADE} AS probabilidade, ${mesDoGanho(fuso)} AS mes_ganho,
             ${COLUNAS_DO_GRUPO[agrupar]}
      FROM modulo_crm.crm_deal d
      ${JUNCOES}
      ${agrupar === AGRUPAMENTOS_FORECAST.RESPONSAVEL ? JUNCAO_DO_RESPONSAVEL : Prisma.empty}
      WHERE ${noEscopo(consulta)}
    ),
    f AS (
      SELECT b.*, faixa.chave, faixa.tipo
      FROM b
      CROSS JOIN LATERAL (VALUES
        (
          -- Uma faixa por oportunidade; toda aberta cai em alguma, para os totais
          -- baterem com o pipeline.
          CASE
            WHEN b.status_category = ${GANHO} THEN
              CASE WHEN b.mes_ganho BETWEEN ${de}::date AND ${ate}::date
                THEN to_char(b.mes_ganho, 'YYYY-MM') END
            WHEN b.expected_close_date IS NULL THEN ${BLOCOS_FORECAST.SEM_PREVISAO}
            WHEN b.expected_close_date < ${hoje}::date THEN ${BLOCOS_FORECAST.ATRASADAS}
            WHEN b.expected_close_date < ${de}::date THEN ${BLOCOS_FORECAST.ANTES_DO_PERIODO}
            WHEN b.expected_close_date >= (${ate}::date + interval '1 month')
              THEN ${BLOCOS_FORECAST.ALEM_DO_HORIZONTE}
            ELSE to_char(b.expected_close_date, 'YYYY-MM')
          END,
          CASE WHEN b.status_category = ${GANHO} THEN ${REALIZADO} ELSE ${TIPO_ABERTO} END
        ),
        (
          CASE WHEN b.status_category = ${ABERTO} AND b.amount IS NULL
            THEN ${BLOCOS_FORECAST.SEM_VALOR} END,
          ${TIPO_ABERTO}
        )
      ) AS faixa (chave, tipo)
      WHERE faixa.chave IS NOT NULL
    )
    SELECT ${nivel}, f.chave,
      (count(*) FILTER (WHERE f.tipo = ${REALIZADO}))::int AS realizado_quantidade,
      ${somaRealizada}::text AS realizado_soma,
      (count(*) FILTER (WHERE f.tipo = ${REALIZADO} AND f.amount IS NULL))::int AS ganhas_sem_valor,
      (count(*) FILTER (WHERE f.tipo = ${TIPO_ABERTO}))::int AS aberto_quantidade,
      COALESCE(sum(f.amount) FILTER (WHERE f.tipo = ${TIPO_ABERTO}), 0)::text AS aberto_soma,
      ${ponderado}::text AS aberto_ponderado,
      (${somaRealizada} + ${ponderado})::text AS previsto
    FROM f
    GROUP BY ${agrupamento}
  `;
}

/**
 * O agregado e, à parte, se o tenant tem alguma oportunidade de vendas ativa
 * nos pipelines visíveis (sem os filtros de pipeline e responsável): a tela
 * vazia de quem ainda não começou.
 *
 * @param {ConsultaAgregada} consulta
 * @returns {Promise<{ linhas: LinhaAgregada[], vazio: boolean }>}
 */
export function agregarForecast(consulta) {
  const { tenantId, ocultos } = consulta;
  const todoOTenant = noEscopo({ tenantId, ocultos, pipelineId: null, responsavelId: null });
  return getTenantClient(tenantId, async (tx) => {
    const linhas = await tx.$queryRaw(consultaAgregada(consulta));
    const [{ existe }] = await tx.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM modulo_crm.crm_deal d ${JUNCOES} WHERE ${todoOTenant}
      ) AS existe
    `;
    return { linhas, vazio: !existe };
  });
}

/**
 * Fuso configurado do tenant (`public.tenants`, fora do RLS: client admin com
 * o id explícito, como as flags).
 *
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function buscarFusoDoTenant(tenantId) {
  const tenant = await getAdminClient().tenant.findUnique({
    where: { id: tenantId },
    select: { fusoHorario: true },
  });
  return tenant?.fusoHorario ?? null;
}

/**
 * Consulta barata, antes do agregado: `hoje` no fuso e a marca do cache. Toda
 * escrita em oportunidade publica no outbox na mesma transação, e mudar a
 * probabilidade padrão mexe no `updated_at` do status: a marca muda sozinha.
 *
 * @param {string} tenantId
 * @param {string} fuso
 * @returns {Promise<{ marca: string, hoje: string }>}
 */
export function buscarMarcaEHoje(tenantId, fuso) {
  return getTenantClient(tenantId, async (tx) => {
    const [linha] = await tx.$queryRaw`
      SELECT
        COALESCE((
          SELECT max(e.occurred_at) FROM modulo_crm.crm_event e
          WHERE e.tenant_id = ${tenantId}::uuid
        )::text, '-') || '|' || COALESCE((
          SELECT max(o.updated_at) FROM modulo_crm.crm_option o
          WHERE o.tenant_id = ${tenantId}::uuid AND o.kind = 'status'
        )::text, '-') AS marca,
        to_char((now() AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS hoje
    `;
    return linha;
  });
}

/**
 * @typedef {{ mes: string, tipo: string } | { bloco: string, de: string, ate: string }} Selecao
 *   `mes`/`de`/`ate`: primeiro dia do mês
 */

/**
 * @param {Selecao} selecao
 * @param {{ fuso: string, hoje: string }} datas
 * @returns {Prisma.Sql}
 */
function condicaoDaSelecao(selecao, { fuso, hoje }) {
  const aberta = Prisma.sql`d.status_category = ${ABERTO}`;
  if ('mes' in selecao) {
    const { mes, tipo } = selecao;
    if (tipo === TIPOS_MES_FORECAST.REALIZADO) {
      return Prisma.sql`d.status_category = ${GANHO} AND ${mesDoGanho(fuso)} = ${mes}::date`;
    }
    return Prisma.sql`${aberta} AND d.expected_close_date >= ${hoje}::date
      AND d.expected_close_date >= ${mes}::date
      AND d.expected_close_date < (${mes}::date + interval '1 month')`;
  }
  const { bloco, de, ate } = selecao;
  switch (bloco) {
    case BLOCOS_FORECAST.ATRASADAS:
      return Prisma.sql`${aberta} AND d.expected_close_date < ${hoje}::date`;
    case BLOCOS_FORECAST.ANTES_DO_PERIODO:
      return Prisma.sql`${aberta} AND d.expected_close_date >= ${hoje}::date
        AND d.expected_close_date < ${de}::date`;
    case BLOCOS_FORECAST.SEM_PREVISAO:
      return Prisma.sql`${aberta} AND d.expected_close_date IS NULL`;
    case BLOCOS_FORECAST.ALEM_DO_HORIZONTE:
      return Prisma.sql`${aberta} AND d.expected_close_date >= ${hoje}::date
        AND d.expected_close_date >= (${ate}::date + interval '1 month')`;
    default:
      return Prisma.sql`${aberta} AND d.amount IS NULL`;
  }
}

const ORDEM_DAS_GANHAS = Prisma.raw('d.won_at DESC, d.id');
const ORDEM_DAS_ABERTAS = Prisma.raw(
  'd.expected_close_date ASC NULLS LAST, d.amount DESC NULLS LAST, d.id',
);

/**
 * As oportunidades por trás de um número do forecast, com o mesmo escopo e a
 * mesma regra de faixa do agregado.
 *
 * @param {Escopo & { fuso: string, hoje: string, selecao: Selecao, limite: number, offset: number }} consulta
 * @returns {Promise<{ linhas: Record<string, any>[], total: number }>}
 */
export function buscarOportunidadesDoForecast(consulta) {
  const { tenantId, fuso, hoje, selecao, limite, offset } = consulta;
  const onde = Prisma.sql`${noEscopo(consulta)} AND ${condicaoDaSelecao(selecao, { fuso, hoje })}`;
  const ganhas = 'mes' in selecao && selecao.tipo === TIPOS_MES_FORECAST.REALIZADO;
  return getTenantClient(tenantId, async (tx) => {
    const linhas = await tx.$queryRaw`
      SELECT d.id::text, d.lead_id::text, l.nome AS pessoa, d.pipeline_id::text,
             d.status, o.label AS status_label, d.status_category,
             d.amount::text AS valor, ${PROBABILIDADE}::int AS probabilidade,
             round(d.amount * ${PROBABILIDADE} / 100.0, 2)::text AS ponderado,
             to_char(d.expected_close_date, 'YYYY-MM-DD') AS data_prevista,
             d.won_at, d.owner_id::text, d.updated_at
      FROM modulo_crm.crm_deal d
      ${JUNCOES}
      WHERE ${onde}
      ORDER BY ${ganhas ? ORDEM_DAS_GANHAS : ORDEM_DAS_ABERTAS}
      LIMIT ${limite} OFFSET ${offset}
    `;
    const [{ total }] = await tx.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_crm.crm_deal d ${JUNCOES} WHERE ${onde}
    `;
    return { linhas, total };
  });
}
