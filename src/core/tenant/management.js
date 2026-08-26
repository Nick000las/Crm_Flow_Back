import { getAdminClient } from '#core/db/tenantClient.js';
import { MODULES } from '#api/modules.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/** @param {string[]} moduleKeys */
function validarModuleKeys(moduleKeys) {
  for (const moduleKey of moduleKeys) {
    if (!moduleKey || typeof moduleKey !== 'string' || !MODULES.some((mod) => mod.key === moduleKey)) {
      throw new AppError({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Module key inválido: ${moduleKey}`,
        fields: { modulosContratados: [`"${moduleKey}" não é um módulo válido`] },
      });
    }
  }
}

/** @param {string} tenantId */
function erroTenantNaoEncontrado(tenantId) {
  return new AppError({
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.RESOURCE_NOT_FOUND,
    message: `Tenant com ID "${tenantId}" não encontrado`,
  });
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {string} tenantId
 */
async function buscarTenantOuFalhar(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw erroTenantNaoEncontrado(tenantId);
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
        modulosAtivos: { select: { moduleKey: true, enabledAt: true, disabledAt: true } },
      },
    });
    if (!tenant) throw erroTenantNaoEncontrado(tenantId);
    return tenant;
  }

  /**
   * Atualiza campos simples do tenant. NÃO mexe em status nem em módulos
   * contratados — isso é garantido pelo schema Zod da rota
   * (admin-tenants.routes.js), que só aceita os campos permitidos aqui; não
   * precisa reforçar de novo nesta camada.
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

  /** Soft-disable — mantém a linha (histórico de billing), só marca `disabledAt`. */
  static async desligarModuleTenant(tenantId, moduleKey) {
    const prisma = getAdminClient();
    const resultado = await prisma.tenantModule.updateMany({
      where: { tenantId, moduleKey, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    if (resultado.count === 0) {
      throw new AppError({
        statusCode: HTTP_STATUS.NOT_FOUND,
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Tenant "${tenantId}" não tem o módulo "${moduleKey}" ativo`,
      });
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
