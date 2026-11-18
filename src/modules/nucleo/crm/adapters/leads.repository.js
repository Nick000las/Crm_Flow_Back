/**
 * @file ADAPTER: único lugar deste módulo que chama getTenantClient.
 */
import { Prisma } from '@prisma/client';

import { getTenantClient } from '#core/db/tenantClient.js';

import {
  CAMADA_1_CAMPOS,
  CAMADA_2_CAMPOS,
  CAMPOS_COMERCIAIS,
  EVENTOS_PESSOA,
  TIPOS_EVENTO_LEAD,
} from '../constants.js';
import {
  moverFormulariosNaMesclagem,
  revogarLinksAtivosDasPessoas,
} from './crm-form-ciclo.repository.js';
import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';
import { colunasDoCiclo } from './crm-lead-ciclo.sql.js';
import { inserirEvento } from './crm-lead-events.repository.js';
import { condicaoPessoaVisivel, fonteLeadsVisivel } from './crm-lead-read-model.js';
import {
  criarOportunidadeDoLead,
  excluirOportunidadesDoLead,
  gravarComercialDoLead,
  moverOportunidades,
  restaurarOportunidadesDoLead,
} from './crm-oportunidades.repository.js';
import { publicarEventoDaPessoa } from './crm-outbox.repository.js';

const FIRST_RESULT_INDEX = 0;
const DOIS_LEADS = 2;

/**
 * Colunas devolvidas por toda leitura de lead (lista, detalhe, busca
 * filtrada) — uma lista só, pra uma coluna nova não ficar faltando em uma
 * das três. Espera `l` = `FONTE_LEADS`, que traz o comercial da oportunidade
 * principal.
 */
const COLUNAS_BASE = Prisma.sql`
  l.id, l.nome, l.primeiro_nome, l.telefone, l.email, l.valor, l.funil_estagio_id,
  l.fonte_lead, l.status, l.tags, l.ultima_interacao_em,
  l.empresa, l.cargo, l.cpf, l.cnpj, l.cidade, l.uf, l.cep, l.endereco,
  l.campanha_utm, l.data_conversao, l.probabilidade_fechamento,
  l.data_prevista_fechamento, l.motivo_perda, l.lead_score, l.proximo_followup,
  l.legal_basis, l.legal_basis_at, l.origem_registro, l.marketing_opt_out_at, l.anonimizado_em,
  l.custom_fields, l.usuario_responsavel_id,
  l.created_at, l.updated_at, l.archived_at, l.deleted_at, l.mesclado_em_id,
  (SELECT m.nome FROM modulo_crm.leads m WHERE m.id = l.mesclado_em_id AND m.tenant_id = l.tenant_id) AS mesclado_em_nome,
  l.assigned_by_rule_id AS atribuido_por_regra_id,
  (SELECT r.nome FROM modulo_crm.crm_assignment_rule r WHERE r.id = l.assigned_by_rule_id AND r.tenant_id = l.tenant_id) AS atribuido_por_regra_nome
`;

/**
 * `inatividade` = o "agora" do cálculo do lead esfriando (M9) quando a
 * flag está ligada; sem ele, `esfriando_desde` sai `null` sem custo.
 * `ocultos`: o ciclo de vida (FC4) conta só as oportunidades que quem lê vê.
 *
 * @param {Date | null} [inatividade]
 * @param {string[]} [ocultos]
 */
function colunasLeitura(inatividade = null, ocultos = []) {
  return Prisma.sql`${COLUNAS_BASE}, l.estagio_nome, ${colunaEsfriandoDesde(inatividade)},
    ${colunasDoCiclo(ocultos)}`;
}

/**
 * Chaves editáveis por `atualizarLead` → coluna real. Única fonte de nome
 * de coluna que o SET dinâmico aceita interpolar (`Prisma.raw`) — nunca
 * uma chave vinda do cliente, mesma regra do filtro. Comercial não entra: mora
 * na oportunidade (`CAMPOS_COMERCIAIS`).
 */
