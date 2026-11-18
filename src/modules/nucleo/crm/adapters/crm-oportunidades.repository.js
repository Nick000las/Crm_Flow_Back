/**
 * @file ADAPTER: oportunidades (`modulo_crm.crm_deal`, migration 0037).
 */
import { Prisma } from '@prisma/client';

import { getTenantClient } from '#core/db/tenantClient.js';

import { CATEGORIAS_STATUS, TIPOS_EVENTO_LEAD, TIPOS_PIPELINE } from '../constants.js';
import { ENTIDADE_OPORTUNIDADE, EVENTOS_OPORTUNIDADE } from '../constants/oportunidades.js';
import { inserirEvento } from './crm-lead-events.repository.js';
import { statusDoPipeline } from './crm-options.repository.js';
import { publicarEvento } from './crm-outbox.repository.js';
import { pipelinePadraoSql } from './crm-pipelines.repository.js';

/**
 * ADAPTER: oportunidades (`modulo_crm.crm_deal`, migration 0037). Toda escrita
 * passa por uma transação só, com a oportunidade, a pessoa (principal e ciclo
 * de vida), o histórico e o outbox: ou tudo entra, ou nada.
 *
 * As decisões ficam no service, entregues como callback (`montar`) que roda
 * com as linhas travadas, como em `mesclarLeads`.
 *
 * @typedef {Record<string, any>} LinhaOportunidade
 * @typedef {{
 *   mudancas: Record<string, unknown>,
 *   diff?: unknown[],
 *   historico?: string,
 *   evento: string,
 *   ganhou?: boolean,
 *   reabriu?: boolean,
 *   statusMudou?: boolean,
 *   statusAnterior?: string,
 * }} Plano
 * @typedef {import('./crm-options.repository.js').OpcaoLista} OpcaoLista
 * @typedef {{
 *   status: string, categoria: string, titulo?: string | null, valor?: number | null,
 *   probabilidade?: number | null, dataPrevista?: Date | null, motivoPerda?: string | null,
 *   ganhaEm?: Date | null, responsavelId?: string | null,
 * }} NovaOportunidade
 * @typedef {{
 *   exigeOportunidade: boolean,
 *   nova: (opcoes: OpcaoLista[]) => NovaOportunidade,
 *   planejar: (deal: LinhaOportunidade, opcoes: OpcaoLista[]) => Plano | null,
 * }} ComercialDoLead
 */

/**
 * Probabilidade padrão do status da oportunidade (FC1), para a resposta calcular
 * a efetiva. `alias` é texto fixo deste arquivo: o nome da tabela ou o apelido.
 *
 * @param {'d' | 'crm_deal'} alias
 */
function probabilidadeDoStatusSql(alias) {
  const deal = Prisma.raw(alias);

  return Prisma.sql`(
    SELECT o.default_probability::int FROM modulo_crm.crm_option o
    WHERE o.tenant_id = ${deal}.tenant_id AND o.kind = 'status'
      AND o.pipeline_id = ${deal}.pipeline_id AND o.key = ${deal}.status
  ) AS probabilidade_padrao`;
}

/**
 * Oportunidade principal e ciclo de vida, derivados (decisões F-2 e F-3).
 * Principal: aberta mais recente em Vendas; sem aberta, a última ganha; senão,
 * a mais recente. Arquivada só é principal se não houver outra.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 */
