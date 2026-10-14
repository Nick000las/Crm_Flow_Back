import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { CAMADA_1_CAMPOS, CAMADA_2_CAMPOS } from '../constants.js';

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
  l.custom_fields, l.usuario_responsavel_id, f.nome AS estagio_nome
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
 */

/**
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
      WHERE l.id = ${leadId}::uuid AND l.tenant_id = ${tenantId}::uuid
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
 * gravado como veio, com ou sem máscara).
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
        WHERE tenant_id = ${tenantId}::uuid AND lower(email) = lower(${email})
        LIMIT 1
      `;
      if (porEmail) return porEmail;
    }

    if (telefoneDigitos) {
      const [porTelefone] = await tx.$queryRaw`
        SELECT id FROM modulo_crm.leads
        WHERE tenant_id = ${tenantId}::uuid
          AND regexp_replace(telefone, '[^0-9]', '', 'g') = ${telefoneDigitos}
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
 * @returns {Promise<{ id: string }>}
 */
export function criarLead(tenantId, dados) {
  const customFieldsJson = JSON.stringify(dados.customFields ?? {});
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
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
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Edição parcial com SET dinâmico: chave **omitida** (`undefined`) não
 * entra no UPDATE; chave **`null`** limpa a coluna. `custom_fields` faz
 * merge raso das chaves com valor e remove as que vieram `null`.
 * Regras de negócio sobre o que pode ser limpo (sobrar e-mail ou
 * telefone, obrigatórios) já foram checadas no service.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {AtualizarLeadInput} dados
 * @returns {Promise<Lead | undefined>}
 */
export function atualizarLead(tenantId, leadId, dados) {
  const atribuicoes = montarAtribuicoes(dados);
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.leads
      SET ${Prisma.join(atribuicoes, ', ')}
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING
        id, nome, telefone, email, valor, funil_estagio_id, custom_fields, usuario_responsavel_id,
        fonte_lead, status, tags, ultima_interacao_em,
        empresa, cargo, cpf, cnpj, cidade, uf, cep, endereco,
        campanha_utm, data_conversao, probabilidade_fechamento,
        data_prevista_fechamento, motivo_perda, lead_score, proximo_followup
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
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

  atribuicoes.push(Prisma.sql`updated_at = now()`);
  return atribuicoes;
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function removerLead(tenantId, leadId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      DELETE FROM modulo_crm.leads
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}
