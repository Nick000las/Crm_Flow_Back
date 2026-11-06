/** `crm_event.entidade`. */
export const ENTIDADE_OPORTUNIDADE = 'deal';

/**
 * `crm_event.tipo`. Consumidos no M5 (tempo real). O payload leva só ids e
 * chaves de status: evento não guarda dado pessoal.
 */
export const EVENTOS_OPORTUNIDADE = Object.freeze({
  CRIADA: 'deal.created',
  ATUALIZADA: 'deal.updated',
  STATUS_MUDOU: 'deal.status_changed',
  GANHA: 'deal.won',
  PERDIDA: 'deal.lost',
  REABERTA: 'deal.reopened',
  ARQUIVADA: 'deal.archived',
  DESARQUIVADA: 'deal.unarchived',
  EXCLUIDA: 'deal.deleted',
  RESTAURADA: 'deal.restored',
});

/**
 * Chaves do lead que moram na oportunidade principal (M2.5, F4). `/crm/leads`
 * continua aceitando e devolvendo todas; a gravação vai para `crm_deal`.
 */
export const CAMPOS_COMERCIAIS = Object.freeze([
  'status',
  'funilEstagioId',
  'valor',
  'probabilidadeFechamento',
  'dataPrevistaFechamento',
  'motivoPerda',
  'dataConversao',
]);

/** Limites de `crm_deal`: `amount NUMERIC(14, 2)` e `probability_override` de 0 a 100. */
export const LIMITES_OPORTUNIDADE = Object.freeze({
  VALOR_MAXIMO: 999_999_999_999.99,
  PROBABILIDADE_MAXIMA: 100,
});

/** Regra de quem assume o atendimento criado pela venda. */
export const REGRAS_DONO_ATENDIMENTO = Object.freeze({
  PESSOA: 'person_owner',
  USUARIO: 'specific_user',
  NINGUEM: 'none',
});
