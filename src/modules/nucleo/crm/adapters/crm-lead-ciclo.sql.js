/**
 * @file O dia (no fuso do tenant) de uma das datas do ciclo, pra comparar com `AAAA-MM-DD`.
 * `won_at` é UTC sem fuso: vira instante e depois hora local.
 */
import { Prisma } from '@prisma/client';

import { CATEGORIAS_STATUS, CICLOS_DE_VIDA, TIPOS_PIPELINE } from '../constants.js';

/**
 * Ciclo de vida na tabela de leads (FC4): ciclo, "Cliente desde", "Última
 * compra" e oportunidades abertas, calculados a cada leitura das oportunidades
 * que quem lê enxerga (sem os pipelines ocultos, D4). O `lifecycle_stage`
 * gravado não entra: com pipeline oculto, ele revelaria uma venda escondida.
 * Sem pipeline oculto, dá o mesmo que ele (regra de `recalcularPessoa`).
 *
 * - Cliente: alguma ganha em pipeline de vendas (arquivada também conta).
 *   "Cliente desde" e "Última compra" são a primeira e a última dessas.
 * - Oportunidade: senão, alguma aberta e não arquivada, de qualquer pipeline.
 * - Lead: o resto.
 *
 * Fragmentos puros (sem client), pra `lead-filter.service.js` poder usar. Espera
 * `l` com `tenant_id`, `id` e `deleted_at` da pessoa: vale para `FONTE_LEADS` e
 * para os cards do quadro.
 */

/**
 * As oportunidades da pessoa que entram na conta: fora as excluídas; com a
 * pessoa na lixeira, as que foram junto (como `condicaoPessoaVisivel`).
 *
 * @param {string[]} ocultos
 * @param {boolean} pessoaNaLixeira
 * @returns {Prisma.Sql}  condição sobre `d` (`crm_deal`)
 */
function oportunidadesDaPessoa(ocultos, pessoaNaLixeira) {
  const excluidas = pessoaNaLixeira ? Prisma.empty : Prisma.sql`AND d.deleted_at IS NULL`;
  const visiveis =
    ocultos.length > 0 ? Prisma.sql`AND d.pipeline_id <> ALL(${ocultos}::uuid[])` : Prisma.empty;

  return Prisma.sql`d.tenant_id = l.tenant_id AND d.lead_id = l.id ${excluidas} ${visiveis}`;
}

/**
 * Pessoa fora da lixeira (o caso comum) consulta com `d.deleted_at IS NULL`
 * literal, que é o que deixa o índice parcial `idx_crm_deal_lead` valer.
 *
 * @param {string[]} ocultos
 * @param {(daPessoa: Prisma.Sql) => Prisma.Sql} consulta
 * @returns {Prisma.Sql}
 */
function porSituacaoDaPessoa(ocultos, consulta) {
  return Prisma.sql`(CASE WHEN l.deleted_at IS NULL
    THEN ${consulta(oportunidadesDaPessoa(ocultos, false))}
    ELSE ${consulta(oportunidadesDaPessoa(ocultos, true))} END)`;
}

/**
 * @param {'min' | 'max'} agregado  texto fixo, nunca do cliente
 * @returns {(ocultos: string[]) => Prisma.Sql}
 */
function ganhaEmVendas(agregado) {
  return (ocultos) =>
    porSituacaoDaPessoa(
      ocultos,
      (daPessoa) => Prisma.sql`(
        SELECT ${Prisma.raw(agregado)}(d.won_at) FROM modulo_crm.crm_deal d
        JOIN modulo_crm.crm_pipeline p ON p.tenant_id = d.tenant_id AND p.id = d.pipeline_id
        WHERE ${daPessoa} AND d.status_category = ${CATEGORIAS_STATUS.GANHO}
          AND p.type = ${TIPOS_PIPELINE.VENDAS}
      )`,
    );
}

/**
 * Primeira venda ganha (timestamp UTC, como `data_conversao`); NULL se não é cliente.
 *
 * @type {(ocultos: string[]) => Prisma.Sql}
 */
export const clienteDesdeSql = ganhaEmVendas('min');

/**
 * Última venda ganha; NULL se não é cliente.
 *
 * @type {(ocultos: string[]) => Prisma.Sql}
 */
export const ultimaCompraSql = ganhaEmVendas('max');

/**
 * Abertas e não arquivadas, de qualquer tipo de pipeline (`int`).
 *
 * @param {string[]} ocultos
 * @returns {Prisma.Sql}
 */
export function oportunidadesAbertasSql(ocultos) {
  return porSituacaoDaPessoa(
    ocultos,
    (daPessoa) => Prisma.sql`(
      SELECT count(*)::int FROM modulo_crm.crm_deal d
      WHERE ${daPessoa} AND d.status_category = ${CATEGORIAS_STATUS.ABERTO}
        AND d.archived_at IS NULL
    )`,
  );
}

/**
 * `lead`, `oportunidade` ou `cliente`: a CTE `estagio` de `recalcularPessoa`.
 *
 * @param {string[]} ocultos
 * @returns {Prisma.Sql}
 */
export function cicloDeVidaSql(ocultos) {
  return porSituacaoDaPessoa(
    ocultos,
    (daPessoa) => Prisma.sql`(
      SELECT CASE
        WHEN bool_or(d.status_category = ${CATEGORIAS_STATUS.GANHO} AND p.type = ${TIPOS_PIPELINE.VENDAS})
          THEN ${CICLOS_DE_VIDA.CLIENTE}
        WHEN bool_or(d.status_category = ${CATEGORIAS_STATUS.ABERTO} AND d.archived_at IS NULL)
          THEN ${CICLOS_DE_VIDA.OPORTUNIDADE}
        ELSE ${CICLOS_DE_VIDA.LEAD}
      END::text
      FROM modulo_crm.crm_deal d
      JOIN modulo_crm.crm_pipeline p ON p.tenant_id = d.tenant_id AND p.id = d.pipeline_id
      WHERE ${daPessoa}
    )`,
  );
}

/**
 * As quatro colunas da leitura do lead.
 *
 * @param {string[]} ocultos
 * @returns {Prisma.Sql}
 */
export function colunasDoCiclo(ocultos) {
  return Prisma.sql`${cicloDeVidaSql(ocultos)} AS ciclo_de_vida,
    ${clienteDesdeSql(ocultos)} AS cliente_desde,
    ${ultimaCompraSql(ocultos)} AS ultima_compra,
    ${oportunidadesAbertasSql(ocultos)} AS oportunidades_abertas`;
}

/**
 * O dia (no fuso do tenant) de uma das datas do ciclo, pra comparar com
 * `AAAA-MM-DD`. `won_at` é UTC sem fuso: vira instante e depois hora local.
 *
 * @param {Prisma.Sql} data  `clienteDesdeSql`/`ultimaCompraSql`
 * @param {string} fuso  IANA, já normalizado
 * @returns {Prisma.Sql}
 */
export function diaNoFuso(data, fuso) {
  return Prisma.sql`((${data} AT TIME ZONE 'UTC') AT TIME ZONE ${fuso})::date`;
}