export function recalcularPessoa(tx, tenantId, leadId) {
  return tx.$executeRaw`
    WITH
      classificadas AS (
        SELECT
          d.id,
          d.status_category,
          d.archived_at,
          d.created_at,
          d.won_at,
          p.type,
          CASE
            WHEN d.status_category = ${CATEGORIAS_STATUS.ABERTO}
            AND p.type = ${TIPOS_PIPELINE.VENDAS} THEN 0
            WHEN d.status_category = ${CATEGORIAS_STATUS.GANHO}
            AND p.type = ${TIPOS_PIPELINE.VENDAS} THEN 1
            ELSE 2
          END AS grupo
        FROM
          modulo_crm.crm_deal d
          JOIN modulo_crm.crm_pipeline p ON p.tenant_id = d.tenant_id
          AND p.id = d.pipeline_id
        WHERE
          d.tenant_id = ${tenantId}::uuid
          AND d.lead_id = ${leadId}::uuid
          AND d.deleted_at IS NULL
      ),
      principal AS (
        SELECT
          id
        FROM
          classificadas
        ORDER BY
          (archived_at IS NOT NULL),
          grupo,
          CASE
            WHEN grupo = 1 THEN won_at
          END DESC NULLS LAST,
          created_at DESC,
          id DESC
        LIMIT
          1
      ),
      estagio AS (
        SELECT
          CASE
            WHEN bool_or(
              status_category = ${CATEGORIAS_STATUS.GANHO}
              AND type = ${TIPOS_PIPELINE.VENDAS}
            ) THEN 'cliente'
            WHEN bool_or(
              status_category = ${CATEGORIAS_STATUS.ABERTO}
              AND archived_at IS NULL
            ) THEN 'oportunidade'
            ELSE 'lead'
          END AS valor
        FROM
          classificadas
      )
    UPDATE modulo_crm.leads l
    SET
      principal_deal_id = (
        SELECT
          id
        FROM
          principal
      ),
      lifecycle_changed_at = CASE
        WHEN l.lifecycle_stage IS DISTINCT FROM e.valor THEN now()
        ELSE l.lifecycle_changed_at
      END,
      lifecycle_stage = e.valor
    FROM
      estagio e
    WHERE
      l.tenant_id = ${tenantId}::uuid
      AND l.id = ${leadId}::uuid
  `;
}

/**
 * Histórico e outbox de uma oportunidade. Sem dado pessoal no outbox.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {LinhaOportunidade} deal
 * @param {{ tipoHistorico?: string, evento: string, autorId: string | null, diff?: unknown[], extras?: Record<string, unknown> }} registro
 *   sem `tipoHistorico`, só o outbox: a timeline já tem o evento do lead
 */
async function registrar(
  tx,
  tenantId,
  deal,
  { tipoHistorico, evento, autorId, diff, extras = {} },
) {
  if (tipoHistorico) {
    await inserirEvento(tx, tenantId, deal.lead_id, {
      tipo: tipoHistorico,
      autorId,
      diff,
      detalhes: { oportunidadeId: deal.id, pipelineId: deal.pipeline_id, ...extras },
    });
  }

  await publicarEvento(tx, tenantId, {
    tipo: evento,
    entidade: ENTIDADE_OPORTUNIDADE,
    entidadeId: deal.id,
    payload: {
      leadId: deal.lead_id,
      pipelineId: deal.pipeline_id,
      status: deal.status,
      ...extras,
    },
  });
}

/**
 * Atendimentos automáticos de uma venda ganha. A unicidade por origem e
 * pipeline garante que repetir o ganho não duplica. O status é o configurado;
 * se ele foi desativado, o primeiro aberto do pipeline.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {LinhaOportunidade} venda
 * @param {string | null} responsavelDaPessoa
 * @param {string | null} autorId
 */
