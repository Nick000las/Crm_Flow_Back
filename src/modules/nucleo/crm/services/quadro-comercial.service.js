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
  listarCardsDaColuna,
  resumirColuna,
} from '../adapters/crm-quadro.repository.js';
import { CRM_FEATURES, ROTULOS_DO_QUADRO, SELOS_DO_CARD, TIPOS_LISTA } from '../constants.js';
import {
  cardDePessoaExistenteSchema,
  cardDePessoaNovaSchema,
} from '../schemas/quadro-comercial.schema.js';
import { customFieldsParaApi } from './field-schema.service.js';
import { obterLayout } from './layout.service.js';
import { registrarNovoLead } from './leads.service.js';
import { criarOportunidade, mudarStatusDaOportunidade } from './oportunidades.service.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { tituloDaPessoa } from './pessoa-entidade.service.js';
import { pipelinesOcultos } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: o contrato de quadro do M2, com o CRM como dono. Cada pipeline ativo
 * vira um quadro, cada status uma coluna e cada oportunidade um card. Atrás de
 * `crm.quadro_comercial`; sem a flag, o quadro não existe para o tenant.
 *
 * Aqui não há regra de negócio: mover e criar passam pelos services do CRM.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 */

const SEPARADOR_DO_CURSOR = '|';
const CAMPOS_DO_CURSOR = 2;
const CHAVE_STATUS = 'status';
const CHAVE_RESPONSAVEL = 'usuarioResponsavelId';

const quadroInexistente = () => erroNaoEncontrado('Quadro não encontrado.');

/** @param {string} tenantId */
const quadroLigado = (tenantId) => featureAtiva(tenantId, CRM_FEATURES.QUADRO_COMERCIAL);

/**
 * Pipeline ativo que este papel vê. Qualquer outro caso é o mesmo 404.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 */
async function pipelineDoQuadro({ tenantId, role }, quadroRef) {
  if (!(await quadroLigado(tenantId))) throw quadroInexistente();
  const [pipelines, ocultos] = await Promise.all([
    buscarPipelines(tenantId),
    pipelinesOcultos(tenantId, role),
  ]);
  const pipeline = pipelines.find((item) => item.id === quadroRef);
  if (!pipeline || !pipeline.ativo || ocultos.includes(pipeline.id)) throw quadroInexistente();
  return pipeline;
}

/** @param {string | undefined} cursor */
function lerCursor(cursor) {
  if (!cursor) return null;
  const partes = cursor.split(SEPARADOR_DO_CURSOR);
  const [emTexto, id] = partes;
  if (partes.length !== CAMPOS_DO_CURSOR || Number.isNaN(Date.parse(emTexto))) {
    throw erroDeValidacao('cursor', 'Cursor inválido');
  }
  return { emTexto, id };
}

/** Número, para o `Decimal` do driver não sair como texto na resposta. */
function numero(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

/** @param {TenantContext} context */
async function listarQuadros({ tenantId, role }) {
  if (!(await quadroLigado(tenantId))) return [];
  const [pipelines, ocultos] = await Promise.all([
    buscarPipelines(tenantId),
    pipelinesOcultos(tenantId, role),
  ]);
  return pipelines
    .filter((pipeline) => pipeline.ativo && !ocultos.includes(pipeline.id))
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
 * @param {{ colunaRef: string, cursor?: string, limite: number }} consulta
 */
async function listarCards(context, quadroRef, { colunaRef, cursor, limite }) {
  const { id } = await pipelineDoQuadro(context, quadroRef);
  const linhas = await listarCardsDaColuna(context.tenantId, {
    pipelineId: id,
    status: colunaRef,
    cursor: lerCursor(cursor),
    limite: limite + 1,
  });
  const pagina = linhas.slice(0, limite);
  const ultima = pagina.at(-1);
  return {
    itens: pagina.map((linha) => ({
      entidadeId: linha.deal_id,
      atualizadoEm: linha.deal_atualizada_em,
    })),
    proximoCursor:
      linhas.length > limite
        ? `${ultima.deal_cursor}${SEPARADOR_DO_CURSOR}${ultima.deal_id}`
        : null,
  };
}

/**
 * Sem acesso a Valor, a soma sai `null` (P12): nem a soma pode revelar o dado.
 *
 * @param {TenantContext} context
 * @param {string} quadroRef
 * @param {{ colunaRef: string }} consulta
 */
async function resumoColuna(context, quadroRef, { colunaRef }) {
  const { id } = await pipelineDoQuadro(context, quadroRef);
  const [resumo, schema] = await Promise.all([
    resumirColuna(context.tenantId, { pipelineId: id, status: colunaRef }),
    obterSchemaDoPapel(context.tenantId, context.role),
  ]);
  const veValor = schema.campos.some((campo) => campo.chave === 'valor');
  return { total: resumo.total, soma: veValor ? numero(resumo.soma) : null };
}

/**
 * Quem arrasta = quem pode editar o Status (D4b), sem regra por coluna.
 * Oportunidade arquivada ou de pessoa anonimizada não muda.
 *
 * @param {TenantContext} context
 * @param {string} entidadeId
 * @returns {Promise<string[]>}
 */
async function acoesPermitidas({ tenantId, role }, entidadeId) {
  const [linha] = await buscarCardsPorIds(tenantId, [entidadeId], {
    ocultos: await pipelinesOcultos(tenantId, role),
    inatividade: null,
  });
  if (!linha || linha.anonimizado_em || linha.deal_arquivada_em) return [];
  const schema = await obterSchemaDoPapel(tenantId, role);
  return schema.restritos?.has(CHAVE_STATUS) ? [] : [ROTULOS_DO_QUADRO.MOVER];
}

/**
 * @param {TenantContext} context
 * @param {{ quadroRef: string, entidadeId: string, colunaDestino: string, expectedUpdatedAt?: string }} movimento
 */
async function mover(context, { quadroRef, entidadeId, colunaDestino, expectedUpdatedAt }) {
  const { tenantId, userId, role } = context;
  await pipelineDoQuadro(context, quadroRef);
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
    { status: colunaDestino, expectedUpdatedAt },
    userId,
    { papel: role },
  );
  return {
    entidadeId,
    colunaRef: colunaDestino,
    conflito: movida.conflito,
    atualizadoEm: movida.atualizadaEm,
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
  const [ocultos, inatividade, schema, { efetivo }] = await Promise.all([
    pipelinesOcultos(tenantId, role),
    featureAtiva(tenantId, CRM_FEATURES.INATIVIDADE),
    obterSchemaDoPapel(tenantId, role),
    obterLayout(tenantId, userId, { papel: role }),
  ]);
  const linhas = await buscarCardsPorIds(tenantId, ids, {
    ocultos,
    inatividade: inatividade ? new Date() : null,
  });
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
  resumoColuna,
  acoesPermitidas,
  mover,
  criar,
});
