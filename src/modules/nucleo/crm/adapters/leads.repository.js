import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { CAMADA_1_CAMPOS, CAMADA_2_CAMPOS, TIPOS_EVENTO_LEAD } from '../constants.js';
import { inserirEvento } from './crm-lead-events.repository.js';

const FIRST_RESULT_INDEX = 0;

/**
 * Colunas devolvidas por toda leitura de lead (lista, detalhe, busca
 * filtrada) — uma lista só, pra uma coluna nova não ficar faltando em uma
 * das três. Espera `l` = leads e `f` = funil_estagios (LEFT JOIN).
 */
const COLUNAS_LEITURA = Prisma.sql`
  l.id, l.nome, l.telefone, l.email, l.valor, l.funil_estagio_id,
  l.fonte_lead, l.status, l.tags, l.ultima_interacao_em,
  l.empresa, l.cargo, l.cpf, l.cnpj, l.cidade, l.uf, l.cep, l.endereco,
  l.campanha_utm, l.data_conversao, l.probabilidade_fechamento,
  l.data_prevista_fechamento, l.motivo_perda, l.lead_score, l.proximo_followup,
  l.custom_fields, l.usuario_responsavel_id, f.nome AS estagio_nome,
  l.created_at, l.updated_at, l.archived_at, l.deleted_at
`;

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
 * @returns {Promise<Lead | undefined>}
 */
export function buscarLeadPorId(tenantId, leadId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${COLUNAS_LEITURA}
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
 * @param {{ limite: number, offset: number }} paginacao
 * @returns {Promise<{ itens: Lead[], total: number }>}
 */
export function buscarLeadsComFiltro(tenantId, condicoes, { limite, offset }) {
  const where = Prisma.join([Prisma.sql`l.tenant_id = ${tenantId}::uuid`, ...condicoes], ' AND ');

  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM modulo_crm.leads l
      WHERE ${where}
    `;
    const itens = await tx.$queryRaw`
      SELECT ${COLUNAS_LEITURA}
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
 * Deduplicação do import: procura primeiro por e-mail (case-insensitive)
 * e, se não achar, por telefone comparando só os dígitos (o telefone é
 * gravado como veio, com ou sem máscara). Lead na lixeira não conta
 * (reimportar cria de novo); arquivado conta, porque continua existindo.
 *
 * @param {string} tenantId
 * @param {{ email?: string | null, telefoneDigitos?: string | null }} chaves
 * @returns {Promise<{ id: string } | undefined>}
 */
export function buscarLeadDuplicado(tenantId, { email, telefoneDigitos }) {
  return getTenantClient(tenantId, async (tx) => {
    if (email) {
      const [porEmail] = await tx.$queryRaw`
        SELECT id FROM modulo_crm.leads
        WHERE tenant_id = ${tenantId}::uuid AND lower(email) = lower(${email}) AND deleted_at IS NULL
        LIMIT 1
      `;
      if (porEmail) return porEmail;
    }

    if (telefoneDigitos) {
      const [porTelefone] = await tx.$queryRaw`
        SELECT id FROM modulo_crm.leads
        WHERE tenant_id = ${tenantId}::uuid
          AND regexp_replace(telefone, '[^0-9]', '', 'g') = ${telefoneDigitos}
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (porTelefone) return porTelefone;
    }

    return undefined;
  });
}

/**
 * `email`/`telefone` já chegam validados pelo service ("pelo menos um dos
 * dois") — `chk_leads_email_ou_telefone` no banco é a rede de segurança
 * final. Camada 1/2 vão como `null` quando ausentes (nunca `undefined` —
 * Prisma não aceita `undefined` num `$queryRaw`).
 *
 * @param {string} tenantId
 * @param {CriarLeadInput} dados
 * @param {{ autorId?: string | null }} [historico] sem ele (import), sem evento
 * @returns {Promise<{ id: string }>}
 */
export function criarLead(tenantId, dados, historico) {
  const customFieldsJson = JSON.stringify(dados.customFields ?? {});
  return getTenantClient(tenantId, async (tx) => {
    const criado = await tx.$queryRaw`
      INSERT INTO modulo_crm.leads (
        tenant_id, nome, telefone, funil_estagio_id, custom_fields, valor, usuario_responsavel_id,
        email, fonte_lead, status, tags, ultima_interacao_em,
        empresa, cargo, cpf, cnpj, cidade, uf, cep, endereco,
        campanha_utm, data_conversao, probabilidade_fechamento,
        data_prevista_fechamento, motivo_perda, lead_score, proximo_followup
      )
      VALUES (
        ${tenantId}::uuid, ${dados.nome}, ${dados.telefone ?? null}, ${dados.funilEstagioId ?? null}::uuid, ${customFieldsJson}::jsonb, ${dados.valor ?? null}, ${dados.usuarioResponsavelId ?? null}::uuid,
        ${dados.email ?? null}, ${dados.fonteLead ?? null}, ${dados.status ?? null}, ${dados.tags ?? null}, ${dados.ultimaInteracaoEm ?? null},
        ${dados.empresa ?? null}, ${dados.cargo ?? null}, ${dados.cpf ?? null}, ${dados.cnpj ?? null}, ${dados.cidade ?? null}, ${dados.uf ?? null}, ${dados.cep ?? null}, ${dados.endereco ?? null},
        ${dados.campanhaUtm ?? null}, ${dados.dataConversao ?? null}, ${dados.probabilidadeFechamento ?? null},
        ${dados.dataPrevistaFechamento ?? null}, ${dados.motivoPerda ?? null}, ${dados.leadScore ?? null}, ${dados.proximoFollowup ?? null}
      )
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]);
    if (historico) {
      await inserirEvento(tx, tenantId, criado.id, { tipo: TIPOS_EVENTO_LEAD.CRIADO, autorId: historico.autorId });
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
 * @param {{ autorId?: string | null, montarDiff: (antes: Lead, depois: Lead) => unknown[] }} [historico]
 * @returns {Promise<Lead | undefined>}
 */
export function atualizarLead(tenantId, leadId, dados, historico) {
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
      SELECT ${COLUNAS_LEITURA}
      FROM l
      LEFT JOIN modulo_crm.funil_estagios f ON l.funil_estagio_id = f.id
    `;

    if (historico && depois) {
      const diff = historico.montarDiff(antes, depois);
      if (diff.length > 0) {
        await inserirEvento(tx, tenantId, leadId, { tipo: TIPOS_EVENTO_LEAD.ATUALIZADO, autorId: historico.autorId, diff });
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
      RETURNING id
    `;
    if (restaurado && historico) {
      await inserirEvento(tx, tenantId, leadId, { tipo: TIPOS_EVENTO_LEAD.RESTAURADO, autorId: historico.autorId });
    }
    return restaurado;
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
