import { Worker } from 'bullmq';
import { loadEnv } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { IMPORT_FILA } from '#modules/nucleo/crm/constants.js';
import { processarImportacao } from '#modules/nucleo/crm/services/import.service.js';

/**
 * Entrypoint do worker de importação do CRM — processo separado do HTTP
 * (`pnpm worker:crm`), mesmo papel de um controller: recebe o evento da
 * fila e delega pro service (docs/plano-crm-campos-filtros-import-export.md §3.3).
 * Um job por vez: cada import já é sequencial por linha, e concorrência
 * aqui só disputaria o pool do Neon com o servidor HTTP.
 */

const FAILURE_EXIT_CODE = 1;

function main() {
  const config = loadEnv();
  const worker = new Worker(
    IMPORT_FILA,
    (job) => processarImportacao(job.data.tenantId, job.data.jobId),
    { connection: criarConexaoRedis({ paraWorker: true, redisUrl: config.REDIS_URL }), concurrency: 1 },
  );

  worker.on('completed', (job) => console.info(`[crm-import] job ${job.data.jobId} concluído`));
  worker.on('failed', (job, erro) => console.error(`[crm-import] job ${job?.data.jobId} falhou:`, erro));
  worker.on('error', (erro) => console.error('[crm-import] erro de conexão:', erro));

  const encerrar = async () => {
    await worker.close();
    await disconnectDatabase();
  };
  process.once('SIGINT', () => void encerrar());
  process.once('SIGTERM', () => void encerrar());

  console.info(`[crm-import] aguardando jobs na fila "${IMPORT_FILA}"`);
}

try {
  main();
} catch (erro) {
  console.error(erro);
  process.exit(FAILURE_EXIT_CODE);
}
