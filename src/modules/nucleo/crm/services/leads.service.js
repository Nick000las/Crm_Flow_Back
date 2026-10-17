import { erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { featureAtiva, garantirFeature } from '#core/tenant/feature-flags.js';
import { formatarTelefoneBR } from '#shared/formatters/index.js';
import {
  buscarLeadsComFiltro,
  buscarLeadPorId,
  criarLead as criarLeadRepository,
  atualizarLead as atualizarLeadRepository,
} from '../adapters/leads.repository.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';
import {
  camposDoContexto,
  camposParaFiltro,
  customFieldsParaApi,
  customFieldsParaArmazenamento,
  exigidoNaCriacao,
  obterSchemaCampos,
} from './field-schema.service.js';
import { dataDaPurga, montarCondicoes } from './lead-filter.service.js';
import { diffDoLead } from './historico.service.js';
import { identificadorDaBusca } from './layout.service.js';
import { gravarTagsNovas, resolverOpcoesDoLead } from './listas.service.js';
import { normalizarTelefone, normalizarValorDoTipo, valorAusente, valorValidoParaTipo } from './tipos-campo.service.js';
import { CAMADA, CAMPOS_SISTEMA, CRM_FEATURES, SITUACOES_LEAD } from '../constants.js';

/**
 * Campos com regra própria de obrigatoriedade: `nome` é checado à parte e
 * `email`/`telefone` seguem "pelo menos um dos dois".
 */
const CHAVES_OBRIGATORIEDADE_PROPRIA = new Set(['nome', 'email', 'telefone']);

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
  const [lead, schema] = await Promise.all([buscarLeadPorId(tenantId, leadId), obterSchemaCampos(tenantId)]);

  if (!lead) {
    throw leadNaoEncontrado();
  }

  return formatarLead(lead, schema);
}

/**
 * @param {string} tenantId
 * @param {CriarLeadInput} input
 * @param {string} [usuarioId] quem está criando — vira o responsável
 *   quando `input.usuarioResponsavelId` não vem
 * @returns {Promise<{ id: string }>}
 */
export async function registrarNovoLead(tenantId, entrada, usuarioId) {
  const input = comContatoNormalizado(entrada);
  if (input.nome.trim().length === 0) {
    throw erroDeValidacao('nome', 'Nome do lead não pode ser vazio', 'Informe o nome do lead');
  }

  validarEmailOuTelefone(input);

  const schema = await obterSchemaCampos(tenantId);
  const { definicoes } = schema;
  validarCustomFields(definicoes, input.customFields);
  // Criação exige todo campo obrigatório (nativo ou personalizado) do
  // formulário de criação — edição não (ver atualizarLeadExistente).
  validarObrigatoriosNaCriacao(schema.campos, input);
  // Status/origem/motivo só com opção ativa; tags viram keys (M3).
  const { input: comListas, tagsNovas } = await resolverOpcoesDoLead(schema.listas, input);

  // O criador já veio de um token válido deste tenant — só um responsável
  // escolhido explicitamente precisa ser conferido.
  if (input.usuarioResponsavelId && input.usuarioResponsavelId !== usuarioId) {
    await validarResponsavel(tenantId, input.usuarioResponsavelId);
  }

  // Tag nova entra na lista só quando tudo já foi validado.
  await gravarTagsNovas(tenantId, tagsNovas);
  // `customFields` vai como objeto puro — é o repository quem faz o
  // `JSON.stringify` (uma vez só). Stringificar aqui também gravaria uma
  // string dupla-serializada no JSONB em vez do objeto.
  return criarLeadRepository(
    tenantId,
    { ...comCustomFieldsArmazenaveis(comListas, definicoes), usuarioResponsavelId: input.usuarioResponsavelId ?? usuarioId },
    { autorId: usuarioId ?? null },
  );
}

/**
 * O diff dos campos alterados vai pro histórico (M6), com `usuarioId` de
 * autor. `ultimaInteracaoEm` só entra no diff se veio no payload — quando
 * é a mudança de status que a atualiza, não é edição do usuário.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {AtualizarLeadInput} input
 * @param {string} [usuarioId] quem está editando (do token)
 * @returns {Promise<Lead>}
 */
