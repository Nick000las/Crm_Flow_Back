/**
 * Constantes do módulo CRM, separadas por assunto — este arquivo só
 * reexporta, pra todo `import ... from '../constants.js'` seguir valendo:
 *
 * - `constants/campos.js`: tipos, camadas, campos do sistema, contextos de
 *   visibilidade, valores fechados e operadores de filtro;
 * - `constants/listas.js`: listas configuráveis (status, origem, motivo de
 *   perda, tipo de atividade, tag) e os padrões semeados;
 * - `constants/layout.js`: layout do lead (identificador, destaques, seções);
 * - `constants/planilha.js`: importação e exportação;
 * - `constants/arquivo.js`: arquivo, lixeira e a purga agendada;
 * - `constants/historico.js`: atividades e eventos do lead;
 * - `constants/acesso.js`: papéis de gestão e feature flags.
 */
export * from './constants/arquivo.js';
export * from './constants/historico.js';
export * from './constants/campos.js';
export * from './constants/layout.js';
export * from './constants/listas.js';
export * from './constants/planilha.js';
export * from './constants/acesso.js';
