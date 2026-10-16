import { getAdminClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { invalidarAcessoModulo } from '#core/tenant/module-access.js';
import { reconciliarModulos } from '#core/tenant/reconcile.js';
import { modulosRegistrados, validarModuleKeys } from '#core/registry/modules.js';

/**
 * Catálogo de feature flags: o que cada módulo declara em `featureFlags`.
 *
 * @returns {{ moduleKey: string, featureKey: string }[]}
 */
export function listarCatalogoFeatures() {
  return modulosRegistrados().flatMap((mod) =>
    (mod.featureFlags ?? []).map((featureKey) => ({ moduleKey: mod.key, featureKey })),
  );
}

/** @param {string[]} featureKeys */
function validarFeatureKeys(featureKeys) {
  const catalogo = new Set(listarCatalogoFeatures().map((item) => item.featureKey));
  const invalidas = featureKeys.filter((featureKey) => !catalogo.has(featureKey));
  if (invalidas.length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Feature flag inválida: ${invalidas.join(', ')}`,
      fields: { features: invalidas.map((featureKey) => `"${featureKey}" não está no catálogo`) },
    });
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

/**
 * Chaves dos módulos contratados e não desligados — o formato que a área
 * admin lê (`modulosContratados`), o mesmo do body de criação/PUT.
 *
 * @param {{ moduleKey: string, disabledAt?: Date | null }[]} modulos
 * @returns {string[]}
 */
function chavesContratadas(modulos) {
  return modulos.filter((modulo) => !modulo.disabledAt).map((modulo) => modulo.moduleKey);
}

export class TenantManagement {
  static async listTenants() {
    const prisma = getAdminClient();
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        nome: true,
        subdomain: true,
        status: true,
        createdAt: true,
        modulosAtivos: { where: { disabledAt: null }, select: { moduleKey: true } },
      },
    });
    return tenants.map(({ modulosAtivos, ...tenant }) => ({
      ...tenant,
      modulosContratados: chavesContratadas(modulosAtivos),
    }));
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
        dominioCustomizado: true,
        dataRegion: true,
        retencaoConversaMeses: true,
        fusoHorario: true,
        modulosAtivos: { select: { moduleKey: true, enabledAt: true, disabledAt: true } },
        featureFlags: { select: { featureKey: true }, orderBy: { featureKey: 'asc' } },
      },
    });
    if (!tenant) throw erroTenantNaoEncontrado(tenantId);
    const { featureFlags, ...resto } = tenant;
    // `modulosAtivos` segue com as linhas cruas (inclui `disabledAt`, o
    // histórico); `modulosContratados` é a lista pronta pra UI.
    return {
      ...resto,
      modulosContratados: chavesContratadas(resto.modulosAtivos),
      features: featureFlags.map((flag) => flag.featureKey),
    };
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

    let adicionados = [];
    const resultado = await prisma.$transaction(async (tx) => {
      await buscarTenantOuFalhar(tx, tenantId);

      const atuais = await tx.tenantModule.findMany({
        where: { tenantId },
        select: { moduleKey: true, disabledAt: true },
      });
      const todasKeys = atuais.map((m) => m.moduleKey);
      const ativosKeys = atuais.filter((m) => !m.disabledAt).map((m) => m.moduleKey);
      const desligadosKeys = atuais.filter((m) => m.disabledAt).map((m) => m.moduleKey);

      const paraRemover = ativosKeys.filter((key) => !modulosContratados.includes(key));
      // Desligado por `desligarModuleTenant` (soft-disable) e marcado de novo:
      // a linha existe, então é reativar — criar daria conflito no unique.
      const paraReativar = desligadosKeys.filter((key) => modulosContratados.includes(key));
      const paraAdicionar = modulosContratados.filter((key) => !todasKeys.includes(key));

      if (paraRemover.length > 0) {
        await tx.tenantModule.deleteMany({ where: { tenantId, moduleKey: { in: paraRemover } } });
      }
      if (paraReativar.length > 0) {
        await tx.tenantModule.updateMany({
          where: { tenantId, moduleKey: { in: paraReativar } },
          data: { disabledAt: null, enabledAt: new Date() },
        });
      }
      if (paraAdicionar.length > 0) {
        await tx.tenantModule.createMany({
          data: paraAdicionar.map((moduleKey) => ({ tenantId, moduleKey })),
        });
      }
      adicionados = [...paraAdicionar, ...paraReativar];

      return tx.tenant.findUnique({
        where: { id: tenantId },
        include: { modulosAtivos: true },
      });
    });

    await invalidarAcessoModulo(tenantId);
    // Módulo recém-contratado (ou reativado) ganha o estado inicial (best-effort).
    if (adicionados.length > 0) await reconciliarModulos(tenantId, adicionados);
    return resultado;
  }

  /**
   * PUT = substitui o conjunto inteiro de flags ligadas do tenant (lista
   * vazia desliga todas). Ligar flag de módulo não contratado é permitido:
   * a rota do módulo continua barrada por `exigirModuloAtivo` — dá pra
   * preparar o rollout antes da contratação.
   *
   * @param {string} tenantId
   * @param {string[]} featureKeys
   * @returns {Promise<string[]>} flags ligadas depois da mudança
   */
  static async atualizarFeaturesTenant(tenantId, featureKeys) {
    validarFeatureKeys(featureKeys);
    const moduloDaFeature = new Map(
      listarCatalogoFeatures().map((item) => [item.featureKey, item.moduleKey]),
    );
    const prisma = getAdminClient();

    await prisma.$transaction(async (tx) => {
      await buscarTenantOuFalhar(tx, tenantId);
      await tx.tenantModuleFeature.deleteMany({
        where: { tenantId, featureKey: { notIn: featureKeys } },
      });
      await tx.tenantModuleFeature.createMany({
        data: featureKeys.map((featureKey) => ({
          tenantId,
          moduleKey: moduloDaFeature.get(featureKey),
          featureKey,
        })),
        skipDuplicates: true,
      });
    });

    await invalidarFeatures(tenantId);
    return [...new Set(featureKeys)].sort();
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
    await invalidarAcessoModulo(tenantId);
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