const COLUNAS_EDITAVEIS = Object.freeze({
  ...Object.fromEntries(
    Object.entries({ ...CAMADA_1_CAMPOS, ...CAMADA_2_CAMPOS }).filter(
      ([chave]) => !CAMPOS_COMERCIAIS.includes(chave),
    ),
  ),
  usuarioResponsavelId: 'usuario_responsavel_id',
});

const COLUNAS_UUID = new Set(['usuarioResponsavelId']);

/**
 * Um lead pela leitura, de dentro de uma transação: enxerga o que ela já gravou.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ inatividade?: Date | null, ocultos?: string[] }} [opcoes]
 */
async function lerLead(tx, tenantId, leadId, { inatividade = null, ocultos = [] } = {}) {
  const [lead] = await tx.$queryRaw`
    SELECT
      ${colunasLeitura(inatividade, ocultos)}
    FROM
      ${fonteLeadsVisivel(ocultos)} l
    WHERE
      l.id = ${leadId}::uuid
      AND l.tenant_id = ${tenantId}::uuid
  `;

  return lead;
}

/**
 * ADAPTER: único lugar deste módulo que chama getTenantClient.
 * @typedef {import('../types/index.js').Lead} Lead
 * @typedef {import('../types/index.js').CriarLeadInput} CriarLeadInput
 * @typedef {import('../types/index.js').AtualizarLeadInput} AtualizarLeadInput
 *
 * Toda escrita que muda o lead aceita o autor e grava o evento do
 * histórico (M6) na MESMA transação.
 */

/**
 * Lead fora da lixeira (arquivado vem; na lixeira = não existe, M5).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ inatividade?: Date | null, ocultos?: string[] }} [opcoes] `inatividade`: ver
 *   `colunasLeitura`; `ocultos`: pipelines que quem lê não vê (D4)
 * @returns {Promise<Lead | undefined>}
 */
export function buscarLeadPorId(tenantId, leadId, { inatividade = null, ocultos = [] } = {}) {
  return getTenantClient(tenantId, async (tx) =>
    tx.$queryRaw`
      SELECT
        ${colunasLeitura(inatividade, ocultos)}
      FROM
        ${fonteLeadsVisivel(ocultos)} l
      WHERE
        l.id = ${leadId}::uuid
        AND l.tenant_id = ${tenantId}::uuid
        AND l.deleted_at IS NULL
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Busca paginada com condições dinâmicas. `condicoes` são fragmentos
 * `Prisma.sql` já parametrizados, montados por `lead-filter.service.js`
 * (nome de coluna só de lista fechada, valor sempre como parâmetro) —
 * este adapter só os junta com `AND`, sem nunca concatenar texto cru.
 * `tenant_id` explícito continua no WHERE (defesa em profundidade, além
 * do RLS).
 *
 * @param {string} tenantId
 * @param {Prisma.Sql[]} condicoes
 * @param {{ limite: number, offset: number, inatividade?: Date | null, ocultos?: string[] }} paginacao
 *   `inatividade`: ver `colunasLeitura`; `ocultos`: pipelines que quem busca não vê (D4)
 * @returns {Promise<{ itens: Lead[], total: number }>}
 */
export function buscarLeadsComFiltro(
  tenantId,
  condicoes,
  { limite, offset, inatividade = null, ocultos = [] },
) {
  const where = Prisma.join([Prisma.sql`l.tenant_id = ${tenantId}::uuid`, ...condicoes], ' AND ');
  const fonte = fonteLeadsVisivel(ocultos);

  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT
        COUNT(*)::int AS total
      FROM
        ${fonte} l
      WHERE
        ${where}
    `;
    const itens = await tx.$queryRaw`
      SELECT
        ${colunasLeitura(inatividade, ocultos)}
      FROM
        ${fonte} l
      WHERE
        ${where}
      ORDER BY
        l.created_at DESC,
        l.id
      LIMIT
        ${limite}
      OFFSET
        ${offset}
    `;

    return { itens, total: contagem.total };
  });
}

