import { z } from 'zod';
import { getAdminClient, disconnectDatabase } from '#core/db/tenantClient.js';

/**
 * Cria (ou reaproveita) o tenant-plataforma e cria um usuário MASTER dentro
 * dele — o mesmo tipo de bootstrap que `django createsuperuser` ou uma task
 * `db:seed` fazem em outros ecossistemas, adaptado às regras deste projeto.
 *
 * Uso:
 *   node scripts/create-master.js --email=pessoa@empresa.com --nome="Nome Completo"
 *   npm run create:master -- --email=pessoa@empresa.com --nome="Nome Completo"
 *
 * Por que existe:
 * - `provisionarTenant` (core/tenant/provisioning.js) força role: 'DONO' —
 *   nunca cria MASTER, de propósito (owner de tenant de cliente != equipe
 *   interna da plataforma).
 * - As rotas administrativas (`/admin/tenants/*`) já exigem
 *   `requireRole(['MASTER'])` — não dá pra criar o primeiro MASTER pela API,
 *   é o clássico problema do ovo e da galinha. Esse script é a única porta
 *   de entrada pra isso hoje.
 *
 * Por que NÃO pede senha:
 * - `Usuario.tenantId` é NOT NULL (FK) — todo usuário, MASTER incluso,
 *   precisa pertencer a um tenant. Por isso o script primeiro garante que
 *   existe um tenant "guarda-chuva" pra equipe interna (o tenant-plataforma).
 * - O usuário nasce com `senhaHash: null` e `ativo: true` — o MESMO estado
 *   de um convite normal de dono de tenant. Ele loga em POST /auth/login com
 *   esse e-mail, o fluxo de ativação já existente (identifyEmail) detecta
 *   que não há senha e manda o código de criação por e-mail. Nenhuma senha
 *   passa pela mão deste script, nem pela minha.
 *
 * Idempotência:
 * - O tenant-plataforma é criado via `upsert` por `subdomain` — rodar o
 *   script de novo (ou já ter criado o tenant manualmente antes) não
 *   duplica nada, só reaproveita o que já existe.
 * - Um e-mail já cadastrado (MASTER ou não — o e-mail é único globalmente,
 *   ver migration 0003) barra a execução ANTES de qualquer escrita, com uma
 *   mensagem clara — não deixa o erro cru do Prisma (P2002) subir.
 */

const PLATFORM_TENANT_SUBDOMAIN = 'plataforma-interna';
const PLATFORM_TENANT_NOME = 'Plataforma (interno)';
const MASTER_ROLE = 'MASTER';
// process.argv[0] = node, process.argv[1] = caminho do script — os
// argumentos de verdade (--email=..., --nome=...) começam no índice 2.
const CLI_ARGS_START_INDEX = 2;

// Mesmo padrão de normalização de e-mail já usado em login.schema.js e
// admin-tenants.routes.js — minúsculo, porque o índice único de e-mail
// (migration 0003) é case-insensitive.
const argsSchema = z.object({
  email: z
    .string({ required_error: 'Informe --email' })
    .trim()
    .min(1, 'Informe --email')
    .email('E-mail inválido')
    .transform((email) => email.toLowerCase()),
  nome: z
    .string({ required_error: 'Informe --nome' })
    .trim()
    .min(1, 'Informe --nome'),
});

async function main() {
  const { email, nome } = parseArgs();
  const prisma = getAdminClient();

  const usuarioExistente = await prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, role: true },
  });

  if (usuarioExistente) {
    throw new Error(
      `Já existe um usuário com o e-mail "${email}" (id: ${usuarioExistente.id}, role: ${usuarioExistente.role}). Nada foi criado — escolha outro e-mail ou apague o registro existente antes de rodar de novo.`,
    );
  }

  // Transação: se a criação do usuário falhar por qualquer motivo depois do
  // tenant já existir (ex: race condition improvável), o tenant criado
  // agora não fica órfão sem uso — mas o upsert também garante que rodar de
  // novo não duplica o tenant de qualquer forma.
  const { tenant, usuario } = await prisma.$transaction(async (tx) => {
    const tenantCriadoOuExistente = await tx.tenant.upsert({
      where: { subdomain: PLATFORM_TENANT_SUBDOMAIN },
      update: {},
      create: {
        nome: PLATFORM_TENANT_NOME,
        subdomain: PLATFORM_TENANT_SUBDOMAIN,
        status: 'active',
      },
    });

    const usuarioCriado = await tx.usuario.create({
      data: {
        tenantId: tenantCriadoOuExistente.id,
        nome,
        email,
        role: MASTER_ROLE,
        ativo: true,
        // senhaHash fica null de propósito — ver docstring do arquivo.
      },
      select: { id: true, nome: true, email: true },
    });

    return { tenant: tenantCriadoOuExistente, usuario: usuarioCriado };
  });

  console.log('Tenant-plataforma:', tenant.id, `(${tenant.subdomain})`);
  console.log('Usuário MASTER criado:', usuario.id, '-', usuario.nome, `<${usuario.email}>`);
  console.log(
    '\nSem senha definida. Peça pra essa pessoa logar em POST /auth/login com esse ' +
      'e-mail — o fluxo de ativação já existente manda o código de criação de senha.',
  );
}

/** @returns {{ email: string, nome: string }} */
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
    throw new Error(
      `Uso: node scripts/create-master.js --email=pessoa@empresa.com --nome="Nome Completo"\n\n${mensagens}`,
    );
  }
  return resultado.data;
}

main()
  .catch((error) => {
    console.error('Falha ao criar MASTER:', error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