async function criarAtendimentos(tx, tenantId, venda, responsavelDaPessoa, autorId) {
  const criados = await tx.$queryRaw`
    INSERT INTO
      modulo_crm.crm_deal (
        tenant_id,
        lead_id,
        pipeline_id,
        source_deal_id,
        status,
        status_category,
        owner_id
      )
    SELECT
      p.tenant_id,
      ${venda.lead_id}::uuid,
      p.id,
      ${venda.id}::uuid,
      o.key,
      o.category,
      CASE p.auto_create_owner_rule
        WHEN 'specific_user' THEN p.auto_create_owner_id
        WHEN 'none' THEN NULL
        ELSE ${responsavelDaPessoa}::uuid
      END
    FROM
      modulo_crm.crm_pipeline p
      CROSS JOIN LATERAL (
        SELECT
          op.key,
          op.category
        FROM
          modulo_crm.crm_option op
        WHERE
          op.tenant_id = p.tenant_id
          AND op.kind = 'status'
          AND op.pipeline_id = p.id
          AND op.is_active
          AND op.category = ${CATEGORIAS_STATUS.ABERTO}
        ORDER BY
          (op.key = p.auto_create_initial_status) DESC,
          op.position,
          op.id
        LIMIT
          1
      ) o
    WHERE
      p.tenant_id = ${tenantId}::uuid
      AND p.type = ${TIPOS_PIPELINE.ATENDIMENTO}
      AND p.auto_create_enabled
      AND p.is_active
      AND p.auto_create_from_pipeline_id = ${venda.pipeline_id}::uuid
    ON CONFLICT (source_deal_id, pipeline_id)
    WHERE
      source_deal_id IS NOT NULL DO NOTHING
    RETURNING
      id::text,
      lead_id::text,
      pipeline_id::text,
      status
  `;

  for (const atendimento of criados) {
    await registrar(tx, tenantId, atendimento, {
      tipoHistorico: TIPOS_EVENTO_LEAD.OPORTUNIDADE_CRIADA,
      evento: EVENTOS_OPORTUNIDADE.CRIADA,
      autorId,
      extras: { origemId: venda.id },
    });
  }
}

/** Uma venda reaberta avisa os atendimentos que nasceram dela. */
function marcarOrigemReaberta(tx, tenantId, vendaId) {
  return tx.$executeRaw`
    UPDATE modulo_crm.crm_deal
    SET
      source_reopened_at = now()
    WHERE
      tenant_id = ${tenantId}::uuid
      AND source_deal_id = ${vendaId}::uuid
      AND deleted_at IS NULL
  `;
}

/**
 * Oportunidade fora da lixeira. `undefined` = não existe neste tenant.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ incluirExcluidas?: boolean }} [opcoes]
 * @returns {Promise<LinhaOportunidade | undefined>}
 */