export async function atualizarLeadExistente(tenantId, leadId, entrada, usuarioId) {
  const input = comContatoNormalizado(entrada);
  if (input.nome !== undefined && input.nome.trim().length === 0) {
    throw erroDeValidacao('nome', 'Nome do lead não pode ser vazio', 'Informe o nome do lead');
  }

  const schema = await obterSchemaCampos(tenantId);
  const { definicoes } = schema;

  // Edição é parcial: só valida tipo/opções das chaves que vieram agora,
  // nunca exige que TODO campo obrigatório esteja neste payload. O que a
  // edição pode fazer é LIMPAR um campo (`null`) — isso sim é checado.
  validarCustomFields(definicoes, input.customFields);
  validarLimpezaDeObrigatorios(input, schema.campos, definicoes);
  await validarContatoRestante(tenantId, leadId, input);
  // Opção inativa que o lead já tinha continua aceita (só aí o lead é lido).
  const { input: comListas, tagsNovas } = await resolverOpcoesDoLead(schema.listas, input, () =>
    buscarLeadPorId(tenantId, leadId),
  );

  if (input.usuarioResponsavelId) {
    await validarResponsavel(tenantId, input.usuarioResponsavelId);
  }

  await gravarTagsNovas(tenantId, tagsNovas);
  const ignorar = input.ultimaInteracaoEm === undefined ? ['ultimaInteracaoEm'] : [];
  const leadAtualizado = await atualizarLeadRepository(tenantId, leadId, comCustomFieldsArmazenaveis(comListas, definicoes), {
    autorId: usuarioId ?? null,
    montarDiff: (antes, depois) => diffDoLead(antes, depois, { ignorar }),
  });

  // UPDATE ... RETURNING sem linha = id não existe (ou não é deste
  // tenant) — mesmo padrão de field-definitions.service.js, sem query
  // extra só pra checar antes.
  if (!leadAtualizado) {
    throw leadNaoEncontrado();
  }

  return formatarLead(leadAtualizado, schema);
}

/**
 * Fonte única pra formulário/filtro/mapeamento de import (docs/crm/plano-campos-hibridos.md,
 * decisão 5) — Camada 1 + Camada 2 visível pro tenant + Camada 3
 * (definições customizadas), no mesmo shape `{ chave, label, tipo, camada,
 * obrigatorio, ordem, visibilidade, opcoes? }`. Com `contexto` (M2), só os
 * campos visíveis nele — `create_form`, `detail`, `table` ou `filter`.
 *
 * @param {string} tenantId
 * @param {string} [contexto]
 * @returns {Promise<Array<{ chave: string, label: string, tipo: string, camada: 1 | 2 | 3, obrigatorio: boolean, ordem: number, visibilidade: Record<string, boolean>, opcoes?: string[] | null }>>}
 */
export async function listarCamposDoTenant(tenantId, contexto) {
  const { campos } = await obterSchemaCampos(tenantId);
  return contexto ? camposDoContexto(campos, contexto) : campos;
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
  const [schema, identificador, comArquivo] = await Promise.all([
    obterSchemaCampos(tenantId),
    identificadorDaBusca(tenantId),
    featureAtiva(tenantId, CRM_FEATURES.ARQUIVO),
  ]);
  // Arquivados e lixeira só existem com o arquivo ligado (M5).
  if (!comArquivo && filtro.situacao && filtro.situacao !== SITUACOES_LEAD.ATIVOS) {
    await garantirFeature(tenantId, CRM_FEATURES.ARQUIVO);
  }
  const condicoes = montarCondicoes(filtro, camposParaFiltro(schema), { identificador, comArquivo });
  const { itens, total } = await buscarLeadsComFiltro(tenantId, condicoes, paginacao);

  return {
    itens: itens.map((lead) => formatarLead(lead, schema)),
    total,
    campos: schema.campos,
  };
}

