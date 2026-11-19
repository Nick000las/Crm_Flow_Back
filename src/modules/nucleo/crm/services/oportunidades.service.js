import {
  AppError,
  erroCamposObrigatorios,
  erroDeConflito,
  erroDeValidacao,
  erroNaoEncontrado,
} from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { buscarStatusDoPipeline } from '../adapters/crm-options.repository.js';
import {
  alterarOportunidade,
  buscarOportunidade,
  buscarOportunidadesDaPessoa,
  criarOportunidade as criarOportunidadeRepository,
} from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import { atualizarLead, buscarLeadPorId, criarLead } from '../adapters/leads.repository.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';
import { CAMPOS_SISTEMA, CATEGORIAS_STATUS, TIPOS_EVENTO_LEAD } from '../constants.js';
import {
  EVENTOS_OPORTUNIDADE,
  SAIDA_DOS_CAMPOS_DA_OPORTUNIDADE,
} from '../constants/oportunidades.js';
import { leadAnonimizadoNaoEditavel } from './lgpd.service.js';
import {
  avisosDoPlano,
  diffDaOportunidade,
  novaOportunidadeDoLead,
  opcaoDoStatus,
  planejarEdicaoDoLead,
  planejarStatus,
  primeiroStatusAberto,
  probabilidadeEfetiva,
  separarComerciais,
  validarComerciais,
} from './oportunidade-transicao.service.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { leadParaApi, regrasAplicaveis } from './regras-lead.service.js';
import { validarRegras } from './regras-campos.service.js';
import { recalcularScoreDosLeads } from './score.service.js';
import { pipelinesOcultos } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: a única porta para mudar uma oportunidade (M2.5, F3). Ficha,
 * importação, edição em massa e o `mover` do quadro passam por aqui, com as
 * mesmas regras. Ganhar, perder e reabrir são `mudarStatusDaOportunidade`.
 * `/crm/leads` entra por `criarLeadComOportunidade` e
 * `atualizarLeadComOportunidade`: lead e oportunidade na mesma transação.
 *
 * Regras e pessoa são conferidas com as linhas travadas, dentro da transação.
 *
 * @typedef {{ papel?: string }} Acesso
 * @typedef {import('./oportunidade-transicao.service.js').OpcaoDeStatus} OpcaoDeStatus
 */

/** Coluna → chave no histórico: as mesmas do lead, que a timeline já conhece. */
const CAMPOS_NO_HISTORICO = Object.freeze({
  status: 'status',
  amount: 'valor',
  probability_override: 'probabilidadeFechamento',
  expected_close_date: 'dataPrevistaFechamento',
  lost_reason: 'motivoPerda',
  owner_id: 'usuarioResponsavelId',
  title: 'tituloOportunidade',
});

const naoEncontrada = () => erroNaoEncontrado('Oportunidade não encontrada');

/** @param {Record<string, any>} lead */
function garantirPessoaEditavel(lead) {
  if (lead.anonimizado_em) throw leadAnonimizadoNaoEditavel();
}

/** @param {Record<string, any>} deal */
function garantirAtiva(deal) {
  if (deal.deleted_at) throw naoEncontrada();
  if (deal.archived_at) {
    throw erroDeConflito('oportunidade', 'Restaure a oportunidade antes de alterá-la');
  }
}

/** @param {Record<string, any>} linha */
export function formatarOportunidade(linha) {
  return {
    id: linha.id,
    leadId: linha.lead_id,
    pipelineId: linha.pipeline_id,
    origemId: linha.source_deal_id ?? null,
    titulo: linha.title,
    status: linha.status,
    categoria: linha.status_category,
    valor: linha.amount === null ? null : Number(linha.amount),
    probabilidadeFechamento: linha.probability_override,
    // A que vale no forecast (FC1): a da oportunidade ou a padrão do status.
    probabilidadeEfetiva: probabilidadeEfetiva(
      linha.probability_override,
      linha.probabilidade_padrao,
    ),
    dataPrevistaFechamento: linha.expected_close_date,
    ganhaEm: linha.won_at,
    perdidaEm: linha.lost_at,
    motivoPerda: linha.lost_reason,
    responsavelId: linha.owner_id,
    origemReabertaEm: linha.source_reopened_at,
    arquivadaEm: linha.archived_at,
    criadaEm: linha.created_at,
    atualizadaEm: linha.updated_at,
  };
}

