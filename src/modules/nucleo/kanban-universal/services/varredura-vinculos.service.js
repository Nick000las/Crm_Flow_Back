import { provedoresDeEntidade } from '#core/quadros/registro.js';
import { listarTenantsDoModulo } from '#core/tenant/module-access.js';
import { agendarVarreduraDiaria } from '../adapters/manutencao-queue.repository.js';
import { aplicarVarredura, listarEntidadesVinculadas } from '../adapters/vinculos.repository.js';
import { MODULO_KANBAN, VINCULO } from '../constants.js';

/**
 * SERVICE: varredura diária dos vínculos de card (M6). O nome já some na
 * leitura; este job tira a referência que sobrou: registro apagado ou
 * anonimizado perde o vínculo, e registro mesclado passa para o principal.
 * O outbox `crm_event` substitui o job quando chegar (M3).
 */

/**
 * @param {Record<string, string | null>} resolvidos  id → id atual ou `null`
 * @returns {{ orfaos: string[], trocas: { de: string, para: string }[] }}
 */
export function classificar(resolvidos) {
  const entradas = Object.entries(resolvidos);
  return {
    orfaos: entradas.filter(([, atual]) => atual === null).map(([id]) => id),
    trocas: entradas
      .filter(([id, atual]) => atual !== null && atual !== id)
      .map(([id, atual]) => ({ de: id, para: atual })),
  };
}

/**
 * Id que o provedor não devolveu fica como está: ausência não é prova de que
 * o registro acabou.
 *
 * @param {string} tenantId
 * @param {{ tipo: string, resolverVinculos: (tenantId: string, ids: string[]) => Promise<Record<string, string | null>> }} provedor
 */
async function varrerTipo(tenantId, provedor) {
  const total = { removidos: 0, repontados: 0 };
  let cursor = null;
  let ids;
  do {
    ids = await listarEntidadesVinculadas(tenantId, provedor.tipo, cursor);
    if (ids.length > 0) {
      const mudancas = classificar(await provedor.resolverVinculos(tenantId, ids));
      if (mudancas.orfaos.length > 0 || mudancas.trocas.length > 0) {
        const { removidos, repontados } = await aplicarVarredura(tenantId, provedor.tipo, mudancas);
        total.removidos += removidos;
        total.repontados += repontados;
      }
      cursor = ids.at(-1);
    }
  } while (ids.length === VINCULO.LOTE_VARREDURA);
  return total;
}

/**
 * Roda em todo tenant que já contratou o Kanban, mesmo cancelado: limpar
 * referência de dado pessoal não depende de contrato ativo. Um tenant com
 * falha não para os outros.
 *
 * @returns {Promise<{ tenants: number, removidos: number, repontados: number, falhas: { tenantId: string, erro: string }[] }>}
 */
export async function varrerVinculos() {
  const tenants = await listarTenantsDoModulo(MODULO_KANBAN);
  const relatorio = { tenants: tenants.length, removidos: 0, repontados: 0, falhas: [] };

  for (const tenantId of tenants) {
    try {
      for (const provedor of provedoresDeEntidade()) {
        const { removidos, repontados } = await varrerTipo(tenantId, provedor);
        relatorio.removidos += removidos;
        relatorio.repontados += repontados;
      }
    } catch (erro) {
      relatorio.falhas.push({
        tenantId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }
  return relatorio;
}

/**
 * Chamado pelo worker ao subir: garante o agendamento diário.
 *
 * @param {string} redisUrl
 */
export function agendarVarreduraDeVinculos(redisUrl) {
  return agendarVarreduraDiaria(redisUrl);
}
