import { CAMPOS_DO_FORECAST, CRM_FEATURES, LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from './configuracoes-campos.service.js';

/** Todos os contextos ligados: tabela, filtro, ficha e formulário de criação. */
const VISIVEL_EM_TUDO = Object.freeze(
  Object.fromEntries(LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, true])),
);

/**
 * `Module.aoLigarFeatures` do CRM: o que uma flag precisa no tenant quando é
 * ligada. Hoje só `crm.forecast`, que liga Data prevista e Probabilidade (FC1).
 * Religar a flag depois de o dono desligar um deles liga de novo: é uma ação
 * explícita de quem liga a flag.
 *
 * @param {string} tenantId
 * @param {string[]} chaves  flags do CRM que acabaram de ligar
 */
export async function aoLigarFeaturesDoCrm(tenantId, chaves) {
  if (!chaves.includes(CRM_FEATURES.FORECAST)) return;
  const campos = await listarConfiguracaoCampos(tenantId);
  for (const chave of CAMPOS_DO_FORECAST) {
    const campo = campos.find((item) => item.systemKey === chave);
    const ligado = campo && Object.values(campo.visibilidade).every(Boolean);
    if (campo && !ligado) {
      await atualizarConfiguracaoCampo(tenantId, campo.id, { visibilidade: VISIVEL_EM_TUDO });
    }
  }
}
