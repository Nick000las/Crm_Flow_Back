import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: pontuação de leads (M14, migration 0027) — regras, faixas, o
 * progresso do recálculo e a gravação do `leads.lead_score`. A expressão do
 * score (`Prisma.Sql` sobre `l` = leads) vem pronta do service: é a mesma
 * tradução de condição do filtro.
 *
 * @typedef {{
 *   id: string, nome: string, posicao: number, ativo: boolean, pontos: number,
 *   condicoes: { campoId: string, operador: string, valor?: unknown }[],
 * }} RegraScoreLinha
 * @typedef {{ chave: string, rotulo: string, minimo: number | null, maximo: number | null, cor: string }} FaixaScoreLinha
 * @typedef {{
 *   recalculo_total: number, recalculo_processados: number,
 *   recalculo_iniciado_em: Date | null, recalculo_concluido_em: Date | null,
 * }} ProgressoLinha
 */

/**
 * @param {string} tenantId
 * @returns {Promise<RegraScoreLinha[]>}
 */
export function listarRegrasScore(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id::text, nome, posicao, ativo, pontos, condicoes FROM modulo_crm.crm_score_rule
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY posicao, created_at
    `,
  );
}

/**
 * Vazio = o tenant nunca salvou (vale o padrão do código).
 *
 * @param {string} tenantId
 * @returns {Promise<FaixaScoreLinha[]>}
 */
export function listarFaixasScore(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT chave, rotulo, minimo, maximo, cor FROM modulo_crm.crm_score_band
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY posicao
    `,
  );
}

/**
 * Regras e faixas inteiras, numa transação (a ordem dos arrays vira a `posicao`).
 *
 * @param {string} tenantId
 * @param {Omit<RegraScoreLinha, 'id' | 'posicao'>[]} regras
 * @param {FaixaScoreLinha[]} faixas
 */
export function salvarRegrasEFaixas(tenantId, regras, faixas) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`DELETE FROM modulo_crm.crm_score_rule WHERE tenant_id = ${tenantId}::uuid`;
    for (const [posicao, regra] of regras.entries()) {
      await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_score_rule (tenant_id, nome, posicao, ativo, condicoes, pontos)
        VALUES (${tenantId}::uuid, ${regra.nome}, ${posicao}, ${regra.ativo}, ${JSON.stringify(regra.condicoes)}::jsonb, ${regra.pontos})
      `;
    }
    await tx.$executeRaw`DELETE FROM modulo_crm.crm_score_band WHERE tenant_id = ${tenantId}::uuid`;
    for (const [posicao, faixa] of faixas.entries()) {
      await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_score_band (tenant_id, chave, rotulo, minimo, maximo, cor, posicao)
        VALUES (${tenantId}::uuid, ${faixa.chave}, ${faixa.rotulo}, ${faixa.minimo}, ${faixa.maximo}, ${faixa.cor}, ${posicao})
      `;
    }
  });
}

/**
 * Score de leads específicos (depois de salvar um lead). Não gera evento
 * no histórico: o score não é edição de ninguém.
 *
 * @param {string} tenantId
 * @param {import('@prisma/client').Prisma.Sql} expressao
 * @param {string[]} leadIds
 * @returns {Promise<Map<string, unknown>>} o score novo por lead (`Decimal`, como na leitura do lead)
 */
export async function gravarScores(tenantId, expressao, leadIds) {
  if (leadIds.length === 0) return new Map();
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.leads l SET lead_score = (${expressao})
      WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ANY(${leadIds}::uuid[])
      RETURNING l.id::text, l.lead_score AS score
    `,
  );
  return new Map(linhas.map((linha) => [linha.id, linha.score]));
}

/**
 * Um lote do recálculo, em ordem de id (o cursor é o último id do lote
 * anterior) — todos os leads do tenant, inclusive arquivados e lixeira.
 *
 * @param {string} tenantId
 * @param {import('@prisma/client').Prisma.Sql} expressao
 * @param {string | null} depoisDe
 * @param {number} limite
 * @returns {Promise<string[]>} ids recalculados, em ordem
 */
export async function gravarScoresEmLote(tenantId, expressao, depoisDe, limite) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      WITH lote AS (
        SELECT id FROM modulo_crm.leads
        WHERE tenant_id = ${tenantId}::uuid AND (${depoisDe}::uuid IS NULL OR id > ${depoisDe}::uuid)
        ORDER BY id
        LIMIT ${limite}
      )
      UPDATE modulo_crm.leads l SET lead_score = (${expressao})
      FROM lote WHERE l.id = lote.id
      RETURNING l.id::text
    `,
  );
  return linhas.map((linha) => linha.id).sort();
}

/**
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
export function contarLeadsDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[FIRST_RESULT_INDEX].total),
  );
}

/**
 * @param {string} tenantId
 * @returns {Promise<ProgressoLinha | undefined>}
 */
export function buscarProgressoRecalculo(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT recalculo_total, recalculo_processados, recalculo_iniciado_em, recalculo_concluido_em
      FROM modulo_crm.crm_score_config WHERE tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[FIRST_RESULT_INDEX]),
  );
}

/**
 * Início (`concluido: false`, zera o processado), avanço ou fim.
 *
 * @param {string} tenantId
 * @param {{ total: number, processados: number, inicio?: boolean, concluido?: boolean }} progresso
 */
export function registrarProgressoRecalculo(tenantId, { total, processados, inicio = false, concluido = false }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_score_config
        (tenant_id, recalculo_total, recalculo_processados, recalculo_iniciado_em, recalculo_concluido_em)
      VALUES (${tenantId}::uuid, ${total}, ${processados}, now(), ${concluido ? new Date() : null})
      ON CONFLICT (tenant_id) DO UPDATE SET
        recalculo_total = EXCLUDED.recalculo_total,
        recalculo_processados = EXCLUDED.recalculo_processados,
        recalculo_iniciado_em = CASE WHEN ${inicio} THEN now() ELSE modulo_crm.crm_score_config.recalculo_iniciado_em END,
        recalculo_concluido_em = CASE WHEN ${inicio} THEN NULL ELSE EXCLUDED.recalculo_concluido_em END
    `,
  );
}
