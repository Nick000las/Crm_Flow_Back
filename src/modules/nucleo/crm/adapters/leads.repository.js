import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { CAMADA_1_CAMPOS, CAMADA_2_CAMPOS, TIPOS_EVENTO_LEAD } from '../constants.js';
import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';
import { inserirEvento } from './crm-lead-events.repository.js';

const FIRST_RESULT_INDEX = 0;

/**
 * Colunas devolvidas por toda leitura de lead (lista, detalhe, busca
 * filtrada) — uma lista só, pra uma coluna nova não ficar faltando em uma
 * das três. Espera `l` = leads e `f` = funil_estagios (LEFT JOIN).
 */
const COLUNAS_BASE = Prisma.sql`
  l.id, l.nome, l.primeiro_nome, l.telefone, l.email, l.valor, l.funil_estagio_id,
  l.fonte_lead, l.status, l.tags, l.ultima_interacao_em,
  l.empresa, l.cargo, l.cpf, l.cnpj, l.cidade, l.uf, l.cep, l.endereco,
  l.campanha_utm, l.data_conversao, l.probabilidade_fechamento,
  l.data_prevista_fechamento, l.motivo_perda, l.lead_score, l.proximo_followup,
  l.custom_fields, l.usuario_responsavel_id, f.nome AS estagio_nome,
  l.created_at, l.updated_at, l.archived_at, l.deleted_at, l.mesclado_em_id,
  (SELECT m.nome FROM modulo_crm.leads m WHERE m.id = l.mesclado_em_id) AS mesclado_em_nome,
  l.assigned_by_rule_id AS atribuido_por_regra_id,
  (SELECT r.nome FROM modulo_crm.crm_assignment_rule r WHERE r.id = l.assigned_by_rule_id) AS atribuido_por_regra_nome
`;

/**
 * `inatividade` = o "agora" do cálculo do lead esfriando (M9) quando a
 * flag está ligada; sem ele, `esfriando_desde` sai `null` sem custo.
 *
 * @param {Date | null} [inatividade]
 */
function colunasLeitura(inatividade = null) {
  return Prisma.sql`${COLUNAS_BASE}, ${colunaEsfriandoDesde(inatividade)}`;
}

const COLUNAS_LEITURA = colunasLeitura();

/**
 * Chaves editáveis por `atualizarLead` → coluna real. Única fonte de nome
 * de coluna que o SET dinâmico aceita interpolar (`Prisma.raw`) — nunca
 * uma chave vinda do cliente, mesma regra do filtro.
 */
const COLUNAS_EDITAVEIS = Object.freeze({
  ...CAMADA_1_CAMPOS,
  ...CAMADA_2_CAMPOS,
  funilEstagioId: 'funil_estagio_id',
  valor: 'valor',
  usuarioResponsavelId: 'usuario_responsavel_id',
});

const COLUNAS_UUID = new Set(['funilEstagioId', 'usuarioResponsavelId']);

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
 * @param {{ inatividade?: Date | null }} [opcoes] ver `colunasLeitura`
 * @returns {Promise<Lead | undefined>}
 */
export function buscarLeadPorId(tenantId, leadId, { inatividade = null } = {}) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${colunasLeitura(inatividade)}
      FROM modulo_crm.leads l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
      WHERE l.id = ${leadId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
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
 * @param {{ limite: number, offset: number, inatividade?: Date | null }} paginacao
 *   `inatividade`: ver `colunasLeitura`
 * @returns {Promise<{ itens: Lead[], total: number }>}
 */
export function buscarLeadsComFiltro(tenantId, condicoes, { limite, offset, inatividade = null }) {
  const where = Prisma.join([Prisma.sql`l.tenant_id = ${tenantId}::uuid`, ...condicoes], ' AND ');

  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM modulo_crm.leads l
      WHERE ${where}
    `;
    const itens = await tx.$queryRaw`
      SELECT ${colunasLeitura(inatividade)}
      FROM modulo_crm.leads l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
      WHERE ${where}
      ORDER BY f."order", l.created_at DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
    return { itens, total: contagem.total };
  });
}

