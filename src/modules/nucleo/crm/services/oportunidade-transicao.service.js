import { CATEGORIAS_STATUS } from '../constants.js';
import { EVENTOS_OPORTUNIDADE } from '../constants/oportunidades.js';

/**
 * SERVICE (puro): o que muda quando uma oportunidade troca de status. Ganhar,
 * perder e reabrir são o mesmo caminho: quem define é a categoria da opção.
 *
 * @typedef {{ key: string, label: string, category: string, ativo: boolean }} OpcaoDeStatus
 */

const EVENTO_DA_CATEGORIA = Object.freeze({
  [CATEGORIAS_STATUS.GANHO]: EVENTOS_OPORTUNIDADE.GANHA,
  [CATEGORIAS_STATUS.PERDIDO]: EVENTOS_OPORTUNIDADE.PERDIDA,
});

/**
 * @param {Record<string, any>} deal  linha atual
 * @param {OpcaoDeStatus} opcao  status de destino, do pipeline da oportunidade
 * @param {{ motivoPerda?: string | null }} dados
 * @param {Date} agora
 */
export function planejarStatus(deal, opcao, { motivoPerda }, agora) {
  const destino = opcao.category;
  const origem = deal.status_category;
  const mudouCategoria = origem !== destino;
  const perdida = destino === CATEGORIAS_STATUS.PERDIDO;
  const reabriu = origem !== CATEGORIAS_STATUS.ABERTO && destino === CATEGORIAS_STATUS.ABERTO;

  /** @type {Record<string, unknown>} */
  const mudancas = {
    status: opcao.key,
    status_category: destino,
    // Data de quando entrou na categoria: mudar de Ganho para outro status de ganho não troca.
    won_at: destino === CATEGORIAS_STATUS.GANHO ? (mudouCategoria ? agora : deal.won_at) : null,
    lost_at: perdida ? (mudouCategoria ? agora : deal.lost_at) : null,
    lost_reason: perdida ? (motivoPerda ?? deal.lost_reason) : null,
  };

  const statusMudou = deal.status !== opcao.key;
  const evento =
    (mudouCategoria && EVENTO_DA_CATEGORIA[destino]) ||
    (reabriu ? EVENTOS_OPORTUNIDADE.REABERTA : EVENTOS_OPORTUNIDADE.STATUS_MUDOU);

  return {
    mudancas,
    evento,
    statusMudou,
    statusAnterior: deal.status,
    ganhou: mudouCategoria && destino === CATEGORIAS_STATUS.GANHO,
    // Só venda ganha tem atendimento nascido dela para avisar.
    reabriu: reabriu && origem === CATEGORIAS_STATUS.GANHO,
  };
}

/**
 * Entradas do diff do histórico, nas chaves da API do lead.
 *
 * @param {Record<string, any>} deal
 * @param {Record<string, unknown>} mudancas
 * @param {Readonly<Record<string, string>>} campoDaColuna  coluna → chave no histórico
 */
export function diffDaOportunidade(deal, mudancas, campoDaColuna) {
  const normalizar = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (valor instanceof Date) return valor.toISOString();
    return typeof valor === 'object' ? Number(valor) : valor;
  };
  return Object.entries(campoDaColuna).flatMap(([coluna, campo]) => {
    if (!(coluna in mudancas)) return [];
    const antes = normalizar(deal[coluna]);
    const depois = normalizar(mudancas[coluna]);
    return antes === depois ? [] : [{ campo, antes, depois }];
  });
}
