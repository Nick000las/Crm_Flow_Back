import {
  erroCamposObrigatorios,
  erroDeConflito,
  erroDeValidacao,
  erroNaoEncontrado,
} from '#core/errors/app-error.js';
import { buscarStatusDoPipeline } from '../adapters/crm-options.repository.js';
import {
  alterarOportunidade,
  buscarOportunidade,
  buscarOportunidadesDaPessoa,
  criarOportunidade as criarOportunidadeRepository,
} from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';
import { CATEGORIAS_STATUS, TIPOS_EVENTO_LEAD } from '../constants.js';
import { EVENTOS_OPORTUNIDADE } from '../constants/oportunidades.js';
import { leadAnonimizadoNaoEditavel } from './lgpd.service.js';
import { diffDaOportunidade, planejarStatus } from './oportunidade-transicao.service.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { leadParaApi, regrasAplicaveis } from './regras-lead.service.js';
import { validarRegras } from './regras-campos.service.js';

/**
 * SERVICE: a única porta para mudar uma oportunidade (M2.5, F3). Ficha,
 * importação, edição em massa e o `mover` do quadro passam por aqui, com as
 * mesmas regras. Ganhar, perder e reabrir são `mudarStatusDaOportunidade`.
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
 * Opção de destino. Inativa só vale se a oportunidade já estiver nela.
 *
 * @param {OpcaoDeStatus[]} opcoes
 * @param {string} status
 * @param {string} [statusAtual]
 * @returns {OpcaoDeStatus}
 */
function opcaoDoStatus(opcoes, status, statusAtual) {
  const opcao = opcoes.find((item) => item.key === status);
  if (!opcao || (!opcao.ativo && status !== statusAtual)) {
    throw erroDeValidacao('status', `"${status}" não é uma opção de Status deste pipeline`);
  }
  return opcao;
}

/**
 * Regras (M8) sobre a pessoa com os dados comerciais da oportunidade. A
 * categoria vem da opção do pipeline certo: a lista do schema só tem Vendas.
 *
 * @param {import('./field-schema.service.js').SchemaCampos} schema
 * @param {import('./regras-campos.service.js').Regra[]} regras
 * @param {Record<string, any>} lead
 * @param {Record<string, unknown>} comerciais
 * @param {OpcaoDeStatus} opcao
 * @param {OpcaoDeStatus[]} opcoes
 */
function garantirRegras(schema, regras, lead, comerciais, opcao, opcoes) {
  if (regras.length === 0) return;
  const erros = validarRegras(
    regras,
    { ...leadParaApi(lead, schema), ...comerciais },
    {
      categoriaDoStatus: opcao.category,
      labelDoStatus: Object.fromEntries(opcoes.map((item) => [item.key, item.label])),
    },
  );
  if (erros.length > 0) {
    throw erroCamposObrigatorios(
      Object.fromEntries(erros.map(({ campo, mensagem }) => [campo, mensagem])),
    );
  }
}

/** @param {string} tenantId @param {string} [pipelineId] */
async function pipelineDeDestino(tenantId, pipelineId) {
  const pipelines = await buscarPipelines(tenantId);
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
  const pipeline = await pipelineDeDestino(tenantId, dados.pipelineId);
  const [schema, opcoes] = await Promise.all([
    obterSchemaDoPapel(tenantId, papel),
    buscarStatusDoPipeline(tenantId, pipeline.id),
  ]);
  garantirEscritaPermitida(schema, {
    status: dados.status,
    valor: dados.valor,
    motivoPerda: dados.motivoPerda,
  });
  await validarResponsavel(tenantId, dados.responsavelId);

  const primeiroAberto = opcoes.find(
    (opcao) => opcao.ativo && opcao.category === CATEGORIAS_STATUS.ABERTO,
  );
  const opcao = opcaoDoStatus(opcoes, dados.status ?? primeiroAberto?.key);
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
        { status: opcao.key, valor: dados.valor ?? null, motivoPerda: dados.motivoPerda ?? null },
        opcao,
        opcoes,
      );
    },
    { autorId: usuarioId ?? null },
  );
  if (!criada) throw erroNaoEncontrado('Lead não encontrado');
  return formatarOportunidade(criada);
}

/**
 * Mover no quadro, ganhar, perder e reabrir. Mover segue "a última gravação
 * vence, com aviso" (P8): `conflito` diz que outra pessoa mexeu antes.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ status: string, motivoPerda?: string | null, expectedUpdatedAt?: string }} dados
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
  garantirEscritaPermitida(schema, { status: dados.status, motivoPerda: dados.motivoPerda });
  const regras = await regrasAplicaveis(tenantId, schema);

  let conflito = false;
  const depois = await alterarOportunidade(
    tenantId,
    id,
    (deal, lead) => {
      garantirAtiva(deal);
      garantirPessoaEditavel(lead);
      const opcao = opcaoDoStatus(opcoes, dados.status, deal.status);
      const plano = planejarStatus(deal, opcao, dados, new Date());
      garantirRegras(
        schema,
        regras,
        lead,
        {
          status: opcao.key,
          motivoPerda: plano.mudancas.lost_reason,
          valor: deal.amount === null ? null : Number(deal.amount),
        },
        opcao,
        opcoes,
      );
      conflito = Boolean(
        dados.expectedUpdatedAt &&
        new Date(dados.expectedUpdatedAt).getTime() !== new Date(deal.updated_at).getTime(),
      );
      return {
        ...plano,
        diff: diffDaOportunidade(deal, plano.mudancas, CAMPOS_NO_HISTORICO),
      };
    },
    { autorId: usuarioId ?? null },
  );
  if (!depois) throw naoEncontrada();
  return { ...formatarOportunidade(depois), conflito };
}

/**
 * Edição dos dados: omitido mantém, `null` limpa. Editar não é como mover:
 * `expectedUpdatedAt` antigo é 409 (P8), para não sobrescrever a outra pessoa.
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
        throw erroDeConflito(
          'oportunidade',
          'Esta oportunidade foi alterada por outra pessoa. Carregue a versão atual.',
        );
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
  return formatarOportunidade(depois);
}

/**
 * Arquivar e lixeira não têm regra de negócio: o card sai do quadro e volta se
 * restaurado (P9). Não existe excluir de vez por aqui.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {(deal: Record<string, any>) => { mudancas: Record<string, unknown>, historico: string, evento: string }} planejar
 * @param {string | null | undefined} usuarioId
 */
async function mudarSituacao(tenantId, id, planejar, usuarioId) {
  const depois = await alterarOportunidade(
    tenantId,
    id,
    (deal, lead) => {
      garantirPessoaEditavel(lead);
      return planejar(deal);
    },
    { autorId: usuarioId ?? null },
  );
  if (!depois) throw naoEncontrada();
  return formatarOportunidade(depois);
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {boolean} arquivar
 * @param {string | null | undefined} usuarioId
 */
export function definirArquivamentoDaOportunidade(tenantId, id, arquivar, usuarioId) {
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
  );
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {boolean} excluir  `false` restaura
 * @param {string | null | undefined} usuarioId
 */
export function definirLixeiraDaOportunidade(tenantId, id, excluir, usuarioId) {
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
  );
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 */
export async function listarOportunidadesDaPessoa(tenantId, leadId) {
  return (await buscarOportunidadesDaPessoa(tenantId, leadId)).map(formatarOportunidade);
}
