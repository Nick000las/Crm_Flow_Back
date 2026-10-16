import { z } from 'zod';
import { MODULES } from '#api/modules.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient, disconnectDatabase } from '#core/db/tenantClient.js';

/**
 * Roda a reconciliação idempotente (`Module.reconciliar`) dos módulos em
 * todo tenant que os contratou — passo de deploy: leva o estado de cada
 * tenant ao que a versão atual do código espera (ex: campos do sistema em
 * `crm_field`). Rodar duas vezes não muda nada na segunda.
 *
 * Uso:
 *   pnpm crm:reconcile                       # CRM, todos os tenants
 *   pnpm crm:reconcile -- --tenant=<uuid>    # CRM, um tenant
 *   pnpm reconcile                           # todos os módulos com reconciliar
 *   pnpm reconcile -- --modulo=crm --tenant=<uuid>
 *
 * Só considera módulo ativo (`disabled_at` nulo). Um tenant que falha não
 * interrompe os demais; o processo sai com código 1 se algum falhou.
 */

// process.argv[0] = node, process.argv[1] = caminho do script.
const CLI_ARGS_START_INDEX = 2;
const MODULOS_RECONCILIAVEIS = MODULES.filter((modulo) => typeof modulo.reconciliar === 'function');
const CHAVES = MODULOS_RECONCILIAVEIS.map((modulo) => modulo.key);

const argsSchema = z.object({
  modulo: z
    .enum(/** @type {[string, ...string[]]} */ (CHAVES), {
      message: `Módulos com reconciliação: ${CHAVES.join(', ')}`,
    })
    .optional(),
  tenant: z.string().uuid('--tenant deve ser um UUID').optional(),
});

async function main() {
  const args = parseArgs();
  const prisma = getAdminClient();
  const modulos = MODULOS_RECONCILIAVEIS.filter((modulo) => !args.modulo || modulo.key === args.modulo);
  let falhas = 0;

  for (const modulo of modulos) {
    const contratos = await prisma.tenantModule.findMany({
      where: { moduleKey: modulo.key, disabledAt: null, ...(args.tenant && { tenantId: args.tenant }) },
      select: { tenantId: true },
      orderBy: { tenantId: 'asc' },
    });
    console.log(`\n[${modulo.key}] ${contratos.length} tenant(s)`);

    for (const { tenantId } of contratos) {
      try {
        const relatorio = await modulo.reconciliar(tenantId);
        console.log(`  ok    ${tenantId}`, JSON.stringify(relatorio));
      } catch (error) {
        falhas += 1;
        console.error(`  FALHA ${tenantId}: ${error.message}`);
      }
    }
  }

  if (falhas > 0) {
    throw new Error(`${falhas} reconciliação(ões) falharam — rode de novo depois de corrigir (é idempotente).`);
  }
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
    throw new Error(`Argumentos inválidos:\n${mensagens}`);
  }
  return resultado.data;
}

main()
  .catch((error) => {
    console.error('Falha na reconciliação:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await encerrarCache();
    await disconnectDatabase();
  });
