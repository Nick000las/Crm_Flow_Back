import { inserirCamposSistema } from '../adapters/crm-fields.repository.js';
import { CAMPOS_SISTEMA } from '../constants.js';

/**
 * Reconciliação dos campos (docs/crm/plano-configuracoes.md, M1.2):
 * garante que o tenant tem as linhas de `crm_field` dos campos do sistema
 * (`CAMPOS_SISTEMA`), com o padrão do contrato. Idempotente — campo já
 * existente nunca é tocado, então a configuração do tenant é preservada.
 * Roda no `pnpm crm:reconcile` (deploy, ex: campo do sistema novo no
 * contrato), na contratação do CRM e de forma preguiçosa no resolver.
 */

/**
 * @param {string} tenantId
 * @returns {Promise<{ criados: number }>}
 */
export async function reconciliarCamposSistema(tenantId) {
  const campos = CAMPOS_SISTEMA.map((campo) => ({
    systemKey: campo.systemKey,
    label: campo.label,
    tipo: campo.tipo,
    position: campo.ordemPadrao,
    isRequired: campo.obrigatorioPadrao,
    visivel: campo.visivelPadrao,
  }));

  return { criados: await inserirCamposSistema(tenantId, campos) };
}

/** @type {import('./reconcile.service.js').PassoReconciliacao[]} */
export const PASSOS_CAMPOS = Object.freeze([{ nome: 'campos-sistema', executar: reconciliarCamposSistema }]);

/**
 * Todos os passos de campos em sequência — usado pelo resolver quando
 * encontra um tenant ainda sem os campos do sistema.
 *
 * @param {string} tenantId
 */
export async function reconciliarCampos(tenantId) {
  for (const passo of PASSOS_CAMPOS) {
    await passo.executar(tenantId);
  }
}
