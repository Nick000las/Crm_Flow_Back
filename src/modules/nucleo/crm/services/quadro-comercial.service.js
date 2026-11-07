import { Buffer } from 'node:buffer';
import { AppError, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { buscarStatusDoPipeline, contarUsos } from '../adapters/crm-options.repository.js';
import {
  buscarOportunidade,
  buscarOportunidadesDaPessoa,
} from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import {
  buscarCardsPorIds,
  buscarIdsDeOportunidades,
  cardAtendeAoFiltro,
  listarCardsDaColuna,
  listarCardsPorIds,
  RESPONSAVEL_DO_CARD,
  resumirColuna,
} from '../adapters/crm-quadro.repository.js';
import {
  CRM_FEATURES,
  ORDENS_DO_QUADRO,
  PADRAO_UUID,
  ROTULOS_DO_QUADRO,
  SELOS_DO_CARD,
  TIPOS_LISTA,
} from '../constants.js';
import {
  camposDoMoverSchema,
  cardDePessoaExistenteSchema,
  cardDePessoaNovaSchema,
  filtroDoQuadroSchema,
  ordemDoQuadroSchema,
} from '../schemas/quadro-comercial.schema.js';
import { customFieldsParaApi } from './field-schema.service.js';
import { obterLayout } from './layout.service.js';
import { prepararFiltro, registrarNovoLead } from './leads.service.js';
import { criarOportunidade, mudarStatusDaOportunidade } from './oportunidades.service.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { tituloDaPessoa } from './pessoa-entidade.service.js';
import { confirmarEventos, drenarEventos } from './quadro-eventos.service.js';
import { papelComPipelinesOcultos } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: o contrato de quadro do M2, com o CRM como dono. Cada pipeline ativo
 * vira um quadro, cada status uma coluna e cada oportunidade um card. Atrás de
 * `crm.quadro_comercial`; sem a flag, o quadro não existe para o tenant.
 *
 * Aqui não há regra de negócio: mover e criar passam pelos services do CRM.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 */

const CHAVE_STATUS = 'status';
const CHAVE_RESPONSAVEL = 'usuarioResponsavelId';

const quadroInexistente = () => erroNaoEncontrado('Quadro não encontrado.');

/** @param {string} tenantId */
const quadroLigado = (tenantId) => featureAtiva(tenantId, CRM_FEATURES.QUADRO_COMERCIAL);

/**
 * @param {{ ativo: boolean, visivel_operador: boolean }} pipeline
 * @param {string} papel
 */
const noQuadroDoPapel = (pipeline, papel) =>
  pipeline.ativo && (pipeline.visivel_operador || !papelComPipelinesOcultos(papel));

/**
 * Pipeline ativo que este papel vê. Qualquer outro caso é o mesmo 404.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 */
async function pipelineDoQuadro({ tenantId, role }, quadroRef) {
  if (!(await quadroLigado(tenantId))) throw quadroInexistente();
  const pipelines = await buscarPipelines(tenantId);
  const pipeline = pipelines.find((item) => item.id === quadroRef);
  if (!pipeline || !noQuadroDoPapel(pipeline, role)) throw quadroInexistente();
  return pipeline;
}

/**
 * @param {string} tenantId
 * @param {unknown} filtros  o corpo salvo numa view, ou o da tabela
 * @param {string} papel
 */
async function condicoesDoQuadro(tenantId, filtros, papel) {
  const { condicoes } = await prepararFiltro(
    tenantId,
    filtroDoQuadroSchema.parse(filtros ?? {}),
    papel,
    { colunaResponsavel: RESPONSAVEL_DO_CARD },
  );
  return condicoes;
}

/**
 * Sem `ordem`, a da D2. Quem não vê o campo não ordena por ele: a ordem
 * revelaria o valor.
 *
 * @param {TenantContext} context
 * @param {unknown} pedido
 */
async function ordemDoQuadro({ tenantId, role }, pedido) {
  const { campo, direcao } = ordemDoQuadroSchema.parse(pedido ?? {});
  const definicao = ORDENS_DO_QUADRO[campo];
  if (definicao.campo) {
    const schema = await obterSchemaDoPapel(tenantId, role);
    if (!schema.campos.some((item) => item.chave === definicao.campo)) {
      throw erroDeValidacao('ordem', 'Este campo não está disponível para ordenar');
    }
  }
  return { ...definicao, campo, direcao };
}

/** @param {{ campo: string, direcao: string }} ordem */
const chaveDaOrdem = ({ campo, direcao }) => `${campo}:${direcao}`;

/**
 * O cursor é opaco para quem chama, e vale só para a ordem em que nasceu.
 *
 * @param {{ campo: string, direcao: string }} ordem
 * @param {{ ordem_valor: string | null, deal_id: string }} linha
 */
function escreverCursor(ordem, linha) {
  const conteudo = { o: chaveDaOrdem(ordem), v: linha.ordem_valor, id: linha.deal_id };
  return Buffer.from(JSON.stringify(conteudo)).toString('base64url');
}

/** @param {unknown} valor @param {string} tipo */
function valorDoTipo(valor, tipo) {
  if (valor === null) return true;
  if (typeof valor !== 'string') return false;
  if (tipo === 'numeric') return valor.trim() !== '' && Number.isFinite(Number(valor));
  return tipo === 'text' || !Number.isNaN(Date.parse(valor));
}

/**
 * @param {string | undefined} cursor
 * @param {{ campo: string, direcao: string, tipo: string }} ordem
 */
function lerCursor(cursor, ordem) {
  if (!cursor) return null;
  const invalido = () => erroDeValidacao('cursor', 'Cursor inválido');
  let conteudo;
  try {
    conteudo = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw invalido();
  }
  const { o, v, id } = conteudo ?? {};
  if (o !== chaveDaOrdem(ordem) || !PADRAO_UUID.test(id ?? '') || !valorDoTipo(v, ordem.tipo)) {
    throw invalido();
  }
  return { valor: v ?? null, id };
}

/** Número, para o `Decimal` do driver não sair como texto na resposta. */
function numero(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

/** @param {TenantContext} context */
async function listarQuadros({ tenantId, role }) {
  if (!(await quadroLigado(tenantId))) return [];
  const pipelines = await buscarPipelines(tenantId);
  return pipelines
    .filter((pipeline) => noQuadroDoPapel(pipeline, role))
    .map((pipeline) => ({ quadroRef: pipeline.id, nome: pipeline.nome }));
}

/**
 * Status desativado continua como coluna enquanto tiver oportunidade nele: sem
 * isso, os cards sumiriam do quadro. Estrutura fixa aqui: quem edita é o CRM.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 */
async function listarColunas(context, quadroRef) {
  const { id } = await pipelineDoQuadro(context, quadroRef);
  const [status, usos] = await Promise.all([
    buscarStatusDoPipeline(context.tenantId, id),
    contarUsos(context.tenantId, TIPOS_LISTA.STATUS, id),
  ]);
  return status
    .filter((opcao) => opcao.ativo || usos.has(opcao.key))
    .map((opcao) => ({
      ref: opcao.key,
      nome: opcao.label,
      cor: opcao.color,
      categoria: opcao.category,
      ativa: opcao.ativo,
    }));
}

/**
 * @param {TenantContext} context
 * @param {string} quadroRef
 * @param {{ colunaRef: string, filtros?: object, ordem?: object, cursor?: string, limite: number }} consulta
 */
async function listarCards(context, quadroRef, { colunaRef, filtros, ordem, cursor, limite }) {
  const [{ id }, condicoes, ordenacao] = await Promise.all([
    pipelineDoQuadro(context, quadroRef),
    condicoesDoQuadro(context.tenantId, filtros, context.role),
    ordemDoQuadro(context, ordem),
  ]);
  const linhas = await listarCardsDaColuna(context.tenantId, {
    pipelineId: id,
    status: colunaRef,
    condicoes,
    ordem: ordenacao,
    cursor: lerCursor(cursor, ordenacao),
    limite: limite + 1,
  });
  const pagina = linhas.slice(0, limite);
  const ultima = pagina.at(-1);
  return {
    itens: pagina.map((linha) => ({
      entidadeId: linha.deal_id,
      atualizadoEm: linha.deal_atualizada_em,
    })),
    proximoCursor: linhas.length > limite ? escreverCursor(ordenacao, ultima) : null,
  };
}

/**
 * Releitura de cards apontados por um evento. O que não vier saiu deste quadro,
 * do filtro ou do alcance de quem pede: a tela só precisa tirá-lo.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 * @param {{ ids: string[], filtros?: object }} consulta
 */
async function buscarCards(context, quadroRef, { ids, filtros }) {
  if (!ids.every((id) => PADRAO_UUID.test(id))) {
    throw erroDeValidacao('ids', 'Id de card inválido');
  }
  const [{ id }, condicoes] = await Promise.all([
    pipelineDoQuadro(context, quadroRef),
    condicoesDoQuadro(context.tenantId, filtros, context.role),
  ]);
  const linhas = await listarCardsPorIds(context.tenantId, { pipelineId: id, ids, condicoes });
  return linhas.map((linha) => ({
    entidadeId: linha.deal_id,
    atualizadoEm: linha.deal_atualizada_em,
    colunaRef: linha.status,
  }));
}

/**
 * Sem acesso a Valor, a soma sai `null` (P12): nem a soma pode revelar o dado.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 * @param {{ colunaRef: string, filtros?: object }} consulta
 */
async function resumoColuna(context, quadroRef, { colunaRef, filtros }) {
  const [{ id }, condicoes] = await Promise.all([
    pipelineDoQuadro(context, quadroRef),
    condicoesDoQuadro(context.tenantId, filtros, context.role),
  ]);
  const [resumo, schema] = await Promise.all([
    resumirColuna(context.tenantId, { pipelineId: id, status: colunaRef, condicoes }),
    obterSchemaDoPapel(context.tenantId, context.role),
  ]);
  const veValor = schema.campos.some((campo) => campo.chave === 'valor');
  return { total: resumo.total, soma: veValor ? numero(resumo.soma) : null };
}

/**
 * Quem arrasta = quem pode editar o Status (D4b), sem regra por coluna.
 * Oportunidade arquivada ou de pessoa anonimizada não muda.
 *
 * @param {Record<string, any>} linha
 * @param {{ restritos?: Set<string> }} schema
 */
function podeMoverCard(linha, schema) {
  return !linha.anonimizado_em && !linha.deal_arquivada_em && !schema.restritos?.has(CHAVE_STATUS);
}

/**
 * @param {TenantContext} context
 * @param {string} entidadeId
 * @returns {Promise<string[]>}
 */
async function acoesPermitidas({ tenantId, role }, entidadeId) {
  const [linha] = await buscarCardsPorIds(tenantId, [entidadeId], {
    soVisiveis: papelComPipelinesOcultos(role),
    inatividade: null,
  });
  if (!linha) return [];
  const schema = await obterSchemaDoPapel(tenantId, role);
  return podeMoverCard(linha, schema) ? [ROTULOS_DO_QUADRO.MOVER] : [];
}

/**
 * @param {TenantContext} context
 * @param {{ quadroRef: string, entidadeId: string, colunaDestino: string, expectedUpdatedAt?: string, filtros?: object, campos?: object }} movimento
 *   `filtros`: o filtro aberto na tela. Com ele, a resposta diz se o card saiu dele (D1).
 *   `campos`: o que o formulário de campos faltantes grava junto com o status.
 */
async function mover(
  context,
  { quadroRef, entidadeId, colunaDestino, expectedUpdatedAt, filtros, campos },
) {
  const { tenantId, userId, role } = context;
  await pipelineDoQuadro(context, quadroRef);
  const { motivoPerda } = camposDoMoverSchema.parse(campos ?? {});
  // Antes de gravar: filtro inválido não pode mover o card.
  const condicoes = filtros ? await condicoesDoQuadro(tenantId, filtros, role) : null;
  const deal = await buscarOportunidade(tenantId, entidadeId);
  if (!deal) throw erroNaoEncontrado('Oportunidade não encontrada');
  if (deal.pipeline_id !== quadroRef) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'O card só se move dentro do próprio pipeline',
    });
  }
  const movida = await mudarStatusDaOportunidade(
    tenantId,
    entidadeId,
    { status: colunaDestino, motivoPerda, expectedUpdatedAt },
    userId,
    { papel: role },
  );
  return {
    entidadeId,
    colunaRef: colunaDestino,
    conflito: movida.conflito,
    atualizadoEm: movida.atualizadaEm,
    saiuDoFiltro: condicoes ? !(await cardAtendeAoFiltro(tenantId, entidadeId, condicoes)) : false,
  };
}