export function buscarOportunidade(tenantId, id, { incluirExcluidas = false } = {}) {
  return getTenantClient(tenantId, async (tx) => {
    const [deal] = await tx.$queryRaw`
      SELECT
        d.*,
        d.id::text,
        d.lead_id::text,
        d.pipeline_id::text,
        ${probabilidadeDoStatusSql('d')}
      FROM
        modulo_crm.crm_deal d
      WHERE
        d.tenant_id = ${tenantId}::uuid
        AND d.id = ${id}::uuid
        AND (
          ${incluirExcluidas}
          OR d.deleted_at IS NULL
        )
    `;

    return deal;
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ daLixeira?: boolean }} [opcoes]  `true`: só as excluídas, sem as outras
 * @returns {Promise<LinhaOportunidade[]>} mais nova primeiro
 */
export function buscarOportunidadesDaPessoa(tenantId, leadId, { daLixeira = false } = {}) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        d.*,
        d.id::text,
        d.lead_id::text,
        d.pipeline_id::text,
        ${probabilidadeDoStatusSql('d')}
      FROM
        modulo_crm.crm_deal d
      WHERE
        d.tenant_id = ${tenantId}::uuid
        AND d.lead_id = ${leadId}::uuid
        AND (d.deleted_at IS NOT NULL) = ${daLixeira}
      ORDER BY
        d.created_at DESC,
        d.id DESC
    `,
  );
}

/**
 * Grava a oportunidade e os efeitos dela. `tipoHistorico` omitido: criada junto
 * com o lead, a timeline já mostra "criado".
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {{ id: string, usuario_responsavel_id: string | null }} lead
 * @param {string} pipelineId
 * @param {NovaOportunidade} nova
 * @param {{ autorId: string | null, tipoHistorico?: string }} opcoes
 */
async function inserirOportunidade(tx, tenantId, lead, pipelineId, nova, opcoes) {
  const { autorId, tipoHistorico } = opcoes;
  const ganha = nova.categoria === CATEGORIAS_STATUS.GANHO;
  const perdida = nova.categoria === CATEGORIAS_STATUS.PERDIDO;
  const [deal] = await tx.$queryRaw`
    INSERT INTO
      modulo_crm.crm_deal (
        tenant_id,
        lead_id,
        pipeline_id,
        title,
        status,
        status_category,
        amount,
        probability_override,
        expected_close_date,
        lost_reason,
        owner_id,
        won_at,
        lost_at
      )
    VALUES
      (
        ${tenantId}::uuid,
        ${lead.id}::uuid,
        ${pipelineId}::uuid,
        ${nova.titulo ?? null},
        ${nova.status},
        ${nova.categoria},
        ${nova.valor ?? null},
        ${nova.probabilidade ?? null},
        ${nova.dataPrevista ?? null}::date,
        ${nova.motivoPerda ?? null},
        ${nova.responsavelId ?? lead.usuario_responsavel_id}::uuid,
        CASE
          WHEN ${ganha} THEN COALESCE(${nova.ganhaEm ?? null}::timestamp, now())
        END,
        CASE
          WHEN ${perdida} THEN now()
        END
      )
    RETURNING
      *,
      id::text,
      lead_id::text,
      pipeline_id::text,
      ${probabilidadeDoStatusSql('crm_deal')}
  `;

  await registrar(tx, tenantId, deal, {
    tipoHistorico,
    evento: EVENTOS_OPORTUNIDADE.CRIADA,
    autorId,
  });

  if (ganha) {
    await criarAtendimentos(tx, tenantId, deal, lead.usuario_responsavel_id, autorId);
  }

  await recalcularPessoa(tx, tenantId, lead.id);

  return deal;
}

/**
 * A oportunidade que nasce com o lead, no pipeline padrão (decisão F-1).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {{ id: string, usuario_responsavel_id: string | null }} lead
 * @param {ComercialDoLead['nova']} montar
 * @param {string | null} autorId
 * @param {string} [pipelineId]  sem ele, o padrão
 */
export async function criarOportunidadeDoLead(tx, tenantId, lead, montar, autorId, pipelineId) {
  const [destino] = await tx.$queryRaw`
    SELECT
      COALESCE(${pipelineId ?? null}::uuid, ${pipelinePadraoSql(tenantId)})::text AS id
  `;
  const opcoes = destino.id ? await statusDoPipeline(tx, tenantId, destino.id) : [];

  return inserirOportunidade(tx, tenantId, lead, destino.id, montar(opcoes), { autorId });
}

/**
 * Campos comerciais de `/crm/leads` na oportunidade principal, dentro da
 * transação do lead: um PUT é um evento só na timeline, com contato e comercial
 * juntos. Sem principal (a dele foi excluída), um dado comercial cria outra.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {{ id: string, usuario_responsavel_id: string | null, principal_deal_id: string | null }} lead
 * @param {ComercialDoLead} comercial
 * @param {{ autorId: string | null, contaInteracao: boolean }} opcoes
 * @returns {Promise<string | null>} o pipeline da oportunidade alterada, se houve alteração
 */
export async function gravarComercialDoLead(tx, tenantId, lead, comercial, opcoes) {
  const { autorId, contaInteracao } = opcoes;

  if (!lead.principal_deal_id) {
    if (!comercial.exigeOportunidade) {
      return null;
    }

    const criada = await criarOportunidadeDoLead(tx, tenantId, lead, comercial.nova, autorId);

    return criada.pipeline_id;
  }

  const [deal] = await tx.$queryRaw`
    SELECT
      *,
      id::text,
      lead_id::text,
      pipeline_id::text
    FROM
      modulo_crm.crm_deal
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${lead.principal_deal_id}::uuid
    FOR UPDATE
  `;
  const plano = comercial.planejar(deal, await statusDoPipeline(tx, tenantId, deal.pipeline_id));

  if (!plano) {
    return null;
  }

  await aplicarPlano(tx, tenantId, deal, plano, {
    responsavelDaPessoa: lead.usuario_responsavel_id,
    autorId,
    contaInteracao,
    comHistorico: false,
  });

  return deal.pipeline_id;
}

/**
 * Mesclagem: tudo o que o secundário tinha passa para o principal, inclusive o
 * que estava na lixeira. A nova principal segue o responsável escolhido.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {{ principalId: string, secundarioId: string }} ids
 * @param {string | null} autorId
 */
export async function moverOportunidades(tx, tenantId, { principalId, secundarioId }, autorId) {
  const movidas = await tx.$queryRaw`
    UPDATE modulo_crm.crm_deal
    SET
      lead_id = ${principalId}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ${secundarioId}::uuid
    RETURNING
      id::text,
      lead_id::text,
      pipeline_id::text,
      status
  `;

  for (const deal of movidas) {
    await registrar(tx, tenantId, deal, { evento: EVENTOS_OPORTUNIDADE.ATUALIZADA, autorId });
  }

  await recalcularPessoa(tx, tenantId, principalId);
  await recalcularPessoa(tx, tenantId, secundarioId);

  await tx.$executeRaw`
    UPDATE modulo_crm.crm_deal d
    SET
      owner_id = l.usuario_responsavel_id
    FROM
      modulo_crm.leads l
    WHERE
      l.tenant_id = ${tenantId}::uuid
      AND l.id = ${principalId}::uuid
      AND d.tenant_id = l.tenant_id
      AND d.id = l.principal_deal_id
      AND d.owner_id IS DISTINCT FROM l.usuario_responsavel_id
  `;
}

/**
 * Lead na lixeira leva as oportunidades com o mesmo carimbo: ao restaurar,
 * voltam só as que foram com ele, não as excluídas antes, uma a uma.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string | null} autorId
 */
export async function excluirOportunidadesDoLead(tx, tenantId, leadId, autorId) {
  const excluidas = await tx.$queryRaw`
    UPDATE modulo_crm.crm_deal d
    SET
      deleted_at = l.deleted_at
    FROM
      modulo_crm.leads l
    WHERE
      l.tenant_id = ${tenantId}::uuid
      AND l.id = ${leadId}::uuid
      AND d.tenant_id = l.tenant_id
      AND d.lead_id = l.id
      AND d.deleted_at IS NULL
    RETURNING
      d.id::text,
      d.lead_id::text,
      d.pipeline_id::text,
      d.status
  `;

  for (const deal of excluidas) {
    await registrar(tx, tenantId, deal, { evento: EVENTOS_OPORTUNIDADE.EXCLUIDA, autorId });
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} excluidoEm  carimbo do lead, em texto: `Date` perderia os microssegundos
 * @param {string | null} autorId
 */
export async function restaurarOportunidadesDoLead(tx, tenantId, leadId, excluidoEm, autorId) {
  const restauradas = await tx.$queryRaw`
    UPDATE modulo_crm.crm_deal
    SET
      deleted_at = NULL
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ${leadId}::uuid
      AND deleted_at = ${excluidoEm}::timestamp
    RETURNING
      id::text,
      lead_id::text,
      pipeline_id::text,
      status
  `;

  for (const deal of restauradas) {
    await registrar(tx, tenantId, deal, { evento: EVENTOS_OPORTUNIDADE.RESTAURADA, autorId });
  }
}

/**
 * @param {string} tenantId
 * @param {NovaOportunidade & { leadId: string, pipelineId: string }} nova
 * @param {(lead: Record<string, any>) => void} conferir  roda com a pessoa travada
 * @param {{ autorId: string | null }} opcoes
 * @returns {Promise<LinhaOportunidade | undefined>} `undefined` se a pessoa não existe
 */
export function criarOportunidade(tenantId, nova, conferir, { autorId }) {
  return getTenantClient(tenantId, async (tx) => {
    const [lead] = await tx.$queryRaw`
      SELECT
        *
      FROM
        modulo_crm.leads
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${nova.leadId}::uuid
        AND deleted_at IS NULL
      FOR UPDATE
    `;

    if (!lead) {
      return undefined;
    }

    conferir(lead);

    return inserirOportunidade(
      tx,
      tenantId,
      { id: nova.leadId, usuario_responsavel_id: lead.usuario_responsavel_id },
      nova.pipelineId,
      nova,
      { autorId, tipoHistorico: TIPOS_EVENTO_LEAD.OPORTUNIDADE_CRIADA },
    );
  });
}

/**
 * Grava um plano sobre a oportunidade travada, com todos os efeitos.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {LinhaOportunidade} deal
 * @param {Plano} plano
 * @param {{ responsavelDaPessoa: string | null, autorId: string | null, contaInteracao?: boolean, comHistorico?: boolean }} opcoes
 */
async function aplicarPlano(tx, tenantId, deal, plano, opcoes) {
  const { responsavelDaPessoa, autorId, contaInteracao = true, comHistorico = true } = opcoes;
  const proximo = { ...deal, ...plano.mudancas };
  const [depois] = await tx.$queryRaw`
    UPDATE modulo_crm.crm_deal
    SET
      title = ${proximo.title},
      status = ${proximo.status},
      status_category = ${proximo.status_category},
      amount = ${proximo.amount},
      probability_override = ${proximo.probability_override},
      expected_close_date = ${proximo.expected_close_date}::date,
      won_at = ${proximo.won_at}::timestamp,
      lost_at = ${proximo.lost_at}::timestamp,
      lost_reason = ${proximo.lost_reason},
      owner_id = ${proximo.owner_id}::uuid,
      archived_at = ${proximo.archived_at}::timestamp,
      deleted_at = ${proximo.deleted_at}::timestamp
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${deal.id}::uuid
    RETURNING
      *,
      id::text,
      lead_id::text,
      pipeline_id::text,
      ${probabilidadeDoStatusSql('crm_deal')}
  `;

  if (plano.statusMudou && contaInteracao) {
    // Mudar o status conta como interação: é o relógio do lead esfriando (M9).
    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET
        ultima_interacao_em = now()
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${deal.lead_id}::uuid
    `;
  }

  await registrar(tx, tenantId, depois, {
    tipoHistorico: comHistorico ? (plano.historico ?? TIPOS_EVENTO_LEAD.ATUALIZADO) : undefined,
    evento: plano.evento,
    autorId,
    diff: plano.diff,
    ...(plano.statusAnterior && { extras: { statusAnterior: plano.statusAnterior } }),
  });

  if (plano.reabriu) {
    await marcarOrigemReaberta(tx, tenantId, deal.id);
  }

  if (plano.ganhou) {
    await criarAtendimentos(tx, tenantId, depois, responsavelDaPessoa, autorId);
  }

  await recalcularPessoa(tx, tenantId, deal.lead_id);

  return depois;
}