/**
 * @param {string} tenantId
 * @param {string[]} ids
 * @param {string[]} ocultos  não vazio
 * @returns {Promise<string[]>} os ids que quem pede pode ver (D4)
 */
export async function buscarPessoasVisiveis(tenantId, ids, ocultos) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        l.id::text
      FROM
        modulo_crm.leads l
      WHERE
        l.tenant_id = ${tenantId}::uuid
        AND l.id = ANY (${ids}::UUID[])
        AND ${condicaoPessoaVisivel(ocultos)}
    `,
  );

  return linhas.map((linha) => linha.id);
}

/**
 * `email`/`telefone` já chegam validados pelo service ("pelo menos um dos
 * dois") — `chk_leads_email_ou_telefone` no banco é a rede de segurança
 * final. Camada 1/2 vão como `null` quando ausentes (nunca `undefined` —
 * Prisma não aceita `undefined` num `$queryRaw`). O lead nasce sempre com uma
 * oportunidade, na mesma transação (decisão F-1).
 *
 * @param {string} tenantId
 * @param {CriarLeadInput & { atribuidoPorRegraId?: string | null }} dados  `atribuidoPorRegraId`: a regra
 *   da distribuição automática que escolheu o responsável (M12)
 * @param {{ autorId?: string | null, detalhes?: Record<string, unknown> }} [historico] sem ele (import), sem
 *   evento; `detalhes` vai no evento `criado` (ex.: como o responsável foi distribuído)
 * @param {import('./crm-oportunidades.repository.js').ComercialDoLead['nova']} novaOportunidade
 * @param {string} [pipelineId]  sem ele, o padrão; com ele, só para quem cria pelo quadro
 * @returns {Promise<{ id: string }>}
 */
export function criarLead(tenantId, dados, historico, novaOportunidade, pipelineId) {
  const customFieldsJson = JSON.stringify(dados.customFields ?? {});

  return getTenantClient(tenantId, async (tx) => {
    const criado = await tx.$queryRaw`
      INSERT INTO
        modulo_crm.leads (
          tenant_id,
          nome,
          primeiro_nome,
          telefone,
          custom_fields,
          usuario_responsavel_id,
          assigned_by_rule_id,
          email,
          fonte_lead,
          tags,
          ultima_interacao_em,
          empresa,
          cargo,
          cpf,
          cnpj,
          cidade,
          uf,
          cep,
          endereco,
          campanha_utm,
          lead_score,
          proximo_followup,
          legal_basis,
          legal_basis_at,
          origem_registro,
          marketing_opt_out_at
        )
      VALUES
        (
          ${tenantId}::uuid,
          ${dados.nome},
          ${dados.primeiroNome ?? null},
          ${dados.telefone ?? null},
          ${customFieldsJson}::jsonb,
          ${dados.usuarioResponsavelId ?? null}::uuid,
          ${dados.atribuidoPorRegraId ?? null}::uuid,
          ${dados.email ?? null},
          ${dados.fonteLead ?? null},
          ${dados.tags ?? null},
          ${dados.ultimaInteracaoEm ?? null},
          ${dados.empresa ?? null},
          ${dados.cargo ?? null},
          ${dados.cpf ?? null},
          ${dados.cnpj ?? null},
          ${dados.cidade ?? null},
          ${dados.uf ?? null},
          ${dados.cep ?? null},
          ${dados.endereco ?? null},
          ${dados.campanhaUtm ?? null},
          ${dados.leadScore ?? null},
          ${dados.proximoFollowup ?? null},
          ${dados.baseLegal ?? null},
          ${dados.baseLegalEm ?? null},
          ${dados.origemRegistro ?? null},
          ${dados.optOutMarketingEm ?? null}
        )
      RETURNING
        id
    `.then((rows) => rows[FIRST_RESULT_INDEX]);

    if (historico) {
      await inserirEvento(tx, tenantId, criado.id, {
        tipo: TIPOS_EVENTO_LEAD.CRIADO,
        autorId: historico.autorId,
        detalhes: historico.detalhes,
      });
    }

    await criarOportunidadeDoLead(
      tx,
      tenantId,
      { id: criado.id, usuario_responsavel_id: dados.usuarioResponsavelId ?? null },
      novaOportunidade,
      historico?.autorId ?? null,
      pipelineId,
    );

    return criado;
  });
}

/**
 * Edição parcial com SET dinâmico: chave **omitida** (`undefined`) não
 * entra no UPDATE; chave **`null`** limpa a coluna. `custom_fields` faz
 * merge raso das chaves com valor e remove as que vieram `null`.
 * Regras de negócio sobre o que pode ser limpo (sobrar e-mail ou
 * telefone, obrigatórios) já foram checadas no service. Lead na lixeira
 * não é editável: sem linha, o service responde 404.
 *
 * O lead fica travado (`FOR UPDATE`). Com `historico`, o diff de antes e depois
 * (calculado por `historico.montarDiff`, função pura do service) vira um evento
 * `atualizado`, só se algo mudou de fato. `oportunidade` leva o comercial para
 * a oportunidade principal na mesma transação.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {AtualizarLeadInput} dados
 * @param {{
 *   autorId?: string | null,
 *   montarDiff: (antes: Lead, depois: Lead) => unknown[],
 *   tipo?: string,
 *   detalhes?: Record<string, unknown>,
 * }} [historico]  `tipo` padrão `atualizado` (o enriquecimento por CNPJ grava `enriquecido`)
 * @param {{
 *   inatividade?: Date | null,
 *   oportunidade?: import('./crm-oportunidades.repository.js').ComercialDoLead,
 *   ocultos?: string[],
 *   conferir?: (lead: { updated_at: Date }, tx: Prisma.TransactionClient) => Promise<void>,
 *   depoisDeGravar?: (tx: Prisma.TransactionClient, depois: Lead) => Promise<void>,
 * }} [opcoes] `inatividade`: ver `colunasLeitura` (só a linha devolvida); `ocultos`: pipelines
 *   que quem edita não vê; `conferir`: roda com o lead travado, antes de gravar;
 *   `depoisDeGravar`: na mesma transação, depois do histórico (ex.: a resposta
 *   de formulário que originou a edição, FM4)
 * @returns {Promise<Lead | undefined>}
 */
export function atualizarLead(
  tenantId,
  leadId,
  dados,
  historico,
  { inatividade = null, oportunidade, ocultos = [], conferir, depoisDeGravar } = {},
) {
  const atribuicoes = montarAtribuicoes(dados);

  return getTenantClient(tenantId, async (tx) => {
    const [travado] = await tx.$queryRaw`
      SELECT
        id::text,
        principal_deal_id::text,
        updated_at
      FROM
        modulo_crm.leads
      WHERE
        id = ${leadId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND anonimizado_em IS NULL
      FOR UPDATE
    `;

    if (!travado) {
      return undefined;
    }

    await conferir?.(travado, tx);

    const antes = historico ? await lerLead(tx, tenantId, leadId) : undefined;

    const [{ usuario_responsavel_id: responsavel }] = await tx.$queryRaw`
      UPDATE modulo_crm.leads
      SET
        ${Prisma.join(atribuicoes, ', ')}
      WHERE
        id = ${leadId}::uuid
        AND tenant_id = ${tenantId}::uuid
      RETURNING
        usuario_responsavel_id::text
    `;
    let pipelineId = null;

    if (oportunidade) {
      pipelineId = await gravarComercialDoLead(
        tx,
        tenantId,
        { ...travado, usuario_responsavel_id: responsavel },
        oportunidade,
        {
          autorId: historico?.autorId ?? null,
          contaInteracao: dados.ultimaInteracaoEm === undefined,
        },
      );
    }

    const depois = await lerLead(tx, tenantId, leadId, { inatividade, ocultos });

    await publicarEventoDaPessoa(tx, tenantId, leadId, EVENTOS_PESSOA.ATUALIZADA);

    if (historico) {
      const diff = historico.montarDiff(antes, depois);

      if (diff.length > 0) {
        await inserirEvento(tx, tenantId, leadId, {
          tipo: historico.tipo ?? TIPOS_EVENTO_LEAD.ATUALIZADO,
          autorId: historico.autorId,
          diff,
          // O evento diz de qual pipeline é o comercial: quem não o vê não recebe o evento (D4).
          detalhes: pipelineId ? { ...historico.detalhes, pipelineId } : historico.detalhes,
        });
      }
    }

    await depoisDeGravar?.(tx, depois);

    return depois;
  });
}

/**
 * Exportada só pra teste (inspecionar o SQL gerado).
 *
 * @param {AtualizarLeadInput} dados
 * @returns {Prisma.Sql[]}
 */
export function montarAtribuicoes(dados) {
  const atribuicoes = [];

  for (const [chave, coluna] of Object.entries(COLUNAS_EDITAVEIS)) {
    const valor = dados[chave];

    if (valor === undefined) {
      continue;
    }

    atribuicoes.push(
      COLUNAS_UUID.has(chave)
        ? Prisma.sql`${Prisma.raw(coluna)} = ${valor}::uuid`
        : Prisma.sql`${Prisma.raw(coluna)} = ${valor}`,
    );
  }

  if (dados.customFields !== undefined) {
    const entradas = Object.entries(dados.customFields);
    const definidos = Object.fromEntries(entradas.filter(([, valor]) => valor !== null));
    const removidos = entradas.filter(([, valor]) => valor === null).map(([chave]) => chave);

    atribuicoes.push(
      Prisma.sql`custom_fields = (custom_fields || ${JSON.stringify(definidos)}::jsonb) - ${removidos}::text[]`,
    );
  }

  // Base legal (M15): a data acompanha a troca (some quando a base é limpa),
  // a não ser que venha explícita (mesclagem copia as duas do lado escolhido).
  if (dados.baseLegal !== undefined && dados.baseLegalEm === undefined) {
    atribuicoes.push(
      Prisma.sql`legal_basis_at = CASE WHEN ${dados.baseLegal}::varchar IS NULL THEN NULL WHEN legal_basis IS DISTINCT FROM ${dados.baseLegal} THEN now() ELSE legal_basis_at END`,
    );
  }

  // Opt-out (M15): sim/não no payload; ligar de novo mantém a data da primeira vez.
  if (dados.optOutMarketing !== undefined && dados.optOutMarketingEm === undefined) {
    atribuicoes.push(
      Prisma.sql`marketing_opt_out_at = CASE WHEN ${dados.optOutMarketing}::boolean THEN COALESCE(marketing_opt_out_at, now()) ELSE NULL END`,
    );
  }

  atribuicoes.push(Prisma.sql`updated_at = now()`);

  return atribuicoes;
}

/**
 * "Excluir" (M5): manda pra lixeira. Sem linha = não existe ou já está lá.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ autorId?: string | null }} [historico]
 * @returns {Promise<{ id: string, deleted_at: Date } | undefined>}
 */
export function moverParaLixeira(tenantId, leadId, historico) {
  return getTenantClient(tenantId, async (tx) => {
    const [excluido] = await tx.$queryRaw`
      UPDATE modulo_crm.leads
      SET
        deleted_at = now()
      WHERE
        id = ${leadId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
      RETURNING
        id,
        deleted_at
    `;

    if (excluido) {
      await excluirOportunidadesDoLead(tx, tenantId, leadId, historico?.autorId ?? null);
      // FM6: pessoa na lixeira não responde formulário.
      await revogarLinksAtivosDasPessoas(tx, tenantId, [leadId]);
    }

    if (excluido && historico) {
      await inserirEvento(tx, tenantId, leadId, {
        tipo: TIPOS_EVENTO_LEAD.EXCLUIDO,
        autorId: historico.autorId,
      });
    }

    return excluido;
  });
}

/**
 * Arquivar ou desarquivar. Já no estado pedido, não muda nada nem grava
 * evento (repetir o clique não suja o histórico). Lead na lixeira fica de
 * fora (sem linha).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {boolean} arquivar
 * @param {{ autorId?: string | null }} [historico]
 * @returns {Promise<{ id: string } | undefined>}
 */
export function definirArquivamento(tenantId, leadId, arquivar, historico) {
  return getTenantClient(tenantId, async (tx) => {
    const [atual] = await tx.$queryRaw`
      SELECT
        id,
        archived_at
      FROM
        modulo_crm.leads
      WHERE
        id = ${leadId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
      FOR UPDATE
    `;

    if (!atual) {
      return undefined;
    }

    if ((atual.archived_at !== null) === arquivar) {
      return { id: atual.id };
    }

    const valor = arquivar ? Prisma.sql`now()` : Prisma.sql`NULL`;

    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET
        archived_at = ${valor},
        updated_at = now()
      WHERE
        id = ${leadId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    // FM6: arquivar revoga os links ativos; desarquivar não os traz de volta.
    if (arquivar) {
      await revogarLinksAtivosDasPessoas(tx, tenantId, [leadId]);
    }

    await publicarEventoDaPessoa(
      tx,
      tenantId,
      leadId,
      arquivar ? EVENTOS_PESSOA.ARQUIVADA : EVENTOS_PESSOA.DESARQUIVADA,
    );

    if (historico) {
      const tipo = arquivar ? TIPOS_EVENTO_LEAD.ARQUIVADO : TIPOS_EVENTO_LEAD.DESARQUIVADO;

      await inserirEvento(tx, tenantId, leadId, { tipo, autorId: historico.autorId });
    }

    return { id: atual.id };
  });
}

/**
 * Tira da lixeira se foi excluído a partir de `excluidoDesde` (o prazo).
 * Volta como estava antes (arquivado continua arquivado).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {Date} excluidoDesde
 * @param {{ autorId?: string | null }} [historico]
 * @returns {Promise<{ id: string } | undefined>}
 */
export function restaurarDaLixeira(tenantId, leadId, excluidoDesde, historico) {
  return getTenantClient(tenantId, async (tx) => {
    const [restaurado] = await tx.$queryRaw`
      WITH
        alvo AS (
          SELECT
            id,
            deleted_at
          FROM
            modulo_crm.leads
          WHERE
            id = ${leadId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND deleted_at IS NOT NULL
            AND deleted_at >= ${excluidoDesde}
            AND mesclado_em_id IS NULL
          FOR UPDATE
        )
      UPDATE modulo_crm.leads l
      SET
        deleted_at = NULL
      FROM
        alvo
      WHERE
        l.id = alvo.id
      RETURNING
        l.id,
        alvo.deleted_at::text AS excluido_em
    `;

    if (!restaurado) {
      // Descartado numa mesclagem (M7): os dados e o histórico já estão no outro lead.
      const [mesclado] = await tx.$queryRaw`
        SELECT
          mesclado_em_id
        FROM
          modulo_crm.leads
        WHERE
          id = ${leadId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND deleted_at >= ${excluidoDesde}
          AND mesclado_em_id IS NOT NULL
      `;

      return mesclado ? { mescladoEmId: mesclado.mesclado_em_id } : undefined;
    }

    await restaurarOportunidadesDoLead(
      tx,
      tenantId,
      leadId,
      restaurado.excluido_em,
      historico?.autorId ?? null,
    );

    if (historico) {
      await inserirEvento(tx, tenantId, leadId, {
        tipo: TIPOS_EVENTO_LEAD.RESTAURADO,
        autorId: historico.autorId,
      });
    }

    return { id: restaurado.id };
  });
}

/**
 * Mesclagem (M7), tudo numa transação — se qualquer passo falhar, nada
 * muda. Ordem:
 * 1. trava os dois leads (ordem de id, pra duas mesclagens cruzadas não
 *    travarem uma à outra) — os dois fora da lixeira, senão `undefined`;
 * 2. `montar(principal, secundario)` (função pura do service) dá os dados
 *    finais do principal;
 * 3. atividades, eventos e oportunidades do secundário passam pro principal;
 * 4. UPDATE do principal + evento `mesclado` (diff + id do descartado);
 * 5. secundário pra lixeira com `mesclado_em_id` + evento `excluido`.
 *
 * As oportunidades dos dois continuam existindo; o lead mostra a principal,
 * recalculada (decisão F-2).
 *
 * @param {string} tenantId
 * @param {{ principalId: string, secundarioId: string }} ids
 * @param {{
 *   autorId?: string | null,
 *   montar: (principal: Lead, secundario: Lead) => AtualizarLeadInput,
 *   montarDiff: (antes: Lead, depois: Lead) => unknown[],
 * }} opcoes
 * @returns {Promise<Lead | undefined>} o principal depois da mesclagem
 */
export function mesclarLeads(
  tenantId,
  { principalId, secundarioId },
  { autorId = null, montar, montarDiff },
) {
  return getTenantClient(tenantId, async (tx) => {
    const travados = await tx.$queryRaw`
      SELECT
        id
      FROM
        modulo_crm.leads
      WHERE
        tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND id IN (${principalId}::uuid, ${secundarioId}::uuid)
      ORDER BY
        id
      FOR UPDATE
    `;

    if (travados.length !== DOIS_LEADS) {
      return undefined;
    }

    const principal = await lerLead(tx, tenantId, principalId);
    const secundario = await lerLead(tx, tenantId, secundarioId);

    const dados = montar(principal, secundario);

    await tx.$executeRaw`
      UPDATE modulo_crm.crm_activity
      SET
        lead_id = ${principalId}::uuid
      WHERE
        tenant_id = ${tenantId}::uuid
        AND lead_id = ${secundarioId}::uuid
    `;

    await tx.$executeRaw`
      UPDATE modulo_crm.crm_lead_event
      SET
        lead_id = ${principalId}::uuid
      WHERE
        tenant_id = ${tenantId}::uuid
        AND lead_id = ${secundarioId}::uuid
    `;

    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET
        ${Prisma.join(montarAtribuicoes(dados), ', ')}
      WHERE
        id = ${principalId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    await moverOportunidades(tx, tenantId, { principalId, secundarioId }, autorId);
    // FM6: links, respostas e alertas vão junto; dois ativos do mesmo formulário → fica o mais novo.
    await moverFormulariosNaMesclagem(tx, tenantId, { principalId, secundarioId });

    const depois = await lerLead(tx, tenantId, principalId);

    await publicarEventoDaPessoa(tx, tenantId, principalId, EVENTOS_PESSOA.MESCLADA);

    await inserirEvento(tx, tenantId, principalId, {
      tipo: TIPOS_EVENTO_LEAD.MESCLADO,
      autorId,
      diff: montarDiff(principal, depois),
      detalhes: { leadDescartadoId: secundarioId, nomeDescartado: secundario.nome },
    });

    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET
        deleted_at = now(),
        mesclado_em_id = ${principalId}::uuid
      WHERE
        id = ${secundarioId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    await inserirEvento(tx, tenantId, secundarioId, {
      tipo: TIPOS_EVENTO_LEAD.EXCLUIDO,
      autorId,
      detalhes: { mescladoEmId: principalId },
    });

    return depois;
  });
}

/**
 * Purga: apaga de vez o que foi excluído antes de `excluidoAntesDe`. As
 * tabelas que apontam pro lead seguem as FKs (CASCADE ou SET NULL), como
 * no DELETE de antes do M5.
 *
 * @param {string} tenantId
 * @param {Date} excluidoAntesDe
 * @returns {Promise<number>} quantos leads foram apagados
 */
export function purgarLixeira(tenantId, excluidoAntesDe) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      DELETE FROM modulo_crm.leads
      WHERE
        tenant_id = ${tenantId}::uuid
        AND deleted_at IS NOT NULL
        AND deleted_at < ${excluidoAntesDe}
    `,
  );
}