/**
 * Pessoa existente ganha uma oportunidade; pessoa nova nasce só neste pipeline,
 * com as validações do formulário de Novo lead.
 *
 * @param {TenantContext} context
 * @param {{ quadroRef: string, colunaRef: string, dados: Record<string, unknown> }} novo
 */
async function criar(context, { quadroRef, colunaRef, dados }) {
  const { tenantId, userId, role } = context;
  const { id: pipelineId } = await pipelineDoQuadro(context, quadroRef);
  garantirEscritaPermitida(await obterSchemaDoPapel(tenantId, role), { status: colunaRef });

  if (dados.leadId !== undefined) {
    const { leadId, ...oportunidade } = cardDePessoaExistenteSchema.parse(dados);
    const criada = await criarOportunidade(
      tenantId,
      leadId,
      { ...oportunidade, pipelineId, status: colunaRef },
      userId,
      { papel: role },
    );
    return { entidadeId: criada.id, colunaRef };
  }

  // O status é a coluna: o do formulário não vale aqui.
  const pessoa = { ...cardDePessoaNovaSchema.parse(dados), status: undefined };
  const { id } = await registrarNovoLead(tenantId, pessoa, userId, {
    papel: role,
    oportunidade: { pipelineId, status: colunaRef },
  });
  const [deal] = await buscarOportunidadesDaPessoa(tenantId, id);
  return { entidadeId: deal.id, colunaRef, leadId: id };
}

