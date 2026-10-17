import { erroDeConflito, erroNaoEncontrado } from '#core/errors/app-error.js';
import { listarTenantsDoModulo } from '#core/tenant/module-access.js';
import {
  definirArquivamento,
  moverParaLixeira,
  purgarLixeira,
  restaurarDaLixeira,
} from '../adapters/leads.repository.js';
import { agendarPurgaDiaria } from '../adapters/manutencao-queue.repository.js';
import { MODULO_CRM } from '../constants.js';
import { dataDaPurga, inicioDaLixeira } from './lead-filter.service.js';
import { buscarLeadFormatado } from './leads.service.js';

/**
 * SERVICE: arquivo e lixeira do lead (M5, `docs/crm/plano-configuracoes.md`).
 *
 * - Arquivar tira o lead da lista ativa; ele continua editável e aparece
 *   no filtro `situacao: arquivados`.
 * - Excluir manda pra lixeira (soft delete): some de toda leitura, busca,
 *   export e deduplicação, e pode ser restaurado por `DIAS_NA_LIXEIRA` dias.
 *   Lead na lixeira não é lido nem editado (404).
 * - A purga diária (worker do CRM) apaga de vez o que passou do prazo.
 *   Passado o prazo, o lead já conta como apagado mesmo antes da purga.
 */

/**
 * Toda ação aqui grava o evento do histórico (M6) com `usuarioId` de autor.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} [usuarioId]
 */
export async function arquivarLead(tenantId, leadId, usuarioId) {
  if (!(await definirArquivamento(tenantId, leadId, true, { autorId: usuarioId ?? null }))) {
    throw leadNaoEncontrado();
  }
  return buscarLeadFormatado(tenantId, leadId);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} [usuarioId]
 */
export async function desarquivarLead(tenantId, leadId, usuarioId) {
  if (!(await definirArquivamento(tenantId, leadId, false, { autorId: usuarioId ?? null }))) {
    throw leadNaoEncontrado();
  }
  return buscarLeadFormatado(tenantId, leadId);
}

/**
 * "Excluir": manda pra lixeira.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} [usuarioId]
 * @returns {Promise<{ removido: true, purgaEm: Date }>}
 */
export async function excluirLead(tenantId, leadId, usuarioId) {
  const excluido = await moverParaLixeira(tenantId, leadId, { autorId: usuarioId ?? null });
  if (!excluido) throw leadNaoEncontrado();
  return { removido: true, purgaEm: dataDaPurga(excluido.deleted_at) };
}

/**
 * Restaurar dentro do prazo; depois dele, o lead não existe mais (404).
 * Lead descartado numa mesclagem não volta (409).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} [usuarioId]
 * @param {Date} [agora]
 */
export async function restaurarLead(tenantId, leadId, usuarioId, agora = new Date()) {
  const historico = { autorId: usuarioId ?? null };
  const restaurado = await restaurarDaLixeira(tenantId, leadId, inicioDaLixeira(agora), historico);
  if (!restaurado) throw leadNaoEncontrado();
  // Descartado numa mesclagem (M7): dados e histórico já estão no outro lead.
  if (restaurado.mescladoEmId) {
    throw erroDeConflito('id', `Este lead foi mesclado no lead ${restaurado.mescladoEmId} e não pode ser restaurado`);
  }
  return buscarLeadFormatado(tenantId, leadId);
}

/**
 * Job diário: apaga de vez, em todo tenant que já teve o CRM (mesmo
 * cancelado — é prazo de retenção), o que foi excluído há mais de
 * `DIAS_NA_LIXEIRA`. Um tenant que falha não para os outros.
 *
 * @param {Date} [agora]
 * @returns {Promise<{ tenants: number, apagados: number, falhas: { tenantId: string, erro: string }[] }>}
 */
export async function purgarLixeiras(agora = new Date()) {
  const limite = inicioDaLixeira(agora);
  const tenants = await listarTenantsDoModulo(MODULO_CRM);
  const relatorio = { tenants: tenants.length, apagados: 0, falhas: [] };

  for (const tenantId of tenants) {
    try {
      relatorio.apagados += await purgarLixeira(tenantId, limite);
    } catch (erro) {
      relatorio.falhas.push({ tenantId, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }
  return relatorio;
}

/**
 * Chamado pelo worker ao subir: garante o agendamento diário da purga.
 *
 * @param {string} redisUrl
 */
export function agendarPurgaDaLixeira(redisUrl) {
  return agendarPurgaDiaria(redisUrl);
}

function leadNaoEncontrado() {
  return erroNaoEncontrado('Lead não encontrado');
}
