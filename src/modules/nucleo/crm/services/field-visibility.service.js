import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  buscarVisibilidadePorTenant,
  definirVisibilidade as definirVisibilidadeRepository,
} from '../adapters/field-visibility.repository.js';
import { CAMADA_2_COLUNAS } from '../constants.js';

const ORDEM_PADRAO = 0;

/**
 * SERVICE: lógica de negócio pura. Nunca importa Fastify.
 * @typedef {import('../types/index.js').FieldVisibility} FieldVisibility
 */

/**
 * Devolve o estado de visibilidade das 15 colunas de Camada 2 pro tenant
 * — sempre a lista completa, mesmo pra colunas nunca configuradas (default
 * `visivel: false`), pra UI não precisar saber a lista fechada por conta
 * própria (`CAMADA_2_COLUNAS` é a única fonte disso).
 *
 * @param {string} tenantId
 * @returns {Promise<FieldVisibility[]>}
 */
export async function listarVisibilidadeDoTenant(tenantId) {
  const configuradas = await buscarVisibilidadePorTenant(tenantId);
  const porColuna = new Map(configuradas.map((item) => [item.coluna, item]));

  return CAMADA_2_COLUNAS.map(
    (coluna) =>
      porColuna.get(coluna) ?? {
        coluna,
        visivel: false,
        ordem: ORDEM_PADRAO,
        obrigatorio: false,
      },
  );
}

/**
 * @param {string} tenantId
 * @param {{ coluna: string, visivel: boolean, ordem: number, obrigatorio: boolean }[]} itens
 * @returns {Promise<FieldVisibility[]>}
 */
export async function atualizarVisibilidadeDoTenant(tenantId, itens) {
  const colunaInvalida = itens.find((item) => !CAMADA_2_COLUNAS.includes(item.coluna));
  if (colunaInvalida) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Coluna de campo inválida',
      fields: { coluna: [`Coluna deve ser uma de: ${CAMADA_2_COLUNAS.join(', ')}`] },
    });
  }

  await definirVisibilidadeRepository(tenantId, itens);
  return listarVisibilidadeDoTenant(tenantId);
}
