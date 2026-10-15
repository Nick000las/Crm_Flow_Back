import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { formatarTelefoneBR } from '#shared/formatters/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  buscarLeadsComFiltro,
  buscarLeadPorId,
  criarLead as criarLeadRepository,
  atualizarLead as atualizarLeadRepository,
  removerLead as removerLeadRepository,
} from '../adapters/leads.repository.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';
import { listarDefinicoesPorTenant } from './field-definitions.service.js';
import { listarVisibilidadeDoTenant } from './field-visibility.service.js';
import { montarCondicoes } from './lead-filter.service.js';
import {
  CAMADA,
  CAMADA_1_CAMPOS,
  CAMADA_2_COLUNA_PARA_CAMPO,
  CAMADA_2_METADADOS,
  CAMPOS_CAMADA_1,
} from '../constants.js';

/**
 * SERVICE: lógica de negócio pura. Nunca importa Fastify.
 * @typedef {import('../types/index.js').Lead} Lead
 * @typedef {import('../types/index.js').CriarLeadInput} CriarLeadInput
 * @typedef {import('../types/index.js').AtualizarLeadInput} AtualizarLeadInput
 * @typedef {import('../types/index.js').FieldVisibility} FieldVisibility
 */

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<Lead>}
 */
export async function buscarLeadFormatado(tenantId, leadId) {
  const [lead, visibilidade] = await Promise.all([
    buscarLeadPorId(tenantId, leadId),
    listarVisibilidadeDoTenant(tenantId),
  ]);

  if (!lead) {
    throw leadNaoEncontrado();
  }

  return formatarLead(lead, visibilidade);
}

/**
 * @param {string} tenantId
 * @param {CriarLeadInput} input
 * @param {string} [usuarioId] quem está criando — vira o responsável
 *   quando `input.usuarioResponsavelId` não vem
 * @returns {Promise<{ id: string }>}
 */
export async function registrarNovoLead(tenantId, input, usuarioId) {
  if (input.nome.trim().length === 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Nome do lead não pode ser vazio',
      fields: { nome: ['Informe o nome do lead'] },
    });
  }

  validarEmailOuTelefone(input);

  const [visibilidade, definicoes] = await Promise.all([
    listarVisibilidadeDoTenant(tenantId),
    listarDefinicoesPorTenant(tenantId),
  ]);
  validarCamada2Obrigatoria(input, visibilidade);

  // Criação exige todo campo customizado obrigatório presente — edição não
  // (ver validarCustomFields).
  validarCustomFields(definicoes, input.customFields, { exigirObrigatorios: true });

  // O criador já veio de um token válido deste tenant — só um responsável
  // escolhido explicitamente precisa ser conferido.
  if (input.usuarioResponsavelId && input.usuarioResponsavelId !== usuarioId) {
    await validarResponsavel(tenantId, input.usuarioResponsavelId);
  }

  // `customFields` vai como objeto puro — é o repository quem faz o
  // `JSON.stringify` (uma vez só). Stringificar aqui também gravaria uma
  // string dupla-serializada no JSONB em vez do objeto.
  return criarLeadRepository(tenantId, {
    ...input,
    usuarioResponsavelId: input.usuarioResponsavelId ?? usuarioId,
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {AtualizarLeadInput} input
 * @returns {Promise<Lead>}
 */
export async function atualizarLeadExistente(tenantId, leadId, input) {
  if (input.nome !== undefined && input.nome.trim().length === 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Nome do lead não pode ser vazio',
      fields: { nome: ['Informe o nome do lead'] },
    });
  }

  const [visibilidade, definicoes] = await Promise.all([
    listarVisibilidadeDoTenant(tenantId),
    listarDefinicoesPorTenant(tenantId),
  ]);

  // Edição é parcial: só valida tipo/opções das chaves que vieram agora,
  // nunca exige que TODO campo obrigatório esteja neste payload. O que a
  // edição pode fazer é LIMPAR um campo (`null`) — isso sim é checado.
  validarCustomFields(definicoes, input.customFields, { exigirObrigatorios: false });
  validarLimpezaDeObrigatorios(input, visibilidade, definicoes);
  await validarContatoRestante(tenantId, leadId, input);

  if (input.usuarioResponsavelId) {
    await validarResponsavel(tenantId, input.usuarioResponsavelId);
  }

  const leadAtualizado = await atualizarLeadRepository(tenantId, leadId, input);

  // UPDATE ... RETURNING sem linha = id não existe (ou não é deste
  // tenant) — mesmo padrão de field-definitions.service.js, sem query
  // extra só pra checar antes.
  if (!leadAtualizado) {
    throw leadNaoEncontrado();
  }

  return formatarLead(leadAtualizado, visibilidade);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<{ removido: true }>}
 */