/**
 * `customFields` por `chave` (API) → normalizado por tipo e indexado por
 * `id` do campo, como é gravado (`customFieldsParaArmazenamento`).
 *
 * @template {{ customFields?: Record<string, unknown> }} T
 * @param {T} input
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 * @returns {T}
 */
function comCustomFieldsArmazenaveis(input, definicoes) {
  if (input.customFields === undefined) return input;
  const tipoPorChave = new Map(definicoes.map((definicao) => [definicao.chave, definicao.tipo]));
  // Forma canônica por tipo (telefone só dígitos, e-mail minúsculo...) —
  // depois de validado, antes de trocar `chave` por `id`.
  const normalizados = Object.fromEntries(
    Object.entries(input.customFields).map(([chave, valor]) => [
      chave,
      valor === null ? null : normalizarValorDoTipo(tipoPorChave.get(chave), valor),
    ]),
  );
  return { ...input, customFields: customFieldsParaArmazenamento(definicoes, normalizados) };
}

/**
 * E-mail e telefone nativos na forma canônica dos tipos `email`/`telefone`
 * (a mesma do personalizado): telefone só dígitos, sem DDI 55; e-mail
 * minúsculo. `null` (limpar, na edição) passa direto. Leads gravados antes
 * disso podem ter máscara — o filtro compara pela forma normalizada.
 *
 * @template {{ email?: string | null, telefone?: string | null }} T
 * @param {T} input
 * @returns {T}
 */
function comContatoNormalizado(input) {
  const normalizado = { ...input };
  if (typeof input.telefone === 'string') {
    const telefone = normalizarTelefone(input.telefone);
    if (!telefone) {
      throw erroDeValidacao(
        'telefone',
        'Informe um telefone válido',
        'Informe um telefone com DDD (10 ou 11 dígitos)',
      );
    }
    normalizado.telefone = telefone;
  }
  if (typeof input.email === 'string') normalizado.email = input.email.trim().toLowerCase();
  return normalizado;
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
    throw erroDeValidacao('email', 'Informe e-mail ou telefone');
  }
}

/**
 * Obrigatoriedade na criação, lida do resolver, pras três camadas: Camada 2
 * só entra em `campos` se estiver ligada, a Camada 1 pode ter sido marcada
 * obrigatória pelo tenant (M2) e o personalizado traz o `obrigatorio` da
 * definição. Só conta campo do formulário de criação (`exigidoNaCriacao`).
 *
 * @param {ReturnType<typeof import('./field-schema.service.js').montarCampos>} campos
 * @param {CriarLeadInput} input
 */
function validarObrigatoriosNaCriacao(campos, input) {
  for (const campo of campos) {
    if (!exigidoNaCriacao(campo) || CHAVES_OBRIGATORIEDADE_PROPRIA.has(campo.chave)) continue;

    const personalizado = campo.camada === CAMADA.CAMADA_3;
    const valor = personalizado ? input.customFields?.[campo.chave] : input[campo.chave];
    if (valorAusente(valor)) {
      throw erroDeValidacao(
        personalizado ? 'customFields' : campo.chave,
        `Informe o campo "${campo.label}"`,
        `"${campo.label}" é obrigatório`,
      );
    }
  }
}

/**
 * Campo oculto em TODOS os contextos é "desligado": o dado bruto não sai
 * na resposta HTTP, não só some da tela (docs/crm/plano-campos-hibridos.md,
 * seção 3). Vale igual pras três camadas — coluna nativa (Camada 1 que
 * pode ser ocultada, Camada 2) e personalizado. Oculto só em alguns
 * contextos continua vindo; cada tela filtra pelo seu (`camposDoContexto`).
 *
 * Também aplica `formatarTelefoneBR`. `custom_fields` é gravado por `id`
 * do campo e volta por `chave` (`customFieldsParaApi`). Lead na lixeira
 * (só na busca `situacao: lixeira`) ganha `purga_em`.
 *
 * @param {Lead} lead
 * @param {Pick<import('./field-schema.service.js').SchemaCampos, 'campos' | 'definicoes'>} schema
 * @returns {Lead}
 */
