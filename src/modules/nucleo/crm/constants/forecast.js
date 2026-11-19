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
