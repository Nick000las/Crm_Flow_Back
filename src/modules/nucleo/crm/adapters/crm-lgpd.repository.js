import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { ANONIMIZACAO, TIPOS_EVENTO_LEAD } from '../constants.js';
import { inserirEvento } from './crm-lead-events.repository.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: base legal LGPD (M15, migration 0028) — a configuração do
 * tenant e a anonimização do lead (pedido do titular).
 *
 * @typedef {{ base_legal_padrao: string | null }} ConfigLgpdLinha
 */

/**
 * Sem linha = o tenant nunca salvou (sem base padrão).
 *
 * @param {string} tenantId
 * @returns {Promise<ConfigLgpdLinha | undefined>}
 */
export function buscarConfigLgpd(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT base_legal_padrao FROM modulo_crm.crm_lgpd_config WHERE tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {{ basePadrao: string | null }} config
 */
export function salvarConfigLgpd(tenantId, { basePadrao }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_lgpd_config (tenant_id, base_legal_padrao)
      VALUES (${tenantId}::uuid, ${basePadrao})
      ON CONFLICT (tenant_id) DO UPDATE SET base_legal_padrao = EXCLUDED.base_legal_padrao, updated_at = now()
    `,
  );
}

/**
 * O lead existe (inclusive arquivado ou na lixeira) e já foi anonimizado?
 * `undefined` = não existe neste tenant.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<{ anonimizado: boolean } | undefined>}
 */
export function buscarSituacaoLgpd(tenantId, leadId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT (anonimizado_em IS NOT NULL) AS anonimizado FROM modulo_crm.leads
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[FIRST_RESULT_INDEX]),
  );
}

/**
 * Anonimiza o lead e os que foram mesclados nele (a mesma pessoa, na
 * lixeira), numa transação:
 *
 * - lead: nome vira `ANONIMIZACAO.NOME`, as colunas pessoais ficam nulas e
 *   `custom_fields` guarda só os personalizados de `mantidos` (ids);
 * - atividades: título genérico, sem notas (tipo e datas ficam);
 * - histórico: antes/depois dos campos pessoais vira `null` e o `detalhes`
 *   perde o que identifica (nome do mesclado, CNPJ) — o trigger append-only
 *   só deixa com `app.lgpd_anonimizando` ligado nesta transação;
 * - um evento `anonimizado` e a linha no `audit_log` (core, append-only),
 *   ambos sem dado pessoal.
 *
 * Sem linha (não existe ou já anonimizado) → `null`; o service decide o erro.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ autorId: string | null, mantidos: string[] }} opcoes
 * @returns {Promise<{ leads: number, atividades: number, eventos: number } | null>}
 */
export function anonimizarLead(tenantId, leadId, { autorId, mantidos }) {
  const { NOME, TITULO_ATIVIDADE, COLUNAS_PII, CHAVES_PII, DETALHES_PII, GUC } = ANONIMIZACAO;
  const limpar = Prisma.join(COLUNAS_PII.map((coluna) => Prisma.sql`${Prisma.raw(coluna)} = NULL`), ', ');

  return getTenantClient(tenantId, async (tx) => {
    const linhas = await tx.$queryRaw`
      SELECT id::text FROM modulo_crm.leads
      WHERE tenant_id = ${tenantId}::uuid AND anonimizado_em IS NULL
        AND (id = ${leadId}::uuid OR mesclado_em_id = ${leadId}::uuid)
      FOR UPDATE
    `;
    const ids = linhas.map((linha) => linha.id);
    if (!ids.includes(leadId)) return null;

    await tx.$queryRaw`SELECT set_config(${GUC}, 'on', true)`;

    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET nome = ${NOME}, ${limpar},
        custom_fields = COALESCE(
          (SELECT jsonb_object_agg(e.chave, e.valor) FROM jsonb_each(custom_fields) AS e(chave, valor)
           WHERE e.chave = ANY(${mantidos}::text[])),
          '{}'::jsonb
        ),
        anonimizado_em = now(), updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
    `;

    const atividades = await tx.$executeRaw`
      UPDATE modulo_crm.crm_activity
      SET titulo = ${TITULO_ATIVIDADE}, notas = NULL, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ANY(${ids}::uuid[])
    `;

    // Entrada do diff: `{ campo, campoId?, antes, depois }` — personalizado
    // tem `campo = 'customFields'` e o id do campo em `campoId`.
    const eventos = await tx.$executeRaw`
      UPDATE modulo_crm.crm_lead_event
      SET diff = COALESCE(
          (SELECT jsonb_agg(
             CASE
               WHEN x.item->>'campo' = ANY(${[...CHAVES_PII]}::text[])
                 OR (x.item->>'campo' = 'customFields'
                     AND NOT COALESCE(x.item->>'campoId' = ANY(${mantidos}::text[]), false))
               THEN x.item || '{"antes": null, "depois": null}'::jsonb
               ELSE x.item
             END ORDER BY x.ordem)
           FROM jsonb_array_elements(diff) WITH ORDINALITY AS x(item, ordem)),
          '[]'::jsonb
        ),
        detalhes = detalhes - ${[...DETALHES_PII]}::text[]
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ANY(${ids}::uuid[])
    `;
    // Mesclagem num lead que não é este: o evento de lá guarda o nome do descartado.
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_lead_event
      SET detalhes = detalhes - ${[...DETALHES_PII]}::text[]
      WHERE tenant_id = ${tenantId}::uuid AND NOT (lead_id = ANY(${ids}::uuid[]))
        AND detalhes->>'leadDescartadoId' = ANY(${ids}::text[])
    `;

    const resumo = { leads: ids.length, atividades, eventos };
    await inserirEvento(tx, tenantId, leadId, { tipo: TIPOS_EVENTO_LEAD.ANONIMIZADO, autorId, detalhes: resumo });
    await tx.$executeRaw`
      INSERT INTO audit_log (tenant_id, usuario_id, acao, entidade, entidade_id, detalhes)
      VALUES (
        ${tenantId}::uuid, ${autorId}::uuid, ${ANONIMIZACAO.ACAO_AUDITORIA}, ${ANONIMIZACAO.ENTIDADE_AUDITORIA},
        ${leadId}::uuid, ${JSON.stringify(resumo)}::jsonb
      )
    `;
    return resumo;
  });
}