/**
 * Valor de um item do layout no card. O responsável é o da oportunidade (P13),
 * e o status sai pelo nome da opção do pipeline dela.
 *
 * @param {Record<string, any>} linha
 * @param {{ chave: string, coluna?: string }} item
 * @param {{ definicoes: any[] }} schema
 */
function valorNoCard(linha, item, schema) {
  if (item.chave === CHAVE_RESPONSAVEL) return linha.deal_dono_id;
  if (item.chave === CHAVE_STATUS) return linha.estagio_nome;
  const valor = item.coluna
    ? linha[item.coluna]
    : customFieldsParaApi(schema.definicoes, linha.custom_fields ?? {})[item.chave];
  return typeof valor === 'object' && valor !== null && 'toNumber' in valor
    ? valor.toNumber()
    : (valor ?? null);
}

/** @param {Record<string, any>} linha */
function selosDoCard(linha) {
  return [
    ...(linha.esfriando_desde
      ? [{ tipo: SELOS_DO_CARD.ESFRIANDO, desde: linha.esfriando_desde }]
      : []),
    ...(linha.source_reopened_at
      ? [{ tipo: SELOS_DO_CARD.ORIGEM_REABERTA, desde: linha.source_reopened_at }]
      : []),
  ];
}

/**
 * Identificador, subtítulo e destaques do Layout (P6), com o papel já aplicado:
 * o layout efetivo só traz o que ele vê. Ausente da resposta = "Registro restrito".
 *
 * @param {TenantContext} context
 * @param {string[]} ids
 */
