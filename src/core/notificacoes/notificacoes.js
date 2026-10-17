import { erroNaoEncontrado } from '#core/errors/app-error.js';
import {
  inserirNotificacoes,
  listarNotificacoesDoUsuario,
  marcarNotificacaoLida,
  marcarTodasLidas,
} from './notificacoes.repository.js';

/**
 * Notificação in-app (sino do shell) — do core, pra servir qualquer módulo
 * (decisão D5, docs/crm/plano-configuracoes.md). Um módulo gera com
 * `criarNotificacoes` e o usuário lê por `GET /notificacoes`.
 *
 * Idempotente pela `chaveDedup` (por usuário): um job pode gerar a mesma
 * notificação várias vezes (ex.: rodando de hora em hora) e ela entra uma.
 *
 * @typedef {import('./notificacoes.repository.js').Notificacao} Notificacao
 * @typedef {import('./notificacoes.repository.js').NovaNotificacao} NovaNotificacao
 */

/**
 * @param {string} tenantId
 * @param {NovaNotificacao[]} itens
 * @returns {Promise<number>} quantas entraram (as repetidas não contam)
 */
export function criarNotificacoes(tenantId, itens) {
  return inserirNotificacoes(tenantId, itens);
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ pagina: number, tamanho: number }} paginacao
 */
export async function listarNotificacoes(tenantId, usuarioId, { pagina, tamanho }) {
  const resultado = await listarNotificacoesDoUsuario(tenantId, usuarioId, {
    limite: tamanho,
    offset: (pagina - 1) * tamanho,
  });
  return { ...resultado, pagina, tamanho };
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {string} notificacaoId
 * @returns {Promise<Notificacao>}
 */
export async function marcarComoLida(tenantId, usuarioId, notificacaoId) {
  const notificacao = await marcarNotificacaoLida(tenantId, usuarioId, notificacaoId);
  // De outro usuário ou inexistente: a mesma resposta, sem revelar qual.
  if (!notificacao) throw erroNaoEncontrado('Notificação não encontrada');
  return notificacao;
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<{ marcadas: number }>}
 */
export async function marcarTodasComoLidas(tenantId, usuarioId) {
  return { marcadas: await marcarTodasLidas(tenantId, usuarioId) };
}
