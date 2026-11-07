import {
  buscarOportunidadesParaEventos,
  confirmarEventos as confirmarEventosRepository,
  reservarEventos,
} from '../adapters/crm-outbox.repository.js';
import { ENTIDADE_DO_EVENTO_DA_PESSOA } from '../constants.js';

/**
 * SERVICE: o outbox `crm_event` como fonte única do tempo real (M5). Como o
 * evento nasce na transação de quem mudou o dado, ficha, massa, importação no
 * worker e auto-criação chegam pelo mesmo caminho.
 *
 * Mudança na pessoa vira uma mudança em cada card dela: é ela que dá nome ao card.
 * Sem usuário: quem decide o que cada um vê é a releitura pela API.
 */

/**
 * @param {number} limite
 * @returns {Promise<{ ids: string[], eventos: { tenantId: string, quadroRef: string, entidadeId: string }[] }>}
 */
export async function drenarEventos(limite) {
  const linhas = await reservarEventos(limite);
  // O antigo é confirmado sem ser emitido: quem abre o quadro já lê o estado atual.
  const recentes = linhas.filter((linha) => linha.recente);
  const dasPessoas = recentes.filter((linha) => linha.entidade === ENTIDADE_DO_EVENTO_DA_PESSOA);
  const dosNegocios = recentes.filter((linha) => linha.entidade !== ENTIDADE_DO_EVENTO_DA_PESSOA);
  const cardsDasPessoas =
    dasPessoas.length > 0
      ? await buscarOportunidadesParaEventos(dasPessoas.map((linha) => linha.entidade_id))
      : [];

  return {
    ids: linhas.map((linha) => linha.id),
    eventos: [
      ...dosNegocios.map((linha) => ({
        tenantId: linha.tenant_id,
        quadroRef: linha.payload.pipelineId,
        entidadeId: linha.entidade_id,
      })),
      ...cardsDasPessoas.map((deal) => ({
        tenantId: deal.tenant_id,
        quadroRef: deal.pipeline_id,
        entidadeId: deal.id,
      })),
    ],
  };
}

/** @param {string[]} ids */
export async function confirmarEventos(ids) {
  if (ids.length > 0) await confirmarEventosRepository(ids);
}
