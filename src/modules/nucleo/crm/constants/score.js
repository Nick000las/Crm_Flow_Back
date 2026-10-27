/**
 * Pontuação de leads (M14, `docs/crm/plano-configuracoes.md`). O score é o
 * campo nativo "Lead score" (`leadScore` / `lead_score`).
 */

export const CHAVE_CAMPO_SCORE = 'leadScore';

/**
 * Faixas de quem nunca salvou (decisão do usuário): Frio até 29 (inclui
 * negativos), Morno 30–69, Quente 70+. Limites inclusivos; `null` = sem limite.
 */
export const FAIXAS_SCORE_PADRAO = Object.freeze([
  Object.freeze({ chave: 'frio', rotulo: 'Frio', minimo: null, maximo: 29, cor: '#3B82F6' }),
  Object.freeze({ chave: 'morno', rotulo: 'Morno', minimo: 30, maximo: 69, cor: '#F59E0B' }),
  Object.freeze({ chave: 'quente', rotulo: 'Quente', minimo: 70, maximo: null, cor: '#EF4444' }),
]);

export const LIMITES_SCORE = Object.freeze({
  REGRAS_POR_TENANT: 100,
  CONDICOES_POR_REGRA: 10,
  FAIXAS_POR_TENANT: 10,
  PONTOS_MAX: 1000,
  /** Leads por UPDATE no recálculo em lote (cada lote grava o progresso). */
  LOTE_RECALCULO: 500,
});