/**
 * Altera com a pessoa e a oportunidade travadas, nessa ordem, a mesma de quem
 * recalcula a pessoa. `montar` decide a partir do estado travado.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {(deal: LinhaOportunidade, lead: Record<string, any>) => Plano} montar
 * @param {{ autorId: string | null }} opcoes
 * @returns {Promise<LinhaOportunidade | undefined>} `undefined` se não existe
 */
export function alterarOportunidade(tenantId, id, montar, { autorId }) {
  return getTenantClient(tenantId, async (tx) => {
    const [alvo] = await tx.$queryRaw`
      SELECT
        lead_id::text
      FROM
        modulo_crm.crm_deal
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${id}::uuid
    `;

    if (!alvo) {
      return undefined;
    }

    const [lead] = await tx.$queryRaw`
      SELECT
        *
      FROM
        modulo_crm.leads
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${alvo.lead_id}::uuid
      FOR UPDATE
    `;
    const [deal] = await tx.$queryRaw`
      SELECT
        *,
        id::text,
        lead_id::text,
        pipeline_id::text,
        ${probabilidadeDoStatusSql('crm_deal')}
      FROM
        modulo_crm.crm_deal
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${id}::uuid
      FOR UPDATE
    `;

    return aplicarPlano(tx, tenantId, deal, montar(deal, lead), {
      responsavelDaPessoa: lead.usuario_responsavel_id,
      autorId,
    });
  });
}
