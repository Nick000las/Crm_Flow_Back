/**
 * Regras de obrigatoriedade por status e condicionais (M8,
 * `docs/crm/plano-configuracoes.md`). O "sempre obrigatório" é o
 * `obrigatorio` do campo (M2), não uma regra.
 */

export const TIPOS_REGRA = Object.freeze({
  POR_STATUS: 'required_from_status',
  CONDICIONAL: 'conditional',
});

export const LISTA_TIPOS_REGRA = Object.freeze(Object.values(TIPOS_REGRA));

/** Regra semeada pelo código: pode ser desligada, não excluída. */
export const REGRA_MOTIVO_PERDA = Object.freeze({
  systemKey: 'motivo_perda_em_perdido',
  campoSystemKey: 'motivoPerda',
  kind: 'required_from_status',
  condicao: Object.freeze({ categorias: Object.freeze(['perdido']) }),
  efeito: Object.freeze({ obrigatorio: true }),
});

export const REGRAS_DO_SISTEMA = Object.freeze([REGRA_MOTIVO_PERDA]);

/** Como a categoria aparece na mensagem ("quando o lead está perdido"). */
export const CATEGORIA_NA_FRASE = Object.freeze({
  aberto: 'em aberto',
  ganho: 'ganho',
  perdido: 'perdido',
});

export const LIMITES_REGRAS = Object.freeze({
  POR_TENANT: 100,
  STATUS_POR_REGRA: 50,
});