/**
 * Oportunidade no formato da API, sem o que o papel não vê: campo desligado ou
 * oculto some da resposta, como em `/crm/leads`.
 *
 * @param {Record<string, any>} linha
 * @param {Pick<import('./field-schema.service.js').SchemaCampos, 'campos'>} schema
 */
function oportunidadeParaOPapel(linha, { campos }) {
  const oportunidade = formatarOportunidade(linha);
  const ligados = new Set(campos.map((campo) => campo.chave));
  const doSistema = new Set(CAMPOS_SISTEMA.map((campo) => campo.systemKey));
  for (const [campo, saidas] of Object.entries(SAIDA_DOS_CAMPOS_DA_OPORTUNIDADE)) {
    if (!doSistema.has(campo) || ligados.has(campo)) continue;
    for (const saida of saidas) delete oportunidade[saida];
  }
  return oportunidade;
}

/**
 * Cria o lead com a oportunidade dele (decisão F-1). Os campos comerciais vão
 * para ela; a resposta de `/crm/leads` continua igual. Quem cria pelo quadro
 * escolhe pipeline e status em `destino`, e `conferir` aplica as regras com a
 * opção daquele pipeline, dentro da transação.
 *
 * @param {string} tenantId
 * @param {Record<string, any>} dados
 * @param {Parameters<typeof criarLead>[2]} historico
 * @param {{ pipelineId?: string, status?: string, conferir?: (opcao: OpcaoDeStatus, opcoes: OpcaoDeStatus[]) => void }} [destino]
 */
export async function criarLeadComOportunidade(tenantId, dados, historico, destino = {}) {
  const { comerciais, contato } = separarComerciais(dados);
  validarComerciais(comerciais);
  const completos = { ...comerciais, ...(destino.status && { status: destino.status }) };
  return criarLead(
    tenantId,
    contato,
    historico,
    (opcoes) => {
      const nova = novaOportunidadeDoLead(opcoes, completos);
      const opcao = opcoes.find((item) => item.key === nova.status);
      destino.conferir?.(/** @type {OpcaoDeStatus} */ (opcao), opcoes);
      return nova;
    },
    destino.pipelineId,
  );
}

/**
 * Regras (M8) de uma pessoa ainda sem linha: no formato da API, com a categoria
 * da opção do pipeline certo.
 *
 * @param {import('./regras-campos.service.js').Regra[]} regras
 * @param {Record<string, any>} pessoa  formato da API
 * @param {OpcaoDeStatus} opcao
 * @param {OpcaoDeStatus[]} opcoes
 */
export function garantirRegrasDaPessoaNova(regras, pessoa, opcao, opcoes) {
  lancarErrosDasRegras(
    validarRegras(
      regras,
      { ...pessoa, status: opcao.key },
      {
        categoriaDoStatus: opcao.category,
        labelDoStatus: Object.fromEntries(opcoes.map((item) => [item.key, item.label])),
      },
    ),
  );
}

/** @param {{ campo: string, mensagem: string }[]} erros */
function lancarErrosDasRegras(erros) {
  if (erros.length > 0) {
    throw erroCamposObrigatorios(
      Object.fromEntries(erros.map(({ campo, mensagem }) => [campo, mensagem])),
    );
  }
}

/**
 * Edita o lead e, na mesma transação, a oportunidade principal: comercial e
 * responsável. Só a principal: atendimento tem dono próprio (`auto_create_owner_rule`).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {Record<string, any>} dados
 * @param {Parameters<typeof atualizarLead>[3]} historico
 * @param {Parameters<typeof atualizarLead>[4] & { avisos?: { lista: ReturnType<typeof avisosDoPlano> } }} [opcoes]
 *   `avisos`: recebe os avisos da mudança na oportunidade principal (FC1)
 */
