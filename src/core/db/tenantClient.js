import { PrismaClient } from '@prisma/client';

/**
 * GATEWAY DE ACESSO MULTI-TENANT (Bloco 2.1 do MASTER_DOCUMENT)
 * Toda query de negócio que toca dado com tenant_id passa por AQUI.
 * Único ponto de entrada permitido para os `adapters` de qualquer módulo
 * (ver MODULE_CONTRACT.md, seção 3-4).
 *
 * Decisão de MVP: prisma.$transaction interativo. Gatilho de migração para
 * client raw dedicado: utilização do pool do Neon > 70-80% em uso normal.
 */

const prisma = new PrismaClient();

/**
 * @template T
 * @param {string} tenantId
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function getTenantClient(tenantId, callback) {
  if (!isValidUuid(tenantId)) {
    throw new Error(`tenantId inválido recebido pelo gateway multi-tenant: "${tenantId}"`);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return callback(tx);
  });
}

/**
 * Uso restrito: operações administrativas sem contexto de tenant (Bloco 1.1.5).
 * @returns {PrismaClient}
 */
export function getAdminClient() {
  return prisma;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
