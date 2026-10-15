import { z } from 'zod';
import { getAdminClient, disconnectDatabase } from '#core/db/tenantClient.js';
import { ROLES } from '#shared/constants/index.js';

/**
 * Cria um usuário DONO ou OPERADOR dentro de um tenant que já existe.
 * Ferramenta de desenvolvimento enquanto não há tela de convite de usuários.
 *
 * Uso:
 *   node scripts/create-user.js --tenant=subdominio --email=pessoa@empresa.com --nome="Nome" --role=OPERADOR
 *   pnpm create:user -- --tenant=subdominio --email=pessoa@empresa.com --nome="Nome" --role=DONO
 *
 * Tenant novo com dono e módulos: use a área admin ("Novo tenant"), que
 * chama `provisionarTenant` — este script só acrescenta gente a um tenant.
 *
 * Mesmas regras de `create-master.js`:
 * - MASTER fica de fora (é equipe interna; ver `create-master.js`).
 * - Nasce com `senhaHash: null` e `ativo: true` — o estado de convite. A
 *   pessoa loga em POST /auth/login com o e-mail e o fluxo de ativação manda
 *   o código de criação de senha. Nenhuma senha passa por este script.
 * - Tenant inexistente ou e-mail já cadastrado (único globalmente, migration
 *   0003) barram a execução ANTES de qualquer escrita, com mensagem clara.
 */

const PAPEIS_PERMITIDOS = [ROLES.DONO, ROLES.OPERADOR];
// process.argv[0] = node, process.argv[1] = caminho do script.
const CLI_ARGS_START_INDEX = 2;
const USO =
  'Uso: node scripts/create-user.js --tenant=subdominio --email=pessoa@empresa.com --nome="Nome" --role=DONO|OPERADOR';

const argsSchema = z.object({
  tenant: z
    .string({ required_error: 'Informe --tenant (subdomínio)' })
    .trim()
    .min(1, 'Informe --tenant (subdomínio)')
    .transform((subdomain) => subdomain.toLowerCase()),
  // Minúsculo: o índice único de e-mail (migration 0003) é case-insensitive.
  email: z
    .string({ required_error: 'Informe --email' })
    .trim()
    .min(1, 'Informe --email')
    .email('E-mail inválido')
    .transform((email) => email.toLowerCase()),
  nome: z.string({ required_error: 'Informe --nome' }).trim().min(1, 'Informe --nome'),
  role: z
    .string({ required_error: 'Informe --role' })
    .trim()
    .transform((role) => role.toUpperCase())
    .pipe(z.enum(PAPEIS_PERMITIDOS, { message: `--role deve ser ${PAPEIS_PERMITIDOS.join(' ou ')}` })),
});

async function main() {
  const { tenant: subdomain, email, nome, role } = parseArgs();
  const prisma = getAdminClient();

  const tenant = await prisma.tenant.findUnique({
    where: { subdomain },
    select: { id: true, nome: true, modulosAtivos: { where: { disabledAt: null }, select: { moduleKey: true } } },
  });

  if (!tenant) {
    throw new Error(`Nenhum tenant com o subdomínio "${subdomain}". Nada foi criado.`);
  }

  const usuarioExistente = await prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, role: true },
  });

  if (usuarioExistente) {
    throw new Error(
      `Já existe um usuário com o e-mail "${email}" (id: ${usuarioExistente.id}, role: ${usuarioExistente.role}). Nada foi criado.`,
    );
  }

  const usuario = await prisma.usuario.create({
    data: { tenantId: tenant.id, nome, email, role, ativo: true },
    select: { id: true, nome: true, email: true, role: true },
  });

  const modulos = tenant.modulosAtivos.map((modulo) => modulo.moduleKey);

  console.log('Tenant:', tenant.id, `(${tenant.nome} / ${subdomain})`);
  console.log(`Usuário ${usuario.role} criado:`, usuario.id, '-', usuario.nome, `<${usuario.email}>`);
  console.log('Módulos ativos do tenant:', modulos.length > 0 ? modulos.join(', ') : '(nenhum)');
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
    console.error('Falha ao criar usuário:', error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
