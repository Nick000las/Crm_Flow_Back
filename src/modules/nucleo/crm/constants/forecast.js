/**
 * Forecast (FC1–FC3, docs/crm/plano-execucao-formularios-forecast.md).
 */

/**
 * Campos de que o forecast precisa: ligar `crm.forecast` num tenant liga os
 * dois (decisão do dono, 19/11/2026). Desligar a flag não os desliga.
 */
export const CAMPOS_DO_FORECAST = Object.freeze([
  'dataPrevistaFechamento',
  'probabilidadeFechamento',
]);

/** Limites da consulta e da edição em lote (FC2). */
export const LIMITES_FORECAST = Object.freeze({
  /** De `de` a `ate`, inclusive. */
  MESES_MAXIMOS: 24,
  /** Sem período: o mês atual (no fuso do tenant), três antes e três depois. */
  MESES_ANTES_PADRAO: 3,
  MESES_DEPOIS_PADRAO: 3,
  /** Ids por pedido em "definir data prevista". */
  IDS_POR_LOTE: 200,
  /** Lista de oportunidades de um mês ou bloco. */
  TAMANHO_PADRAO: 50,
  TAMANHO_MAXIMO: 100,
  /** O agregado fica em cache por pouco tempo: a chave já muda a cada escrita. */
  TTL_CACHE_SEGUNDOS: 60,
});

/** `agrupar` de `GET /crm/forecast`. */
export const AGRUPAMENTOS_FORECAST = Object.freeze({
  TOTAL: 'total',
  RESPONSAVEL: 'responsavel',
  STATUS: 'status',
});

/** Blocos fora dos meses, como chegam em `?bloco=` (e saem do SQL). */
export const BLOCOS_FORECAST = Object.freeze({
  ATRASADAS: 'atrasadas',
  /** Abertas de hoje em diante, mas antes do mês `de` (período que começa no futuro). */
  ANTES_DO_PERIODO: 'antes_do_periodo',
  SEM_PREVISAO: 'sem_previsao',
  ALEM_DO_HORIZONTE: 'alem_do_horizonte',
  SEM_VALOR: 'sem_valor',
});

/** `tipo` da lista de um mês: as ganhas nele ou as abertas previstas para ele. */
export const TIPOS_MES_FORECAST = Object.freeze({ REALIZADO: 'realizado', ABERTO: 'aberto' });

/** `ignoradas[].motivo` de "definir data prevista", além do `code` de um `AppError`. */
export const MOTIVOS_IGNORADA_FORECAST = Object.freeze({
  NAO_ENCONTRADA: 'NAO_ENCONTRADA',
  NAO_ABERTA: 'NAO_ABERTA',
});

/** Rótulo do grupo das oportunidades sem responsável. */
export const ROTULO_SEM_RESPONSAVEL = 'Sem responsável';

/** Responsável que está no snapshot mas não existe mais em `usuarios` (FC3). */
export const ROTULO_RESPONSAVEL_REMOVIDO = 'Responsável removido';

/**
 * Snapshot semanal do forecast (FC3). O job roda de hora em hora e, em cada
 * tenant, grava a semana a partir de segunda às 6h no fuso dele. Já gravada
 * (UNIQUE por tenant, semana e mês), pula: worker parado na segunda grava na
 * próxima hora em que subir, mesmo no meio da semana.
 */
export const SNAPSHOT_FORECAST = Object.freeze({
  AGENDAMENTO_ID: 'crm-snapshot-forecast',
  JOB: 'snapshot-forecast',
  CRON: '0 * * * *',
  /** Na segunda, antes desta hora local, a semana do snapshot ainda não começou. */
  HORA_LOCAL: 6,
  /** O mês atual e os seguintes: quatro linhas por semana. */
  MESES_A_FRENTE: 3,
  /** Chave do `by_owner` das oportunidades sem responsável. */
  CHAVE_SEM_RESPONSAVEL: 'sem_responsavel',
});

/** O que `tirarSnapshotDoTenant` fez num tenant. */
export const RESULTADOS_SNAPSHOT = Object.freeze({
  GRAVADO: 'gravado',
  JA_EXISTIA: 'ja_existia',
  CEDO: 'cedo',
  SEM_FLAG: 'sem_flag',
});

/** `GET /crm/forecast/assertividade` (FC3). */
export const LIMITES_ASSERTIVIDADE = Object.freeze({
  /** Sem período: os seis meses fechados antes do atual. */
  MESES_PADRAO: 6,
  /** Casas da razão realizado / previsto. */
  CASAS_DA_ASSERTIVIDADE: 4,
});
