/**
 * @typedef {object} Board
 * @property {string} id
 * @property {string} boardType
 * @property {string} nome
 * @property {boolean} [canEdit]
 * @property {Date} createdAt
 * @property {number} [totalParticipantes]
 * @property {BoardParticipant[]} [participantes]
 */

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {string} boardId
 * @property {string} colunaId
 * @property {string} titulo
 * @property {string | null} responsavelId
 * @property {CardDetails & Record<string, unknown>} dadosExtras
 * @property {Date | null} [archivedAt]
 * @property {Date} updatedAt
 */

/**
 * @typedef {object} CardDetails
 * @property {string} [descricao]
 * @property {'sem_prioridade' | 'baixa' | 'media' | 'alta' | 'urgente'} [prioridade]
 * @property {string | null} [prazo] Data YYYY-MM-DD, sem conversão de fuso.
 * @property {boolean} [prazoConcluido]
 * @property {{id: string, nome: string, cor: string}[]} [etiquetas]
 * @property {{id: string, titulo: string, concluido: boolean}[]} [checklist]
 */

export {};

/**
 * @typedef {object} BoardParticipant
 * @property {string} id
 * @property {string} nome
 * @property {boolean} ativo
 * @property {'editor' | 'leitor'} [permissao]
 */
