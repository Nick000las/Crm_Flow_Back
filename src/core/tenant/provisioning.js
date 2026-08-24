import bcrypt from 'bcryptjs';
import { getAdminClient } from '#core/db/tenantClient.js';
import { MODULES } from '#api/modules.js';

/**
 * @typedef {object} ProvisionarTenantInput
 * @property {string} nome
 * @property {string} subdomain
 * @property {{ nome: string, email: string, senha: string }} owner
 * @property {string[]} modulosContratados   // module keys, ex: ['crm', 'kanban_universal']
 */

/**
 * Cria tenant + usuário admin inicial + vínculo de módulos, em uma única
 * transação atômica (Bloco 1.1.5). Usa getAdminClient() — não existe
 * tenant ainda pra usar getTenantClient().
 *
 * Quem chama isso já validou o body (Zod, na rota) e já autorizou a
 * requisição (proteção da rota ainda não decidida — ver admin-tenants.js).
 * Essa função não valida nada disso de novo, confia em quem chamou.
 *
 * @param {ProvisionarTenantInput} input
 * @returns {Promise<{ tenantId: string, usuarioId: string }>}
 */
export async function provisionarTenant(input) {
  const { nome, subdomain, owner, modulosContratados } = input;
  const senhaHash = await bcrypt.hash(owner.senha, 10);

  const prisma = getAdminClient();

  const existeSubdomain = await prisma.tenant.findUnique({
    where: { subdomain },
    select: { id: true },
  });
  if (existeSubdomain) {
    const error = new Error(`Subdomain "${subdomain}" já existe`);
    error.statusCode = 409;
    throw error;
  }
  
    modulosContratados.forEach((moduleKey) => {
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
    });

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { nome, subdomain },
    });

    const usuario = await tx.usuario.create({
      data: {
        tenantId: tenant.id,
        nome: owner.nome,
        email: owner.email,
        senhaHash,
        // forçado — o default do schema é OPERADOR. MASTER é reservado pra equipe
        // interna da plataforma (ver docstring de admin-tenants.js); o owner criado
        // aqui é o dono do NEGÓCIO do cliente (quem contratou), logo é DONO.
        role: 'DONO',
        // TODO decidir: Bloco 1.1.5 diz "o acesso não é liberado neste momento".
        // Deixei `ativo: false` como leitura mais literal disso, mas confirma comigo
        // antes de considerar certo — pode ser só "não manda e-mail ainda" em vez de bloquear login.
        ativo: false,
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