export async function atualizarLeadComOportunidade(
  tenantId,
  leadId,
  dados,
  historico,
  opcoes = {},
) {
  const { comerciais, contato } = separarComerciais(dados);
  validarComerciais(comerciais);
  const exigeOportunidade = Object.keys(comerciais).length > 0;
  const { usuarioResponsavelId } = contato;
  const oportunidade =
    exigeOportunidade || usuarioResponsavelId !== undefined
      ? {
          exigeOportunidade,
          nova: (status) => novaOportunidadeDoLead(status, comerciais),
          planejar: (deal, status) => {
            // D4: o OPERADOR edita o contato, mas não alcança uma principal oculta.
            if (opcoes.ocultos?.includes(deal.pipeline_id)) {
              if (!exigeOportunidade) return null;
              throw erroDeConflito('oportunidade', 'A oportunidade desta pessoa não está visível');
            }
            const plano = planejarEdicaoDoLead(
              deal,
              status,
              { ...comerciais, usuarioResponsavelId },
              new Date(),
            );
            // Atribuição, não acúmulo: o plano pode ser refeito na mesma edição.
            if (opcoes.avisos) opcoes.avisos.lista = avisosDoPlano(plano);
            return plano;
          },
        }
      : undefined;
  const { avisos, ...doLead } = opcoes;
  if (avisos) avisos.lista = [];
  return atualizarLead(tenantId, leadId, contato, historico, { ...doLead, oportunidade });
}

/**
 * Regras (M8) sobre a pessoa com os dados comerciais da oportunidade. A
 * categoria vem da opção do pipeline certo: a lista do schema só tem Vendas.
 *
 * @param {import('./field-schema.service.js').SchemaCampos} schema
 * @param {import('./regras-campos.service.js').Regra[]} regras
 * @param {Record<string, any>} lead  a linha de `leads`, só com o contato
 * @param {Record<string, unknown>} comerciais  todos os da oportunidade: a pessoa não os tem
 * @param {OpcaoDeStatus} opcao
 * @param {OpcaoDeStatus[]} opcoes
 */
function garantirRegras(schema, regras, lead, comerciais, opcao, opcoes) {
  if (regras.length === 0) return;
  lancarErrosDasRegras(
    validarRegras(
      regras,
      { ...leadParaApi(lead, schema), ...comerciais },
      {
        categoriaDoStatus: opcao.category,
        labelDoStatus: Object.fromEntries(opcoes.map((item) => [item.key, item.label])),
      },
    ),
  );
}

/**
 * @param {string} tenantId
 * @param {string} [pipelineId]
 * @param {string | undefined} papel  pipeline oculto para o papel não é destino (D4)
 */
async function pipelineDeDestino(tenantId, pipelineId, papel) {
  const [todos, ocultos] = await Promise.all([
    buscarPipelines(tenantId),
    pipelinesOcultos(tenantId, papel),
  ]);
  const pipelines = todos.filter((item) => !ocultos.includes(item.id));
  const pipeline = pipelineId
    ? pipelines.find((item) => item.id === pipelineId)
    : pipelines.find((item) => item.padrao);
  if (!pipeline || !pipeline.ativo) {
    throw erroDeValidacao('pipelineId', 'Escolha um pipeline ativo');
  }
  return pipeline;
}

/** @param {string} tenantId @param {string | null | undefined} usuarioId */
async function validarResponsavel(tenantId, usuarioId) {
  if (usuarioId && !(await buscarUsuarioAtivoDoTenant(tenantId, usuarioId))) {
    throw erroDeValidacao('responsavelId', 'Escolha um usuário ativo desta conta');
  }
}

/**
 * Sem pipeline, entra no padrão. Sem status, no primeiro aberto do pipeline.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{
 *   pipelineId?: string, status?: string, titulo?: string | null, valor?: number | null,
 *   probabilidadeFechamento?: number | null, dataPrevistaFechamento?: Date | null,
 *   motivoPerda?: string | null, responsavelId?: string | null,
 * }} dados
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} [acesso]
 */
