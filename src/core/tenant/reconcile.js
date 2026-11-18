/**
 * @file Roda `Module.aoLigarFeatures(tenantId, chaves)` de cada módulo dono das flags que
 * **acabaram** de ligar no tenant.
 */
import { modulosRegistrados } from '#core/registry/modules.js';

/**
 * Roda `Module.reconciliar(tenantId)` dos módulos indicados — chamado
 * quando um tenant passa a ter o módulo (criação do tenant, contratação).
 * Ex.: o CRM semeia os campos do sistema em `crm_field`.
 *
 * Best-effort de propósito: a contratação já foi gravada, e reconciliar é
 * idempotente — o que falhar aqui é refeito pelo `pnpm reconcile` (deploy)
 * ou de forma preguiçosa pelo próprio módulo. Por isso nunca lança.
 *
 * @param {string} tenantId
 * @param {string[]} moduleKeys
 * @returns {Promise<{ moduleKey: string, ok: boolean, erro?: string }[]>}
 */
export async function reconciliarModulos(tenantId, moduleKeys) {
  const alvos = modulosRegistrados().filter(
    (modulo) => moduleKeys.includes(modulo.key) && typeof modulo.reconciliar === 'function',
  );
  const resultados = await Promise.allSettled(alvos.map((modulo) => modulo.reconciliar(tenantId)));

  return resultados.map((resultado, indice) => {
    const moduleKey = alvos[indice].key;

    if (resultado.status === 'fulfilled') {
      return { moduleKey, ok: true };
    }

    const erro =
      resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason);

    console.warn(`[reconcile] ${moduleKey} falhou no tenant ${tenantId}: ${erro}`);

    return { moduleKey, ok: false, erro };
  });
}

/**
 * Roda `Module.aoLigarFeatures(tenantId, chaves)` de cada módulo dono das
 * flags que **acabaram** de ligar no tenant. Ex.: ligar `crm.forecast` liga os
 * campos de que o forecast precisa.
 *
 * Best-effort, como `reconciliarModulos`: a flag já foi gravada e não volta
 * atrás por erro aqui; o dono ainda pode ajustar à mão. Nunca lança.
 *
 * @param {string} tenantId
 * @param {string[]} ligadas  flags que estavam desligadas e agora estão ligadas
 * @returns {Promise<{ moduleKey: string, ok: boolean, erro?: string }[]>}
 */
export async function avisarFeaturesLigadas(tenantId, ligadas) {
  if (ligadas.length === 0) {
    return [];
  }

  const alvos = modulosRegistrados()
    .filter((modulo) => typeof modulo.aoLigarFeatures === 'function')
    .map((modulo) => ({
      modulo,
      chaves: ligadas.filter((chave) => chave.startsWith(`${modulo.key}.`)),
    }))
    .filter(({ chaves }) => chaves.length > 0);
  const resultados = await Promise.allSettled(
    alvos.map(({ modulo, chaves }) => modulo.aoLigarFeatures(tenantId, chaves)),
  );

  return resultados.map((resultado, indice) => {
    const moduleKey = alvos[indice].modulo.key;

    if (resultado.status === 'fulfilled') {
      return { moduleKey, ok: true };
    }

    const erro =
      resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason);

    console.warn(`[features] ${moduleKey} falhou ao ligar flags no tenant ${tenantId}: ${erro}`);

    return { moduleKey, ok: false, erro };
  });
}
