import { getAdminClient } from '#core/db/tenantClient.js';
import { MODULES } from '#api/modules.js';

/** @param {string[]} moduleKeys */
function validarModuleKeys(moduleKeys) {
  for (const moduleKey of moduleKeys) {
    if (!moduleKey || typeof moduleKey !== 'string') {
      const error = new Error(`Module key inválido: ${moduleKey}`);
      error.statusCode = 400;
      throw error;
    }
    const existe = MODULES.some((mod) => mod.key === moduleKey);
    if (!existe) {
      const error = new Error(`Module key não existe: ${moduleKey}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {string} tenantId
 */
async function buscarTenantOuFalhar(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    const error = new Error(`Tenant com ID "${tenantId}" não encontrado`);
    error.statusCode = 404;
    throw error;
  }
  return tenant;
}

export class TenantManagement {
  static async listTenants() {
    const prisma = getAdminClient();
    return prisma.tenant.findMany({
      select: { id: true, nome: true, subdomain: true, status: true, createdAt: true },
    });
  }

  static async getTenantById(tenantId) {
    const prisma = getAdminClient();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        nome: true,
        subdomain: true,
        status: true,
        createdAt: true,
        modulosAtivos: { select: { moduleKey: true, enabledAt: true, disabled_at: true } },
      },
    });
    if (!tenant) {
      const error = new Error(`Tenant com ID "${tenantId}" não encontrado`);
      error.statusCode = 404;
      throw error;
    }
    return tenant;
  }

  /**
   * Atualiza campos simples do tenant. NÃO mexe em status nem em módulos
   * contratados — isso é garantido pelo schema Zod da rota (admin-tenants.js),
   * que só aceita os campos permitidos aqui; não precisa reforçar de novo
   * nesta camada.
   *
   * @param {string} tenantId
   * @param {object} data
   */
  static async atualizarTenant(tenantId, data) {
    const prisma = getAdminClient();
    await buscarTenantOuFalhar(prisma, tenantId);
    return prisma.tenant.update({ where: { id: tenantId }, data });
  }

  /** @param {string} tenantId @param {string} status */
  static async atualizarStatusTenant(tenantId, status) {
    const prisma = getAdminClient();
    await buscarTenantOuFalhar(prisma, tenantId);
    return prisma.tenant.update({ where: { id: tenantId }, data: { status } });
  }

  /**
   * PUT = substitui o conjunto inteiro de módulos contratados (remove os que
   * saíram da lista, adiciona os que entraram) — não é um PATCH incremental.
   *
   * @param {string} tenantId
   * @param {string[]} modulosContratados
   */
  static async atualizarModulosTenant(tenantId, modulosContratados) {
    validarModuleKeys(modulosContratados);
    const prisma = getAdminClient();

    return prisma.$transaction(async (tx) => {
      await buscarTenantOuFalhar(tx, tenantId);

      const atuais = await tx.tenantModule.findMany({
        where: { tenantId },
        select: { moduleKey: true },
      });
      const atuaisKeys = atuais.map((m) => m.moduleKey);
      const paraRemover = atuaisKeys.filter((key) => !modulosContratados.includes(key));
      const paraAdicionar = modulosContratados.filter((key) => !atuaisKeys.includes(key));

      if (paraRemover.length > 0) {
        await tx.tenantModule.deleteMany({ where: { tenantId, moduleKey: { in: paraRemover } } });
      }
      if (paraAdicionar.length > 0) {
        await tx.tenantModule.createMany({
          data: paraAdicionar.map((moduleKey) => ({ tenantId, moduleKey })),
        });
      }

      return tx.tenant.findUnique({
        where: { id: tenantId },
        include: { modulosAtivos: true },
      });
    });
  }

  /** Soft-disable — mantém a linha (histórico de billing), só marca `disabled_at`. */
  static async desligarModuleTenant(tenantId, moduleKey) {
    const prisma = getAdminClient();
    const resultado = await prisma.tenantModule.updateMany({
      where: { tenantId, moduleKey, disabled_at: null },
      data: { disabled_at: new Date() },
    });
    if (resultado.count === 0) {
      const error = new Error(`Tenant "${tenantId}" não tem o módulo "${moduleKey}" ativo`);
      error.statusCode = 404;
      throw error;
    }
    return { tenantId, moduleKey, disabled: true };
  }

  /**
   * Hard delete de verdade — com onDelete: Cascade no schema, isso apaga
   * usuários, módulos, assinaturas, cobranças e audit log desse tenant
   * PERMANENTEMENTE.
   *
   * Decisão de produto: hard delete só deve acontecer X tempo depois do
   * tenant já estar em status 'cancelado' (Bloco 1.1.5) — não imediatamente
   * a pedido. Esta função é só a operação de exclusão em si; ainda falta o
   * job agendado que dispara isso automaticamente depois do prazo. Até esse
   * job existir, chamar isso direto (via rota) pula esse prazo.
   *
   * @param {string} tenantId
   */
  static async deleteTenant(tenantId) {
    const prisma = getAdminClient();
    await buscarTenantOuFalhar(prisma, tenantId);
    return prisma.tenant.delete({ where: { id: tenantId } });
  }
}
