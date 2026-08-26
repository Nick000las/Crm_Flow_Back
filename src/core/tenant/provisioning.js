import { getAdminClient } from '#core/db/tenantClient.js';
import { MODULES } from '#api/modules.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * @typedef {object} ProvisionarTenantInput
 * @property {string} nome
 * @property {string} subdomain
 * @property {{ nome: string, email: string }} owner
 * @property {string[]} modulosContratados   // module keys, ex: ['crm', 'kanban_universal']
 */

/**
 * Cria tenant + usuário admin inicial + vínculo de módulos, em uma única
 * transação atômica (Bloco 1.1.5). Usa getAdminClient() — não existe
 * tenant ainda pra usar getTenantClient().
 *
 * O owner nasce SEM senha (`senhaHash` fica null) e `ativo: true` — é esse
 * par que faz o fluxo de convite funcionar: `identifyEmail`
 * (core/auth/login/services/login.service.js) só encontra o "convite" e
 * manda o código de ativação por e-mail se o usuário já estiver ativo mas
 * ainda sem senha. Se criássemos com senha aqui, ou com `ativo: false`, o
 * owner nunca conseguiria logar (ver auditoria pós-merge).
 *
 * @param {ProvisionarTenantInput} input
 * @returns {Promise<{ tenantId: string, usuarioId: string }>}
 */
export async function provisionarTenant(input) {
  const { nome, subdomain, owner, modulosContratados } = input;

  validarModuleKeys(modulosContratados);

  const prisma = getAdminClient();

  // Conflito de subdomain (tenants.subdomain é @unique) é resolvido pelo
  // error-handler.js global (Prisma P2002 -> 409 RESOURCE_CONFLICT) — não
  // precisa de pre-check aqui, evita a corrida check-then-insert.
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { nome, subdomain },
    });

    const usuario = await tx.usuario.create({
      data: {
        tenantId: tenant.id,
        nome: owner.nome,
        email: owner.email,
        // forçado — o default do schema é OPERADOR. MASTER é reservado pra equipe
        // interna da plataforma (ver docstring de admin-tenants.routes.js); o
        // owner criado aqui é o dono do NEGÓCIO do cliente, logo é DONO.
        role: 'DONO',
        ativo: true,
      },
    });

    // createMany em vez de várias tx.tenantModule.create() em paralelo:
    // dentro de uma transação interativa (tx), todas as queries correm na MESMA
    // conexão — rodar em paralelo (Promise.all) arrisca erro de conexão. createMany
    // é uma query só, sem esse risco.
    await tx.tenantModule.createMany({
      data: modulosContratados.map((moduleKey) => ({
        tenantId: tenant.id,
        moduleKey,
      })),
    });

    return { tenantId: tenant.id, usuarioId: usuario.id };
  });
}

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
