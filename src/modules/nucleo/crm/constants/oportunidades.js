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

/** Regra de quem assume o atendimento criado pela venda. */
export const REGRAS_DONO_ATENDIMENTO = Object.freeze({
  PESSOA: 'person_owner',
  USUARIO: 'specific_user',
  NINGUEM: 'none',
});