async function descrever({ tenantId, userId, role }, ids) {
  if (ids.length === 0) return [];
  const inatividade = await featureAtiva(tenantId, CRM_FEATURES.INATIVIDADE);
  // Em paralelo: cada etapa em série custa uma transação inteira, e o quadro
  // pede uma página por coluna (M4).
  const [schema, { efetivo }, linhas] = await Promise.all([
    obterSchemaDoPapel(tenantId, role),
    obterLayout(tenantId, userId, { papel: role }),
    buscarCardsPorIds(tenantId, ids, {
      soVisiveis: papelComPipelinesOcultos(role),
      inatividade: inatividade ? new Date() : null,
    }),
  ]);
  const noCard = (linha, item) => ({
    ref: item.ref,
    chave: item.chave,
    label: item.label,
    tipo: item.tipo,
    valor: valorNoCard(linha, item, schema),
  });

  return linhas.map((linha) => ({
    id: linha.deal_id,
    leadId: linha.id,
    titulo: tituloDaPessoa(linha, efetivo.identificador, schema),
    subtitulo: efetivo.subtitulo.map((item) => noCard(linha, item)),
    destaques: efetivo.destaques.map((item) => noCard(linha, item)),
    selos: selosDoCard(linha),
    tituloOportunidade: linha.deal_titulo,
    responsavelId: linha.deal_dono_id,
    podeMover: podeMoverCard(linha, schema),
  }));
}

/**
 * Sem usuário: chamado por job. Oportunidade não muda de id ao mesclar a
 * pessoa: mantém o id, ou `null` se foi apagada.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<Record<string, string | null>>}
 */
async function resolverVinculos(tenantId, ids) {
  const existentes = new Set(await buscarIdsDeOportunidades(tenantId, ids));
  return Object.fromEntries(ids.map((id) => [id, existentes.has(id) ? id : null]));
}

/** @type {import('#core/types/module.js').ProvedorDeEntidade} */
export const provedorDeOportunidade = Object.freeze({
  tipo: ROTULOS_DO_QUADRO.ENTIDADE,
  vinculavel: false,
  descrever,
  rotaFicha: (id) => `/crm/oportunidades/${id}`,
  resolverVinculos,
});

/** @type {import('#core/types/module.js').ProvedorDeQuadro} */
export const provedorComercial = Object.freeze({
  boardType: ROTULOS_DO_QUADRO.BOARD_TYPE,
  entidadeTipo: ROTULOS_DO_QUADRO.ENTIDADE,
  listarQuadros,
  listarColunas,
  listarCards,
  buscarCards,
  drenarEventos,
  confirmarEventos,
  resumoColuna,
  acoesPermitidas,
  mover,
  criar,
});
