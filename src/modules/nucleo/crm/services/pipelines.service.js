import { erroDeConflito, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';
import {
  buscarPipelines,
  contarOportunidadesPorPipeline,
  excluirPipeline as excluirPipelineRepository,
  inserirPipelineDeAtendimento,
  inserirPipelineDentroDoLimite,
  inserirPipelinePadrao,
  salvarPipeline,
} from '../adapters/crm-pipelines.repository.js';
import {
  buscarStatusDoPipeline,
  contarUsos,
  inserirOpcoes,
} from '../adapters/crm-options.repository.js';
import {
  CATEGORIAS_STATUS,
  PIPELINES,
  REGRAS_DONO_ATENDIMENTO,
  STATUS_DE_VENDAS_NOVO,
  STATUS_DO_ATENDIMENTO,
  TIPOS_LISTA,
  TIPOS_PIPELINE,
} from '../constants.js';
import { atualizarOpcao, criarOpcao, excluirOpcao, reordenarLista } from './listas.service.js';
import { pipelinesOcultos } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: pipelines comerciais (M2.5). Todo tenant nasce com Vendas (padrão)
 * e Atendimento. O dono pode renomear ou desativar, e o reconcile não recria:
 * Atendimento conta como existente se houver qualquer pipeline `service`.
 */

/**
 * @param {string} tenantId
 * @param {number} proximaPosicao
 */
async function criarAtendimento(tenantId, proximaPosicao) {
  const pipeline = await inserirPipelineDeAtendimento(tenantId, {
    nome: PIPELINES.NOME_ATENDIMENTO,
    tipo: TIPOS_PIPELINE.ATENDIMENTO,
    position: proximaPosicao,
    statusInicial: STATUS_DO_ATENDIMENTO[0].key,
    regraDoDono: PIPELINES.DONO_DO_ATENDIMENTO,
  });
  await inserirOpcoes(
    tenantId,
    TIPOS_LISTA.STATUS,
    STATUS_DO_ATENDIMENTO.map((opcao, indice) => ({ ...opcao, position: indice })),
    pipeline.id,
  );
}

/**
 * Passo do reconcile, antes das listas: os status de Vendas pertencem ao
 * pipeline padrão. Idempotente.
 *
 * @param {string} tenantId
 * @returns {Promise<{ criados: number }>}
 */
export async function reconciliarPipelines(tenantId) {
  const antes = await buscarPipelines(tenantId);
  await inserirPipelinePadrao(tenantId, {
    nome: PIPELINES.NOME_VENDAS,
    tipo: TIPOS_PIPELINE.VENDAS,
  });

  const temAtendimento = antes.some((pipeline) => pipeline.tipo === TIPOS_PIPELINE.ATENDIMENTO);
  if (!temAtendimento) {
    await criarAtendimento(tenantId, (await buscarPipelines(tenantId)).length);
  }
  return { criados: (await buscarPipelines(tenantId)).length - antes.length };
}

/**
 * @param {import('../adapters/crm-pipelines.repository.js').Pipeline} pipeline
 */
function formatarPipeline(pipeline) {
  const {
    automacao_ativa: ativa,
    automacao_origem_id: origemId,
    automacao_status_inicial: statusInicial,
    automacao_regra_dono: regraDoDono,
    automacao_dono_id: donoId,
    visivel_operador: visivelOperador,
    ...dados
  } = pipeline;
  return {
    ...dados,
    visivelOperador,
    automacao: { ativa, origemId, statusInicial, regraDoDono, donoId },
  };
}

/**
 * Configurações → Pipelines: cada pipeline com os status, os usos e a automação.
 *
 * @param {string} tenantId
 * @param {{ papel?: string }} [acesso]  pipeline oculto para o papel não aparece (D4)
 */
export async function listarPipelines(tenantId, { papel } = {}) {
  const [pipelines, oportunidades, ocultos] = await Promise.all([
    buscarPipelines(tenantId),
    contarOportunidadesPorPipeline(tenantId),
    pipelinesOcultos(tenantId, papel),
  ]);
  const visiveis = pipelines.filter((pipeline) => !ocultos.includes(pipeline.id));
  return Promise.all(
    visiveis.map(async (pipeline) => {
      const [status, usos] = await Promise.all([
        buscarStatusDoPipeline(tenantId, pipeline.id),
        contarUsos(tenantId, TIPOS_LISTA.STATUS, pipeline.id),
      ]);
      return {
        ...formatarPipeline(pipeline),
        oportunidades: oportunidades.get(pipeline.id) ?? 0,
        status: status.map((opcao) => ({ ...opcao, usos: usos.get(opcao.key) ?? 0 })),
      };
    }),
  );
}

/**
 * Nasce com uma lista inicial de status. Pipeline de atendimento nasce com a
 * automação desligada: o dono escolhe de qual venda ele vem.
 *
 * @param {string} tenantId
 * @param {{ nome: string, tipo: string }} dados
 */
export async function criarPipeline(tenantId, dados) {
  const criado = await inserirPipelineDentroDoLimite(
    tenantId,
    dados,
    PIPELINES.LIMITE_POR_TENANT,
    dados.tipo === TIPOS_PIPELINE.ATENDIMENTO ? STATUS_DO_ATENDIMENTO : STATUS_DE_VENDAS_NOVO,
  );
  if (!criado) {
    throw erroDeValidacao(
      'pipeline',
      `O limite é de ${PIPELINES.LIMITE_POR_TENANT} pipelines, incluindo Vendas e Atendimento`,
    );
  }
  return formatarPipeline(criado);
}

/**
 * @param {string} tenantId
 * @param {string} id
 */
async function pipelineExistente(tenantId, id) {
  const pipelines = await buscarPipelines(tenantId);
  const pipeline = pipelines.find((item) => item.id === id);
  if (!pipeline) throw erroNaoEncontrado('Pipeline não encontrado');
  return { pipeline, pipelines };
}

/**
 * A automação ligada precisa conseguir criar o card: venda ativa de origem,
 * status aberto ativo neste pipeline e, com usuário fixo, um usuário ativo.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {import('../adapters/crm-pipelines.repository.js').Pipeline[]} pipelines
 * @param {{ origemId: string | null, statusInicial: string | null, regraDoDono: string, donoId: string | null }} automacao
 */
async function validarAutomacao(tenantId, id, pipelines, automacao) {
  const origem = pipelines.find((item) => item.id === automacao.origemId);
  if (!origem || !origem.ativo || origem.tipo !== TIPOS_PIPELINE.VENDAS) {
    throw erroDeValidacao('automacao.origemId', 'Escolha um pipeline de vendas ativo');
  }
  const status = await buscarStatusDoPipeline(tenantId, id);
  const inicial = status.find((opcao) => opcao.key === automacao.statusInicial);
  if (!inicial || !inicial.ativo || inicial.category !== CATEGORIAS_STATUS.ABERTO) {
    throw erroDeValidacao('automacao.statusInicial', 'Escolha um status aberto deste pipeline');
  }
  if (automacao.regraDoDono !== REGRAS_DONO_ATENDIMENTO.USUARIO) return;
  if (!automacao.donoId || !(await buscarUsuarioAtivoDoTenant(tenantId, automacao.donoId))) {
    throw erroDeValidacao('automacao.donoId', 'Escolha um usuário ativo desta conta');
  }
}

/**
 * Parcial: omitido mantém. Desativar não mexe nas oportunidades que já estão no
 * pipeline; só impede criar novas.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{
 *   nome?: string, ativo?: boolean, visivelOperador?: boolean,
 *   automacao?: { ativa?: boolean, origemId?: string | null, statusInicial?: string | null, regraDoDono?: string, donoId?: string | null },
 * }} mudancas
 */
export async function atualizarPipeline(
  tenantId,
  id,
  { nome, ativo, visivelOperador, automacao = {} },
) {
  const { pipeline, pipelines } = await pipelineExistente(tenantId, id);
  if (pipeline.padrao && ativo === false) {
    throw erroDeConflito('ativo', 'O pipeline padrão não pode ser desativado');
  }
  if (pipeline.tipo !== TIPOS_PIPELINE.ATENDIMENTO && Object.keys(automacao).length > 0) {
    throw erroDeValidacao('automacao', 'Só pipeline de atendimento tem automação');
  }

  const atual = formatarPipeline(pipeline).automacao;
  const final = { ...atual, ...automacao };
  if (final.ativa) await validarAutomacao(tenantId, id, pipelines, final);

  const salvo = await salvarPipeline(tenantId, id, {
    nome: nome ?? pipeline.nome,
    ativo: ativo ?? pipeline.ativo,
    visivelOperador: visivelOperador ?? pipeline.visivel_operador,
    automacaoAtiva: final.ativa,
    origemId: final.origemId,
    statusInicial: final.statusInicial,
    regraDoDono: final.regraDoDono,
    donoId: final.regraDoDono === REGRAS_DONO_ATENDIMENTO.USUARIO ? final.donoId : null,
  });
  if (!salvo) throw erroNaoEncontrado('Pipeline não encontrado');
  return formatarPipeline(salvo);
}

/** Por que um pipeline não pode ser apagado. */
const BLOQUEIOS_DE_EXCLUSAO = Object.freeze({
  padrao: 'O pipeline padrão não pode ser excluído',
  em_uso: 'Este pipeline tem oportunidades: desative em vez de excluir',
  origem: 'Outro pipeline nasce deste: mude a automação dele antes',
});

/**
 * @param {string} tenantId
 * @param {string} id
 * @returns {Promise<{ removido: true }>}
 */
export async function excluirPipeline(tenantId, id) {
  const resultado = await excluirPipelineRepository(tenantId, id);
  if (resultado === 'nao_encontrado') throw erroNaoEncontrado('Pipeline não encontrado');
  if (resultado !== 'removido') {
    throw erroDeConflito('pipeline', BLOQUEIOS_DE_EXCLUSAO[resultado]);
  }
  return { removido: true };
}

/**
 * Status de um pipeline: as mesmas regras da lista de Configurações, com o
 * escopo do pipeline.
 *
 * @param {string} tenantId
 * @param {string} pipelineId
 * @param {Parameters<typeof criarOpcao>[2]} dados
 */
export async function criarStatus(tenantId, pipelineId, dados) {
  await pipelineExistente(tenantId, pipelineId);
  return criarOpcao(tenantId, TIPOS_LISTA.STATUS, dados, { pipelineId });
}

/**
 * @param {string} tenantId
 * @param {string} pipelineId
 * @param {string} opcaoId
 * @param {Parameters<typeof atualizarOpcao>[3]} mudancas
 */
export async function atualizarStatus(tenantId, pipelineId, opcaoId, mudancas) {
  await pipelineExistente(tenantId, pipelineId);
  return atualizarOpcao(tenantId, TIPOS_LISTA.STATUS, opcaoId, mudancas, { pipelineId });
}

/**
 * @param {string} tenantId
 * @param {string} pipelineId
 * @param {string[]} ids
 */
export async function reordenarStatus(tenantId, pipelineId, ids) {
  await pipelineExistente(tenantId, pipelineId);
  return reordenarLista(tenantId, TIPOS_LISTA.STATUS, ids, { pipelineId });
}

/**
 * @param {string} tenantId
 * @param {string} pipelineId
 * @param {string} opcaoId
 */
export async function excluirStatus(tenantId, pipelineId, opcaoId) {
  await pipelineExistente(tenantId, pipelineId);
  return excluirOpcao(tenantId, TIPOS_LISTA.STATUS, opcaoId, { pipelineId });
}

/** @type {import('./reconcile.service.js').PassoReconciliacao[]} */
export const PASSOS_PIPELINES = Object.freeze([
  { nome: 'pipelines-padrao', executar: reconciliarPipelines },
]);
