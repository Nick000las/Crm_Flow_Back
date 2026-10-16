import { PASSOS_CAMPOS } from './campos-reconcile.service.js';
import { PASSOS_LISTAS } from './listas-reconcile.service.js';
import { invalidarSchemaCampos } from './field-schema.service.js';

/**
 * Reconciliação do CRM num tenant (`Module.reconciliar`): passos
 * idempotentes que levam o tenant ao estado esperado pela versão atual do
 * código — ex: semear os campos do sistema em `crm_field` (M1) e as
 * opções padrão das listas (M3). Roda em `pnpm crm:reconcile` (deploy) e
 * pode rodar de novo sem efeito colateral.
 *
 * Cada passo novo entra em `PASSOS`, nunca como migration de dado.
 *
 * @typedef {{ nome: string, executar: (tenantId: string) => Promise<unknown> }} PassoReconciliacao
 */

/** @type {readonly PassoReconciliacao[]} */
export const PASSOS = Object.freeze([...PASSOS_CAMPOS, ...PASSOS_LISTAS]);

/**
 * Executa os passos em ordem e para no primeiro que falhar (um passo pode
 * depender do anterior).
 *
 * @param {string} tenantId
 * @param {PassoReconciliacao[]} [passos]
 * @returns {Promise<{ passo: string, resultado: unknown }[]>}
 */
export async function reconciliarTenant(tenantId, passos = PASSOS) {
  const relatorio = [];
  try {
    for (const passo of passos) {
      relatorio.push({ passo: passo.nome, resultado: await passo.executar(tenantId) });
    }
  } finally {
    // Mesmo com falha no meio, o que já rodou pode ter mudado a configuração.
    await invalidarSchemaCampos(tenantId);
  }
  return relatorio;
}
