import { erroCamposObrigatorios } from '#core/errors/app-error.js';
import { ACOES_CARD_ENTIDADE } from '../constants.js';

export const BOARD_TYPE_FALSO = 'falso_oportunidades';
export const QUADRO_FALSO = 'pipeline-1';
export const COLUNA_ABERTA = 'aberta';
export const COLUNA_PERDIDA = 'perdida';
export const CARD_SO_LEITURA = 'card-so-leitura';
export const CARD_RESTRITO = 'card-restrito';

/**
 * Módulo em memória que implementa os dois contratos do M2, para provar o
 * motor sem depender do CRM. "Perdida" exige `motivo`, como faria uma regra
 * de domínio. Cada chamada cria um estado novo.
 *
 * @param {{ id: string, coluna: string, valor?: number }[]} cardsIniciais
 */
export function criarModuloFalso(cardsIniciais = []) {
  const cards = cardsIniciais.map((card) => ({ ...card }));

  return {
    key: 'provedor_falso',
    name: 'Provedor falso',
    registerRoutes() {},
    cards,
    quadros: [
      {
        boardType: BOARD_TYPE_FALSO,
        entidadeTipo: 'falsa',
        listarQuadros: async () => [{ quadroRef: QUADRO_FALSO, nome: 'Pipeline falso' }],
        listarColunas: async () => [
          { ref: COLUNA_ABERTA, nome: 'Aberta', cor: null },
          { ref: COLUNA_PERDIDA, nome: 'Perdida', cor: null },
        ],
        listarCards: async (_ctx, _quadroRef, { colunaRef, cursor, limite }) => {
          const daColuna = cards.filter((card) => card.coluna === colunaRef);
          const inicio = Number(cursor ?? 0);
          const fim = inicio + limite;
          return {
            itens: daColuna
              .slice(inicio, fim)
              .map(({ id }) => ({ entidadeId: id, atualizadoEm: null })),
            proximoCursor: fim < daColuna.length ? String(fim) : null,
          };
        },
        resumoColuna: async (_ctx, _quadroRef, { colunaRef }) => {
          const daColuna = cards.filter((card) => card.coluna === colunaRef);
          return {
            total: daColuna.length,
            soma: daColuna.reduce((soma, card) => soma + (card.valor ?? 0), 0),
          };
        },
        acoesPermitidas: async (_ctx, entidadeId) =>
          entidadeId === CARD_SO_LEITURA ? [] : [ACOES_CARD_ENTIDADE.MOVER],
        mover: async (_ctx, { entidadeId, colunaDestino }) => {
          const card = cards.find((item) => item.id === entidadeId);
          if (colunaDestino === COLUNA_PERDIDA && !card.motivo) {
            throw erroCamposObrigatorios({ motivo: '"Motivo" é obrigatório nesta coluna' });
          }
          card.coluna = colunaDestino;
          return { entidadeId, colunaRef: colunaDestino };
        },
        criar: async (_ctx, { colunaRef, dados }) => {
          const card = { id: dados.id, coluna: colunaRef };
          cards.push(card);
          return { entidadeId: card.id, colunaRef };
        },
      },
    ],
    entidades: [
      {
        tipo: 'falsa',
        descrever: async (_ctx, ids) =>
          ids
            .filter((id) => id !== CARD_RESTRITO)
            .map((id) => ({ id, titulo: `Card ${id}`, subtitulo: null, destaques: [] })),
        rotaFicha: (id) => `/falso/${id}`,
        resolverVinculos: async (_tenantId, ids) => Object.fromEntries(ids.map((id) => [id, id])),
      },
    ],
  };
}
