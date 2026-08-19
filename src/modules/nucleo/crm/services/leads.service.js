import { formatarTelefoneBR } from '#shared/formatters/index.js';
import { buscarLeadsPorTenant, criarLead } from '../adapters/leads.repository.js';

/**
 * SERVICE: lógica de negócio pura. Nunca importa Fastify.
 * @typedef {import('../types/index.js').Lead} Lead
 * @typedef {import('../types/index.js').CriarLeadInput} CriarLeadInput
 */

/**
 * @param {string} tenantId
 * @returns {Promise<Lead[]>}
 */
export async function listarLeadsFormatados(tenantId) {
  const leads = await buscarLeadsPorTenant(tenantId);
  return leads.map((lead) => ({ ...lead, telefone: formatarTelefoneBR(lead.telefone) }));
}

/**
 * @param {string} tenantId
 * @param {CriarLeadInput} input
 * @returns {Promise<{ id: string }>}
 */
export async function registrarNovoLead(tenantId, input) {
  if (input.nome.trim().length === 0) {
    throw new Error('Nome do lead não pode ser vazio');
  }
  return criarLead(tenantId, input);
}