export async function excluirLead(tenantId, leadId) {
  const leadRemovido = await removerLeadRepository(tenantId, leadId);

  if (!leadRemovido) {
    throw leadNaoEncontrado();
  }

  return { removido: true };
}

/**
 * Fonte única pra formulário/filtro/mapeamento de import (docs/plano-crm-campos-hibridos.md,
 * decisão 5) — Camada 1 fixa + Camada 2 visível pro tenant + Camada 3
 * (definições customizadas), no mesmo shape `{ chave, label, tipo, camada,
 * obrigatorio, ordem, opcoes? }`.
 *
 * @param {string} tenantId
 * @returns {Promise<Array<{ chave: string, label: string, tipo: string, camada: 1 | 2 | 3, obrigatorio: boolean, ordem: number, opcoes?: string[] | null }>>}
 */
export async function listarCamposDoTenant(tenantId) {
  const [visibilidade, definicoes] = await Promise.all([
    listarVisibilidadeDoTenant(tenantId),
    listarDefinicoesPorTenant(tenantId),
  ]);

  return montarCampos(visibilidade, definicoes);
}

/**
 * POST /crm/leads/search — filtro combinando as 3 camadas + paginação.
 *
 * @param {string} tenantId
 * @param {import('./lead-filter.service.js').FiltroLeads & { paginacao: { pagina: number, tamanho: number } }} input
 * @returns {Promise<{ itens: Lead[], total: number, pagina: number, tamanho: number }>}
 */
export async function pesquisarLeads(tenantId, input) {
  const { pagina, tamanho } = input.paginacao;
  const { itens, total } = await buscarLeadsFiltrados(tenantId, input, {
    limite: tamanho,
    offset: (pagina - 1) * tamanho,
  });

  return { itens, total, pagina, tamanho };
}

/**
 * Base comum da busca e do export: monta os campos ativos (uma vez só),
 * traduz o filtro e já devolve os leads com Camada 2 desligada removida.
 * `campos` vai junto pra quem chama (export) não buscar de novo.
 *
 * @param {string} tenantId
 * @param {import('./lead-filter.service.js').FiltroLeads} filtro
 * @param {{ limite: number, offset: number }} paginacao
 */
export async function buscarLeadsFiltrados(tenantId, filtro, paginacao) {
  const [visibilidade, definicoes] = await Promise.all([
    listarVisibilidadeDoTenant(tenantId),
    listarDefinicoesPorTenant(tenantId),
  ]);
  const campos = montarCampos(visibilidade, definicoes);
  const condicoes = montarCondicoes(filtro, campos);
  const { itens, total } = await buscarLeadsComFiltro(tenantId, condicoes, paginacao);

  return {
    itens: itens.map((lead) => formatarLead(lead, visibilidade)),
    total,
    campos,
  };
}

/**
 * @param {FieldVisibility[]} visibilidade
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 */
function montarCampos(visibilidade, definicoes) {
  // `coluna` (Camadas 1/2): nome da propriedade no lead lido (snake_case),
  // enquanto `chave` (camelCase) é o que vai no payload e no filtro. A
  // Camada 3 não tem `coluna` — o valor fica em `custom_fields[chave]`.
  const camposCamada1 = CAMPOS_CAMADA_1.map((campo) => ({
    ...campo,
    coluna: CAMADA_1_CAMPOS[campo.chave],
    camada: CAMADA.CAMADA_1,
  }));

  const camposCamada2 = visibilidade
    .filter((item) => item.visivel)
    .map((item) => ({
      chave: CAMADA_2_COLUNA_PARA_CAMPO[item.coluna],
      coluna: item.coluna,
      ...CAMADA_2_METADADOS[item.coluna],
      camada: CAMADA.CAMADA_2,
      obrigatorio: item.obrigatorio,
      ordem: item.ordem,
    }));

  const camposCamada3 = definicoes.map((definicao) => ({ ...definicao, camada: CAMADA.CAMADA_3 }));

  return [...camposCamada1, ...camposCamada2, ...camposCamada3].sort((a, b) => a.ordem - b.ordem);
}

