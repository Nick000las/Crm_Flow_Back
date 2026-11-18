/**
 * @file SERVICE: alertas do formulário (FM5).
 */
import { erroNaoEncontrado } from '#core/errors/app-error.js';

import {
  buscarAlertasDaPessoa,
  marcarAlertaVisto,
} from '../adapters/crm-form-alerts.repository.js';
import { TEXTO_ALERTA_GENERICO } from '../constants.js';
import { regraDeVisibilidade } from './formulario-visibilidade.service.js';
import { avaliarCondicao } from './regras-campos.service.js';

/**
 * SERVICE: alertas do formulário (FM5). As regras vêm da versão do link e são
 * avaliadas no envio da resposta, com os mesmos operadores do filtro
 * (`avaliarCondicao`). Cada regra que casa vira um alerta da pessoa, visto
 * por usuário. Quem não vê o alvo (campo ou pergunta sensível) recebe só o
 * texto genérico, com o nível.
 *
 * @typedef {{ id: string, alvo: { campoId?: string, perguntaId?: string }, operador: string, valor?: unknown, nivel: string, texto: string }} RegraDeAlerta
 * @typedef {{ chave: string, ehPergunta: boolean, tipo: string, sensivel: boolean }} ItemAvaliado
 */

/**
 * Alertas que a resposta dispara. Alvo que não está nos itens não dispara.
 *
 * @param {RegraDeAlerta[]} regras  `alert_rules` da versão
 * @param {ItemAvaliado[]} itens  `itensDaVersao`
 * @param {{ campos: Record<string, unknown>, perguntas: Record<string, unknown> }} valores  já validados
 * @returns {{ regraId: string, nivel: string, texto: string, sensivel: boolean }[]}
 */
export function alertasDaResposta(regras, itens, valores) {
  const porChave = new Map(itens.map((item) => [item.chave, item]));

  return regras.flatMap((regra) => {
    const chave = regra.alvo.campoId ?? regra.alvo.perguntaId;
    const item = chave ? porChave.get(chave) : undefined;

    if (!item) {
      return [];
    }

    const valor = (item.ehPergunta ? valores.perguntas : valores.campos)[item.chave];

    if (!avaliarCondicao(item.tipo, regra.operador, regra.valor, valor)) {
      return [];
    }

    return [{ regraId: regra.id, nivel: regra.nivel, texto: regra.texto, sensivel: item.sensivel }];
  });
}

/**
 * Alertas da pessoa para quem está vendo a ficha.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ userId: string, role?: string }} quem
 * @param {{ todos?: boolean }} [opcoes]
 */
export async function listarAlertasDaPessoa(tenantId, leadId, { userId, role }, opcoes = {}) {
  const [linhas, regra] = await Promise.all([
    buscarAlertasDaPessoa(tenantId, leadId, userId, opcoes),
    regraDeVisibilidade(tenantId, role),
  ]);

  return linhas.map((linha) => {
    const alvo = linha.regras.find((item) => item.id === linha.regra_id)?.alvo ?? {};
    const ve = alvo.campoId
      ? regra.veCampo(alvo.campoId, linha.campos[alvo.campoId])
      : regra.vePergunta(linha.sensivel);
    // Regra sem alvo conhecido (não deveria acontecer): na dúvida, restrito.
    const podeVer = Boolean(alvo.campoId || alvo.perguntaId) && ve;

    return {
      id: linha.id,
      nivel: linha.nivel,
      texto: podeVer ? linha.texto : TEXTO_ALERTA_GENERICO,
      generico: !podeVer,
      formulario: { id: linha.formulario_id, nome: linha.formulario_nome },
      respostaId: linha.resposta_id,
      criadoEm: linha.criado_em,
      vistoEm: linha.visto_em,
    };
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} alertaId
 * @param {string} usuarioId
 */
export async function marcarVisto(tenantId, leadId, alertaId, usuarioId) {
  if (!(await marcarAlertaVisto(tenantId, leadId, alertaId, usuarioId))) {
    throw erroNaoEncontrado('Alerta não encontrado');
  }

  return { id: alertaId, visto: true };
}
