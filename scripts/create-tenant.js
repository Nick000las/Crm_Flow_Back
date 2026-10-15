import { z } from 'zod';
import { MODULES } from '#api/modules.js';
import { getAdminClient, disconnectDatabase } from '#core/db/tenantClient.js';
import { provisionarTenant } from '#core/tenant/provisioning.js';

/**
 * Cria um tenant de cliente com o dono (DONO) e os módulos contratados —
 * a mesma operação de "Novo tenant" na área admin (`POST /admin/tenants`),
 * pela mesma função (`provisionarTenant`). Ferramenta de desenvolvimento.
 *
 * Uso:
 *   node scripts/create-tenant.js --nome="Empresa Teste" --subdomain=empresa-teste \
 *     --owner-nome="Dona Teste" --owner-email=dona@empresa.com --modulos=crm
 *   pnpm create:tenant -- --nome="Empresa Teste" --subdomain=empresa-teste \
 *     --owner-nome="Dona Teste" --owner-email=dona@empresa.com --modulos=crm,kanban_universal
 *
 * - O dono nasce sem senha (estado de convite): entra em POST /auth/login com
 *   o e-mail e o fluxo de ativação manda o código de criação de senha.
 * - Subdomínio ou e-mail já usados barram ANTES de qualquer escrita.
 * - Mais gente no tenant depois: `create-user.js`.
 */

// process.argv[0] = node, process.argv[1] = caminho do script.
const CLI_ARGS_START_INDEX = 2;
const MODULE_KEYS = MODULES.map((modulo) => modulo.key);
const USO =
  'Uso: node scripts/create-tenant.js --nome="Empresa" --subdomain=empresa ' +
  '--owner-nome="Nome" --owner-email=pessoa@empresa.com --modulos=crm[,outro]';

// Mesmas regras de `criarTenantBodySchema` (admin-tenants.routes.js).
const argsSchema = z.object({
  nome: z.string({ required_error: 'Informe --nome' }).trim().min(1, 'Informe --nome'),
  subdomain: z
    .string({ required_error: 'Informe --subdomain' })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Use só letras minúsculas, números e hífen'),
  'owner-nome': z.string({ required_error: 'Informe --owner-nome' }).trim().min(1, 'Informe --owner-nome'),
  // Minúsculo: o índice único de e-mail (migration 0003) é case-insensitive.
  'owner-email': z
    .string({ required_error: 'Informe --owner-email' })
    .trim()
    .email('E-mail inválido')
    .transform((email) => email.toLowerCase()),
  modulos: z
    .string({ required_error: `Informe --modulos (${MODULE_KEYS.join(', ')})` })
    .transform((lista) => [...new Set(lista.split(',').map((chave) => chave.trim()).filter(Boolean))])
    .pipe(
      z
        .array(z.enum(MODULE_KEYS, { message: `Módulos válidos: ${MODULE_KEYS.join(', ')}` }))
        .min(1, `Informe ao menos um módulo (${MODULE_KEYS.join(', ')})`),
    ),
});

async function main() {
  const args = parseArgs();
  const prisma = getAdminClient();

  const [tenantExistente, usuarioExistente] = await Promise.all([
    prisma.tenant.findUnique({ where: { subdomain: args.subdomain }, select: { id: true } }),
    prisma.usuario.findFirst({
      where: { email: { equals: args['owner-email'], mode: 'insensitive' } },
      select: { id: true, role: true },
    }),
  ]);

  if (tenantExistente) {
    throw new Error(`Já existe um tenant com o subdomínio "${args.subdomain}" (id: ${tenantExistente.id}). Nada foi criado.`);
  }
  if (usuarioExistente) {
    throw new Error(
      `Já existe um usuário com o e-mail "${args['owner-email']}" (id: ${usuarioExistente.id}, role: ${usuarioExistente.role}). Nada foi criado.`,
    );
  }

  const { tenantId, usuarioId } = await provisionarTenant({
    nome: args.nome,
    subdomain: args.subdomain,
    owner: { nome: args['owner-nome'], email: args['owner-email'] },
    modulosContratados: args.modulos,
  });

  console.log('Tenant criado:', tenantId, `(${args.nome} / ${args.subdomain})`);
  console.log('Dono (DONO):', usuarioId, '-', args['owner-nome'], `<${args['owner-email']}>`);
  console.log('Módulos contratados:', args.modulos.join(', '));
  console.log(
    '\nSem senha definida. Entre em POST /auth/login com esse e-mail — o fluxo de ' +
      'ativação manda o código de criação de senha.',
  );
}

/** @returns {z.infer<typeof argsSchema>} */
function parseArgs() {
  const bruto = Object.fromEntries(
    process.argv.slice(CLI_ARGS_START_INDEX).map((arg) => {
      const [chave, ...valorPartes] = arg.replace(/^--/, '').split('=');
      return [chave, valorPartes.join('=')];
    }),
  );

  const resultado = argsSchema.safeParse(bruto);
  if (!resultado.success) {
    const mensagens = resultado.error.issues
      .map((issue) => `  --${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`${USO}\n\n${mensagens}`);
  }
  return resultado.data;
}

main()
  .catch((error) => {
    console.error('Falha ao criar tenant:', error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