/**
 * `email`/`telefone` são cada um opcional isoladamente no schema Zod (não
 * dá pra expressar "A ou B obrigatório" por campo isolado) — quem garante
 * "pelo menos um dos dois" é aqui + `chk_leads_email_ou_telefone` no banco
 * como rede de segurança final. Só roda na criação: edição parcial nunca
 * limpa um campo pra `null` (ver comentário em `atualizarLeadExistente`).
 *
 * @param {CriarLeadInput} input
 */
function validarEmailOuTelefone(input) {
  if (!input.email && !input.telefone) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Informe e-mail ou telefone',
      fields: { email: ['Informe e-mail ou telefone'] },
    });
  }
}

/**
 * Campo de Camada 2 marcado `obrigatorio: true` só é exigido se também
 * estiver `visivel: true` — um campo desligado não pode travar a criação
 * do lead. `visibilidade[].coluna` é snake_case (nome da coluna real);
 * `input` usa as chaves camelCase do schema — `CAMADA_2_COLUNA_PARA_CAMPO`
 * faz a ponte entre os dois. Só roda na criação (mesma assimetria de
 * `validarCustomFields`).
 *
 * @param {CriarLeadInput} input
 * @param {FieldVisibility[]} visibilidade
 */
function validarCamada2Obrigatoria(input, visibilidade) {
  for (const item of visibilidade) {
    if (!item.visivel || !item.obrigatorio) continue;

    const campo = CAMADA_2_COLUNA_PARA_CAMPO[item.coluna];
    if (valorAusente(input[campo])) {
      const label = CAMADA_2_METADADOS[item.coluna]?.label ?? campo;
      throw new AppError({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Informe o campo "${label}"`,
        fields: { [campo]: [`"${label}" é obrigatório`] },
      });
    }
  }
}

/**
 * Remove do lead qualquer coluna de Camada 2 com `visivel: false` pro
 * tenant antes de devolver — não é só esconder no frontend, o dado bruto
 * não pode vazar na resposta HTTP de um campo desligado (docs/plano-crm-campos-hibridos.md,
 * seção 3). Também aplica `formatarTelefoneBR` (mesmo de antes desta
 * mudança). `visibilidade` já vem com a lista completa das 15 colunas de
 * Camada 2 (default `visivel: false` pras nunca configuradas — ver
 * `field-visibility.service.js`), então dá pra iterar só sobre ela em vez
 * de precisar de outra lista de colunas.
 *
 * @param {Lead} lead
 * @param {FieldVisibility[]} visibilidade
 * @returns {Lead}
 */
function formatarLead(lead, visibilidade) {
  // `telefone` é nullable desde a migration 0009 (lead só com e-mail).
  const leadFormatado = { ...lead, telefone: lead.telefone ? formatarTelefoneBR(lead.telefone) : null };

  for (const { coluna, visivel } of visibilidade) {
    if (!visivel) {
      delete leadFormatado[coluna];
    }
  }

  return leadFormatado;
}

/**
 * Valida `customFields` contra as `tenant_lead_field_definitions` vigentes
 * do tenant — é dado de banco por tenant, então não dá pra expressar isso
 * num schema Zod estático na borda (o "schema" de custom_fields muda
 * conforme o tenant e só existe em tempo de execução).
 *
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 * @param {Record<string, unknown> | undefined} customFields
 * @param {{ exigirObrigatorios: boolean }} opcoes
 */
function validarCustomFields(definicoes, customFields, { exigirObrigatorios }) {
  const valores = customFields ?? {};
  const definicaoPorChave = new Map(definicoes.map((definicao) => [definicao.chave, definicao]));

  for (const chave of Object.keys(valores)) {
    const definicao = definicaoPorChave.get(chave);

    if (!definicao) {
      throw new AppError({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Campo customizado desconhecido: "${chave}"`,
        fields: { customFields: [`"${chave}" não corresponde a nenhum campo cadastrado`] },
      });
    }

    validarValorPorTipo(definicao, valores[chave]);
  }

  if (exigirObrigatorios) {
    for (const definicao of definicoes) {
      if (definicao.obrigatorio && valorAusente(valores[definicao.chave])) {
        throw new AppError({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Informe o campo "${definicao.label}"`,
          fields: { customFields: [`"${definicao.label}" é obrigatório`] },
        });
      }
    }
  }
}

/** @param {unknown} valor */
function valorAusente(valor) {
  return valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0);
}

/**
 * @param {import('../types/index.js').FieldDefinition} definicao
 * @param {unknown} valor
 */
function validarValorPorTipo(definicao, valor) {
  const erroDeTipo = () =>
    new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Valor inválido para o campo "${definicao.label}"`,
      fields: { customFields: [`"${definicao.label}" espera um valor do tipo ${definicao.tipo}`] },
    });

  if (valorAusente(valor)) return; // obrigatoriedade é checada à parte

  switch (definicao.tipo) {
    case 'texto':
      if (typeof valor !== 'string') throw erroDeTipo();
      return;
    case 'numero':
      if (typeof valor !== 'number' || !Number.isFinite(valor)) throw erroDeTipo();
      return;
    case 'data':
      if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) throw erroDeTipo();
      return;
    case 'booleano':
      if (typeof valor !== 'boolean') throw erroDeTipo();
      return;
    case 'selecao':
      if (!definicao.opcoes?.includes(valor)) throw erroDeTipo();
      return;
    case 'selecao_multipla':
      if (!Array.isArray(valor) || !valor.every((item) => definicao.opcoes?.includes(item))) {
        throw erroDeTipo();
      }
      return;
    default:
      // FIELD_DEFINITION_TIPOS (constants.js) e o CHECK do banco garantem
      // que `tipo` só chega aqui com um dos 6 valores válidos — default
      // é só defesa em profundidade, nunca deveria disparar de verdade.
      throw erroDeTipo();
  }
}

/**
 * Na edição, `email: null`/`telefone: null` limpa o campo — só é permitido
 * se o outro continuar preenchido (`chk_leads_email_ou_telefone`). Só
 * busca o lead atual quando o payload de fato limpa um dos dois.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {AtualizarLeadInput} input
 */
async function validarContatoRestante(tenantId, leadId, input) {
  if (input.email !== null && input.telefone !== null) return;

  const atual = await buscarLeadPorId(tenantId, leadId);
  if (!atual) throw leadNaoEncontrado();

  const email = input.email !== undefined ? input.email : atual.email;
  const telefone = input.telefone !== undefined ? input.telefone : atual.telefone;
  if (!email && !telefone) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'O lead precisa manter e-mail ou telefone',
      fields: { [input.email === null ? 'email' : 'telefone']: ['O lead precisa manter e-mail ou telefone'] },
    });
  }
}