export async function criarOportunidade(tenantId, leadId, dados, usuarioId, { papel } = {}) {
  validarComerciais(dados);
  const pipeline = await pipelineDeDestino(tenantId, dados.pipelineId, papel);
  const [schema, opcoes] = await Promise.all([
    obterSchemaDoPapel(tenantId, papel),
    buscarStatusDoPipeline(tenantId, pipeline.id),
  ]);
  garantirEscritaPermitida(schema, {
    status: dados.status,
    valor: dados.valor,
    motivoPerda: dados.motivoPerda,
    probabilidadeFechamento: dados.probabilidadeFechamento,
    dataPrevistaFechamento: dados.dataPrevistaFechamento,
  });
  await validarResponsavel(tenantId, dados.responsavelId);

  const opcao = opcaoDoStatus(opcoes, dados.status ?? primeiroStatusAberto(opcoes)?.key);
  const regras = await regrasAplicaveis(tenantId, schema);

  const criada = await criarOportunidadeRepository(
    tenantId,
    {
      leadId,
      pipelineId: pipeline.id,
      titulo: dados.titulo ?? null,
      status: opcao.key,
      categoria: opcao.category,
      valor: dados.valor ?? null,
      probabilidade: dados.probabilidadeFechamento ?? null,
      dataPrevista: dados.dataPrevistaFechamento ?? null,
      motivoPerda: dados.motivoPerda ?? null,
      responsavelId: dados.responsavelId ?? null,
    },
    (lead) => {
      garantirPessoaEditavel(lead);
      garantirRegras(
        schema,
        regras,
        lead,
        {
          status: opcao.key,
          valor: dados.valor ?? null,
          motivoPerda: dados.motivoPerda ?? null,
          probabilidadeFechamento: dados.probabilidadeFechamento ?? null,
          dataPrevistaFechamento: dados.dataPrevistaFechamento ?? null,
          dataConversao: opcao.category === CATEGORIAS_STATUS.GANHO ? new Date() : null,
        },
        opcao,
        opcoes,
      );
    },
    { autorId: usuarioId ?? null },
  );
  if (!criada) throw erroNaoEncontrado('Lead não encontrado');
  await recalcularScoreDosLeads(tenantId, [leadId]);
  return oportunidadeParaOPapel(criada, schema);
}

/**
 * Mover no quadro, ganhar, perder e reabrir. Mover segue "a última gravação
 * vence, com aviso" (P8): `conflito` diz que outra pessoa mexeu antes. Trocar o
 * status volta a probabilidade ao padrão do novo (FC1), com aviso em `avisos`;
 * `probabilidadeFechamento` mandada junto vence.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ status: string, motivoPerda?: string | null, probabilidadeFechamento?: number | null, expectedUpdatedAt?: string }} dados
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} [acesso]
 */
