import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { formatarTelefoneBR } from '#shared/formatters/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
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
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Nome do lead não pode ser vazio',
      fields: { nome: ['Informe o nome do lead'] },
    });
  }
  return criarLead(tenantId, input);
}