/**
 * Campo obrigatório (Camada 2 visível com `obrigatorio`, ou definição de
 * Camada 3 obrigatória) não pode ser limpo com `null` na edição.
 *
 * @param {AtualizarLeadInput} input
 * @param {FieldVisibility[]} visibilidade
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 */
function validarLimpezaDeObrigatorios(input, visibilidade, definicoes) {
  for (const item of visibilidade) {
    if (!item.visivel || !item.obrigatorio) continue;
    const campo = CAMADA_2_COLUNA_PARA_CAMPO[item.coluna];
    if (input[campo] === null) {
      throw campoObrigatorioNaoPodeSerLimpo(campo, CAMADA_2_METADADOS[item.coluna]?.label ?? campo);
    }
  }

  for (const definicao of definicoes) {
    if (definicao.obrigatorio && input.customFields?.[definicao.chave] === null) {
      throw campoObrigatorioNaoPodeSerLimpo('customFields', definicao.label);
    }
  }
}

/** @param {string} campo @param {string} label */
function campoObrigatorioNaoPodeSerLimpo(campo, label) {
  return new AppError({
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: ERROR_CODES.VALIDATION_ERROR,
    message: `"${label}" é obrigatório e não pode ser limpo`,
    fields: { [campo]: [`"${label}" é obrigatório e não pode ser limpo`] },
  });
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 */
async function validarResponsavel(tenantId, usuarioId) {
  if (!(await buscarUsuarioAtivoDoTenant(tenantId, usuarioId))) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Responsável inválido',
      fields: { usuarioResponsavelId: ['Escolha um usuário ativo desta conta'] },
    });
  }
}

function leadNaoEncontrado() {
  return new AppError({
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.RESOURCE_NOT_FOUND,
    message: 'Lead não encontrado',
  });
}