export async function mudarStatusDaOportunidade(tenantId, id, dados, usuarioId, { papel } = {}) {
  const atual = await buscarOportunidade(tenantId, id);
  if (!atual) throw naoEncontrada();

  const [schema, opcoes] = await Promise.all([
    obterSchemaDoPapel(tenantId, papel),
    buscarStatusDoPipeline(tenantId, atual.pipeline_id),
  ]);
  validarComerciais(dados);
  garantirEscritaPermitida(schema, {
    status: dados.status,
    motivoPerda: dados.motivoPerda,
    probabilidadeFechamento: dados.probabilidadeFechamento,
  });
  const regras = await regrasAplicaveis(tenantId, schema);

  let conflito = false;
  let avisos = [];
  const depois = await alterarOportunidade(
    tenantId,
    id,
    (deal, lead) => {
      garantirAtiva(deal);
      garantirPessoaEditavel(lead);
      const opcao = opcaoDoStatus(opcoes, dados.status, deal.status);
      const plano = comProbabilidadeMandada(
        planejarStatus(deal, opcao, dados, new Date()),
        dados.probabilidadeFechamento,
      );
      const probabilidadeDepois =
        'probability_override' in plano.mudancas
          ? plano.mudancas.probability_override
          : deal.probability_override;
      garantirRegras(
        schema,
        regras,
        lead,
        {
          status: opcao.key,
          motivoPerda: plano.mudancas.lost_reason,
          valor: deal.amount === null ? null : Number(deal.amount),
          probabilidadeFechamento: probabilidadeDepois,
          dataPrevistaFechamento: deal.expected_close_date,
          dataConversao: plano.mudancas.won_at,
        },
        opcao,
        opcoes,
      );
      conflito = Boolean(
        dados.expectedUpdatedAt &&
        new Date(dados.expectedUpdatedAt).getTime() !== new Date(deal.updated_at).getTime(),
      );
      // O aviso traz a probabilidade anterior: só para quem vê o campo.
      if (schema.campos.some((campo) => campo.chave === 'probabilidadeFechamento')) {
        avisos = avisosDoPlano(plano);
      }
      return {
        ...plano,
        diff: diffDaOportunidade(deal, plano.mudancas, CAMPOS_NO_HISTORICO),
      };
    },
    { autorId: usuarioId ?? null },
  );
  if (!depois) throw naoEncontrada();
  await recalcularScoreDosLeads(tenantId, [depois.lead_id]);
  return { ...oportunidadeParaOPapel(depois, schema), conflito, avisos };
}

/**
 * A probabilidade mandada junto com o status vence a volta ao padrão.
 *
 * @template {{ mudancas: Record<string, unknown>, probabilidadeRedefinida?: number | null }} P
 * @param {P} plano
 * @param {number | null | undefined} probabilidade
 * @returns {P}
 */
function comProbabilidadeMandada(plano, probabilidade) {
  if (probabilidade === undefined) return plano;
  return {
    ...plano,
    mudancas: { ...plano.mudancas, probability_override: probabilidade },
    probabilidadeRedefinida: null,
  };
}

/**
 * Edição dos dados: omitido mantém, `null` limpa. Editar não é como mover:
 * `expectedUpdatedAt` antigo é 409 (P8), para não sobrescrever a outra pessoa, e
 * a resposta traz o estado atual em `details.atual`.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{
 *   titulo?: string | null, valor?: number | null, probabilidadeFechamento?: number | null,
 *   dataPrevistaFechamento?: Date | null, responsavelId?: string | null, expectedUpdatedAt?: string,
 * }} dados
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} [acesso]
 */
export async function editarOportunidade(tenantId, id, dados, usuarioId, { papel } = {}) {
  validarComerciais(dados);
  const schema = await obterSchemaDoPapel(tenantId, papel);
  garantirEscritaPermitida(schema, {
    valor: dados.valor,
    probabilidadeFechamento: dados.probabilidadeFechamento,
    dataPrevistaFechamento: dados.dataPrevistaFechamento,
    usuarioResponsavelId: dados.responsavelId,
  });
  await validarResponsavel(tenantId, dados.responsavelId);

  const entradas = {
    title: dados.titulo,
    amount: dados.valor,
    probability_override: dados.probabilidadeFechamento,
    expected_close_date: dados.dataPrevistaFechamento,
    owner_id: dados.responsavelId,
  };
  const mudancas = Object.fromEntries(
    Object.entries(entradas).filter(([, valor]) => valor !== undefined),
  );

  const depois = await alterarOportunidade(
    tenantId,
    id,
    (deal, lead) => {
      garantirAtiva(deal);
      garantirPessoaEditavel(lead);
      if (
        dados.expectedUpdatedAt &&
        new Date(dados.expectedUpdatedAt).getTime() !== new Date(deal.updated_at).getTime()
      ) {
        const mensagem =
          'Esta oportunidade foi alterada por outra pessoa. Carregue a versão atual.';
        throw new AppError({
          statusCode: HTTP_STATUS.CONFLICT,
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: mensagem,
          fields: { oportunidade: [mensagem] },
          details: { atual: oportunidadeParaOPapel(deal, schema) },
        });
      }
      return {
        mudancas,
        diff: diffDaOportunidade(deal, mudancas, CAMPOS_NO_HISTORICO),
        evento: EVENTOS_OPORTUNIDADE.ATUALIZADA,
      };
    },
    { autorId: usuarioId ?? null },
  );
  if (!depois) throw naoEncontrada();
  await recalcularScoreDosLeads(tenantId, [depois.lead_id]);
  return oportunidadeParaOPapel(depois, schema);
}