function formatarLead(lead, { campos, definicoes }) {
  // `telefone` é nullable desde a migration 0009 (lead só com e-mail).
  const leadFormatado = { ...lead, telefone: lead.telefone ? formatarTelefoneBR(lead.telefone) : null };
  const ligados = new Set(campos.map((campo) => campo.chave));

  if ('custom_fields' in lead) {
    const definicoesLigadas = definicoes.filter((definicao) => ligados.has(definicao.chave));
    leadFormatado.custom_fields = customFieldsParaApi(definicoesLigadas, lead.custom_fields);
  }
  for (const campo of CAMPOS_SISTEMA) {
    if (!ligados.has(campo.systemKey)) delete leadFormatado[campo.coluna];
  }
  if (lead.deleted_at) leadFormatado.purga_em = dataDaPurga(lead.deleted_at);

  return leadFormatado;
}

/**
 * Valida `customFields` contra os campos personalizados ativos (`crm_field`)
 * do tenant — é dado de banco por tenant, então não dá pra expressar isso
 * num schema Zod estático na borda (o "schema" de custom_fields muda
 * conforme o tenant e só existe em tempo de execução). Só chave e tipo:
 * obrigatoriedade é `validarObrigatoriosNaCriacao` (criação) e
 * `validarLimpezaDeObrigatorios` (edição).
 *
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 * @param {Record<string, unknown> | undefined} customFields
 */
function validarCustomFields(definicoes, customFields) {
  const valores = customFields ?? {};
  const definicaoPorChave = new Map(definicoes.map((definicao) => [definicao.chave, definicao]));

  for (const chave of Object.keys(valores)) {
    const definicao = definicaoPorChave.get(chave);

    if (!definicao) {
      throw erroDeValidacao(
        'customFields',
        `Campo customizado desconhecido: "${chave}"`,
        `"${chave}" não corresponde a nenhum campo cadastrado`,
      );
    }

    validarValorPorTipo(definicao, valores[chave]);
  }
}

/**
 * @param {import('../types/index.js').FieldDefinition} definicao
 * @param {unknown} valor
 */
function validarValorPorTipo(definicao, valor) {
  const erroDeTipo = () =>
    erroDeValidacao(
      'customFields',
      `Valor inválido para o campo "${definicao.label}"`,
      `"${definicao.label}" espera um valor do tipo ${definicao.tipo}`,
    );

  if (valorAusente(valor)) return; // obrigatoriedade é checada à parte

  // Regras por tipo: `tipos-campo.service.js` (as mesmas do import e do filtro).
  if (!valorValidoParaTipo(definicao.tipo, valor, definicao.opcoes)) throw erroDeTipo();
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
    throw erroDeValidacao(
      input.email === null ? 'email' : 'telefone',
      'O lead precisa manter e-mail ou telefone',
    );
  }
}

/**
 * Campo obrigatório (nativo obrigatório no resolver, ou definição de
 * Camada 3 obrigatória) não pode ser limpo com `null` na edição.
 *
 * @param {AtualizarLeadInput} input
 * @param {ReturnType<typeof import('./field-schema.service.js').montarCampos>} campos
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 */
function validarLimpezaDeObrigatorios(input, campos, definicoes) {
  for (const campo of campos) {
    if (campo.camada === CAMADA.CAMADA_3 || !campo.obrigatorio) continue;
    if (CHAVES_OBRIGATORIEDADE_PROPRIA.has(campo.chave)) continue;
    if (input[campo.chave] === null) {
      throw campoObrigatorioNaoPodeSerLimpo(campo.chave, campo.label);
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
  return erroDeValidacao(campo, `"${label}" é obrigatório e não pode ser limpo`);
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 */
async function validarResponsavel(tenantId, usuarioId) {
  if (!(await buscarUsuarioAtivoDoTenant(tenantId, usuarioId))) {
    throw erroDeValidacao(
      'usuarioResponsavelId',
      'Responsável inválido',
      'Escolha um usuário ativo desta conta',
    );
  }
}

function leadNaoEncontrado() {
  return erroNaoEncontrado('Lead não encontrado');
}
