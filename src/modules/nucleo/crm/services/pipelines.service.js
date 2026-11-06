import { erroDeValidacao } from '#core/errors/app-error.js';
import {
  buscarPipelines,
  inserirPipelineDeAtendimento,
  inserirPipelineDentroDoLimite,
  inserirPipelinePadrao,
} from '../adapters/crm-pipelines.repository.js';
import { inserirOpcoes } from '../adapters/crm-options.repository.js';
import { PIPELINES, STATUS_DO_ATENDIMENTO, TIPOS_LISTA, TIPOS_PIPELINE } from '../constants.js';

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
 * @param {string} tenantId
 * @param {{ nome: string, tipo: string }} dados
 */
export async function criarPipeline(tenantId, dados) {
  const criado = await inserirPipelineDentroDoLimite(tenantId, dados, PIPELINES.LIMITE_POR_TENANT);
  if (!criado) {
    throw erroDeValidacao(
      'pipeline',
      `O limite é de ${PIPELINES.LIMITE_POR_TENANT} pipelines, incluindo Vendas e Atendimento`,
    );
  }
  return criado;
}

/** @type {import('./reconcile.service.js').PassoReconciliacao[]} */
export const PASSOS_PIPELINES = Object.freeze([
  { nome: 'pipelines-padrao', executar: reconciliarPipelines },
]);