/**
 * `email`/`telefone` já chegam validados pelo service ("pelo menos um dos
 * dois") — `chk_leads_email_ou_telefone` no banco é a rede de segurança
 * final. Camada 1/2 vão como `null` quando ausentes (nunca `undefined` —
 * Prisma não aceita `undefined` num `$queryRaw`).
 *
 * @param {string} tenantId
 * @param {CriarLeadInput & { atribuidoPorRegraId?: string | null }} dados  `atribuidoPorRegraId`: a regra
 *   da distribuição automática que escolheu o responsável (M12)
 * @param {{ autorId?: string | null, detalhes?: Record<string, unknown> }} [historico] sem ele (import), sem
 *   evento; `detalhes` vai no evento `criado` (ex.: como o responsável foi distribuído)
 * @returns {Promise<{ id: string }>}
 */
export function criarLead(tenantId, dados, historico) {
  const customFieldsJson = JSON.stringify(dados.customFields ?? {});
  return getTenantClient(tenantId, async (tx) => {
    const criado = await tx.$queryRaw`
      INSERT INTO modulo_crm.leads (
        tenant_id, nome, primeiro_nome, telefone, funil_estagio_id, custom_fields, valor, usuario_responsavel_id, assigned_by_rule_id,
        email, fonte_lead, status, tags, ultima_interacao_em,
        empresa, cargo, cpf, cnpj, cidade, uf, cep, endereco,
        campanha_utm, data_conversao, probabilidade_fechamento,
        data_prevista_fechamento, motivo_perda, lead_score, proximo_followup
      )
      VALUES (
        ${tenantId}::uuid, ${dados.nome}, ${dados.primeiroNome ?? null}, ${dados.telefone ?? null}, ${dados.funilEstagioId ?? null}::uuid, ${customFieldsJson}::jsonb, ${dados.valor ?? null}, ${dados.usuarioResponsavelId ?? null}::uuid, ${dados.atribuidoPorRegraId ?? null}::uuid,
        ${dados.email ?? null}, ${dados.fonteLead ?? null}, ${dados.status ?? null}, ${dados.tags ?? null}, ${dados.ultimaInteracaoEm ?? null},
        ${dados.empresa ?? null}, ${dados.cargo ?? null}, ${dados.cpf ?? null}, ${dados.cnpj ?? null}, ${dados.cidade ?? null}, ${dados.uf ?? null}, ${dados.cep ?? null}, ${dados.endereco ?? null},
        ${dados.campanhaUtm ?? null}, ${dados.dataConversao ?? null}, ${dados.probabilidadeFechamento ?? null},
        ${dados.dataPrevistaFechamento ?? null}, ${dados.motivoPerda ?? null}, ${dados.leadScore ?? null}, ${dados.proximoFollowup ?? null}
      )
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]);
    if (historico) {
      await inserirEvento(tx, tenantId, criado.id, {
        tipo: TIPOS_EVENTO_LEAD.CRIADO,
        autorId: historico.autorId,
        detalhes: historico.detalhes,
      });
    }
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
 * Com `historico`, o lead de antes é lido travado (`FOR UPDATE`) e o diff
 * (calculado por `historico.montarDiff`, função pura do service) vira um
 * evento `atualizado` — só se algo mudou de fato.
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
 * @param {{ inatividade?: Date | null }} [opcoes] ver `colunasLeitura` (só a linha devolvida)
 * @returns {Promise<Lead | undefined>}
 */
export function atualizarLead(tenantId, leadId, dados, historico, { inatividade = null } = {}) {
  const atribuicoes = montarAtribuicoes(dados);
  return getTenantClient(tenantId, async (tx) => {
    let antes;
    if (historico) {
      [antes] = await tx.$queryRaw`
        SELECT ${COLUNAS_LEITURA}
        FROM modulo_crm.leads l
        LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
        WHERE l.id = ${leadId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        FOR UPDATE OF l
      `;
      if (!antes) return undefined;
    }

    // CTE pra devolver as mesmas colunas da leitura, `estagio_nome` incluso
    // (referência `lead.estagio` do layout, M4).
    const [depois] = await tx.$queryRaw`
      WITH l AS (
        UPDATE modulo_crm.leads
        SET ${Prisma.join(atribuicoes, ', ')}
        WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING *
      )
      SELECT ${colunasLeitura(inatividade)}
      FROM l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
    `;

    if (historico && depois) {
      const diff = historico.montarDiff(antes, depois);
      if (diff.length > 0) {
        await inserirEvento(tx, tenantId, leadId, {
          tipo: historico.tipo ?? TIPOS_EVENTO_LEAD.ATUALIZADO,
          autorId: historico.autorId,
          diff,
          detalhes: historico.detalhes,
        });
      }
    }
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
    if (valor === undefined) continue;
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

  // Mudar o status conta como interação (D1, M6): no SET, `status` ainda é
  // o valor de antes. Editar outro campo não conta. Quem manda
  // `ultimaInteracaoEm` explícito decide sozinho.
  if (dados.status !== undefined && dados.ultimaInteracaoEm === undefined) {
    atribuicoes.push(
      Prisma.sql`ultima_interacao_em = CASE WHEN status IS DISTINCT FROM ${dados.status} THEN now() ELSE ultima_interacao_em END`,
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
      SET deleted_at = now()
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      RETURNING id, deleted_at
    `;
    if (excluido && historico) {
      await inserirEvento(tx, tenantId, leadId, { tipo: TIPOS_EVENTO_LEAD.EXCLUIDO, autorId: historico.autorId });
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
      SELECT id, archived_at FROM modulo_crm.leads
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!atual) return undefined;
    if ((atual.archived_at !== null) === arquivar) return { id: atual.id };

    const valor = arquivar ? Prisma.sql`now()` : Prisma.sql`NULL`;
    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET archived_at = ${valor}, updated_at = now()
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
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
      UPDATE modulo_crm.leads
      SET deleted_at = NULL
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
        AND deleted_at IS NOT NULL AND deleted_at >= ${excluidoDesde}
        AND mesclado_em_id IS NULL
      RETURNING id
    `;
    if (!restaurado) {
      // Descartado numa mesclagem (M7): os dados e o histórico já estão no outro lead.
      const [mesclado] = await tx.$queryRaw`
        SELECT mesclado_em_id FROM modulo_crm.leads
        WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
          AND deleted_at >= ${excluidoDesde} AND mesclado_em_id IS NOT NULL
      `;
      return mesclado ? { mescladoEmId: mesclado.mesclado_em_id } : undefined;
    }
    if (historico) {
      await inserirEvento(tx, tenantId, leadId, { tipo: TIPOS_EVENTO_LEAD.RESTAURADO, autorId: historico.autorId });
    }
    return restaurado;
  });
}

/**
 * Mesclagem (M7), tudo numa transação — se qualquer passo falhar, nada
 * muda. Ordem:
 * 1. trava os dois leads (ordem de id, pra duas mesclagens cruzadas não
 *    travarem uma à outra) — os dois fora da lixeira, senão `undefined`;
 * 2. `montar(principal, secundario)` (função pura do service) dá os dados
 *    finais do principal;
 * 3. atividades e eventos do secundário passam pro principal;
 * 4. UPDATE do principal + evento `mesclado` (diff + id do descartado);
 * 5. secundário pra lixeira com `mesclado_em_id` + evento `excluido`.
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
export function mesclarLeads(tenantId, { principalId, secundarioId }, { autorId = null, montar, montarDiff }) {
  return getTenantClient(tenantId, async (tx) => {
    const travados = await tx.$queryRaw`
      SELECT ${COLUNAS_LEITURA}
      FROM modulo_crm.leads l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
      WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        AND l.id IN (${principalId}::uuid, ${secundarioId}::uuid)
      ORDER BY l.id
      FOR UPDATE OF l
    `;
    const principal = travados.find((lead) => lead.id === principalId);
    const secundario = travados.find((lead) => lead.id === secundarioId);
    if (!principal || !secundario) return undefined;

    const dados = montar(principal, secundario);

    await tx.$executeRaw`
      UPDATE modulo_crm.crm_activity SET lead_id = ${principalId}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${secundarioId}::uuid
    `;
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_lead_event SET lead_id = ${principalId}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${secundarioId}::uuid
    `;

    const [depois] = await tx.$queryRaw`
      WITH l AS (
        UPDATE modulo_crm.leads
        SET ${Prisma.join(montarAtribuicoes(dados), ', ')}
        WHERE id = ${principalId}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING *
      )
      SELECT ${COLUNAS_LEITURA}
      FROM l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
    `;
    await inserirEvento(tx, tenantId, principalId, {
      tipo: TIPOS_EVENTO_LEAD.MESCLADO,
      autorId,
      diff: montarDiff(principal, depois),
      detalhes: { leadDescartadoId: secundarioId, nomeDescartado: secundario.nome },
    });

    await tx.$executeRaw`
      UPDATE modulo_crm.leads
      SET deleted_at = now(), mesclado_em_id = ${principalId}::uuid
      WHERE id = ${secundarioId}::uuid AND tenant_id = ${tenantId}::uuid
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
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NOT NULL AND deleted_at < ${excluidoAntesDe}
    `,
  );
}
