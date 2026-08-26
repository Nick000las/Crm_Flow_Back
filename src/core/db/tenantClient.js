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

// DATABASE_URL — role dono das tabelas, acesso cross-tenant DE PROPÓSITO
// (provisionamento/gestão de tenant precisa enxergar todo mundo).
const adminPrisma = new PrismaClient();

// TENANT_DATABASE_URL — role `app_tenant` (migration 0004), sem privilégio
// de dono. É isso que faz o RLS ser garantia do Postgres e não só
// convenção de código: dono de tabela ignora RLS por padrão, um role
// comum não tem escolha.
const tenantPrisma = new PrismaClient({
  datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
});

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
  return tenantPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return callback(tx);
  });
}

/**
 * Uso restrito: operações administrativas sem contexto de tenant (Bloco 1.1.5).
 * @returns {PrismaClient}
 */
export function getAdminClient() {
  return adminPrisma;
}

/** Encerra os pools durante o shutdown gracioso e ao finalizar testes. */
export async function disconnectDatabase() {
  await Promise.all([adminPrisma.$disconnect(), tenantPrisma.$disconnect()]);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
