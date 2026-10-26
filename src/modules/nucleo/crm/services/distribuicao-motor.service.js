import { avaliarCondicao, valorDoCampo } from './regras-campos.service.js';

/**
 * SERVICE (puro): o motor da distribuição automática (M12). Sem banco e
 * sem I/O — quem chama carrega regras, grupos e usuários ativos e, se o
 * destino for rodízio, avança o ponteiro.
 *
 * - Regras em ordem; a primeira ATIVA que casar E tiver destino disponível
 *   decide. Destino indisponível (usuário inativo, grupo sem membro ativo)
 *   pula a regra — a próxima ainda pode decidir.
 * - Condições combinadas com E, com os operadores do filtro e da regra
 *   condicional do M8 (`avaliarCondicao`); sem condição = casa com tudo.
 *   Campo da condição excluído ou desligado: a regra não casa.
 *
 * @typedef {import('../adapters/crm-distribuicao.repository.js').RegraDistribuicaoLinha} RegraDistribuicaoLinha
 * @typedef {{ id: string | null, chave: string, tipo: string, camada: number }} CampoDoSchema
 * @typedef {(
 *   | { tipo: 'usuario', usuarioId: string, regra: RegraDistribuicaoLinha }
 *   | { tipo: 'grupo', grupoId: string, candidatos: string[], regra: RegraDistribuicaoLinha }
 *   | { tipo: 'fallback' }
 * )} Destino
 */

/**
 * @param {RegraDistribuicaoLinha} regra
 * @param {Record<string, any>} lead  formato da API
 * @param {Map<string, CampoDoSchema>} campoPorId
 */
export function regraCasa(regra, lead, campoPorId) {
  return regra.condicoes.every(({ campoId, operador, valor }) => {
    const campo = campoPorId.get(campoId);
    return campo !== undefined && avaliarCondicao(campo.tipo, operador, valor, valorDoCampo(lead, campo));
  });
}

/**
 * @param {{
 *   regras: RegraDistribuicaoLinha[],
 *   lead: Record<string, any>,
 *   campos: CampoDoSchema[],
 *   ativos: Set<string>,
 *   membrosPorGrupo: Map<string, string[]>,
 * }} contexto  `membrosPorGrupo`: ids de todos os membros (o motor tira os inativos)
 * @returns {Destino}
 */
export function escolherDestino({ regras, lead, campos, ativos, membrosPorGrupo }) {
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));

  for (const regra of regras) {
    if (!regra.ativo || !regraCasa(regra, lead, campoPorId)) continue;

    if (regra.destino_usuario_id) {
      if (ativos.has(regra.destino_usuario_id)) return { tipo: 'usuario', usuarioId: regra.destino_usuario_id, regra };
      continue;
    }
    const candidatos = candidatosAtivos(membrosPorGrupo.get(regra.destino_grupo_id ?? '') ?? [], ativos);
    if (candidatos.length > 0) return { tipo: 'grupo', grupoId: /** @type {string} */ (regra.destino_grupo_id), candidatos, regra };
  }
  return { tipo: 'fallback' };
}

/**
 * Só os ativos, ordenados e sem repetição — a ordem do rodízio.
 *
 * @param {string[]} ids
 * @param {Set<string>} ativos
 */
export function candidatosAtivos(ids, ativos) {
  return [...new Set(ids)].filter((id) => ativos.has(id)).sort();
}
