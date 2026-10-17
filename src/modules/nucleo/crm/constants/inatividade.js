/**
 * Lead esfriando (M9, `docs/crm/plano-configuracoes.md`). Cada status tem
 * os dias sem interação até o lead esfriar (`crm_option.stale_days`; sem
 * valor = desligado). "Esfriando" é calculado na leitura, nunca gravado.
 */
export const DIAS_ESFRIAR = Object.freeze({ MIN: 1, MAX: 365 });

/**
 * Sugestões da spec (§6), pela key do status — ganho e perdido ficam
 * desligados. Semeadas junto com a lista de status (e, nos tenants que já
 * tinham a lista, pela migration 0023).
 */
export const SUGESTAO_DIAS_ESFRIAR = Object.freeze({
  novo: 1,
  em_contato: 3,
  qualificado: 5,
  proposta: 7,
  negociacao: 7,
});

/**
 * Resumo diário no sino: o job roda de hora em hora e, em cada tenant, só
 * a partir das 8h no fuso dele. A chave de dedup (com a data local) faz
 * cada usuário receber um por dia, mesmo com o worker parado às 8h.
 */
export const NOTIFICACAO_ESFRIANDO = Object.freeze({
  AGENDAMENTO_ID: 'crm-notificar-esfriando',
  JOB: 'notificar-esfriando',
  CRON: '0 * * * *',
  HORA_LOCAL: 8,
  MODULO: 'crm',
  TIPO: 'crm.esfriando',
  TIPO_SEM_RESPONSAVEL: 'crm.esfriando_sem_responsavel',
  ROTA: '/crm/leads',
});

/** View do sistema (não fica no banco): o filtro fixo "Esfriando". */
export const VIEW_ESFRIANDO = Object.freeze({
  id: 'esfriando',
  nome: 'Esfriando',
  filtros: Object.freeze({ esfriando: true, filtros: Object.freeze([]) }),
  sistema: true,
});
