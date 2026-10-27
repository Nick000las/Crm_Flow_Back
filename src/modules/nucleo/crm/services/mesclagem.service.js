import { erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { mesclarLeads as mesclarLeadsRepository } from '../adapters/leads.repository.js';
import { CAMPOS_SISTEMA, PROPRIEDADES_NO_HISTORICO } from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { diffDoLead } from './historico.service.js';
import { buscarLeadFormatado } from './leads.service.js';
import { recalcularScoreDosLeads } from './score.service.js';
import { valorAusente } from './tipos-campo.service.js';

/**
 * SERVICE: mesclagem de dois leads (M7). O principal fica; o secundário
 * vai pra lixeira (sem restaurar) e as atividades e o histórico dele
 * passam pro principal — tudo numa transação (`leads.repository.js`).
 *
 * Valor de cada campo: o que o usuário escolheu (`principal` ou
 * `secundario`); sem escolha, o do principal — ou o do secundário, se o
 * do principal estiver vazio. Tags: união. Última interação: a mais recente.
 *
 * @typedef {'principal' | 'secundario'} Lado
 */

/** Calculados à parte (união / mais recente), sem escolha do usuário. */
const CHAVES_AUTOMATICAS = new Set(['tags', 'ultimaInteracaoEm']);

/** NUMERIC vem como Decimal do driver; o UPDATE recebe número. */
function paraEscrita(valor) {
  if (valor && typeof valor === 'object' && typeof valor.toNumber === 'function') return valor.toNumber();
  return valor ?? null;
}

/**
 * @param {unknown} doPrincipal
 * @param {unknown} doSecundario
 * @param {Lado | undefined} escolha
 */
function escolher(doPrincipal, doSecundario, escolha) {
  if (escolha === 'secundario') return doSecundario;
  if (escolha === 'principal') return doPrincipal;
  return valorAusente(doPrincipal) ? doSecundario : doPrincipal;
}

/**
 * Função pura: os dados finais do principal, no formato do
 * `atualizarLead` (chaves da API; `customFields` pelo id do campo).
 *
 * @param {Record<string, any>} principal  linha do lead (colunas)
 * @param {Record<string, any>} secundario
 * @param {Record<string, Lado>} [escolhas]  por chave da API; personalizado pelo id do campo
 */
export function montarMesclagem(principal, secundario, escolhas = {}) {
  /** @type {Record<string, unknown>} */
  const dados = {};

  for (const campo of CAMPOS_SISTEMA) {
    if (CHAVES_AUTOMATICAS.has(campo.systemKey)) continue;
    dados[campo.systemKey] = paraEscrita(
      escolher(principal[campo.coluna], secundario[campo.coluna], escolhas[campo.systemKey]),
    );
  }
  for (const { campo, coluna } of PROPRIEDADES_NO_HISTORICO) {
    dados[campo] = paraEscrita(escolher(principal[coluna], secundario[coluna], escolhas[campo]));
  }

  dados.tags = [...new Set([...(principal.tags ?? []), ...(secundario.tags ?? [])])];
  const interacoes = [principal.ultima_interacao_em, secundario.ultima_interacao_em].filter(Boolean);
  dados.ultimaInteracaoEm = interacoes.length > 0 ? new Date(Math.max(...interacoes.map(Number))) : null;

  const customPrincipal = principal.custom_fields ?? {};
  const customSecundario = secundario.custom_fields ?? {};
  dados.customFields = Object.fromEntries(
    [...new Set([...Object.keys(customPrincipal), ...Object.keys(customSecundario)])].map((campoId) => [
      campoId,
      escolher(customPrincipal[campoId], customSecundario[campoId], escolhas[campoId]) ?? null,
    ]),
  );
  return dados;
}

/**
 * POST /crm/leads/merge. `escolhas` chega com a chave da API, inclusive a
 * do personalizado — aqui ela vira o id do campo, como é gravado.
 *
 * @param {string} tenantId
 * @param {{ principalId: string, secundarioId: string, escolhas?: Record<string, Lado> }} input
 * @param {string} [usuarioId]
 */
export async function mesclarLeads(tenantId, { principalId, secundarioId, escolhas = {} }, usuarioId) {
  if (principalId === secundarioId) {
    throw erroDeValidacao('secundarioId', 'Escolha dois leads diferentes para mesclar');
  }

  const { definicoes } = await obterSchemaCampos(tenantId);
  const idPorChave = new Map(definicoes.map((definicao) => [definicao.chave, definicao.id]));
  const escolhasArmazenadas = Object.fromEntries(
    Object.entries(escolhas).map(([chave, lado]) => [idPorChave.get(chave) ?? chave, lado]),
  );

  const mesclado = await mesclarLeadsRepository(
    tenantId,
    { principalId, secundarioId },
    {
      autorId: usuarioId ?? null,
      montar: (principal, secundario) => montarMesclagem(principal, secundario, escolhasArmazenadas),
      montarDiff: (antes, depois) => diffDoLead(antes, depois),
    },
  );
  if (!mesclado) throw erroNaoEncontrado('Lead não encontrado');
  // Pontuação (M14): o principal agora tem os dados escolhidos dos dois.
  await recalcularScoreDosLeads(tenantId, [principalId]);
  return buscarLeadFormatado(tenantId, principalId);
}
