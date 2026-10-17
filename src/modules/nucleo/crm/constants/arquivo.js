/**
 * Arquivo e lixeira do lead (M5, `docs/crm/plano-configuracoes.md`).
 *
 * `situacao` é um filtro fixo da busca (e do export/views): sem ele, a
 * lista mostra só os ativos.
 */
export const SITUACOES_LEAD = Object.freeze({
  ATIVOS: 'ativos',
  ARQUIVADOS: 'arquivados',
  LIXEIRA: 'lixeira',
});

export const LISTA_SITUACOES_LEAD = Object.freeze(Object.values(SITUACOES_LEAD));

/** Dias que um lead excluído pode ser restaurado antes da purga. */
export const DIAS_NA_LIXEIRA = 30;

/**
 * Fila de manutenção do CRM (jobs agendados, não disparados por usuário).
 * A purga roda uma vez por dia, de madrugada no horário de Brasília.
 */
export const MANUTENCAO_FILA = 'crm-manutencao';

export const PURGA_LIXEIRA = Object.freeze({
  AGENDAMENTO_ID: 'crm-purga-lixeira',
  JOB: 'purgar-lixeira',
  CRON: '0 3 * * *',
  FUSO: 'America/Sao_Paulo',
});