/**
 * Arquivar e lixeira não têm regra de negócio: o card sai do quadro e volta se
 * restaurado (P9). Não existe excluir de vez por aqui. Lead na lixeira levou as
 * oportunidades com ele: elas só voltam quando ele voltar.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {(deal: Record<string, any>) => { mudancas: Record<string, unknown>, historico: string, evento: string }} planejar
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} acesso
 */
async function mudarSituacao(tenantId, id, planejar, usuarioId, { papel }) {
  const schema = await obterSchemaDoPapel(tenantId, papel);
  const depois = await alterarOportunidade(
    tenantId,
    id,
    (deal, lead) => {
      if (lead.deleted_at) throw naoEncontrada();
      garantirPessoaEditavel(lead);
      return planejar(deal);
    },
    { autorId: usuarioId ?? null },
  );
  if (!depois) throw naoEncontrada();
  return oportunidadeParaOPapel(depois, schema);
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {boolean} arquivar
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} [acesso]
 */
export function definirArquivamentoDaOportunidade(tenantId, id, arquivar, usuarioId, acesso = {}) {
  return mudarSituacao(
    tenantId,
    id,
    (deal) => {
      if (deal.deleted_at) throw naoEncontrada();
      return {
        mudancas: { archived_at: arquivar ? new Date() : null },
        historico: arquivar
          ? TIPOS_EVENTO_LEAD.OPORTUNIDADE_ARQUIVADA
          : TIPOS_EVENTO_LEAD.OPORTUNIDADE_DESARQUIVADA,
        evento: arquivar ? EVENTOS_OPORTUNIDADE.ARQUIVADA : EVENTOS_OPORTUNIDADE.DESARQUIVADA,
      };
    },
    usuarioId,
    acesso,
  );
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {boolean} excluir  `false` restaura
 * @param {string | null | undefined} usuarioId
 * @param {Acesso} [acesso]
 */
export function definirLixeiraDaOportunidade(tenantId, id, excluir, usuarioId, acesso = {}) {
  return mudarSituacao(
    tenantId,
    id,
    () => ({
      mudancas: { deleted_at: excluir ? new Date() : null },
      historico: excluir
        ? TIPOS_EVENTO_LEAD.OPORTUNIDADE_EXCLUIDA
        : TIPOS_EVENTO_LEAD.OPORTUNIDADE_RESTAURADA,
      evento: excluir ? EVENTOS_OPORTUNIDADE.EXCLUIDA : EVENTOS_OPORTUNIDADE.RESTAURADA,
    }),
    usuarioId,
    acesso,
  );
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {Acesso & { daLixeira?: boolean }} [opcoes]  `daLixeira`: só as excluídas
 */
export async function listarOportunidadesDaPessoa(
  tenantId,
  leadId,
  { papel, daLixeira = false } = {},
) {
  const [lead, schema, linhas, ocultos] = await Promise.all([
    buscarLeadPorId(tenantId, leadId),
    obterSchemaDoPapel(tenantId, papel),
    buscarOportunidadesDaPessoa(tenantId, leadId, { daLixeira }),
    pipelinesOcultos(tenantId, papel),
  ]);
  if (!lead) throw erroNaoEncontrado('Lead não encontrado');
  return linhas
    .filter((linha) => !ocultos.includes(linha.pipeline_id))
    .map((linha) => oportunidadeParaOPapel(linha, schema));
}
